require('dotenv').config();
const { Telegraf } = require('telegraf');
const {
  chats,
  getChat,
  pushMessage,
  markBotReplied,
  markIdlePrompted,
} = require('./contextStore');
const { decideTrigger } = require('./trigger');
const { decideAndReply } = require('./ai');
const { tryAcquireChatAi, releaseChatAi } = require('./chatAiLock');
const { DEFAULT_PERSONA } = require('./persona');
const {
  getChatStickers,
  getChatStickerIds,
  addChatSticker,
  clearChatStickers,
} = require('./stickerStore');
const { getChatConfig, setChatConfig } = require('./chatConfigStore');

const bot = new Telegraf(process.env.BOT_TOKEN);
let botInfo = null;

const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

function getManualAdminIds() {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function getEnvStickerIds() {
  return (process.env.STICKER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function getAllowedChatIds() {
  return (process.env.ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAllowedChat(ctx) {
  const allowedChatIds = getAllowedChatIds();
  if (allowedChatIds.length === 0) return true;
  return allowedChatIds.includes(String(ctx.chat?.id));
}

function getStickerTags(chatId) {
  return Array.from(new Set(getChatStickers(chatId).flatMap((item) => item.tags))).filter(Boolean);
}

function pickRandomStickerId(chatId, tag = '') {
  const chatStickers = getChatStickers(chatId);
  const envStickers = getEnvStickerIds().map((fileId) => ({ fileId, tags: [] }));
  const stickers = [...chatStickers, ...envStickers];
  if (stickers.length === 0) return null;

  const normalizedTag = String(tag || '').trim();
  const matched = normalizedTag
    ? stickers.filter((item) => item.tags.some((itemTag) => itemTag === normalizedTag))
    : [];
  const pool = matched.length ? matched : stickers;
  return pool[Math.floor(Math.random() * pool.length)].fileId;
}

async function maybeSendSticker(ctx, wantsSticker, tag = '') {
  if (!wantsSticker) return false;
  const config = getChatConfig(ctx.chat.id);
  if (Math.random() > config.stickerReplyChance) return false;

  const stickerId = pickRandomStickerId(ctx.chat.id, tag);
  if (!stickerId) return false;

  await ctx.replyWithSticker(stickerId);
  return true;
}

async function maybeSendStickerToChat(chatId, wantsSticker, tag = '') {
  if (!wantsSticker) return false;
  const config = getChatConfig(chatId);
  if (Math.random() > config.stickerReplyChance) return false;

  const stickerId = pickRandomStickerId(chatId, tag);
  if (!stickerId) return false;

  await bot.telegram.sendSticker(chatId, stickerId);
  return true;
}

function requireAllowedChat(ctx) {
  if (isAllowedChat(ctx)) return true;
  console.log(`拒绝未授权群组: chat=${ctx.chat?.id}, title=${ctx.chat?.title || ''}`);
  return false;
}

function getPersona(chatId) {
  const basePersona = process.env.PERSONA_PROMPT || DEFAULT_PERSONA;
  const rules = getChatConfig(chatId).personaRules || [];
  if (rules.length === 0) return basePersona;
  return `${basePersona}\n\n本群额外人设规则：\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`;
}

async function isAdmin(ctx) {
  const fromId = ctx.from?.id?.toString();
  const manualAdminIds = getManualAdminIds();

  if (fromId && manualAdminIds.includes(fromId)) return true;

  // Telegram 群开启“匿名管理员”时，消息来源会变成群本身，ctx.from 不再是真实管理员账号。
  // 这种情况下 sender_chat.id 等于当前 chat.id，可以视为管理员操作。
  if (ctx.message?.sender_chat?.id && ctx.message.sender_chat.id === ctx.chat.id) {
    return true;
  }

  if (!fromId || !ctx.chat?.id || ctx.chat.type === 'private') return false;

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(member.status)) return true;
  } catch (e) {
    console.error('检查管理员身份失败:', e.message);
  }

  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    return admins.some((admin) => admin.user?.id?.toString() === fromId);
  } catch (e) {
    console.error('获取管理员列表失败:', e.message);
    return false;
  }
}

// ---- 管理员指令 ----

bot.command('my_id', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return ctx.reply('没有获取到你的用户 ID');
  ctx.reply(`你的 Telegram 用户 ID 是：${userId}\n如果管理员判断失效，可以把它填进 .env 的 ADMIN_USER_IDS`);
});

bot.command('chat_id', async (ctx) => {
  ctx.reply(`当前聊天 ID 是：${ctx.chat.id}\n如果要限制机器人只在这个群可用，把它填进 .env 的 ALLOWED_CHAT_IDS`);
});

bot.command('sticker_id', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;

  const sticker = ctx.message?.reply_to_message?.sticker || ctx.message?.sticker;
  if (!sticker) {
    return ctx.reply('请回复一条贴纸消息发送 /sticker_id，我会告诉你这个贴纸的 file_id。');
  }

  ctx.reply(`贴纸 file_id：\n${sticker.file_id}\n\n如果想直接加入当前群贴纸池，请回复贴纸发送 /sticker_add。`);
});

