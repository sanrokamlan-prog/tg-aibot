const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
process.env.RULE_COOLDOWN_SECONDS = '60';

const { addRule } = require('../src/ruleStore');
const { handleMessage } = require('../src/extensions/keywordRules');

test('always applies block rules while cooling down repeated notices', async () => {
  addRule(-200, 'block', '广告', '请勿发广告');
  let deleted = 0;
  let replied = 0;
  const ctx = {
    chat: { id: -200 },
    message: { message_id: 1 },
    deleteMessage: async () => { deleted += 1; },
    reply: async () => { replied += 1; },
  };

  assert.equal(await handleMessage(ctx, '广告内容'), true);
  assert.equal(await handleMessage(ctx, '又一条广告'), true);
  assert.equal(deleted, 2);
  assert.equal(replied, 1);
});
