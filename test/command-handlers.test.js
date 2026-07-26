const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
process.env.ALLOWED_CHAT_IDS = '-500';

const { registerGeneralCommands } = require('../src/commands/general');
const { getChat, pushMessage } = require('../src/contextStore');
const { closeDatabase } = require('../src/database');

function collectHandlers() {
  const handlers = new Map();
  const bot = {
    command(name, handler) {
      handlers.set(name, handler);
    },
  };
  registerGeneralCommands(bot, () => ({ id: 1, username: 'test_bot' }));
  return handlers;
}

test('protects chat_id with the allowed-chat list', async () => {
  const handlers = collectHandlers();
  let replies = 0;
  await handlers.get('chat_id')({
    chat: { id: -501, title: 'not allowed' },
    message: { message_id: 1, text: '/chat_id' },
    reply: async () => { replies += 1; },
  });
  assert.equal(replies, 0);

  await handlers.get('chat_id')({
    chat: { id: -500, title: 'allowed' },
    message: { message_id: 2, text: '/chat_id', message_thread_id: 7 },
    reply: async (text) => {
      replies += 1;
      assert.match(text, /Topic ID：7/);
    },
  });
  assert.equal(replies, 1);
});

test('clears only the current topic context', async () => {
  const handlers = collectHandlers();
  pushMessage(-500, 7, {
    user: 'tester', text: 'topic 7', ts: Date.now(), fromBot: false, telegramMessageId: 10,
  });
  pushMessage(-500, 8, {
    user: 'tester', text: 'topic 8', ts: Date.now(), fromBot: false, telegramMessageId: 11,
  });

  await handlers.get('context_clear')({
    chat: { id: -500, type: 'supergroup' },
    from: { id: 9 },
    message: { message_id: 12, text: '/context_clear', message_thread_id: 7 },
    telegram: { getChatMember: async () => ({ status: 'administrator' }) },
    reply: async () => ({ message_id: 13 }),
  });

  assert.equal(getChat(-500, 7).messages.length, 0);
  assert.equal(getChat(-500, 8).messages.length, 1);
});

test.after(() => closeDatabase());
