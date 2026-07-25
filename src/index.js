require('dotenv').config();
const { Telegraf } = require('telegraf');
const { getAllowedChatIds } = require('./access');
const { registerCommands, BOT_COMMANDS } = require('./commands');
const { pruneExpiredMessages } = require('./contextStore');
const { closeDatabase, getDatabase } = require('./database');
const { startIdleScheduler } = require('./idleScheduler');
const { createInteractionService } = require('./interactionService');

if (!process.env.BOT_TOKEN) {
  throw new Error('缺少 BOT_TOKEN');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
let botInfo = null;
let stopIdleScheduler = null;
const interactionService = createInteractionService(bot, () => botInfo);

registerCommands(bot, () => botInfo);
bot.on('message', interactionService.handleMessage);

bot.catch((error, ctx) => {
  console.error(`Telegram 更新处理失败: update=${ctx.update.update_id}:`, error.message);
});

async function main() {
  getDatabase();
  pruneExpiredMessages();
  botInfo = await bot.telegram.getMe();
  await bot.telegram.setMyCommands(BOT_COMMANDS);
  if (!getAllowedChatIds().length) {
    console.warn('警告：ALLOWED_CHAT_IDS 为空，机器人可被任意群使用。');
  }
  await bot.launch();
  stopIdleScheduler = startIdleScheduler(interactionService.runIdleCheck);
  console.log(`机器人已启动: @${botInfo.username} (${botInfo.id})`);
}

async function shutdown(signal) {
  stopIdleScheduler?.();
  bot.stop(signal);
  closeDatabase();
}

main().catch((error) => {
  console.error('启动失败:', error.message);
  closeDatabase();
  process.exit(1);
});

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  console.error('未处理 Promise 异常:', error?.message || error);
});
