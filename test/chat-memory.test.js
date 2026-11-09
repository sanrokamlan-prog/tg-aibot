const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_PATH = ':memory:';
const { getDatabase, closeDatabase } = require('../src/database');
const { addMemory, listMemories, deleteMemory, buildMemoryContext, clearMemories } = require('../src/memoryStore');
const { buildDecisionPrompt, parseDecision } = require('../src/aiPrompt');
test.after(closeDatabase);

test('persists confirmed memory with topic isolation, expiration, size limits and deletion', () => {
  addMemory(-1, 1, '小李不吃辣');
  addMemory(-1, 2, '这个话题讨论游戏');
  assert.equal(listMemories(-2, 1).length, 0);
  assert.equal(listMemories(-1, 0).length, 0);
  assert.equal(buildMemoryContext(-1, 1), '小李不吃辣');
  const [first] = listMemories(-1, 1);
  assert.equal(deleteMemory(-1, 2, first.id), 0);
  assert.equal(deleteMemory(-1, 1, first.id), 1);
  assert.throws(() => addMemory(-1, 1, 'x'.repeat(301)), /300/);
  for (let i = 0; i < 35; i++) addMemory(-1, 1, `note-${i}`);
  assert.equal(listMemories(-1, 1).length, 30);
  getDatabase().prepare('UPDATE conversation_memories SET expires_at = 0 WHERE chat_id = ? AND thread_id = ?').run('-1', '1');
  assert.equal(listMemories(-1, 1).length, 0);
  clearMemories(-1, 2);
  assert.equal(listMemories(-1, 2).length, 0);
});

test('retains message references and the actual target when other users speak later', () => {
  const prompt = buildDecisionPrompt({ mode: 'mention', memoryContext: '小李不吃辣',
    messages: [{ user: '甲', text: '目标提问', telegramMessageId: 5, replyToMessageId: 3 }, { user: '乙', text: '另一件事' }],
    replyTarget: { user: '甲', text: '目标提问', quotedText: '先前说的那个' } });
  assert.ok(prompt.userContent.includes('#5 回复#3'));
  assert.ok(prompt.userContent.includes('甲: 目标提问'));
  assert.ok(prompt.userContent.includes('该消息引用的内容：先前说的那个'));
  assert.ok(prompt.userContent.includes('小李不吃辣'));
  assert.equal(parseDecision('{"action":"reply","reply":"'+ '答'.repeat(500) +'"}', { strict: true }).reply.length, 500);
  assert.throws(() => parseDecision('{"action":"reply","reply":""}', { strict: true }));
});
