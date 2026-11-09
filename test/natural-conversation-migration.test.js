const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-aibot-natural-migration-'));
process.env.DATABASE_PATH = path.join(directory, 'bot.db');
const original = new DatabaseSync(process.env.DATABASE_PATH);
original.exec(`
  CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO metadata VALUES('schema_version', '2'), ('legacy_json_imported', '{}');
  CREATE TABLE messages(id INTEGER PRIMARY KEY, chat_id TEXT, thread_id TEXT,
    telegram_message_id INTEGER, reply_to_message_id INTEGER, user_name TEXT, text TEXT, ts INTEGER, from_bot INTEGER);
  INSERT INTO messages VALUES(1, '-1', '0', 12, NULL, '原用户', '原有上下文', 123, 0);
  CREATE TABLE conversation_memories(id INTEGER PRIMARY KEY, chat_id TEXT, thread_id TEXT, text TEXT, expires_at INTEGER);
  INSERT INTO conversation_memories VALUES(1, '-1', '0', '原有确认记忆', 9999999999999);
`);
original.close();
const { getDatabase, closeDatabase } = require('../src/database');

test('upgrades an existing v2 database without replacing messages or confirmed memories', () => {
  const db = getDatabase();
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, '3');
  const message = db.prepare('SELECT * FROM messages WHERE id = 1').get();
  assert.equal(message.text, '原有上下文');
  assert.equal(message.sender_id, null); assert.equal(message.learning_eligible, 0);
  assert.equal(db.prepare('SELECT text FROM conversation_memories WHERE id = 1').get().text, '原有确认记忆');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learned_expressions').get().n, 0);
  closeDatabase();
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
});

test.after(() => { closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); });
