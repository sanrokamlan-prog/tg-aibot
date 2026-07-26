const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

const { AI_DEFAULTS, CHAT_DEFAULTS, STORAGE_DEFAULTS } = require('../src/defaults');
const { envNumber } = require('../src/env');
const { buildEnv, quoteEnv, writeEnvFile } = require('../scripts/setup-env');

const expectedEnvDefaults = {
  AI_MAX_CONTEXT_MESSAGES: AI_DEFAULTS.maxContextMessages,
  AI_MAX_INPUT_CHARS: AI_DEFAULTS.maxInputChars,
  AI_MAX_MESSAGE_CHARS: AI_DEFAULTS.maxMessageChars,
  AI_MAX_OUTPUT_TOKENS: AI_DEFAULTS.maxOutputTokens,
  AI_REQUEST_TIMEOUT_MS: AI_DEFAULTS.requestTimeoutMs,
  AI_RESPONSE_MAX_BYTES: AI_DEFAULTS.responseMaxBytes,
  RANDOM_REPLY_CHANCE: CHAT_DEFAULTS.randomChance,
  MIN_REPLY_INTERVAL_SECONDS: CHAT_DEFAULTS.minReplyIntervalSeconds,
  MIN_MSGS_BETWEEN_REPLIES: CHAT_DEFAULTS.minMsgsBetweenReplies,
  IDLE_THRESHOLD_MINUTES: CHAT_DEFAULTS.idleThresholdMinutes,
  IDLE_COOLDOWN_MINUTES: CHAT_DEFAULTS.idleCooldownMinutes,
  STICKER_REPLY_CHANCE: CHAT_DEFAULTS.stickerReplyChance,
  TTS_REPLY_CHANCE: CHAT_DEFAULTS.ttsReplyChance,
  MAX_HISTORY: STORAGE_DEFAULTS.maxHistory,
  MESSAGE_TTL_HOURS: STORAGE_DEFAULTS.messageTtlHours,
  USAGE_TTL_DAYS: STORAGE_DEFAULTS.usageTtlDays,
};

test('keeps .env.example aligned with runtime defaults', () => {
  const parsed = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.example')));
  for (const [name, value] of Object.entries(expectedEnvDefaults)) {
    assert.equal(parsed[name], String(value), `${name} drifted from runtime defaults`);
  }
});

test('builds a parseable env file without losing special characters', () => {
  const envText = buildEnv({
    botToken: '123456789:AAxxxxxxxxxxxxxxxxxxxx',
    apiType: 'chat_completions',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key#with spaces',
    model: 'test-model',
    randomModel: '',
    idleModel: '',
    disableResponseStorage: 'true',
    maxContextMessages: String(AI_DEFAULTS.maxContextMessages),
    maxInputChars: String(AI_DEFAULTS.maxInputChars),
    maxMessageChars: String(AI_DEFAULTS.maxMessageChars),
    maxOutputTokens: String(AI_DEFAULTS.maxOutputTokens),
    allowedChatIds: '-100',
    adminUserIds: '123',
    stickerIds: '',
    stickerReplyChance: String(CHAT_DEFAULTS.stickerReplyChance),
    personaPrompt: '第一行\n第二行',
    randomReplyChance: String(CHAT_DEFAULTS.randomChance),
    minReplyIntervalSeconds: String(CHAT_DEFAULTS.minReplyIntervalSeconds),
    minMsgsBetweenReplies: String(CHAT_DEFAULTS.minMsgsBetweenReplies),
    idleThresholdMinutes: String(CHAT_DEFAULTS.idleThresholdMinutes),
    idleCooldownMinutes: String(CHAT_DEFAULTS.idleCooldownMinutes),
    maxHistory: String(STORAGE_DEFAULTS.maxHistory),
  });
  const parsed = dotenv.parse(envText);
  assert.equal(parsed.AI_API_KEY, 'key#with spaces');
  assert.equal(parsed.PERSONA_PROMPT, '第一行\n第二行');
  assert.equal(parsed.AI_RESPONSE_MAX_BYTES, String(AI_DEFAULTS.responseMaxBytes));
  assert.equal(quoteEnv('plain'), 'plain');
});

test('treats blank numeric environment values as unset', () => {
  process.env.TEST_BLANK_NUMBER = '';
  try {
    assert.equal(envNumber('TEST_BLANK_NUMBER', 42), 42);
  } finally {
    delete process.env.TEST_BLANK_NUMBER;
  }
});

test('atomically replaces an env file without leaving a temporary file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-aibot-env-'));
  const targetPath = path.join(directory, '.env');
  try {
    fs.writeFileSync(targetPath, 'OLD=value\n');
    writeEnvFile('NEW=value\n', targetPath);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'NEW=value\n');
    assert.equal(fs.existsSync(`${targetPath}.setup-${process.pid}`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
