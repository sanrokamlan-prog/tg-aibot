const { Markup } = require('telegraf');
const { requireAllowedChat, isAdmin } = require('../access');
const { getChatConfig } = require('../chatConfigStore');
const { getChat } = require('../contextStore');
const { getChatStickers } = require('../stickerStore');
const { getUsageSummary } = require('../usageStore');

const BOT_COMMANDS = [
  { command: 'ai_panel', description: '打开 AI 管理面板' },
  { command: 'ai_status', description: '查看当前群状态' },
  { command: 'ai_on', description: '开启 AI 互动' },
  { command: 'ai_off', description: '关闭 AI 互动' },
  { command: 'voice_on', description: '开启语音回复' },
  { command: 'voice_off', description: '关闭语音回复' },
  { command: 'context_clear', description: '清除当前话题上下文' },
  { command: 'persona', description: '查看群人设规则' },
  { command: 'ai_test', description: '测试 AI 接口' },
  { command: 'usage', description: '查看 24 小时 AI 用量' },
  { command: 'chat_id', description: '查看当前聊天 ID' },
  { command: 'my_id', description: '查看自己的用户 ID' },
];

function modelOverrides(config) {
  return { mention: config.modelMention, random: config.modelRandom, idle: config.modelIdle };
}

function formatConfig(chatId, threadId, botInfo) {
  const state = getChat(chatId, threadId);
  const config = getChatConfig(chatId);
  const usage = getUsageSummary(chatId);
  return [
    `AI互动: ${config.aiEnabled ? '开启' : '关闭'}`,
    `Reaction: ${config.reactionEnabled ? '开启' : '关闭'}`,
    `语音回复: ${config.voiceEnabled ? '开启' : '关闭'}`,
    `随机概率: ${config.randomChance}`,
    `主动冷却: ${config.minReplyIntervalSeconds} 秒 / ${config.minMsgsBetweenReplies} 条消息`,
    `冷场: ${config.idleThresholdMinutes} 分钟后，冷却 ${config.idleCooldownMinutes} 分钟`,
    `安静时段: ${config.quietStart && config.quietEnd ? `${config.quietStart}-${config.quietEnd}` : '关闭'}`,
    `贴纸概率: ${config.stickerReplyChance}`,
    `当前 Topic 上下文: ${state.messages.length} 条`,
    `当前群贴纸: ${getChatStickers(chatId).length} 个`,
    `24h AI 请求: ${usage.requests || 0}，成功 ${usage.successes || 0}，平均 ${usage.avg_latency_ms || 0}ms`,
    `模型覆盖: mention=${config.modelMention || '默认'} random=${config.modelRandom || '默认'} idle=${config.modelIdle || '默认'}`,
    `机器人: ${botInfo?.username ? `@${botInfo.username}` : '启动中'} (${botInfo?.id || '-'})`,
  ].join('\n');
}

function panelMarkup(config) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`AI ${config.aiEnabled ? 'ON' : 'OFF'}`, 'panel:toggle_ai'),
      Markup.button.callback(`Reaction ${config.reactionEnabled ? 'ON' : 'OFF'}`, 'panel:toggle_reaction'),
      Markup.button.callback(`语音 ${config.voiceEnabled ? 'ON' : 'OFF'}`, 'panel:toggle_voice'),
    ],
    [
      Markup.button.callback('安静', 'panel:preset_quiet'),
      Markup.button.callback('均衡', 'panel:preset_balanced'),
      Markup.button.callback('活跃', 'panel:preset_active'),
    ],
    [Markup.button.callback('刷新', 'panel:refresh')],
  ]);
}

async function requireAdmin(ctx) {
  if (!requireAllowedChat(ctx)) return false;
  if (await isAdmin(ctx)) return true;
  await ctx.reply('只有管理员可以操作');
  return false;
}

module.exports = { BOT_COMMANDS, modelOverrides, formatConfig, panelMarkup, requireAdmin };
