const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ai-cli-'));
process.env.OPENCODE_DATA_DIR = dir;
process.env.BOT_TOKEN = 'never-pass-to-cli';
process.env.AI_API_KEY = 'never-pass-to-cli';
const { runProcess, requestOpenCode, parseCliOutput, cliEnvironment, resolvePackageBinary } = require('../src/opencode');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const textEvent = (text, id = 'text-1') => JSON.stringify({ type: 'text', part: { id, text } });

test('reads completed text only, rejects error events, never includes thinking or tools', () => {
  const text = '{"action":"reply","reply":"你好"}';
  assert.equal(parseCliOutput([
    JSON.stringify({ type: 'reasoning', part: { text: 'private' } }),
    JSON.stringify({ type: 'tool_use', part: { text: 'private' } }),
    textEvent(text), textEvent(text),
  ].join('\n')), text);
  assert.throws(() => parseCliOutput(JSON.stringify({ type: 'error', error: { status: 429, message: 'secret' } })), error => error.status === 429 && !error.message.includes('secret'));
  assert.throws(() => parseCliOutput(''), /未返回文字/);
  assert.equal(parseCliOutput([
    JSON.stringify({ type: 'text', timestamp: 1, part: { id: 'delta', text: '{"action":"reply",' } }),
    JSON.stringify({ type: 'text', timestamp: 2, part: { id: 'delta', text: '"reply":"你好"}' } }),
  ].join('\n')), '{"action":"reply","reply":"你好"}');
});

test('runs a real child with stdin, preserves Unicode, enforces timeout and output bounds', async () => {
  const input = '中文 😀 $(echo pwned) `cmd` & /file';
  const out = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input });
  assert.equal(out, input);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 }), /超时/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { maxBytes: 100 }), /超过限制/);
});

test('isolates CLI secrets and denies tools', () => {
  const env = cliEnvironment();
  assert.equal(env.BOT_TOKEN, undefined);
  assert.equal(env.AI_API_KEY, undefined);
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.permissions[0].effect, 'ask');
  assert.equal(config.agents, undefined);
  assert.equal(config.policies, undefined);
});

test('resolves the declared npm launcher on Linux as well as Windows', () => {
  const packageDir = path.join(dir, 'fixture-package');
  fs.mkdirSync(packageDir);
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ bin: { opencode: './bin/opencode.exe' } }));
  assert.equal(resolvePackageBinary(packageDir), path.join(packageDir, 'bin', 'opencode.exe'));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ bin: { opencode: './bin/opencode' } }));
  assert.equal(resolvePackageBinary(packageDir), path.join(packageDir, 'bin', 'opencode'));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ bin: { opencode: '../../escape' } }));
  assert.throws(() => resolvePackageBinary(packageDir), /配置无效/);
});

test('can reuse the standard OpenCode profile without passing bot credentials', () => {
  process.env.OPENCODE_ISOLATED = 'false';
  try {
    const env = cliEnvironment();
    assert.equal(env.XDG_DATA_HOME, process.env.XDG_DATA_HOME);
    assert.equal(env.BOT_TOKEN, undefined);
    assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).permissions[0].effect, 'ask');
  } finally { delete process.env.OPENCODE_ISOLATED; }
});

test('auto-free changes models after CLI failure and invalid output, then skips cooling models', async () => {
  const calls = [];
  const models = ['opencode/test-a-free', 'opencode/test-b-free', 'opencode/test-c-free'];
  const dependencies = {
    ensure: async () => 'fake-opencode',
    connect: async () => ({ url: 'http://127.0.0.1:4096', env: {} }),
    discover: async () => models,
    run: async (_bin, args, options) => {
      const selected = args[args.indexOf('--model') + 1];
      calls.push(selected);
      assert.ok(args.includes('--server'));
      assert.equal(args.includes('--standalone'), false);
      assert.equal(args[args.indexOf('--agent') + 1], 'build');
      assert.equal(args.includes('--continue'), false);
      assert.equal(options.input, 'system\n\nuser');
      if (selected.endsWith('a-free')) throw new Error('CLI request failed');
      if (selected.endsWith('b-free')) return textEvent('{"action":');
      return textEvent('{"action":"reply","reply":"接上了"}');
    },
  };
  const request = { sys: 'system', userContent: 'user', model: 'auto-free', mode: 'mention' };
  const result = await requestOpenCode(request, dependencies);
  assert.equal(result.model, models[2]);
  assert.equal(JSON.parse(result.text).reply, '接上了');
  assert.deepEqual(calls, models);
  calls.length = 0;
  await requestOpenCode(request, dependencies);
  assert.deepEqual(calls, [models[2]]);
});
