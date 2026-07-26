const test = require('node:test');
const assert = require('node:assert/strict');

const {
  tryAcquireChatAi,
  releaseChatAi,
  beginChatAiShutdown,
  waitForChatAiIdle,
  getActiveChatAiCount,
} = require('../src/chatAiLock');

test('allows only one active AI interaction per chat', () => {
  assert.equal(tryAcquireChatAi(123), true);
  assert.equal(tryAcquireChatAi('123'), false);
  assert.equal(tryAcquireChatAi(456), true);

  releaseChatAi(123);
  assert.equal(tryAcquireChatAi(123), true);

  releaseChatAi(123);
  releaseChatAi(456);
});

test('drains active work and rejects new work during shutdown', async () => {
  assert.equal(tryAcquireChatAi(789), true);
  assert.equal(getActiveChatAiCount(), 1);
  const drained = waitForChatAiIdle(1000);
  beginChatAiShutdown();
  assert.equal(tryAcquireChatAi(790), false);
  releaseChatAi(789);
  assert.equal(await drained, true);
  assert.equal(getActiveChatAiCount(), 0);
});
