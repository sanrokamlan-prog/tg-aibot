const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDecision } = require('../src/ai');
const { normalizeDecision, isIdleEligible } = require('../src/interactionService');
const { shouldUseVoice } = require('../src/decisionDelivery');

test('parses the four interaction actions', () => {
  assert.equal(parseDecision('{"action":"silent"}').action, 'silent');
  assert.equal(parseDecision('{"action":"reaction","reaction":"🔥"}').reaction, '🔥');
  assert.equal(parseDecision('{"action":"sticker","sticker_tag":"开心"}').stickerTag, '开心');
  assert.equal(parseDecision('{"action":"reply","reply":"你好"}').reply, '你好');
  assert.equal(parseDecision(null).action, 'silent');
  assert.equal(parseDecision({ action: 'reply' }).action, 'reply');
});

test('treats zero TTS probability as disabled', () => {
  assert.equal(shouldUseVoice({ voiceEnabled: true, ttsReplyChance: 0 }, () => 0), false);
  assert.equal(shouldUseVoice({ voiceEnabled: true, ttsReplyChance: 1 }, () => 0.99), true);
  assert.equal(shouldUseVoice({ voiceEnabled: false, ttsReplyChance: 1 }, () => 0), false);
});

test('forces a direct mention to receive a reply and respects reaction settings', () => {
  const mention = normalizeDecision({ action: 'silent', reply: '' }, 'mention', { reactionEnabled: true });
  assert.equal(mention.action, 'reply');
  assert.ok(mention.reply);
  assert.equal(
    normalizeDecision({ action: 'reaction', reply: '直接回答' }, 'mention', { reactionEnabled: true }).action,
    'reply'
  );

  const disabled = normalizeDecision(
    { action: 'reaction', reaction: '👍', reply: '文字' },
    'random',
    { reactionEnabled: false }
  );
  assert.equal(disabled.action, 'reply');
});

test('allows only one idle prompt for each human conversation period', () => {
  const now = Date.now();
  const config = {
    aiEnabled: true,
    quietStart: '',
    quietEnd: '',
    idleThresholdMinutes: 20,
    idleCooldownMinutes: 60,
  };
  const state = {
    lastHumanMessageAt: now - 2 * 60 * 60 * 1000,
    lastIdlePromptAt: 0,
    idlePromptedForHumanAt: 0,
  };
  assert.equal(isIdleEligible(state, config, now), true);
  state.idlePromptedForHumanAt = state.lastHumanMessageAt;
  assert.equal(isIdleEligible(state, config, now), false);
  state.lastHumanMessageAt = now - 30 * 60 * 1000;
  assert.equal(isIdleEligible(state, config, now), true);
});
