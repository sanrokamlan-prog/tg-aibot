const test = require('node:test');
const assert = require('node:assert/strict');
const { Telegraf } = require('telegraf');

process.env.DATABASE_PATH = ':memory:';

const { registerCommands, BOT_COMMANDS } = require('../src/commands');

test('registers all Telegram command and callback handlers', () => {
  const bot = new Telegraf('123456:test-token');
  assert.doesNotThrow(() => registerCommands(bot, () => ({ id: 1, username: 'test_bot' })));
  assert.ok(BOT_COMMANDS.some((item) => item.command === 'ai_panel'));
  assert.ok(BOT_COMMANDS.some((item) => item.command === 'usage'));
  assert.ok(BOT_COMMANDS.some((item) => item.command === 'context_clear'));
});