bot.command('sticker_add', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const sticker = ctx.message?.reply_to_message?.sticker || ctx.message?.sticker;
  if (!sticker) {
    return ctx.reply('请回复一条贴纸消息发送 /sticker_add，我会把它加入当前群贴纸池。');
  }

  const tags = ctx.message.text.split(/\s+/).slice(1).map((tag) => tag.trim()).filter(Boolean);
  const stickers = addChatSticker(ctx.chat.id, sticker.file_id, tags);
  ctx.reply(`已加入当前群贴纸池。当前贴纸数量：${stickers.length}\n标签：${tags.length ? tags.join('、') : '未设置'}`);
});

bot.command('sticker_list', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const stickers = getChatStickers(ctx.chat.id);
  const envStickers = getEnvStickerIds();
  ctx.reply(
    `当前群贴纸数量：${stickers.length}\n全局 .env 贴纸数量：${envStickers.length}\n` +
      (stickers.length
        ? stickers.map((item, index) => `${index + 1}. ${item.tags.length ? item.tags.join('、') : '未设置标签'}\n${item.fileId}`).join('\n')
        : '当前群还没有添加贴纸')
  );
});

bot.command('sticker_clear', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  clearChatStickers(ctx.chat.id);
  ctx.reply('已清空当前群贴纸池。');
});

bot.command('ai_on', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');
  getChat(ctx.chat.id).aiEnabled = true;
  setChatConfig(ctx.chat.id, { aiEnabled: true });
  ctx.reply('已开启 AI 互动');
});

bot.command('ai_off', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');
  getChat(ctx.chat.id).aiEnabled = false;
  setChatConfig(ctx.chat.id, { aiEnabled: false });
  ctx.reply('已关闭 AI 互动');
});

bot.command('ai_chance', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');
  const arg = ctx.message.text.split(' ')[1];
  const val = parseFloat(arg);
  if (Number.isNaN(val) || val < 0 || val > 1) {
    return ctx.reply('用法: /ai_chance 0.05  (范围 0-1，代表随机插话概率)');
  }
  getChat(ctx.chat.id).randomChance = val;
  setChatConfig(ctx.chat.id, { randomChance: val });
  ctx.reply(`随机插话概率已设置为 ${val}`);
});

function formatChatConfig(chatId) {
  const s = getChat(chatId);
  const config = getChatConfig(chatId);
  const username = botInfo?.username ? `@${botInfo.username}` : '启动中';
  const id = botInfo?.id || '启动中';
  return [
    `AI互动: ${config.aiEnabled && s.aiEnabled ? '开启' : '关闭'}`,
    `随机插话概率 random_chance: ${config.randomChance}`,
    `主动发言冷却 min_interval: ${config.minReplyIntervalSeconds} 秒`,
    `消息间隔 min_msgs: ${config.minMsgsBetweenReplies} 条`,
    `冷场阈值 idle_threshold: ${config.idleThresholdMinutes} 分钟`,
    `冷场冷却 idle_cooldown: ${config.idleCooldownMinutes} 分钟`,
    `贴纸概率 sticker_chance: ${config.stickerReplyChance}`,
    `当前缓存消息数: ${s.messages.length}`,
    `当前群贴纸数: ${getChatStickers(chatId).length}`,
    `机器人: ${username}`,
    `机器人ID: ${id}`,
  ].join('\n');
}

bot.command('ai_status', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  ctx.reply(formatChatConfig(ctx.chat.id));
});

