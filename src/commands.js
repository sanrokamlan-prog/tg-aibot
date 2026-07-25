const { Markup } = require('telegraf');
const { requireAllowedChat, isAdmin } = require('./access');
const { decideAndReply } = require('./ai');
const { tryAcquireChatAi, releaseChatAi } = require('./chatAiLock');
const { getChatConfig, setChatConfig } = require('./chatConfigStore');
const { getChat } = require('./contextStore');
const { getExtensionNames } = require('./extensions');
const { getPersona } = require('./personaService');
const { addRule, getRules, deleteRule, clearRules } = require('./ruleStore');
const { getStickerTags } = require('./stickerService');
const { getChatStickers, addChatSticker, clearChatStickers } = require('./stickerStore');
const { getThreadId, replyExtra } = require('./telegramMessage');
const { getUsageSummary } = require('./usageStore');

const BOT_COMMANDS = [
  { command: 'ai_panel', description: '打开 AI 管理面板' },
  { command: 'ai_status', description: '查看当前群状态' },
  { command: 'ai_on', description: '开启 AI 互动' },
  { command: 'ai_off', description: '关闭 AI 互动' },
  { command: 'voice_on', description: '开启语音回复' },
  { command: 'voice_off', description: '关闭语音回复' },
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

function registerCommands(bot, getBotInfo) {
  bot.command('my_id', async (ctx) => {
    const userId = ctx.from?.id;
    return ctx.reply(userId ? `你的 Telegram 用户 ID 是：${userId}` : '没有获取到你的用户 ID');
  });

  bot.command('chat_id', (ctx) => ctx.reply(`当前聊天 ID 是：${ctx.chat.id}\nTopic ID：${getThreadId(ctx) || 0}`));

  bot.command('sticker_id', async (ctx) => {
    if (!requireAllowedChat(ctx)) return;
    const sticker = ctx.message?.reply_to_message?.sticker || ctx.message?.sticker;
    if (!sticker) return ctx.reply('请回复一条贴纸消息发送 /sticker_id。');
    return ctx.reply(`贴纸 file_id：\n${sticker.file_id}`);
  });

  bot.command('sticker_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const sticker = ctx.message?.reply_to_message?.sticker || ctx.message?.sticker;
    if (!sticker) return ctx.reply('请回复一条贴纸发送 /sticker_add 标签。');
    const tags = ctx.message.text.split(/\s+/).slice(1).map((tag) => tag.trim()).filter(Boolean);
    const stickers = addChatSticker(ctx.chat.id, sticker.file_id, tags);
    return ctx.reply(`已加入贴纸池，当前 ${stickers.length} 个；标签：${tags.join('、') || '无'}`);
  });

  bot.command('sticker_list', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const stickers = getChatStickers(ctx.chat.id);
    const lines = stickers.slice(0, 50).map((item, index) => `${index + 1}. ${item.tags.join('、') || '无标签'}\n${item.fileId}`);
    const text = lines.length ? `当前贴纸 ${stickers.length} 个：\n${lines.join('\n')}` : '当前群还没有贴纸。';
    return ctx.reply(text.slice(0, 4000));
  });

  bot.command('sticker_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    clearChatStickers(ctx.chat.id);
    return ctx.reply('已清空当前群贴纸池。');
  });

  bot.command('ai_on', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { aiEnabled: true });
    return ctx.reply('已开启 AI 互动');
  });

  bot.command('ai_off', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { aiEnabled: false });
    return ctx.reply('已关闭 AI 互动');
  });

  bot.command('voice_on', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { voiceEnabled: true });
    return ctx.reply('已开启当前群语音回复。');
  });

  bot.command('voice_off', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { voiceEnabled: false });
    return ctx.reply('已关闭语音回复，恢复文字。');
  });

  bot.command('ai_chance', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const value = Number(ctx.message.text.split(/\s+/)[1]);
    if (!Number.isFinite(value) || value < 0 || value > 1) return ctx.reply('用法：/ai_chance 0.05');
    setChatConfig(ctx.chat.id, { randomChance: value });
    return ctx.reply(`随机插话概率已设置为 ${value}`);
  });

  bot.command('ai_set', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [, key, rawValue] = ctx.message.text.trim().split(/\s+/);
    const value = Number(rawValue);
    const map = {
      random_chance: ['randomChance', 0, 1],
      min_interval: ['minReplyIntervalSeconds', 0, 86400],
      min_msgs: ['minMsgsBetweenReplies', 0, 1000],
      idle_threshold: ['idleThresholdMinutes', 1, 10080],
      idle_cooldown: ['idleCooldownMinutes', 1, 10080],
      sticker_chance: ['stickerReplyChance', 0, 1],
      tts_chance: ['ttsReplyChance', 0, 1],
    };
    const item = map[key];
    if (!item || !Number.isFinite(value) || value < item[1] || value > item[2]) {
      return ctx.reply('可用参数：random_chance, min_interval, min_msgs, idle_threshold, idle_cooldown, sticker_chance, tts_chance');
    }
    setChatConfig(ctx.chat.id, { [item[0]]: value });
    return ctx.reply(`${key} 已设置为 ${value}`);
  });

  bot.command('quiet', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [, start, end] = ctx.message.text.trim().split(/\s+/);
    if (start === 'off') {
      setChatConfig(ctx.chat.id, { quietStart: '', quietEnd: '' });
      return ctx.reply('已关闭安静时段。');
    }
    const validClock = (value) => {
      const match = /^(\d{2}):(\d{2})$/.exec(value || '');
      return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
    };
    if (!validClock(start) || !validClock(end)) {
      return ctx.reply('用法：/quiet 23:00 08:00，关闭使用 /quiet off');
    }
    setChatConfig(ctx.chat.id, { quietStart: start, quietEnd: end });
    return ctx.reply(`安静时段已设置为 ${start}-${end}`);
  });

  bot.command('ai_model', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const [, mode, ...modelParts] = ctx.message.text.trim().split(/\s+/);
    const fields = { mention: 'modelMention', random: 'modelRandom', idle: 'modelIdle' };
    if (!fields[mode] || !modelParts.length) return ctx.reply('用法：/ai_model mention|random|idle 模型名|default');
    const model = modelParts.join(' ');
    setChatConfig(ctx.chat.id, { [fields[mode]]: model === 'default' ? '' : model });
    return ctx.reply(`${mode} 模型已设置为 ${model}`);
  });

  bot.command('persona', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const rules = getChatConfig(ctx.chat.id).personaRules || [];
    return ctx.reply(rules.length ? rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n') : '当前群没有额外人设规则。');
  });

  bot.command('persona_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const typed = ctx.message.text.replace(/^\/persona_add(@\w+)?\s*/i, '').trim();
    const replied = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
    const rule = (typed || replied).trim().slice(0, 500);
    if (!rule) return ctx.reply('用法：/persona_add 规则内容，或回复文字发送 /persona_add');
    const config = getChatConfig(ctx.chat.id);
    const rules = [...(config.personaRules || []), rule].slice(0, 30);
    setChatConfig(ctx.chat.id, { personaRules: rules });
    return ctx.reply(`已添加人设规则 ${rules.length}：\n${rule}`);
  });

  bot.command('persona_del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const index = Number.parseInt(ctx.message.text.split(/\s+/)[1], 10) - 1;
    const config = getChatConfig(ctx.chat.id);
    const rules = [...(config.personaRules || [])];
    if (!Number.isInteger(index) || index < 0 || index >= rules.length) return ctx.reply('用法：/persona_del 序号');
    const [removed] = rules.splice(index, 1);
    setChatConfig(ctx.chat.id, { personaRules: rules });
    return ctx.reply(`已删除：${removed}`);
  });

  bot.command('persona_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { personaRules: [] });
    return ctx.reply('已清空当前群额外人设规则。');
  });

  bot.command('rule_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const input = ctx.message.text.replace(/^\/rule_add(@\w+)?\s*/i, '').trim();
    const match = /^(reply|block)\s+(.+?)\s*=>\s*(.*)$/i.exec(input);
    if (!match) return ctx.reply('用法：/rule_add reply 关键词 => 回复内容\n或 /rule_add block 广告词 => 删除提示');
    const [, action, rawKeyword, response] = match;
    const keyword = rawKeyword.trim().slice(0, 100);
    if (!keyword) return ctx.reply('关键词不能为空。');
    const id = addRule(ctx.chat.id, action.toLowerCase(), keyword, response.trim().slice(0, 500));
    return ctx.reply(`已添加规则 #${id}`);
  });

  bot.command('rule_list', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const rules = getRules(ctx.chat.id);
    return ctx.reply(rules.length
      ? rules.map((rule) => `#${rule.id} [${rule.action}] ${rule.keyword} => ${rule.response || '(无提示)'}`).join('\n').slice(0, 4000)
      : '当前群没有关键词规则。');
  });

  bot.command('rule_del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const id = Number.parseInt(ctx.message.text.split(/\s+/)[1], 10);
    return ctx.reply(deleteRule(ctx.chat.id, id) ? `已删除规则 #${id}` : '没有找到该规则。');
  });

  bot.command('rule_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    clearRules(ctx.chat.id);
    return ctx.reply('已清空当前群关键词规则。');
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

  async function sendPanel(ctx, edit = false) {
    const config = getChatConfig(ctx.chat.id);
    const text = formatConfig(ctx.chat.id, getThreadId(ctx), getBotInfo());
    const markup = panelMarkup(config);
    if (!edit) return ctx.reply(text, markup);
    try {
      return await ctx.editMessageText(text, markup);
    } catch (error) {
      if (error.description?.includes('message is not modified')) return null;
      throw error;
    }
  }

  bot.command(['ai_panel', 'ai_config'], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    return sendPanel(ctx);
  });

  bot.action(/^panel:(.+)$/, async (ctx) => {
    if (!(await requireAdmin(ctx))) return ctx.answerCbQuery('无权限');
    const action = ctx.match[1];
    const config = getChatConfig(ctx.chat.id);
    if (action === 'toggle_ai') setChatConfig(ctx.chat.id, { aiEnabled: !config.aiEnabled });
    if (action === 'toggle_reaction') setChatConfig(ctx.chat.id, { reactionEnabled: !config.reactionEnabled });
    if (action === 'toggle_voice') setChatConfig(ctx.chat.id, { voiceEnabled: !config.voiceEnabled });
    const presets = {
      preset_quiet: { randomChance: 0.01, minReplyIntervalSeconds: 300, minMsgsBetweenReplies: 8, idleThresholdMinutes: 60 },
      preset_balanced: { randomChance: 0.03, minReplyIntervalSeconds: 180, minMsgsBetweenReplies: 5, idleThresholdMinutes: 30 },
      preset_active: { randomChance: 0.08, minReplyIntervalSeconds: 60, minMsgsBetweenReplies: 3, idleThresholdMinutes: 20 },
    };
    if (presets[action]) setChatConfig(ctx.chat.id, presets[action]);
    await ctx.answerCbQuery('已更新');
    return sendPanel(ctx, true);
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
        messages: [{ user: ctx.from?.username || '管理员', text: '测试 AI 接口，请简短回复。', ts: Date.now(), fromBot: false }],
        mode: 'mention',
        modelOverrides: modelOverrides(config),
      });
      return ctx.reply(`AI 测试成功\naction: ${result.action}\nreply: ${result.reply || '(空)'}\nreaction: ${result.reaction}\nmodel: ${result.model}\nprovider: ${result.provider}`);
    } catch (error) {
      return ctx.reply(`AI 测试失败：${error.message.slice(0, 1000)}`);
    } finally {
      releaseChatAi(ctx.chat.id);
    }
  });
}

module.exports = { registerCommands, BOT_COMMANDS, formatConfig, panelMarkup };
