const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATABASE_PATH = ':memory:';
const { loadProviders, createProviderRouter, providerRouter } = require('../src/providerPool');
const { decideAndReply } = require('../src/ai');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ai-pool-'));
const file = path.join(dir, 'providers.json');
process.env.AI_PROVIDERS_FILE = file;
process.env.POOL_KEY_1 = 'secret-one';
process.env.POOL_KEY_2 = 'secret-two';
function configure(providers, strategy = 'round_robin') {
  fs.writeFileSync(file, JSON.stringify({ providers, strategy }));
  providerRouter.reset();
}
const base = { name: 'first', baseUrl: 'https://first.test/v1', apiKeyEnv: 'POOL_KEY_1', models: ['one', 'two'] };
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); require('../src/database').closeDatabase(); });

test('rotates keys and models, reloads files, preserves each provider model', () => {
  configure([{ ...base, apiKeysEnv: ['POOL_KEY_1', 'POOL_KEY_2'] }, { ...base, name: 'other', models: ['third'] }]);
  const pool = loadProviders();
  assert.equal(pool.providers.length, 5);
  const router = createProviderRouter();
  assert.deepEqual(Array.from({ length: 5 }, () => router.candidates(pool, 'mention')[0].apiKey), ['secret-one', 'secret-one', 'secret-two', 'secret-two', 'secret-one']);
  assert.equal(router.candidates(pool, 'mention', { mention: 'other/custom' })[0].model, 'custom');
  assert.ok(['one', 'two'].includes(router.candidates(pool, 'mention', { mention: 'other/custom' }).find(p => p.name === 'first').model));
  configure([{ ...base, models: ['changed'] }]);
  assert.equal(loadProviders().providers[0].model, 'changed');
});

test('cools failures, honors retry-after, and recovers using a clock', () => {
  configure([base]);
  const pool = loadProviders();
  let time = 100;
  const router = createProviderRouter({ now: () => time });
  const first = router.candidates(pool, 'mention')[0];
  router.failure(first, { status: 429, retryAfterMs: 120000 });
  assert.equal(router.candidates(pool, 'mention').length, 1);
  time += 120001;
  assert.equal(router.candidates(pool, 'mention').length, 2);
  router.success(first);
  assert.equal(router.status(pool)[0].cooldownMs, 0);
});

test('falls through auth failure, empty output, invalid JSON, then returns a sendable answer', async () => {
  configure([{ ...base, models: ['auth', 'empty', 'broken', 'answer'] }], 'failover');
  const original = global.fetch;
  const seen = [];
  global.fetch = async (_url, options) => {
    const { model } = JSON.parse(options.body);
    seen.push(model);
    if (model === 'auth') return new Response('secret-one should not be echoed', { status: 401 });
    return Response.json({ choices: [{ message: { content: model === 'empty' ? '' : model === 'broken' ? '{"action":' : '{"action":"reply","reply":"终于接上了"}' } }] });
  };
  try {
    const result = await decideAndReply({ messages: [], mode: 'mention' });
    assert.equal(result.reply, '终于接上了');
    assert.equal(result.attempts, 4);
    assert.deepEqual(seen, ['auth', 'empty', 'broken', 'answer']);
    seen.length = 0;
    await decideAndReply({ messages: [], mode: 'mention' });
    assert.deepEqual(seen, ['answer']);
  } finally { global.fetch = original; }
});

test('does not accept silent output for mentions and limits attempts', async () => {
  configure([{ ...base, models: ['silent', 'sticker', 'good'] }], 'failover');
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: '{"action":"silent"}' } }] });
  };
  process.env.AI_MAX_ATTEMPTS = '2';
  try {
    await assert.rejects(decideAndReply({ messages: [], mode: 'mention' }), /可发送/);
    assert.equal(calls, 2);
  } finally { global.fetch = original; delete process.env.AI_MAX_ATTEMPTS; }
});

test('rejects bad configuration without exposing credentials and skips text-only models for images', () => {
  configure([{ ...base, apiType: 'made-up' }]);
  assert.throws(loadProviders, /apiType/);
  configure([{ ...base, supportsVision: false }, { name: 'cli', apiType: 'opencode', model: 'auto-free' }]);
  assert.equal(createProviderRouter().candidates(loadProviders(), 'mention', {}, 'data:image/png;base64,AAAA').length, 0);
});
