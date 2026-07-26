const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-aibot-db-'));
process.env.DATA_DIR = tempDir;
process.env.DATABASE_PATH = path.join(tempDir, 'bot.db');
process.env.MAX_HISTORY = '3';
process.env.MESSAGE_TTL_HOURS = '1';

fs.writeFileSync(path.join(tempDir, 'chat-config.json'), JSON.stringify({
  chats: { '-100': { randomChance: 0.2, personaRules: ['旧规则'] } },
}));
fs.writeFileSync(path.join(tempDir, 'stickers.json'), JSON.stringify({
  chats: { '-100': [{ fileId: 'legacy-sticker', tags: ['开心'] }] },
}));

const { getChatConfig, setChatConfig, normalizeChatConfig } = require('../src/chatConfigStore');
const { getChatStickers } = require('../src/stickerStore');
const {
  getChat,
  pushMessage,
  markBotReplied,
  markIdlePrompted,
  clearConversation,
} = require('../src/contextStore');
const { addRule, getRules } = require('../src/ruleStore');
const { recordAiUsage, getUsageSummary, pruneExpiredUsage } = require('../src/usageStore');
const { closeDatabase, getDatabase } = require('../src/database');

test('migrates legacy JSON and persists versioned bot state in SQLite', () => {
  assert.equal(getChatConfig(-100).randomChance, 0.2);
  assert.deepEqual(getChatConfig(-100).personaRules, ['旧规则']);
  assert.equal(getChatStickers(-100)[0].fileId, 'legacy-sticker');

  setChatConfig(-100, { voiceEnabled: true });
  const now = Date.now();
  for (let index = 0; index < 4; index += 1) {
    pushMessage(-100, 7, {
      user: 'tester', text: `message-${index}`, ts: now + index, fromBot: false,
      telegramMessageId: index + 1,
    });
  }
  const state = getChat(-100, 7);
  assert.equal(state.messages.length, 3);
  assert.equal(state.messages[0].text, 'message-1');
  assert.equal(state.msgSinceBotReply, 4);

  markBotReplied(-100, 7);
  assert.equal(state.msgSinceBotReply, 0);
  markIdlePrompted(-100, 7);
  assert.equal(state.idlePromptedForHumanAt, state.lastHumanMessageAt);

  addRule(-100, 'reply', 'ping', 'pong');
  assert.equal(getRules(-100).length, 1);
  recordAiUsage({
    chatId: -100, mode: 'mention', model: 'test', latencyMs: 25,
    inputChars: 10, outputChars: 5, success: true,
  });
  assert.equal(getUsageSummary(-100).requests, 1);
  assert.equal(getChatConfig(-100).voiceEnabled, true);
});

test('enforces message TTL in memory and clears one topic atomically', () => {
  const now = Date.now();
  pushMessage(-101, 9, {
    user: 'old-user', text: 'expired', ts: now - 2 * 60 * 60 * 1000,
    fromBot: false, telegramMessageId: 1,
  });
  pushMessage(-101, 9, {
    user: 'new-user', text: 'current', ts: now,
    fromBot: false, telegramMessageId: 2,
  });

  assert.deepEqual(getChat(-101, 9).messages.map((message) => message.text), ['current']);
  clearConversation(-101, 9);
  assert.equal(getChat(-101, 9).messages.length, 0);
  assert.equal(getChat(-101, 9).msgSinceBotReply, 0);
});

test('physically prunes expired usage records', () => {
  getDatabase().prepare('UPDATE ai_usage SET ts = ? WHERE chat_id = ?')
    .run(Date.now() - 31 * 24 * 60 * 60 * 1000, '-100');
  assert.equal(pruneExpiredUsage(), 1);
  assert.equal(getUsageSummary(-100).requests, 0);
});

test('normalizes corrupted or out-of-range chat configuration', () => {
  const normalized = normalizeChatConfig({
    aiEnabled: 'yes',
    randomChance: null,
    stickerReplyChance: -1,
    personaRules: [' valid ', null, ''],
  });
  assert.equal(normalized.aiEnabled, true);
  assert.equal(normalized.randomChance, 0.05);
  assert.equal(normalized.stickerReplyChance, 0.15);
  assert.deepEqual(normalized.personaRules, ['valid']);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
