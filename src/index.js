require('dotenv').config();
const { Telegraf } = require('telegraf');
const { getAllowedChatIds } = require('./access');
const { beginChatAiShutdown, waitForChatAiIdle } = require('./chatAiLock');
const { registerCommands, BOT_COMMANDS } = require('./commands');
const { closeDatabase, getDatabase } = require('./database');
const { envInt } = require('./env');
const { startIdleScheduler } = require('./idleScheduler');
const { createInteractionService } = require('./interactionService');
const { runMaintenance, startMaintenanceScheduler } = require('./maintenance');

if (!process.env.BOT_TOKEN) {
  throw new Error('缺少 BOT_TOKEN');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
let botInfo = null;
let stopIdleScheduler = null;
let stopMaintenanceScheduler = null;
let shuttingDown = false;
const interactionService = createInteractionService(bot, () => botInfo);

registerCommands(bot, () => botInfo);
bot.on('message', interactionService.handleMessage);

bot.catch((error, ctx) => {
  console.error(`Telegram 更新处理失败: update=${ctx.update.update_id}:`, error.message);
});

async function main() {
  getDatabase();
  runMaintenance();
  botInfo = await bot.telegram.getMe();
  await bot.telegram.setMyCommands(BOT_COMMANDS);
  if (!getAllowedChatIds().length) {
    console.warn('警告：ALLOWED_CHAT_IDS 为空，机器人可被任意群使用。');
  }
  await bot.launch();
  stopIdleScheduler = startIdleScheduler(interactionService.runIdleCheck);
  stopMaintenanceScheduler = startMaintenanceScheduler();
  console.log(`机器人已启动: @${botInfo.username} (${botInfo.id})`);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopIdleScheduler?.();
  stopMaintenanceScheduler?.();
  beginChatAiShutdown();
  try {
    bot.stop(signal);
  } catch (error) {
    console.warn(`停止 Telegram Bot 时忽略状态错误: ${error.message}`);
  }
  const drained = await waitForChatAiIdle(envInt('SHUTDOWN_DRAIN_TIMEOUT_MS', 15000));
  if (drained) closeDatabase();
  else console.warn('停机等待 AI 请求超时，将保持数据库可用并由容器停止剩余任务。');
}

main().catch((error) => {
  console.error('启动失败:', error.message);
  closeDatabase();
  process.exit(1);
});

process.once('SIGINT', () => shutdown('SIGINT').catch((error) => console.error('停机失败:', error.message)));
process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => console.error('停机失败:', error.message)));
process.on('unhandledRejection', (error) => {
  console.error('未处理 Promise 异常:', error?.message || error);
});
