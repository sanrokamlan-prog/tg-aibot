const { tryAcquireChatAi, releaseChatAi, isAcceptingChatAi } = require('./chatAiLock');
const { envInt } = require('./env');

// A chat keeps one worker. Short bursts from one speaker/topic share one request.
function createConversationQueue(execute, {
  debounceMs = envInt('CONVERSATION_DEBOUNCE_MS', 900, { min: 0 }),
  maxWaitMs = 3000,
  maxPending = 8,
} = {}) {
  const queues = new Map();
  function finish(job, value) {
    for (const resolve of job.waiters) resolve(value);
  }
  function schedule(key, state, wait = 0) {
    state.timer = setTimeout(() => { state.timer = null; drain(key, state); }, wait);
  }
  async function drain(key, state) {
    if (!isAcceptingChatAi()) {
      for (const job of state.jobs) finish(job, false);
      queues.delete(key);
      return;
    }
    if (!tryAcquireChatAi(key)) { schedule(key, state, 100); return; }
    state.running = true;
    try {
      while (state.jobs.length && isAcceptingChatAi()) {
        const first = state.jobs[0];
        const remaining = Math.min(first.updatedAt + debounceMs, first.createdAt + maxWaitMs) - Date.now();
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        // A new fragment may have extended the quiet window while we waited.
        if (Math.min(first.updatedAt + debounceMs, first.createdAt + maxWaitMs) > Date.now()) continue;
        const job = state.jobs.shift();
        state.active = job;
        try {
          const hasNewer = () => job.mergeable !== false && state.jobs.some(next =>
            next.mergeable !== false && next.continuation &&
            next.threadId === job.threadId && next.senderId === job.senderId);
          finish(job, await execute(job, hasNewer));
        } catch (error) {
          console.error('对话任务失败:', error.message);
          finish(job, false);
        } finally { state.active = null; }
      }
    } finally {
      for (const job of state.jobs) finish(job, false);
      queues.delete(key);
      releaseChatAi(key);
    }
  }
  return {
    active(chatId) { return queues.get(String(chatId))?.active || null; },
    participant(chatId, threadId, id) {
      const state = queues.get(String(chatId));
      const previous = state?.jobs.at(-1) || state?.active;
      return id && previous?.senderId === id && previous.threadId === threadId ? previous : null;
    },
    enqueue(input) {
      if (!isAcceptingChatAi()) return Promise.resolve(false);
      const key = String(input.chatId);
      let state = queues.get(key);
      if (!state) { state = { jobs: [], active: null, running: false, timer: null }; queues.set(key, state); }
      input = { ...input, continuation: input.continuation ?? input.trigger === 'followup' };
      if (input.continuation && input.mergeable !== false && state.active?.mergeable !== false &&
        state.active?.trigger === 'mention' && state.active.senderId === input.senderId &&
        state.active.threadId === input.threadId) input.trigger = 'mention';
      return new Promise(resolve => {
        // Only adjacent fragments merge; A/B/A remains three turns.
        const previous = state.jobs.at(-1);
        if (input.mergeable !== false && previous?.mergeable !== false &&
          input.senderId && previous?.senderId === input.senderId && previous.threadId === input.threadId &&
          Date.now() - previous.createdAt <= maxWaitMs) {
          const trigger = previous.trigger === 'mention' || input.trigger === 'mention' ? 'mention' : input.trigger;
          Object.assign(previous, input, { trigger, updatedAt: Date.now() });
          previous.waiters.push(resolve);
        } else {
          if (state.jobs.length >= maxPending) {
            // Keep explicit questions ahead of unsolicited interjections.
            const disposable = state.jobs.findIndex(job => job.trigger !== 'mention');
            if (input.trigger !== 'mention' || disposable < 0) { resolve(false); return; }
            finish(state.jobs.splice(disposable, 1)[0], false);
          }
          state.jobs.push({ ...input, createdAt: Date.now(), updatedAt: Date.now(), waiters: [resolve] });
        }
        if (!state.running && !state.timer) schedule(key, state);
      });
    },
  };
}

module.exports = { createConversationQueue };
