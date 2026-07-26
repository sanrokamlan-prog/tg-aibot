const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
process.env.AI_API_KEY = 'test-key';
process.env.AI_MODEL = 'test-model';
process.env.RANDOM_REPLY_CHANCE = '1';
process.env.MIN_REPLY_INTERVAL_SECONDS = '0';
process.env.MIN_MSGS_BETWEEN_REPLIES = '1';
process.env.IDLE_THRESHOLD_MINUTES = '1';
process.env.IDLE_COOLDOWN_MINUTES = '1';
process.env.TYPING_DELAY_MIN_MS = '0';
process.env.TYPING_DELAY_MAX_MS = '0';

const { createInteractionService } = require('../src/interactionService');
const { getChat, pushMessage } = require('../src/contextStore');
const { closeDatabase } = require('../src/database');
const { addRule } = require('../src/ruleStore');

let decision = { action: 'reaction', reaction: '👍', reply: '' };
let nextMessageId = 100;

function makeContext({ chatId, messageId, text, entities = [] }) {
  const calls = { reactions: [], replies: [], deletes: 0 };
  const ctx = {
    chat: { id: chatId, type: 'supergroup' },
    from: { id: 7, username: 'tester' },
    message: { message_id: messageId, text, entities },
    telegram: {
      callApi: async (method, payload) => { calls.reactions.push({ method, payload }); },
    },
    sendChatAction: async () => {},
    deleteMessage: async () => { calls.deletes += 1; },
    reply: async (replyText, extra) => {
      calls.replies.push({ text: replyText, extra });
      return { message_id: nextMessageId += 1 };
    },
  };
  return { ctx, calls };
}

test('runs reaction, quoted mention reply, and one-shot idle flows', async () => {
  const originalFetch = global.fetch;
  const originalRandom = Math.random;
  global.fetch = async () => Response.json({
    choices: [{ message: { content: JSON.stringify(decision) } }],
  });
  Math.random = () => 0;

  const idleMessages = [];
  const bot = {
    telegram: {
      sendMessage: async (chatId, text, extra) => {
        idleMessages.push({ chatId, text, extra });
        return { message_id: nextMessageId += 1 };
      },
    },
  };
  const service = createInteractionService(bot, () => ({ id: 99, username: 'test_bot' }));

  try {
    const random = makeContext({ chatId: -300, messageId: 1, text: '普通消息' });
    await service.handleMessage(random.ctx);
    assert.equal(random.calls.reactions.length, 1);
    assert.equal(getChat(-300, 0).messages.at(-1).text, '[Reaction 👍]');

    decision = { action: 'reply', reply: '直接回答你', reaction: '👍' };
    const mentionText = '@test_bot 你好';
    const mention = makeContext({
      chatId: -300,
      messageId: 2,
      text: mentionText,
      entities: [{ type: 'mention', offset: 0, length: 9 }],
    });
    await service.handleMessage(mention.ctx);
    assert.equal(mention.calls.replies[0].text, '直接回答你');
    assert.equal(mention.calls.replies[0].extra.reply_parameters.message_id, 2);

    pushMessage(-301, 0, {
      user: 'quiet-user', text: '很久以前的消息', ts: Date.now() - 2 * 60 * 1000,
      fromBot: false, telegramMessageId: 10,
    });
    decision = { action: 'reply', reply: '有人吗？', reaction: '👍' };
    await service.runIdleCheck();
    await service.runIdleCheck();
    assert.equal(idleMessages.filter((item) => item.chatId === -301).length, 1);

    addRule(-303, 'block', '广告', '请勿发广告');
    const blocked = makeContext({ chatId: -303, messageId: 4, text: '广告内容' });
    await service.handleMessage(blocked.ctx);
    assert.equal(blocked.calls.deletes, 1);
    assert.equal(getChat(-303, 0).messages.length, 0);

    pushMessage(-304, 1, {
      user: 'topic-user', text: 'topic 1', ts: Date.now() - 2 * 60 * 1000,
      fromBot: false, telegramMessageId: 20,
    });
    pushMessage(-304, 2, {
      user: 'topic-user', text: 'topic 2', ts: Date.now() - 2 * 60 * 1000,
      fromBot: false, telegramMessageId: 21,
    });
    decision = { action: 'reply', reply: '每轮只唤醒一个话题', reaction: '👍' };
    await service.runIdleCheck();
    assert.equal(idleMessages.filter((item) => item.chatId === -304).length, 1);
  } finally {
    global.fetch = originalFetch;
    Math.random = originalRandom;
    closeDatabase();
  }
});
