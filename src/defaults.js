const AI_DEFAULTS = Object.freeze({
  maxContextMessages: 12,
  maxInputChars: 1500,
  maxMessageChars: 160,
  maxOutputTokens: 120,
  requestTimeoutMs: 30000,
  responseMaxBytes: 1024 * 1024,
});

const CHAT_DEFAULTS = Object.freeze({
  randomChance: 0.05,
  minReplyIntervalSeconds: 60,
  minMsgsBetweenReplies: 3,
  idleThresholdMinutes: 20,
  idleCooldownMinutes: 60,
  stickerReplyChance: 0.15,
  reactionEnabled: true,
  voiceEnabled: false,
  ttsReplyChance: 1,
});

const STORAGE_DEFAULTS = Object.freeze({
  maxHistory: 40,
  messageTtlHours: 24,
  usageTtlDays: 30,
});

module.exports = { AI_DEFAULTS, CHAT_DEFAULTS, STORAGE_DEFAULTS };
