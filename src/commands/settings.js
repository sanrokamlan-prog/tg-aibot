const { getChatConfig, setChatConfig } = require('../chatConfigStore');
const { getThreadId } = require('../telegramMessage');
const { formatConfig, panelMarkup, requireAdmin } = require('./shared');

function registerSettingsCommands(bot, getBotInfo) {
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
}

module.exports = { registerSettingsCommands };
