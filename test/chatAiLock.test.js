const test = require('node:test');
const assert = require('node:assert/strict');

const { tryAcquireChatAi, releaseChatAi } = require('../src/chatAiLock');

test('allows only one active AI interaction per chat', () => {
  assert.equal(tryAcquireChatAi(123), true);
  assert.equal(tryAcquireChatAi('123'), false);
  assert.equal(tryAcquireChatAi(456), true);

  releaseChatAi(123);
  assert.equal(tryAcquireChatAi(123), true);

  releaseChatAi(123);
  releaseChatAi(456);
});