bot.command('ai_config', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');
  ctx.reply(`${formatChatConfig(ctx.chat.id)}\n\n修改示例：\n/ai_set random_chance 0.02\n/ai_set min_interval 180\n/ai_set min_msgs 5\n/ai_set idle_threshold 30\n/ai_set idle_cooldown 120\n/ai_set sticker_chance 0.15`);
});

bot.command('ai_set', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const [, key, rawValue] = ctx.message.text.trim().split(/\s+/);
  const value = Number(rawValue);
  const map = {
    random_chance: { field: 'randomChance', min: 0, max: 1, label: '随机插话概率' },
    min_interval: { field: 'minReplyIntervalSeconds', min: 0, max: 86400, label: '主动发言冷却秒数' },
    min_msgs: { field: 'minMsgsBetweenReplies', min: 0, max: 1000, label: '消息间隔条数' },
    idle_threshold: { field: 'idleThresholdMinutes', min: 1, max: 10080, label: '冷场阈值分钟数' },
    idle_cooldown: { field: 'idleCooldownMinutes', min: 1, max: 10080, label: '冷场冷却分钟数' },
    sticker_chance: { field: 'stickerReplyChance', min: 0, max: 1, label: '贴纸发送概率' },
  };

  const item = map[key];
  if (!item || !Number.isFinite(value) || value < item.min || value > item.max) {
    return ctx.reply('用法：/ai_set 参数 值\n可用参数：random_chance, min_interval, min_msgs, idle_threshold, idle_cooldown, sticker_chance');
  }

  setChatConfig(ctx.chat.id, { [item.field]: value });
  if (item.field === 'randomChance') getChat(ctx.chat.id).randomChance = value;
  ctx.reply(`${item.label}已设置为 ${value}`);
});

bot.command('persona', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const rules = getChatConfig(ctx.chat.id).personaRules || [];
  ctx.reply(
    rules.length
      ? `当前群额外人设规则：\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}\n\n添加：/persona_add 规则内容\n删除：/persona_del 序号\n清空：/persona_clear`
      : '当前群还没有额外人设规则。\n添加：/persona_add 说话更毒舌一点，但不要骂人\n也可以回复一条消息发送 /persona_add，把那条消息作为规则添加。'
  );
});

bot.command('persona_add', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const typedRule = ctx.message.text.replace(/^\/persona_add(@\w+)?\s*/i, '').trim();
  const repliedRule = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
  const rule = (typedRule || repliedRule).trim();

  if (!rule) {
    return ctx.reply('用法：/persona_add 规则内容\n或者回复一条文字消息发送 /persona_add，把那条消息作为人设规则添加。');
  }

  const config = getChatConfig(ctx.chat.id);
  const rules = [...(config.personaRules || []), rule].slice(0, 30);
  setChatConfig(ctx.chat.id, { personaRules: rules });
  ctx.reply(`已添加人设规则 ${rules.length}：\n${rule}`);
});

bot.command('persona_del', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  const index = parseInt(ctx.message.text.split(/\s+/)[1], 10) - 1;
  const config = getChatConfig(ctx.chat.id);
  const rules = [...(config.personaRules || [])];

  if (!Number.isInteger(index) || index < 0 || index >= rules.length) {
    return ctx.reply('用法：/persona_del 序号\n先用 /persona 查看序号。');
  }

  const [removed] = rules.splice(index, 1);
  setChatConfig(ctx.chat.id, { personaRules: rules });
  ctx.reply(`已删除人设规则：\n${removed}`);
});

bot.command('persona_clear', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');

  setChatConfig(ctx.chat.id, { personaRules: [] });
  ctx.reply('已清空当前群额外人设规则。');
});

bot.command('ai_test', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以操作');
  if (!tryAcquireChatAi(ctx.chat.id)) return ctx.reply('当前群已有 AI 请求正在处理，请稍后再试。');

  try {
    await ctx.sendChatAction('typing');
    const result = await decideAndReply({
      persona: getPersona(ctx.chat.id),
      stickerTags: getStickerTags(ctx.chat.id),
      messages: [
        {
          user: ctx.from?.username || ctx.from?.first_name || '管理员',
          text: '测试一下 AI 接口是否正常，请回复一句简短的话。',
          ts: Date.now(),
          fromBot: false,
        },
      ],
      mode: 'mention',
    });

    ctx.reply(`AI接口测试成功\nshouldReply: ${result.shouldReply}\nreply: ${result.reply || '(空)'}\nsticker: ${result.sticker}\nstickerTag: ${result.stickerTag || '(空)'}`);
  } catch (e) {
    console.error('AI 接口测试失败:', e.message);
    ctx.reply(`AI接口测试失败：${e.message.slice(0, 3500)}`);
  } finally {
    releaseChatAi(ctx.chat.id);
  }
});

