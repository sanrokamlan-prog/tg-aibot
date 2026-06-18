const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '40', 10);

// chatId -> { messages, lastBotReplyAt, lastIdlePromptAt, msgSinceBotReply, aiEnabled, randomChance }
const chats = new Map();

function getChat(chatId) {
  if (!chats.has(chatId)) {
    chats.set(chatId, {
      messages: [],
      lastBotReplyAt: 0,
      lastIdlePromptAt: 0,
      msgSinceBotReply: 0,
      aiEnabled: true,
      randomChance: parseFloat(process.env.RANDOM_REPLY_CHANCE || '0.05'),
    });
  }
  return chats.get(chatId);
}

function pushMessage(chatId, msg) {
  const c = getChat(chatId);
  c.messages.push(msg);
  if (c.messages.length > MAX_HISTORY) c.messages.shift();
  if (!msg.fromBot) c.msgSinceBotReply += 1;
  return c;
}

function markBotReplied(chatId) {
  const c = getChat(chatId);
  c.lastBotReplyAt = Date.now();
  c.msgSinceBotReply = 0;
}

function markIdlePrompted(chatId) {
  getChat(chatId).lastIdlePromptAt = Date.now();
}

module.exports = { chats, getChat, pushMessage, markBotReplied, markIdlePrompted };
