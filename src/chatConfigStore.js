const { getDatabase } = require('./database');

function numEnv(name, defaultValue) {
  const value = Number(process.env[name] ?? defaultValue);
  return Number.isFinite(value) ? value : defaultValue;
}

function boolEnv(name, defaultValue) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return value.trim().toLowerCase() === 'true';
}

function getDefaultConfig() {
  return {
    aiEnabled: true,
    randomChance: numEnv('RANDOM_REPLY_CHANCE', 0.05),
    minReplyIntervalSeconds: numEnv('MIN_REPLY_INTERVAL_SECONDS', 60),
    minMsgsBetweenReplies: numEnv('MIN_MSGS_BETWEEN_REPLIES', 3),
    idleThresholdMinutes: numEnv('IDLE_THRESHOLD_MINUTES', 20),
    idleCooldownMinutes: numEnv('IDLE_COOLDOWN_MINUTES', 60),
    stickerReplyChance: numEnv('STICKER_REPLY_CHANCE', 0.15),
    reactionEnabled: boolEnv('REACTION_ENABLED', true),
    voiceEnabled: boolEnv('TTS_ENABLED', false),
    ttsReplyChance: numEnv('TTS_REPLY_CHANCE', 1),
    quietStart: process.env.QUIET_HOURS_START || '',
    quietEnd: process.env.QUIET_HOURS_END || '',
    modelMention: '',
    modelRandom: '',
    modelIdle: '',
    personaRules: [],
  };
}

function getChatConfig(chatId) {
  const db = getDatabase();
  const row = db.prepare('SELECT config_json FROM chat_configs WHERE chat_id = ?').get(String(chatId));
  if (!row) return getDefaultConfig();

  try {
    return { ...getDefaultConfig(), ...JSON.parse(row.config_json) };
  } catch (error) {
    console.error(`群配置损坏，使用默认值: chat=${chatId}:`, error.message);
    return getDefaultConfig();
  }
}

function setChatConfig(chatId, patch) {
  const db = getDatabase();
  const config = { ...getChatConfig(chatId), ...patch };
  db.prepare(`
    INSERT INTO chat_configs(chat_id, config_json, updated_at) VALUES(?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
  `).run(String(chatId), JSON.stringify(config), Date.now());
  return config;
}

module.exports = { getChatConfig, setChatConfig, getDefaultConfig };
