const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
process.env.AI_API_KEY = 'test-key';
process.env.AI_MODEL = 'test-model';
process.env.RANDOM_REPLY_CHANCE = '0';
process.env.CONVERSATION_DEBOUNCE_MS = '15';
process.env.TYPING_DELAY_MIN_MS = '0';
process.env.TYPING_DELAY_MAX_MS = '0';
const { createInteractionService } = require('../src/interactionService');
const { getChat, pushMessage } = require('../src/contextStore');
const { setChatConfig } = require('../src/chatConfigStore');
const { closeDatabase } = require('../src/database');
const { listExpressions } = require('../src/expressionStore');
const { providerRouter } = require('../src/providerPool');
test.after(closeDatabase);

function gate() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function ctx(chatId, id, text, mention = false, userId = 1) {
  const replies = [];
  return {
    chat: { id: chatId, type: 'supergroup' }, from: { id: userId, username: `u${userId}` },
    message: { message_id: id, text, entities: mention ? [{ type: 'mention', offset: 0, length: 9 }] : [] },
    sendChatAction: async () => {}, replies,
    reply: async (text, extra) => { replies.push({ text, extra }); return { message_id: 1000 + id }; },
  };
}
function response(reply, metadata = {}) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ action: 'reply', reply, ...metadata }) } }] });
}
test('merges a question and its supplement, persists learning and continues without another mention', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  providerRouter.reset();
  const service = createInteractionService({}, () => ({ id: 99, username: 'test_bot' }));
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(requests.length === 1 ? '真的离谱' : '这里可以再试一下', {
      learn_expression: { source_message_id: 2, text: '绷不住了', situation: '遇到意外操作时' },
    });
  };
  try {
    const a = ctx(-901, 1, '@test_bot 这个操作为什么失败了', true);
    const b = ctx(-901, 2, '补充一下，是更新后出现的，绷不住了');
    await Promise.all([service.handleMessage(a), service.handleMessage(b)]);
    assert.equal(requests.length, 1); assert.equal(a.replies.length, 0); assert.equal(b.replies.length, 1);
    assert.match(requests[0].messages[1].content, /为什么失败了/);
    assert.match(requests[0].messages[1].content, /更新后出现的/);
    assert.equal(b.replies[0].extra.reply_parameters.message_id, 2);
    assert.equal(getChat(-901).messages.at(-1).replyToMessageId, 2);
    assert.equal(listExpressions(-901).length, 1);
    const c = ctx(-901, 3, '那现在该怎么处理');
    await service.handleMessage(c);
    assert.equal(requests.length, 2); assert.equal(c.replies.length, 1);
    assert.match(requests[1].messages[1].content, /承接你刚才的话/);
    const d = ctx(-901, 4, '谢谢');
    await service.handleMessage(d);
    assert.equal(requests.length, 2);
  } finally { global.fetch = originalFetch; }
});

test('queues another person\'s direct question while generation is running and targets each separately', async () => {
  const originalFetch = global.fetch; const entered = gate(); const release = gate();
  let requests = 0;
  providerRouter.reset();
  const service = createInteractionService({}, () => ({ id: 99, username: 'test_bot' }));
  global.fetch = async () => {
    requests += 1;
    if (requests === 1) { entered.resolve(); await release.promise; }
    return response('回答当前提问');
  };
  try {
    const a = ctx(-902, 1, '@test_bot 第一个问题', true);
    const b = ctx(-902, 2, '@test_bot 第二个人的问题', true, 2);
    const first = service.handleMessage(a); await entered.promise;
    const second = service.handleMessage(b);
    release.resolve(); await Promise.all([first, second]);
    assert.equal(requests, 2); assert.equal(a.replies.length, 1); assert.equal(b.replies.length, 1);
    assert.equal(a.replies[0].extra.reply_parameters.message_id, 1);
    assert.equal(b.replies[0].extra.reply_parameters.message_id, 2);
  } finally { global.fetch = originalFetch; }
});

test('replaces an in-flight answer with the same speaker\'s supplementary context', async () => {
  const originalFetch = global.fetch; const entered = gate(); const release = gate();
  let requests = 0;
  providerRouter.reset();
  const service = createInteractionService({}, () => ({ id: 99, username: 'test_bot' }));
  global.fetch = async () => {
    requests += 1;
    if (requests === 1) { entered.resolve(); await release.promise; return response('过时回答'); }
    return response('结合补充后的回答');
  };
  try {
    const a = ctx(-903, 1, '@test_bot 应该怎么办', true);
    const b = ctx(-903, 2, '刚才说错了，实际是另一个版本');
    const first = service.handleMessage(a); await entered.promise;
    const second = service.handleMessage(b);
    // Allow the message to pass the extension hook and enter the pending queue.
    await new Promise(resolve => setImmediate(resolve));
    release.resolve(); await Promise.all([first, second]);
    assert.equal(a.replies.length, 0); assert.equal(b.replies[0].text, '结合补充后的回答');
  } finally { global.fetch = originalFetch; }
});

test('cancels idle output if a person speaks during generation', async () => {
  const originalFetch = global.fetch;
  providerRouter.reset();
  const sent = [];
  const service = createInteractionService({ telegram: { sendMessage: async (...args) => { sent.push(args); return { message_id: 900 }; } } },
    () => ({ id: 99, username: 'test_bot' }));
  setChatConfig(-904, { idleThresholdMinutes: 1, idleCooldownMinutes: 1 });
  pushMessage(-904, 0, { user: 'u1', senderId: 'user:1', text: '旧话题', ts: Date.now() - 120000, telegramMessageId: 1 });
  global.fetch = async () => {
    await service.handleMessage(ctx(-904, 2, '已经开始聊新话题了'));
    return response('迟到的冷场插话');
  };
  try {
    await service.runIdleCheck();
    assert.equal(sent.length, 0); assert.equal(getChat(-904).idlePromptedForHumanAt, 0);
  } finally { global.fetch = originalFetch; }
});
