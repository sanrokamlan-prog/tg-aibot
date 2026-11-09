const { requireAllowedChat } = require('../access');
const { decideAndReply } = require('../ai');
const { tryAcquireChatAi, releaseChatAi } = require('../chatAiLock');
const { getChatConfig } = require('../chatConfigStore');
const { clearConversation } = require('../contextStore');
const { getExtensionNames } = require('../extensions');
const { getPersona } = require('../personaService');
const { getStickerTags } = require('../stickerService');
const { getThreadId, replyExtra } = require('../telegramMessage');
const { getUsageSummary } = require('../usageStore');
const { formatConfig, modelOverrides, requireAdmin } = require('./shared');
const { loadProviders, providerRouter } = require('../providerPool');

function registerGeneralCommands(bot, getBotInfo) {
  bot.command('ai_providers', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    try {
      const pool = loadProviders();
      const rows = providerRouter.status(pool).map(p => `${p.name} / ${p.model} (${p.apiType})：${p.cooldownMs ? `冷却 ${Math.ceil(p.cooldownMs / 1000)} 秒 ${p.reason}` : '就绪'}`);
      if (pool.providers.some(p => p.apiType === 'opencode')) {
        const status = require('../opencode').openCodeServiceStatus();
        rows.push(`OpenCode 常驻服务：${status.running ? '运行中' : '未就绪'}，重启 ${status.restarts} 次`);
      }
      return ctx.reply(`策略：${pool.strategy}\n${rows.join('\n')}`.slice(0, 3900));
    } catch (error) { return ctx.reply(error.message); }
  });
  bot.command('my_id', async (ctx) => {
    const userId = ctx.from?.id;
    return ctx.reply(userId ? `你的 Telegram 用户 ID 是：${userId}` : '没有获取到你的用户 ID');
  });

  bot.command('chat_id', (ctx) => {
    if (!requireAllowedChat(ctx)) return;
    return ctx.reply(`当前聊天 ID 是：${ctx.chat.id}\nTopic ID：${getThreadId(ctx) || 0}`);
  });

  bot.command('extensions', (ctx) => {
    if (!requireAllowedChat(ctx)) return;
    return ctx.reply(`已加载扩展：${getExtensionNames().join(', ')}`);
  });

  bot.command('usage', (ctx) => {
    if (!requireAllowedChat(ctx)) return;
    const usage = getUsageSummary(ctx.chat.id);
    return ctx.reply([
      `最近 24 小时请求：${usage.requests || 0}`,
      `成功：${usage.successes || 0}`,
      `输入字符：${usage.input_chars || 0}`,
      `输出字符：${usage.output_chars || 0}`,
      `平均延迟：${usage.avg_latency_ms || 0}ms`,
    ].join('\n'));
  });

  bot.command('ai_status', (ctx) => {
    if (!requireAllowedChat(ctx)) return;
    return ctx.reply(formatConfig(ctx.chat.id, getThreadId(ctx), getBotInfo()));
  });

  bot.command('context_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    if (!tryAcquireChatAi(ctx.chat.id)) return ctx.reply('当前群有 AI 请求正在处理，请稍后再清除上下文。');
    try {
      const threadId = getThreadId(ctx);
      clearConversation(ctx.chat.id, threadId);
      return ctx.reply('已清除当前 Topic 的短期上下文；群配置、人设、规则和贴纸保持不变。', replyExtra(ctx));
    } finally {
      releaseChatAi(ctx.chat.id);
    }
  });

  bot.command('ai_test', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    if (!tryAcquireChatAi(ctx.chat.id)) return ctx.reply('当前群已有 AI 请求正在处理，请稍后再试。');
    try {
      const config = getChatConfig(ctx.chat.id);
      const result = await decideAndReply({
        chatId: ctx.chat.id,
        persona: getPersona(ctx.chat.id),
        stickerTags: getStickerTags(ctx.chat.id),
        messages: [{
          user: ctx.from?.username || '管理员',
          text: '测试 AI 接口，请简短回复。',
          ts: Date.now(),
          fromBot: false,
        }],
        mode: 'mention',
        modelOverrides: modelOverrides(config),
      });
      return ctx.reply(`AI 测试成功\naction: ${result.action}\nreply: ${result.reply || '(空)'}\nreaction: ${result.reaction}\nmodel: ${result.model}\nprovider: ${result.provider}\nattempts: ${result.attempts}`);
    } catch (error) {
      return ctx.reply(`AI 测试失败：${error.message.slice(0, 1000)}`);
    } finally {
      releaseChatAi(ctx.chat.id);
    }
  });
}

module.exports = { registerGeneralCommands };
