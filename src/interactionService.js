const { decideAndReply } = require('./ai');
const { tryAcquireChatAi, releaseChatAi } = require('./chatAiLock');
const { getChatConfig } = require('./chatConfigStore');
const {
  chats,
  getChat,
  pushMessage,
  updateMessageText,
  markIdlePrompted,
} = require('./contextStore');
const {
  normalizeDecision,
  sendContextDecision,
  sendIdleDecision,
} = require('./decisionDelivery');
const { runMessageExtensions } = require('./extensions');
const { prepareMediaContext } = require('./mediaContext');
const { getPersona } = require('./personaService');
const { requireAllowedChat } = require('./access');
const { getStickerTags } = require('./stickerService');
const { decideTrigger, isQuietHours } = require('./trigger');
const {
  getThreadId,
  getSenderName,
  normalizeMessageText,
  replyExtra,
} = require('./telegramMessage');

function modelOverrides(config) {
  return { mention: config.modelMention, random: config.modelRandom, idle: config.modelIdle };
}

function isIdleEligible(state, config, now = Date.now()) {
  if (!config.aiEnabled || isQuietHours(config, new Date(now)) || !state.lastHumanMessageAt) return false;
  if (state.idlePromptedForHumanAt >= state.lastHumanMessageAt) return false;
  if (now - state.lastHumanMessageAt <= config.idleThresholdMinutes * 60 * 1000) return false;
  if (now - state.lastIdlePromptAt <= config.idleCooldownMinutes * 60 * 1000) return false;
  return true;
}

function createInteractionService(bot, getBotInfo) {
  async function handleMessage(ctx) {
    if (!requireAllowedChat(ctx)) return;
    if (ctx.message.text?.startsWith('/')) return;
    const initialText = normalizeMessageText(ctx.message);
    if (!initialText) return;

    const chatId = ctx.chat.id;
    const threadId = getThreadId(ctx);
    const handledBy = await runMessageExtensions(ctx, initialText);
    if (handledBy) {
      console.log(`扩展已处理消息: chat=${chatId}, extension=${handledBy}`);
      return;
    }

    const stored = pushMessage(chatId, threadId, {
      user: getSenderName(ctx),
      text: initialText,
      ts: Date.now(),
      fromBot: false,
      telegramMessageId: ctx.message.message_id,
      replyToMessageId: ctx.message.reply_to_message?.message_id || null,
    });

    const trigger = decideTrigger(ctx, getBotInfo(), threadId);
    if (!trigger) return;
    if (!tryAcquireChatAi(chatId)) {
      console.log(`跳过并发AI触发: chat=${chatId}, mode=${trigger}`);
      return;
    }

    try {
      const media = await prepareMediaContext(ctx);
      if (media.replacementText) updateMessageText(chatId, threadId, stored.dbId, media.replacementText);
      try {
        await ctx.sendChatAction('typing');
      } catch (error) {
        console.warn(`发送输入状态失败: chat=${chatId}:`, error.message);
      }
      const state = getChat(chatId, threadId);
      const config = getChatConfig(chatId);
      const decision = await decideAndReply({
        chatId,
        persona: getPersona(chatId),
        messages: state.messages,
        mode: trigger,
        stickerTags: getStickerTags(chatId),
        imageDataUrl: media.imageDataUrl,
        extraContext: media.extraContext,
        modelOverrides: modelOverrides(config),
      });
      console.log(`AI决策: chat=${chatId}, mode=${trigger}, action=${decision.action}, model=${decision.model}`);
      await sendContextDecision(ctx, threadId, decision, trigger, config);
    } catch (error) {
      console.error('AI 回复失败:', error.message);
      if (trigger === 'mention') {
        await ctx.reply(`AI接口出错了：${error.message.slice(0, 1000)}`, replyExtra(ctx, true));
      }
    } finally {
      releaseChatAi(chatId);
    }
  }

  async function runIdleCheck() {
    const now = Date.now();
    const attemptedChats = new Set();
    for (const state of chats.values()) {
      const chatKey = String(state.chatId);
      if (attemptedChats.has(chatKey)) continue;
      const config = getChatConfig(state.chatId);
      if (!isIdleEligible(state, config, now)) continue;
      if (!tryAcquireChatAi(state.chatId)) continue;
      attemptedChats.add(chatKey);

      try {
        const decision = await decideAndReply({
          chatId: state.chatId,
          persona: getPersona(state.chatId),
          messages: state.messages,
          mode: 'idle',
          stickerTags: getStickerTags(state.chatId),
          modelOverrides: modelOverrides(config),
        });
        await sendIdleDecision(bot, state, decision, config);
        markIdlePrompted(state.chatId, state.threadId);
      } catch (error) {
        console.error(`冷场检测失败: chat=${state.chatId}:`, error.message);
      } finally {
        releaseChatAi(state.chatId);
      }
    }
  }

  return { handleMessage, runIdleCheck };
}

module.exports = { createInteractionService, normalizeDecision, isIdleEligible };
