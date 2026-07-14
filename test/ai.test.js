const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY = 'test-key';
process.env.AI_REQUEST_TIMEOUT_MS = '20';

const { decideAndReply } = require('../src/ai');

test('aborts an AI request after the configured timeout', async () => {
  const originalFetch = global.fetch;

  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  try {
    await assert.rejects(
      decideAndReply({ messages: [], mode: 'mention' }),
      /AI API 请求超时（20ms）/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
