const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchBuffer } = require('../src/http');

test('enforces response limits without forwarding internal timeout options', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal('timeoutMs' in options, false);
    return new Response(Buffer.alloc(16), { status: 200 });
  };
  try {
    await assert.rejects(fetchBuffer('https://example.test', { timeoutMs: 100 }, 8), /字节限制/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('keeps a bounded error response for diagnostics', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('provider unavailable', { status: 503 });
  try {
    await assert.rejects(fetchBuffer('https://example.test'), /HTTP 503: provider unavailable/);
  } finally {
    global.fetch = originalFetch;
  }
});
