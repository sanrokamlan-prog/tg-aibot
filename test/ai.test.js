const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY = 'test-key';
process.env.AI_BASE_URL = 'https://primary.test/v1';
process.env.AI_MODEL = 'primary-model';
process.env.AI_REQUEST_TIMEOUT_MS = '20';
process.env.AI_FALLBACK_BASE_URL = 'https://fallback.test/v1';
process.env.AI_FALLBACK_API_KEY = 'fallback-key';
process.env.AI_FALLBACK_MODEL = 'fallback-model';

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

test('switches to the fallback provider on retryable errors', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('primary.test')) return new Response('unavailable', { status: 503 });
    return Response.json({
      choices: [{ message: { content: '{"action":"reply","reply":"备用接口正常"}' } }],
    });
  };

  try {
    const result = await decideAndReply({ messages: [], mode: 'mention' });
    assert.equal(result.provider, 'fallback');
    assert.equal(result.model, 'fallback-model');
    assert.equal(result.reply, '备用接口正常');
    assert.equal(urls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('accepts array-form chat completion content', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({
    choices: [{ message: { content: [{ type: 'text', text: '{"action":"reaction","reaction":"🔥"}' }] } }],
  });

  try {
    const result = await decideAndReply({ messages: [], mode: 'random' });
    assert.equal(result.action, 'reaction');
    assert.equal(result.reaction, '🔥');
    assert.equal(result.provider, 'primary');
  } finally {
    global.fetch = originalFetch;
  }
});
