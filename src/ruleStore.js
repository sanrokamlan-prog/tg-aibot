const { getDatabase } = require('./database');

function addRule(chatId, action, keyword, response = '') {
  const result = getDatabase().prepare(`
    INSERT INTO keyword_rules(chat_id, action, keyword, response, enabled, created_at)
    VALUES(?, ?, ?, ?, 1, ?)
  `).run(String(chatId), action, keyword, response, Date.now());
  return Number(result.lastInsertRowid);
}

function getRules(chatId) {
  return getDatabase().prepare(`
    SELECT id, action, keyword, response, enabled
    FROM keyword_rules WHERE chat_id = ? ORDER BY id
  `).all(String(chatId)).map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

function deleteRule(chatId, id) {
  return getDatabase().prepare(`
    DELETE FROM keyword_rules WHERE chat_id = ? AND id = ?
  `).run(String(chatId), id).changes > 0;
}

function clearRules(chatId) {
  getDatabase().prepare('DELETE FROM keyword_rules WHERE chat_id = ?').run(String(chatId));
}

module.exports = { addRule, getRules, deleteRule, clearRules };
