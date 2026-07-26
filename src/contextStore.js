const { getDatabase } = require('./database');
const { STORAGE_DEFAULTS } = require('./defaults');

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_HISTORY = positiveInt(process.env.MAX_HISTORY, STORAGE_DEFAULTS.maxHistory);
const MESSAGE_TTL_HOURS = positiveInt(process.env.MESSAGE_TTL_HOURS, STORAGE_DEFAULTS.messageTtlHours);
const chats = new Map();

function normalizeThreadId(threadId) {
  return String(threadId || 0);
}

function conversationKey(chatId, threadId = 0) {
  return `${String(chatId)}:${normalizeThreadId(threadId)}`;
}

function messageCutoff(now = Date.now()) {
  return now - MESSAGE_TTL_HOURS * 60 * 60 * 1000;
}

function pruneStateMessages(state, now = Date.now()) {
  const retained = state.messages
    .filter((message) => message.ts >= messageCutoff(now))
    .slice(-MAX_HISTORY);
  state.messages.splice(0, state.messages.length, ...retained);
}

function loadMessages(chatId, threadId) {
  const rows = getDatabase().prepare(`
    SELECT * FROM (
      SELECT id, telegram_message_id, reply_to_message_id, user_name, text, ts, from_bot
      FROM messages
      WHERE chat_id = ? AND thread_id = ? AND ts >= ?
      ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC
  `).all(String(chatId), normalizeThreadId(threadId), messageCutoff(), MAX_HISTORY);

  return rows.map((row) => ({
    dbId: row.id,
    telegramMessageId: row.telegram_message_id,
    replyToMessageId: row.reply_to_message_id,
    user: row.user_name,
    text: row.text,
    ts: row.ts,
    fromBot: Boolean(row.from_bot),
  }));
}

function getChat(chatId, threadId = 0) {
  const key = conversationKey(chatId, threadId);
  if (chats.has(key)) {
    const state = chats.get(key);
    pruneStateMessages(state);
    return state;
  }

  const normalizedThreadId = normalizeThreadId(threadId);
  const row = getDatabase().prepare(`
    SELECT * FROM conversation_state WHERE chat_id = ? AND thread_id = ?
  `).get(String(chatId), normalizedThreadId);
  const state = {
    chatId,
    threadId: Number(threadId || 0),
    messages: loadMessages(chatId, threadId),
    lastBotReplyAt: row?.last_bot_reply_at || 0,
    lastIdlePromptAt: row?.last_idle_prompt_at || 0,
    lastHumanMessageAt: row?.last_human_message_at || 0,
    idlePromptedForHumanAt: row?.idle_prompted_for_human_at || 0,
    msgSinceBotReply: row?.msg_since_bot_reply || 0,
  };
  chats.set(key, state);
  return state;
}

function persistState(state) {
  getDatabase().prepare(`
    INSERT INTO conversation_state(
      chat_id, thread_id, last_bot_reply_at, last_idle_prompt_at,
      last_human_message_at, idle_prompted_for_human_at, msg_since_bot_reply
    ) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET
      last_bot_reply_at = excluded.last_bot_reply_at,
      last_idle_prompt_at = excluded.last_idle_prompt_at,
      last_human_message_at = excluded.last_human_message_at,
      idle_prompted_for_human_at = excluded.idle_prompted_for_human_at,
      msg_since_bot_reply = excluded.msg_since_bot_reply
  `).run(
    String(state.chatId), normalizeThreadId(state.threadId), state.lastBotReplyAt,
    state.lastIdlePromptAt, state.lastHumanMessageAt, state.idlePromptedForHumanAt,
    state.msgSinceBotReply
  );
}

function pruneConversation(chatId, threadId) {
  const cutoff = messageCutoff();
  getDatabase().prepare(`
    DELETE FROM messages
    WHERE chat_id = ? AND thread_id = ?
      AND (ts < ? OR id NOT IN (
        SELECT id FROM messages WHERE chat_id = ? AND thread_id = ? ORDER BY id DESC LIMIT ?
      ))
  `).run(
    String(chatId), normalizeThreadId(threadId), cutoff,
    String(chatId), normalizeThreadId(threadId), MAX_HISTORY
  );
}

function pushMessage(chatId, threadId, msg) {
  const state = getChat(chatId, threadId);
  const result = getDatabase().prepare(`
    INSERT INTO messages(
      chat_id, thread_id, telegram_message_id, reply_to_message_id,
      user_name, text, ts, from_bot
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(chatId), normalizeThreadId(threadId), msg.telegramMessageId || null,
    msg.replyToMessageId || null, msg.user, msg.text, msg.ts, msg.fromBot ? 1 : 0
  );
  const stored = { ...msg, dbId: Number(result.lastInsertRowid) };
  state.messages.push(stored);
  pruneStateMessages(state);

  if (!msg.fromBot) {
    state.msgSinceBotReply += 1;
    state.lastHumanMessageAt = msg.ts;
  }
  persistState(state);
  pruneConversation(chatId, threadId);
  return stored;
}

function updateMessageText(chatId, threadId, dbId, text) {
  getDatabase().prepare('UPDATE messages SET text = ? WHERE id = ?').run(text, dbId);
  const message = getChat(chatId, threadId).messages.find((item) => item.dbId === dbId);
  if (message) message.text = text;
}

function markBotReplied(chatId, threadId = 0) {
  const state = getChat(chatId, threadId);
  state.lastBotReplyAt = Date.now();
  state.msgSinceBotReply = 0;
  persistState(state);
}

function markIdlePrompted(chatId, threadId = 0) {
  const state = getChat(chatId, threadId);
  state.lastIdlePromptAt = Date.now();
  state.idlePromptedForHumanAt = state.lastHumanMessageAt;
  persistState(state);
}

function pruneExpiredMessages() {
  const cutoff = messageCutoff();
  getDatabase().prepare('DELETE FROM messages WHERE ts < ?').run(cutoff);
  for (const state of chats.values()) pruneStateMessages(state);
}

function clearConversation(chatId, threadId = 0) {
  const key = conversationKey(chatId, threadId);
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM messages WHERE chat_id = ? AND thread_id = ?')
      .run(String(chatId), normalizeThreadId(threadId));
    db.prepare('DELETE FROM conversation_state WHERE chat_id = ? AND thread_id = ?')
      .run(String(chatId), normalizeThreadId(threadId));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  chats.delete(key);
}

module.exports = {
  chats,
  conversationKey,
  getChat,
  pushMessage,
  updateMessageText,
  markBotReplied,
  markIdlePrompted,
  clearConversation,
  pruneExpiredMessages,
  MAX_HISTORY,
  MESSAGE_TTL_HOURS,
};
