const { getDatabase } = require('./database');
const { envInt } = require('./env');

// Explicitly confirmed notes, scoped to a chat/topic. Never infer facts about users.
function listMemories(chatId, threadId = 0) {
  return getDatabase().prepare('SELECT id, text FROM conversation_memories WHERE chat_id = ? AND thread_id = ? AND expires_at > ? ORDER BY id DESC LIMIT 30')
    .all(String(chatId), String(threadId || 0), Date.now()).reverse();
}

function addMemory(chatId, threadId, text) {
  const value = String(text || '').trim();
  if (!value || value.length > 300) throw new Error('记忆内容应为 1-300 字');
  const db = getDatabase();
  const now = Date.now();
  db.prepare('INSERT INTO conversation_memories(chat_id, thread_id, text, expires_at) VALUES(?, ?, ?, ?)')
    .run(String(chatId), String(threadId || 0), value, now + envInt('MEMORY_TTL_DAYS', 30) * 86400000);
  db.prepare('DELETE FROM conversation_memories WHERE chat_id = ? AND thread_id = ? AND id NOT IN (SELECT id FROM conversation_memories WHERE chat_id = ? AND thread_id = ? ORDER BY id DESC LIMIT 30)')
    .run(String(chatId), String(threadId || 0), String(chatId), String(threadId || 0));
}

function deleteMemory(chatId, threadId, id) {
  return getDatabase().prepare('DELETE FROM conversation_memories WHERE chat_id = ? AND thread_id = ? AND id = ?')
    .run(String(chatId), String(threadId || 0), id).changes;
}

function clearMemories(chatId, threadId) {
  getDatabase().prepare('DELETE FROM conversation_memories WHERE chat_id = ? AND thread_id = ?').run(String(chatId), String(threadId || 0));
}

function buildMemoryContext(chatId, threadId) {
  return listMemories(chatId, threadId).map(m => m.text).join('\n').slice(0, 3000);
}

module.exports = { listMemories, addMemory, deleteMemory, clearMemories, buildMemoryContext };
