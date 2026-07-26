const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'bot.db');

let database = null;

function getDatabase() {
  if (database) return database;

  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  database = new DatabaseSync(DATABASE_PATH, { timeout: 5000 });
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(database);
  importLegacyJson(database);
  return database;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const currentVersion = Number(
    db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value || 0
  );

  const migrations = [
    () => db.exec(`
      CREATE TABLE chat_configs (
        chat_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE stickers (
        chat_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, file_id)
      );

      CREATE TABLE conversation_state (
        chat_id TEXT NOT NULL,
        thread_id TEXT NOT NULL DEFAULT '0',
        last_bot_reply_at INTEGER NOT NULL DEFAULT 0,
        last_idle_prompt_at INTEGER NOT NULL DEFAULT 0,
        last_human_message_at INTEGER NOT NULL DEFAULT 0,
        idle_prompted_for_human_at INTEGER NOT NULL DEFAULT 0,
        msg_since_bot_reply INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (chat_id, thread_id)
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        thread_id TEXT NOT NULL DEFAULT '0',
        telegram_message_id INTEGER,
        reply_to_message_id INTEGER,
        user_name TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL,
        from_bot INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_messages_conversation ON messages(chat_id, thread_id, id DESC);
      CREATE INDEX idx_messages_ts ON messages(ts);

      CREATE TABLE keyword_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        action TEXT NOT NULL,
        keyword TEXT NOT NULL,
        response TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_keyword_rules_chat ON keyword_rules(chat_id, enabled);

      CREATE TABLE ai_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_chars INTEGER NOT NULL,
        output_chars INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        ts INTEGER NOT NULL
      );
      CREATE INDEX idx_ai_usage_chat_ts ON ai_usage(chat_id, ts DESC);
    `),
  ];

  if (currentVersion > migrations.length) {
    throw new Error(`数据库版本 ${currentVersion} 高于当前程序支持的版本 ${migrations.length}`);
  }

  for (let version = currentVersion + 1; version <= migrations.length; version += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migrations[version - 1]();
      db.prepare(`
        INSERT INTO metadata(key, value) VALUES('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(version));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function importLegacyJson(db) {
  const imported = db.prepare("SELECT value FROM metadata WHERE key = 'legacy_json_imported'").get();
  if (imported) return;

  const configPath = path.join(DATA_DIR, 'chat-config.json');
  const stickerPath = path.join(DATA_DIR, 'stickers.json');
  let configCount = 0;
  let stickerCount = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (fs.existsSync(configPath)) {
      const legacy = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const insertConfig = db.prepare(`
        INSERT INTO chat_configs(chat_id, config_json, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(chat_id) DO NOTHING
      `);
      for (const [chatId, config] of Object.entries(legacy.chats || {})) {
        insertConfig.run(String(chatId), JSON.stringify(config), Date.now());
        configCount += 1;
      }
    }

    if (fs.existsSync(stickerPath)) {
      const legacy = JSON.parse(fs.readFileSync(stickerPath, 'utf8'));
      const insertSticker = db.prepare(`
        INSERT INTO stickers(chat_id, file_id, tags_json, created_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(chat_id, file_id) DO NOTHING
      `);
      for (const [chatId, stickers] of Object.entries(legacy.chats || {})) {
        for (const raw of stickers || []) {
          const item = typeof raw === 'string' ? { fileId: raw, tags: [] } : raw;
          const fileId = item.fileId || item.file_id || item.id;
          if (!fileId) continue;
          insertSticker.run(String(chatId), String(fileId), JSON.stringify(item.tags || []), Date.now());
          stickerCount += 1;
        }
      }
    }

    db.prepare("INSERT INTO metadata(key, value) VALUES('legacy_json_imported', ?)").run(
      JSON.stringify({ at: Date.now(), configCount, stickerCount })
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('导入旧 JSON 数据失败:', error.message);
  }

  if (configCount || stickerCount) {
    console.log(`已导入旧数据: 群配置 ${configCount}，贴纸 ${stickerCount}`);
  }
}

function closeDatabase() {
  if (!database) return;
  database.close();
  database = null;
}

module.exports = { getDatabase, closeDatabase, DATA_DIR, DATABASE_PATH };
