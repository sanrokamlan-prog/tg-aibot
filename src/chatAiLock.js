const activeChatIds = new Set();
const idleWaiters = new Set();
let accepting = true;

function tryAcquireChatAi(chatId) {
  const key = String(chatId);
  if (!accepting || activeChatIds.has(key)) return false;
  activeChatIds.add(key);
  return true;
}

function releaseChatAi(chatId) {
  activeChatIds.delete(String(chatId));
  if (activeChatIds.size !== 0) return;
  for (const resolve of idleWaiters) resolve(true);
  idleWaiters.clear();
}

function beginChatAiShutdown() {
  accepting = false;
}

function waitForChatAiIdle(timeoutMs) {
  if (activeChatIds.size === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timeoutId;
    const done = (drained) => {
      clearTimeout(timeoutId);
      idleWaiters.delete(done);
      resolve(drained);
    };
    idleWaiters.add(done);
    timeoutId = setTimeout(() => done(false), timeoutMs);
  });
}

function getActiveChatAiCount() {
  return activeChatIds.size;
}

module.exports = {
  tryAcquireChatAi,
  releaseChatAi,
  beginChatAiShutdown,
  waitForChatAiIdle,
  getActiveChatAiCount,
};
