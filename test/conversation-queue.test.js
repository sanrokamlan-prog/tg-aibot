const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationQueue } = require('../src/conversationQueue');
const { tryAcquireChatAi, releaseChatAi, beginChatAiShutdown, getActiveChatAiCount } = require('../src/chatAiLock');

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function input(chatId, id, sender = 'user:1', threadId = 0, trigger = 'mention') {
  return { chatId, id, senderId: sender, threadId, trigger };
}

test('batches adjacent fragments and keeps speakers, topics and media separate', async () => {
  const seen = [];
  const queue = createConversationQueue(async job => { seen.push(job.id); return true; }, { debounceMs: 10 });
  const promises = [
    queue.enqueue(input(1, 1)), queue.enqueue(input(1, 2)),
    queue.enqueue(input(1, 3, 'user:2')), queue.enqueue(input(1, 4, 'user:1', 7)),
    queue.enqueue({ ...input(1, 5, 'user:1', 7), mergeable: false }),
  ];
  assert.deepEqual(await Promise.all(promises), [true, true, true, true, true]);
  assert.deepEqual(seen, [2, 3, 4, 5]);
  assert.equal(getActiveChatAiCount(), 0);
});

test('serializes each chat, runs different chats in parallel and signals a newer continuation', async () => {
  const entered = gate(); const release = gate();
  const seen = []; let cancelled;
  const queue = createConversationQueue(async (job, hasNewer) => {
    seen.push(job.id);
    if (job.id === 1) { entered.resolve(); await release.promise; cancelled = hasNewer(); }
    return true;
  }, { debounceMs: 0 });
  const first = queue.enqueue(input(2, 1)); await entered.promise;
  const next = queue.enqueue(input(2, 2, 'user:1', 0, 'followup'));
  await queue.enqueue(input(3, 3));
  assert.deepEqual(seen, [1, 3]);
  release.resolve(); await Promise.all([first, next]);
  assert.deepEqual(seen, [1, 3, 2]); assert.equal(cancelled, true);
});

test('does not silently skip a direct question while an external idle task holds the chat lock', async () => {
  assert.equal(tryAcquireChatAi(4), true);
  let executed = false;
  const queue = createConversationQueue(async () => { executed = true; return true; }, { debounceMs: 0 });
  const pending = queue.enqueue(input(4, 1));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(executed, false);
  releaseChatAi(4);
  assert.equal(await pending, true); assert.equal(executed, true);
});

test('bounds pending work and prioritizes direct questions over random interruptions', async () => {
  const entered = gate(); const release = gate();
  const seen = [];
  const queue = createConversationQueue(async job => {
    seen.push(job.id);
    if (job.id === 1) { entered.resolve(); await release.promise; }
    return true;
  }, { debounceMs: 0, maxPending: 2 });
  const first = queue.enqueue(input(5, 1)); await entered.promise;
  const random = queue.enqueue(input(5, 2, 'user:2', 0, 'random'));
  const direct = queue.enqueue(input(5, 3, 'user:3'));
  const priority = queue.enqueue(input(5, 4, 'user:4'));
  assert.equal(await random, false);
  assert.equal(await queue.enqueue(input(5, 5, 'user:5')), false);
  release.resolve(); await Promise.all([first, direct, priority]);
  assert.deepEqual(seen, [1, 3, 4]);
});

test('drains active work and cancels scheduled work on shutdown without acquiring another lock', async () => {
  const entered = gate(); const release = gate();
  const seen = [];
  const queue = createConversationQueue(async job => {
    seen.push(job.id); entered.resolve(); await release.promise; return true;
  }, { debounceMs: 0 });
  const first = queue.enqueue(input(6, 1)); await entered.promise;
  const pending = queue.enqueue(input(6, 2, 'user:2'));
  beginChatAiShutdown(); release.resolve();
  assert.equal(await first, true); assert.equal(await pending, false);
  assert.equal(await queue.enqueue(input(7, 3)), false);
  assert.deepEqual(seen, [1]); assert.equal(getActiveChatAiCount(), 0);
});
