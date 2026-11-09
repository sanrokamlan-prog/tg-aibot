const { decideAndReply } = require('./ai');
const { tryAcquireChatAi, releaseChatAi, isAcceptingChatAi } = require('./chatAiLock');
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
const { buildMemoryContext } = require('./memoryStore');
const { buildExpressionContext, recordExpression } = require('./expressionStore');
const { senderId, isAcknowledgement } = require('./conversationContext');
const { createConversationQueue } = require('./conversationQueue');
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
  const queue = createConversationQueue(processJob);

  async function handleMessage(ctx) {
    if (!isAcceptingChatAi()) return;
    if (!requireAllowedChat(ctx)) return;
    if (ctx.message.text?.startsWith('/')) return;
    if (ctx.from?.is_bot && !ctx.message.sender_chat) return;
    const initialText = normalizeMessageText(ctx.message);
    if (!initialText) return;

    const chatId = ctx.chat.id;
    const threadId = getThreadId(ctx);
    const handledBy = await runMessageExtensions(ctx, initialText);
    if (!isAcceptingChatAi()) return;
    if (handledBy) {
      console.log(`扩展已处理消息: chat=${chatId}, extension=${handledBy}`);
      return;
    }

    const stored = pushMessage(chatId, threadId, {
      user: getSenderName(ctx),
      text: initialText,
      ts: Date.now(),
      fromBot: false,
      senderId: senderId(ctx),
      learningEligible: Boolean(ctx.message.text && !ctx.message.forward_origin &&
        !ctx.message.forward_date && !ctx.message.via_bot && !ctx.message.sender_chat &&
        !(ctx.message.entities || []).some(entity =>
          ['blockquote', 'expandable_blockquote', 'code', 'pre', 'url', 'text_link'].includes(entity.type))),
      telegramMessageId: ctx.message.message_id,
      replyToMessageId: ctx.message.reply_to_message?.message_id || null,
    });

    let trigger = decideTrigger(ctx, getBotInfo(), threadId);
    const pending = queue.participant(chatId, threadId, stored.senderId);
    const config = getChatConfig(chatId);
    if (!trigger && pending && config.aiEnabled && !isQuietHours(config) &&
      !isAcknowledgement(initialText) && !ctx.message.reply_to_message &&
      !(ctx.message.entities || ctx.message.caption_entities || []).some(entity =>
        ['mention', 'text_mention'].includes(entity.type))) trigger = 'followup';
    if (!trigger) return;
    const completed = await queue.enqueue({ chatId, threadId, senderId: stored.senderId, ctx, stored, initialText, trigger,
      mergeable: Boolean(ctx.message.text && !ctx.message.reply_to_message) });
    if (!completed && trigger === 'mention' && isAcceptingChatAi()) {
      // A bounded queue can fill under abuse; do not silently discard a direct question.
      await ctx.reply('这会儿消息有点多，稍等一下再叫我。', replyExtra(ctx, true));
    }
  }

  async function processJob({ chatId, threadId, ctx, stored, initialText, trigger, continuation }, hasNewer) {
    if (!getChatConfig(chatId).aiEnabled) return true;

    try {
      const media = await prepareMediaContext(ctx);
      if (media.replacementText) updateMessageText(chatId, threadId, stored.dbId, media.replacementText);
      try {
        await ctx.sendChatAction('typing');
      } catch (error) {
        console.warn(`发送输入状态失败: chat=${chatId}:`, error.message);
      }
      const state = getChat(chatId, threadId);
      const messages = state.messages.map(message => ({ ...message }));
      const newestHumanId = messages.findLast(message => !message.fromBot)?.dbId;
      const config = getChatConfig(chatId);
      const decision = await decideAndReply({
        chatId,
        persona: getPersona(chatId),
        messages,
        replyTarget: { user: stored.user, text: media.replacementText || initialText,
          senderId: stored.senderId, isFollowup: continuation,
          quotedText: ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '' },
        memoryContext: [buildMemoryContext(chatId, threadId),
          buildExpressionContext(chatId, threadId, initialText)].filter(Boolean).join('\n\n'),
        // Keep provider/model routing compatible with the existing three modes.
        mode: trigger === 'followup' ? 'random' : trigger,
        stickerTags: getStickerTags(chatId),
        imageDataUrl: media.imageDataUrl,
        extraContext: media.extraContext,
        modelOverrides: modelOverrides(config),
      });
      try { recordExpression(chatId, threadId, decision.learnedExpression, messages); }
      catch (error) { console.warn('表达学习写入失败:', error.message); }
      console.log(`AI决策: chat=${chatId}, mode=${trigger}, action=${decision.action}, model=${decision.model}`);
      const shouldCancel = () => hasNewer() || (trigger !== 'mention' &&
        getChat(chatId, threadId).messages.findLast(message => !message.fromBot)?.dbId !== newestHumanId);
      await sendContextDecision(ctx, threadId, decision, trigger, config, shouldCancel);
    } catch (error) {
      console.error('AI 回复失败:', error.message);
      if (trigger === 'mention' && !hasNewer()) {
        await ctx.reply(`AI接口出错了：${error.message.slice(0, 1000)}`, replyExtra(ctx, true));
      }
    }
    return true;
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
        const humanAt = state.lastHumanMessageAt;
        const messages = state.messages.map(message => ({ ...message }));
        const decision = await decideAndReply({
          chatId: state.chatId,
          persona: getPersona(state.chatId),
          messages,
          memoryContext: buildMemoryContext(state.chatId, state.threadId),
          mode: 'idle',
          stickerTags: getStickerTags(state.chatId),
          modelOverrides: modelOverrides(config),
        });
        if (state.lastHumanMessageAt === humanAt) {
          await sendIdleDecision(bot, state, decision, config, () => state.lastHumanMessageAt !== humanAt);
          if (state.lastHumanMessageAt === humanAt) markIdlePrompted(state.chatId, state.threadId);
        }
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
