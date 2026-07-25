const { getDatabase } = require('./database');

function normalizeTags(tags) {
  return Array.from(new Set(
    (Array.isArray(tags) ? tags : []).map((tag) => String(tag).trim()).filter(Boolean)
  ));
}

function getChatStickers(chatId) {
  const rows = getDatabase().prepare(`
    SELECT file_id, tags_json FROM stickers WHERE chat_id = ? ORDER BY created_at, file_id
  `).all(String(chatId));

  return rows.map((row) => {
    let tags = [];
    try {
      tags = normalizeTags(JSON.parse(row.tags_json));
    } catch (error) {
      console.error(`贴纸标签损坏: file=${row.file_id}:`, error.message);
    }
    return { fileId: row.file_id, tags };
  });
}

function addChatSticker(chatId, stickerId, tags = []) {
  const db = getDatabase();
  const key = String(chatId);
  const existing = db.prepare(`
    SELECT tags_json FROM stickers WHERE chat_id = ? AND file_id = ?
  `).get(key, stickerId);
  let mergedTags = normalizeTags(tags);

  if (existing) {
    try {
      mergedTags = normalizeTags([...JSON.parse(existing.tags_json), ...mergedTags]);
    } catch (error) {
      console.error(`读取贴纸标签失败: file=${stickerId}:`, error.message);
    }
  }

  db.prepare(`
    INSERT INTO stickers(chat_id, file_id, tags_json, created_at) VALUES(?, ?, ?, ?)
    ON CONFLICT(chat_id, file_id) DO UPDATE SET tags_json = excluded.tags_json
  `).run(key, stickerId, JSON.stringify(mergedTags), Date.now());
  return getChatStickers(chatId);
}

function clearChatStickers(chatId) {
  getDatabase().prepare('DELETE FROM stickers WHERE chat_id = ?').run(String(chatId));
}

module.exports = { getChatStickers, addChatSticker, clearChatStickers };
