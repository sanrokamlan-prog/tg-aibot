const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { senderId, isNaturalFollowup, buildConversationHints } = require('../src/conversationContext');
const { decideTrigger } = require('../src/trigger');
const { pushMessage, getChat, chats } = require('../src/contextStore');
const { setChatConfig } = require('../src/chatConfigStore');
const { closeDatabase } = require('../src/database');
const { buildDecisionPrompt, parseDecision } = require('../src/aiPrompt');

test.after(closeDatabase);

function context(id = 1, text = '那后来呢') {
  return { chat: { id: -801, type: 'supergroup' }, from: { id, username: '同名' }, message: { message_id: 3, text } };
}

function conversation() {
  const now = Date.now();
  return { messages: [
    { user: '同名', senderId: 'user:1', text: '这个游戏怎么样', ts: now - 5000, telegramMessageId: 1 },
    { user: '[你]', text: '后期内容挺多', ts: now - 4000, telegramMessageId: 2, replyToMessageId: 1, fromBot: true },
    { user: '同名', senderId: 'user:1', text: '那后来呢', ts: now, telegramMessageId: 3 },
  ] };
}

test('continues with the addressed person but respects acknowledgements, other people and expiration', () => {
  const state = conversation();
  assert.equal(isNaturalFollowup(context(), state), true);
  assert.equal(isNaturalFollowup(context(2), state), false);
  assert.equal(isNaturalFollowup(context(1, '谢谢！'), state), false);
  assert.equal(isNaturalFollowup(context(1, '不用回复'), state), false);
  assert.equal(isNaturalFollowup(context(), state, Date.now() + 121000), false);
  const otherReply = context(); otherReply.message.reply_to_message = { message_id: 90 };
  assert.equal(isNaturalFollowup(otherReply, state), false);
  const otherMention = context(); otherMention.message.entities = [{ type: 'mention' }];
  assert.equal(isNaturalFollowup(otherMention, state), false);
  state.messages.splice(2, 0, { senderId: 'user:2', text: '新话题' });
  assert.equal(isNaturalFollowup(context(), state), false);
  assert.equal(senderId({ from: { id: 1087968824 }, message: { sender_chat: { id: -99 } } }), 'chat:-99');
});

test('follow-ups bypass random cooldown without crossing topics and survive reload', () => {
  const state = conversation();
  for (const message of state.messages) pushMessage(-801, 0, message);
  getChat(-801).lastBotReplyAt = Date.now();
  setChatConfig(-801, { randomChance: 0, minReplyIntervalSeconds: 3600, minMsgsBetweenReplies: 999 });
  assert.equal(decideTrigger(context(), { id: 99 }), 'followup');
  const otherTopic = context(); otherTopic.message.message_thread_id = 7;
  assert.equal(decideTrigger(otherTopic, { id: 99 }, 7), null);
  chats.clear();
  assert.equal(getChat(-801).messages[0].senderId, 'user:1');
  assert.equal(decideTrigger(context(), { id: 99 }), 'followup');
  setChatConfig(-801, { aiEnabled: false });
  assert.equal(decideTrigger(context(), { id: 99 }), null);
});

test('private messages and configured nicknames reach the conversational path', () => {
  const privateCtx = context(); privateCtx.chat = { id: 810, type: 'private' };
  assert.equal(decideTrigger(privateCtx, { id: 99 }), 'mention');
  process.env.BOT_ALIASES = '喵喵,小喵';
  try {
    const named = context(1, '喵喵，你怎么看'); named.chat.id = -802;
    assert.equal(decideTrigger(named, { id: 99 }), 'mention');
    named.message.text = '我家喵喵今天睡了一天';
    setChatConfig(-802, { randomChance: 0 });
    assert.equal(decideTrigger(named, { id: 99 }), null);
  } finally { delete process.env.BOT_ALIASES; }
});

test('adapts to human messages, separates speaker identities and preserves reply paragraphs', () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({
    user: '同名', senderId: `user:${i}`, text: '这也行啊', learningEligible: true, telegramMessageId: i + 1,
  }));
  messages.push({ fromBot: true, text: '我之前说过的开场' });
  const hints = buildConversationHints(messages, { isFollowup: true });
  assert.match(hints, /承接/); assert.match(hints, /短句/); assert.match(hints, /很少用表情/);
  const prompt = buildDecisionPrompt({ messages, mode: 'random' });
  assert.match(prompt.userContent, /user:0/); assert.match(prompt.userContent, /user:1/);
  assert.match(prompt.userContent, /我之前说过的开场/);
  assert.equal(parseDecision(JSON.stringify({ action: 'reply', reply: '先看这里\n\n再试一下' }), { strict: true }).reply, '先看这里\n\n再试一下');
});
