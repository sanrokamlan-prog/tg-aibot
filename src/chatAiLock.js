const activeChatIds = new Set();

function tryAcquireChatAi(chatId) {
  const key = String(chatId);
  if (activeChatIds.has(key)) return false;
  activeChatIds.add(key);
  return true;
}

function releaseChatAi(chatId) {
  activeChatIds.delete(String(chatId));
}

module.exports = { tryAcquireChatAi, releaseChatAi };
