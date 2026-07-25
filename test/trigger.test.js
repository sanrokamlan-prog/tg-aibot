const test = require('node:test');
const assert = require('node:assert/strict');

const { computeAdaptiveChance, isQuietHours } = require('../src/trigger');

test('reduces random interruption probability in fast conversations', () => {
  const now = Date.now();
  const busy = {
    messages: Array.from({ length: 10 }, (_, index) => ({
      user: `u${index % 4}`, ts: now - index * 1000, fromBot: false,
    })),
  };
  const quiet = { messages: [{ user: 'u1', ts: now, fromBot: false }] };
  assert.ok(computeAdaptiveChance(busy, 0.1, now) < computeAdaptiveChance(quiet, 0.1, now));
});

test('supports quiet-hour ranges that cross midnight', () => {
  const date = new Date(2026, 6, 25, 23, 30);
  assert.equal(isQuietHours({ quietStart: '23:00', quietEnd: '08:00' }, date), true);
  assert.equal(isQuietHours({ quietStart: '09:00', quietEnd: '18:00' }, date), false);
});
