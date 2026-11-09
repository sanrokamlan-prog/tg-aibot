const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ai-validation-'));
process.env.DATA_DIR = directory;
process.env.OPENCODE_VALIDATION_MODELS = 'opencode/test-free,paid/provider';
const { validate } = require('../scripts/opencode-validate');
const reportFile = path.join(directory, 'opencode-validation', 'report.json');
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function fakeClient() {
  return {
    ensureOpenCode: async () => '/synthetic/cli', cliEnvironment: () => ({}),
    runProcess: async (_bin, args) => args[0] === '--version' ? '2.2.6' : '你好',
    listFreeModels: async () => ['opencode/test-free'],
    startOpenCodeService: async () => ({ url: 'http://127.0.0.1:1', env: {} }),
    openCodeServiceStatus: () => ({ running: true }), parseCliOutput: text => text,
    stopOpenCodeService: async () => {},
  };
}

test('requires a sendable bot decision and excludes non-catalog models', async () => {
  const result = await validate({ client: fakeClient(), decide: async () => {
    assert.equal(process.env.OPENCODE_MODELS, 'opencode/test-free');
    return { action: 'reply', reply: '歇一会儿' };
  } });
  assert.equal(result.ok, true); assert.equal(result.models.length, 1);
  assert.equal(result.models[0].native.ok, true); assert.equal(result.models[0].bot.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(reportFile)).ok, true);
  assert.equal(process.env.OPENCODE_MODELS, undefined);
});

test('reports real generation failure even when installation, catalog and native text work', async () => {
  const result = await validate({ client: fakeClient(), decide: async () => {
    const error = new Error('never-publish-secret-body'); error.status = 429; throw error;
  } });
  assert.equal(result.ok, false); assert.equal(result.models[0].bot.status, 429);
  assert.equal(fs.readFileSync(reportFile, 'utf8').includes('never-publish-secret-body'), false);
  assert.ok(result.completedAt);
});

test('saves partial stages and cleans up after installation failure', async () => {
  let stopped = false;
  const client = fakeClient();
  client.ensureOpenCode = async () => { throw new Error('private installation output'); };
  client.stopOpenCodeService = async () => { stopped = true; };
  const result = await validate({ client });
  assert.equal(result.ok, false); assert.equal(result.models.length, 0); assert.equal(stopped, true);
  assert.equal(JSON.parse(fs.readFileSync(reportFile)).failure.error, 'request_failed');
});
