const { getChat } = require('./contextStore');
const { getChatConfig } = require('./chatConfigStore');

function normalizeUsername(username) {
  return (username || '').replace(/^@/, '').toLowerCase();
}

function isMention(ctx, botInfo) {
  const msg = ctx.message;
  if (!msg) return false;
  const botId = botInfo?.id;
  const botUsername = normalizeUsername(botInfo?.username);

  if (msg.reply_to_message?.from) {
    const repliedUser = msg.reply_to_message.from;
    if (botId && repliedUser.id === botId) return true;
    if (botUsername && normalizeUsername(repliedUser.username) === botUsername) return true;
  }

  const text = msg.text || msg.caption || '';
  for (const entity of msg.entities || msg.caption_entities || []) {
    if (entity.type === 'mention') {
      const mention = text.slice(entity.offset, entity.offset + entity.length);
      if (botUsername && normalizeUsername(mention) === botUsername) return true;
    }
    if (entity.type === 'text_mention' && botId && entity.user?.id === botId) return true;
  }
  return false;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isQuietHours(config, now = new Date()) {
  const start = parseClock(config.quietStart);
  const end = parseClock(config.quietEnd);
  if (start == null || end == null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function computeAdaptiveChance(state, baseChance, now = Date.now()) {
  const recent = state.messages.filter((message) => !message.fromBot && now - message.ts <= 2 * 60 * 1000);
  const activeUsers = new Set(recent.map((message) => message.user)).size;
  let multiplier = 1;
  if (recent.length >= 8) multiplier *= 0.45;
  else if (recent.length >= 4) multiplier *= 0.75;
  if (activeUsers >= 3 && recent.length < 8) multiplier *= 1.1;
  return Math.min(0.5, Math.max(0, baseChance * multiplier));
}

function decideTrigger(ctx, botInfo, threadId = 0) {
  const chatId = ctx.chat.id;
  const state = getChat(chatId, threadId);
  const config = getChatConfig(chatId);
  if (!config.aiEnabled) return null;
  if (isMention(ctx, botInfo)) return 'mention';
  if (isQuietHours(config)) return null;

  const now = Date.now();
  const cooledDown = now - state.lastBotReplyAt > config.minReplyIntervalSeconds * 1000;
  const enoughGap = state.msgSinceBotReply >= config.minMsgsBetweenReplies;
  const chance = computeAdaptiveChance(state, config.randomChance, now);
  return cooledDown && enoughGap && Math.random() < chance ? 'random' : null;
}

module.exports = { decideTrigger, isMention, isQuietHours, computeAdaptiveChance };
