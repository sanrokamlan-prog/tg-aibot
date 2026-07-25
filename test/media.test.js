const test = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateIp } = require('../src/linkPreview');
const { firstMessageUrl } = require('../src/mediaContext');

test('blocks private link-preview addresses', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('192.168.1.5'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('extracts URLs from Telegram entities', () => {
  assert.equal(firstMessageUrl({
    text: '打开链接',
    entities: [{ type: 'text_link', offset: 0, length: 4, url: 'https://example.com' }],
  }), 'https://example.com');
  assert.equal(firstMessageUrl({ text: '看 https://example.org/a' }), 'https://example.org/a');
});
