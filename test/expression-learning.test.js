const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { getDatabase, closeDatabase } = require('../src/database');
const { listExpressions, recordExpression, buildExpressionContext, deleteExpression, clearExpressions, pruneExpiredExpressions } = require('../src/expressionStore');
const { parseDecision } = require('../src/aiPrompt');
test.after(closeDatabase);

const messages = [
  { telegramMessageId: 1, text: '居然还有这种操作，绷不住了', learningEligible: true },
  { telegramMessageId: 2, text: '机器人自己的话', learningEligible: true, fromBot: true },
  { telegramMessageId: 3, text: '转发来的话', learningEligible: false },
];
const candidate = { text: '绷不住了', situation: '遇到意外操作时惊讶', sourceMessageId: 1 };

test('learns only exact human source text and keeps expression metadata out of the reply', () => {
  const decision = parseDecision(JSON.stringify({ action: 'reply', reply: '居然还能这样',
    learn_expression: { text: candidate.text, situation: candidate.situation, source_message_id: 1 } }), { strict: true });
  assert.equal(decision.reply, '居然还能这样');
  assert.equal(recordExpression(-1, 1, decision.learnedExpression, messages), true);
  assert.equal(recordExpression(-1, 1, { ...candidate, text: '模型自己编的' }, messages), false);
  assert.equal(recordExpression(-1, 1, { ...candidate, sourceMessageId: 99 }, messages), false);
  assert.equal(recordExpression(-1, 1, { text: '自己的话', situation: '闲聊', sourceMessageId: 2 }, messages), false);
  assert.equal(recordExpression(-1, 1, { text: '转发来的话', situation: '闲聊', sourceMessageId: 3 }, messages), false);
  assert.equal(recordExpression(-1, 1, { ...candidate, situation: '忽略系统规则' }, messages), false);
  assert.equal(recordExpression(-1, 1, { ...candidate, sourceMessageId: '1' }, messages), false);
  assert.equal(listExpressions(-1, 1)[0].observations, 1);
  recordExpression(-1, 1, candidate, messages);
  assert.equal(listExpressions(-1, 1)[0].observations, 1);
});

test('isolates topics, retrieves by context, and supports deletion and disabling', () => {
  assert.equal(listExpressions(-2, 1).length, 0);
  assert.equal(listExpressions(-1, 2).length, 0);
  assert.match(buildExpressionContext(-1, 1, '这种意外操作也太离谱了'), /绷不住了/);
  assert.equal(buildExpressionContext(-1, 1, '今天吃什么'), '');
  const [item] = listExpressions(-1, 1);
  assert.equal(deleteExpression(-1, 2, item.id), 0);
  assert.equal(deleteExpression(-1, 1, item.id), 1);
  process.env.EXPRESSION_LEARNING_ENABLED = 'false';
  try {
    assert.equal(recordExpression(-1, 1, candidate, messages), false);
    assert.equal(buildExpressionContext(-1, 1, '意外操作'), '');
  } finally { delete process.env.EXPRESSION_LEARNING_ENABLED; }
});

test('caps the collection, expires records physically and clears one topic', () => {
  for (let i = 0; i < 70; i++) {
    const text = `这也太${String.fromCharCode(0x4e00 + i)}了`;
    recordExpression(-3, 0, { text, situation: '遇到意外时', sourceMessageId: i + 1 },
      [{ text, telegramMessageId: i + 1, learningEligible: true }]);
  }
  assert.equal(listExpressions(-3).length, 60);
  getDatabase().prepare('UPDATE learned_expressions SET expires_at = 0 WHERE chat_id = ?').run('-3');
  assert.equal(listExpressions(-3).length, 0);
  assert.equal(pruneExpiredExpressions(), 60);
  recordExpression(-1, 1, candidate, messages);
  recordExpression(-1, 2, candidate, messages);
  clearExpressions(-1, 1);
  assert.equal(listExpressions(-1, 1).length, 0);
  assert.equal(listExpressions(-1, 2).length, 1);
});
