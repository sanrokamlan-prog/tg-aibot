const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchPage, isPrivateIp, resolvePublicUrl } = require('../src/linkPreview');
const { firstMessageUrl } = require('../src/mediaContext');

test('blocks private link-preview addresses', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('192.168.1.5'), true);
  assert.equal(isPrivateIp('192.0.2.1'), true);
  assert.equal(isPrivateIp('198.51.100.2'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('2001:db8::1'), true);
  assert.equal(isPrivateIp('2002:7f00:1::'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('rejects a hostname when any resolved address is private', async () => {
  await assert.rejects(
    resolvePublicUrl('https://example.test', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /内网或保留地址/
  );
});

test('pins validated addresses and revalidates redirects', async () => {
  let closed = 0;
  const page = await fetchPage('https://example.test/start', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcherFactory: (addresses) => {
      assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      return { close: async () => { closed += 1; } };
    },
    fetchImpl: async (_url, options) => {
      assert.ok(options.dispatcher);
      return new Response('<html><title>Example</title><body>ok</body></html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.match(page.html, /Example/);
  assert.equal(closed, 1);

  let requests = 0;
  await assert.rejects(fetchPage('https://public.test', {
    lookup: async (hostname) => [{
      address: hostname === 'internal.test' ? '127.0.0.1' : '93.184.216.34',
      family: 4,
    }],
    dispatcherFactory: () => ({ close: async () => {} }),
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: 'http://internal.test/secret' } });
    },
  }), /内网或保留地址/);
  assert.equal(requests, 1);
});

test('extracts URLs from Telegram entities', () => {
  assert.equal(firstMessageUrl({
    text: '打开链接',
    entities: [{ type: 'text_link', offset: 0, length: 4, url: 'https://example.com' }],
  }), 'https://example.com');
  assert.equal(firstMessageUrl({ text: '看 https://example.org/a' }), 'https://example.org/a');
});
