const { getChat } = require('./contextStore');

const MIN_INTERVAL_MS = parseInt(process.env.MIN_REPLY_INTERVAL_SECONDS || '60', 10) * 1000;
const MIN_MSGS_BETWEEN = parseInt(process.env.MIN_MSGS_BETWEEN_REPLIES || '3', 10);

function isMention(ctx, botUsername) {
  const msg = ctx.message;
  if (!msg) return false;

  if (
    msg.reply_to_message &&
    msg.reply_to_message.from &&
    botUsername &&
    msg.reply_to_message.from.username &&
    msg.reply_to_message.from.username.toLowerCase() === botUsername.toLowerCase()
  ) {
    return true;
  }

  if (msg.text && botUsername && msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }

  return false;
}

// 返回 'mention' | 'random' | null
function decideTrigger(ctx, botUsername) {
  const chatId = ctx.chat.id;
  const state = getChat(chatId);
  if (!state.aiEnabled) return null;

  if (isMention(ctx, botUsername)) return 'mention';

  const now = Date.now();
  const cooledDown = now - state.lastBotReplyAt > MIN_INTERVAL_MS;
  const enoughGap = state.msgSinceBotReply >= MIN_MSGS_BETWEEN;

  if (cooledDown && enoughGap && Math.random() < state.randomChance) {
    return 'random';
  }

  return null;
}

module.exports = { decideTrigger };
