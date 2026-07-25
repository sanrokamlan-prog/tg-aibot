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

const { getChatConfig, setChatConfig } = require('../src/chatConfigStore');
const { getChatStickers } = require('../src/stickerStore');
const {
  getChat,
  pushMessage,
  markBotReplied,
  markIdlePrompted,
} = require('../src/contextStore');
const { addRule, getRules } = require('../src/ruleStore');
const { recordAiUsage, getUsageSummary } = require('../src/usageStore');
const { closeDatabase } = require('../src/database');

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

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
