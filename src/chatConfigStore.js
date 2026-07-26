const { getDatabase } = require('./database');
const { CHAT_DEFAULTS } = require('./defaults');
const { envBool, envNumber } = require('./env');

function getDefaultConfig() {
  return {
    aiEnabled: true,
    randomChance: envNumber('RANDOM_REPLY_CHANCE', CHAT_DEFAULTS.randomChance, { min: 0, max: 1 }),
    minReplyIntervalSeconds: envNumber('MIN_REPLY_INTERVAL_SECONDS', CHAT_DEFAULTS.minReplyIntervalSeconds, { min: 0 }),
    minMsgsBetweenReplies: envNumber('MIN_MSGS_BETWEEN_REPLIES', CHAT_DEFAULTS.minMsgsBetweenReplies, { min: 0 }),
    idleThresholdMinutes: envNumber('IDLE_THRESHOLD_MINUTES', CHAT_DEFAULTS.idleThresholdMinutes, { min: 1 }),
    idleCooldownMinutes: envNumber('IDLE_COOLDOWN_MINUTES', CHAT_DEFAULTS.idleCooldownMinutes, { min: 1 }),
    stickerReplyChance: envNumber('STICKER_REPLY_CHANCE', CHAT_DEFAULTS.stickerReplyChance, { min: 0, max: 1 }),
    reactionEnabled: envBool('REACTION_ENABLED', CHAT_DEFAULTS.reactionEnabled),
    voiceEnabled: envBool('TTS_ENABLED', CHAT_DEFAULTS.voiceEnabled),
    ttsReplyChance: envNumber('TTS_REPLY_CHANCE', CHAT_DEFAULTS.ttsReplyChance, { min: 0, max: 1 }),
    quietStart: process.env.QUIET_HOURS_START || '',
    quietEnd: process.env.QUIET_HOURS_END || '',
    modelMention: '',
    modelRandom: '',
    modelIdle: '',
    personaRules: [],
  };
}

function boundedNumber(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function cleanString(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeChatConfig(value) {
  const defaults = getDefaultConfig();
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    aiEnabled: typeof config.aiEnabled === 'boolean' ? config.aiEnabled : defaults.aiEnabled,
    randomChance: boundedNumber(config.randomChance, defaults.randomChance, 0, 1),
    minReplyIntervalSeconds: boundedNumber(config.minReplyIntervalSeconds, defaults.minReplyIntervalSeconds, 0, 86400),
    minMsgsBetweenReplies: boundedNumber(config.minMsgsBetweenReplies, defaults.minMsgsBetweenReplies, 0, 1000),
    idleThresholdMinutes: boundedNumber(config.idleThresholdMinutes, defaults.idleThresholdMinutes, 1, 10080),
    idleCooldownMinutes: boundedNumber(config.idleCooldownMinutes, defaults.idleCooldownMinutes, 1, 10080),
    stickerReplyChance: boundedNumber(config.stickerReplyChance, defaults.stickerReplyChance, 0, 1),
    reactionEnabled: typeof config.reactionEnabled === 'boolean' ? config.reactionEnabled : defaults.reactionEnabled,
    voiceEnabled: typeof config.voiceEnabled === 'boolean' ? config.voiceEnabled : defaults.voiceEnabled,
    ttsReplyChance: boundedNumber(config.ttsReplyChance, defaults.ttsReplyChance, 0, 1),
    quietStart: config.quietStart == null ? defaults.quietStart : cleanString(config.quietStart, 5),
    quietEnd: config.quietEnd == null ? defaults.quietEnd : cleanString(config.quietEnd, 5),
    modelMention: cleanString(config.modelMention),
    modelRandom: cleanString(config.modelRandom),
    modelIdle: cleanString(config.modelIdle),
    personaRules: Array.isArray(config.personaRules)
      ? config.personaRules.map((rule) => cleanString(rule, 500)).filter(Boolean).slice(0, 30)
      : defaults.personaRules,
  };
}

function getChatConfig(chatId) {
  const db = getDatabase();
  const row = db.prepare('SELECT config_json FROM chat_configs WHERE chat_id = ?').get(String(chatId));
  if (!row) return getDefaultConfig();

  try {
    return normalizeChatConfig(JSON.parse(row.config_json));
  } catch (error) {
    console.error(`群配置损坏，使用默认值: chat=${chatId}:`, error.message);
    return getDefaultConfig();
  }
}

function setChatConfig(chatId, patch) {
  const db = getDatabase();
  const config = normalizeChatConfig({ ...getChatConfig(chatId), ...patch });
  db.prepare(`
    INSERT INTO chat_configs(chat_id, config_json, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
  `).run(String(chatId), JSON.stringify(config), Date.now());
  return config;
}

module.exports = { getChatConfig, setChatConfig, getDefaultConfig, normalizeChatConfig };