// ---- 普通消息处理 ----

bot.on('message', async (ctx) => {
  if (!requireAllowedChat(ctx)) return;
  if (!ctx.message.text && !ctx.message.sticker) return;
  if (ctx.message.text?.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const messageText = ctx.message.text || '[贴纸]';

  pushMessage(chatId, {
    user: ctx.from.username || ctx.from.first_name || '某人',
    text: messageText,
    ts: Date.now(),
    fromBot: false,
  });

  const trigger = decideTrigger(ctx, botInfo);
  if (!trigger) return;
  if (!tryAcquireChatAi(chatId)) {
    console.log(`跳过并发AI触发: chat=${chatId}, mode=${trigger}`);
    return;
  }

  console.log(`触发AI回复: chat=${chatId}, mode=${trigger}, text=${messageText.slice(0, 80)}`);

  try {
    await ctx.sendChatAction('typing');
    const state = getChat(chatId);

    const { shouldReply, reply, sticker, stickerTag } = await decideAndReply({
      persona: getPersona(ctx.chat.id),
      messages: state.messages,
      mode: trigger,
      stickerTags: getStickerTags(chatId),
    });

    const finalShouldReply = trigger === 'mention' ? true : shouldReply;
    const finalReply = reply || (trigger === 'mention' ? '我在，但刚才没组织好语言，你再说一遍？' : '');

    console.log(`AI决策: chat=${chatId}, mode=${trigger}, shouldReply=${shouldReply}, replyLength=${reply.length}, sticker=${sticker}, stickerTag=${stickerTag}`);

    if (finalShouldReply && finalReply) {
      // 模拟打字延迟，不要瞬间秒回，显得更自然
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
      await ctx.reply(finalReply);
      await maybeSendSticker(ctx, sticker, stickerTag);
      pushMessage(chatId, { user: '[你]', text: finalReply, ts: Date.now(), fromBot: true });
      markBotReplied(chatId);
    }
  } catch (e) {
    console.error('AI 回复失败:', e.message);
    if (trigger === 'mention') {
      await ctx.reply(`AI接口出错了：${e.message.slice(0, 3000)}`);
    }
  } finally {
    releaseChatAi(chatId);
  }
});

// ---- 冷场复活检测 ----

setInterval(async () => {
  const now = Date.now();
  for (const [chatId, state] of chats.entries()) {
    if (!state.aiEnabled) continue;
    if (state.messages.length === 0) continue;

    const config = getChatConfig(chatId);
    if (!config.aiEnabled) continue;

    const lastMsg = state.messages[state.messages.length - 1];
    const idleFor = now - lastMsg.ts;
    const sinceLastIdlePrompt = now - state.lastIdlePromptAt;
    const idleThresholdMs = config.idleThresholdMinutes * 60 * 1000;
    const idleCooldownMs = config.idleCooldownMinutes * 60 * 1000;

    if (idleFor > idleThresholdMs && sinceLastIdlePrompt > idleCooldownMs) {
      if (!tryAcquireChatAi(chatId)) continue;

      try {
        const { shouldReply, reply, sticker, stickerTag } = await decideAndReply({
          persona: getPersona(chatId),
          messages: state.messages,
          mode: 'idle',
          stickerTags: getStickerTags(chatId),
        });

        markIdlePrompted(chatId);

        if (shouldReply && reply) {
          await bot.telegram.sendMessage(chatId, reply);
          await maybeSendStickerToChat(chatId, sticker, stickerTag);
          pushMessage(chatId, { user: '[你]', text: reply, ts: Date.now(), fromBot: true });
          markBotReplied(chatId);
        }
      } catch (e) {
        console.error('冷场检测失败:', e.message);
      } finally {
        releaseChatAi(chatId);
      }
    }
  }
}, IDLE_CHECK_INTERVAL_MS);

// ---- 启动 ----

async function main() {
  botInfo = await bot.telegram.getMe();
  console.log(`机器人信息: @${botInfo.username} (${botInfo.id})`);

  await bot.launch();
  console.log(`机器人已启动: @${botInfo.username} (${botInfo.id})`);
}

main().catch((e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
