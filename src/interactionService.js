const { decideAndReply } = require('./ai');
const { tryAcquireChatAi, releaseChatAi } = require('./chatAiLock');
const { getChatConfig } = require('./chatConfigStore');
const {
  chats,
  getChat,
  pushMessage,
  updateMessageText,
  markBotReplied,
  markIdlePrompted,
} = require('./contextStore');
const { runMessageExtensions } = require('./extensions');
const { envInt } = require('./env');
const { prepareMediaContext } = require('./mediaContext');
const { getPersona } = require('./personaService');
const { requireAllowedChat } = require('./access');
const { getStickerTags, sendStickerForContext, sendStickerToChat } = require('./stickerService');
const { textToSpeech } = require('./tts');
const { decideTrigger, isQuietHours } = require('./trigger');
const {
  getThreadId,
  getSenderName,
  normalizeMessageText,
  replyExtra,
  threadExtra,
} = require('./telegramMessage');

const TYPING_DELAY_MIN_MS = envInt('TYPING_DELAY_MIN_MS', 800, { min: 0 });
const TYPING_DELAY_MAX_MS = envInt('TYPING_DELAY_MAX_MS', 2200, { min: 0 });

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

function delayBeforeReply() {
  const min = Math.min(TYPING_DELAY_MIN_MS, TYPING_DELAY_MAX_MS);
  const max = Math.max(TYPING_DELAY_MIN_MS, TYPING_DELAY_MAX_MS);
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

function normalizeDecision(decision, mode, config) {
  const result = { ...decision };
  if (mode === 'mention' && ['silent', 'reaction'].includes(result.action)) result.action = 'reply';
  if (!config.reactionEnabled && result.action === 'reaction') {
    result.action = result.reply ? 'reply' : 'silent';
  }
  if (mode === 'idle' && result.action === 'reaction') result.action = result.reply ? 'reply' : 'silent';
  if (result.action === 'reply' && !result.reply && mode === 'mention') {
    result.reply = '我在，但刚才没组织好语言，你再说一遍？';
  }
  return result;
}

async function sendVoiceForContext(ctx, text, quote) {
  const audio = await textToSpeech(text);
  return ctx.replyWithVoice({ source: audio.buffer, filename: audio.filename }, replyExtra(ctx, quote));
}

async function sendVoiceToChat(bot, chatId, threadId, text) {
  const audio = await textToSpeech(text);
  return bot.telegram.sendVoice(
    chatId,
    { source: audio.buffer, filename: audio.filename },
    threadExtra(threadId)
  );
}

async function sendContextDecision(ctx, threadId, rawDecision, mode, config) {
  const decision = normalizeDecision(rawDecision, mode, config);
  let sent = null;
  let historyText = '';

  if (decision.action === 'reaction') {
    try {
      await ctx.telegram.callApi('setMessageReaction', {
        chat_id: ctx.chat.id,
        message_id: ctx.message.message_id,
        reaction: [{ type: 'emoji', emoji: decision.reaction }],
      });
      historyText = `[Reaction ${decision.reaction}]`;
    } catch (error) {
      console.error('发送 Reaction 失败:', error.message);
      if (decision.reply) decision.action = 'reply';
    }
  } else if (decision.action === 'sticker') {
    sent = await sendStickerForContext(ctx, decision.stickerTag, { quote: mode === 'mention' });
    historyText = sent ? `[贴纸 ${decision.stickerTag || ''}]` : '';
    if (!sent) {
      decision.action = 'reply';
      if (!decision.reply && mode === 'mention') decision.reply = '我在，你再说详细一点？';
    }
  }

  if (decision.action === 'reply' && decision.reply) {
    await delayBeforeReply();
    const useVoice = config.voiceEnabled && Math.random() <= config.ttsReplyChance;
    if (useVoice) {
      try {
        sent = await sendVoiceForContext(ctx, decision.reply, mode === 'mention');
        historyText = `[语音回复] ${decision.reply}`;
      } catch (error) {
        console.error('TTS 失败，回退文字:', error.message);
      }
    }
    if (!sent) {
      sent = await ctx.reply(decision.reply, replyExtra(ctx, mode === 'mention'));
      historyText = decision.reply;
    }
  }

  if (!historyText) return false;
  pushMessage(ctx.chat.id, threadId, {
    user: '[你]',
    text: historyText,
    ts: Date.now(),
    fromBot: true,
    telegramMessageId: sent?.message_id || null,
  });
  markBotReplied(ctx.chat.id, threadId);
  return true;
}

async function sendIdleDecision(bot, state, rawDecision, config) {
  const decision = normalizeDecision(rawDecision, 'idle', config);
  let sent = null;
  let historyText = '';

  if (decision.action === 'sticker') {
    sent = await sendStickerToChat(bot, state.chatId, state.threadId, decision.stickerTag);
    historyText = sent ? `[贴纸 ${decision.stickerTag || ''}]` : '';
    if (!sent && decision.reply) decision.action = 'reply';
  }
  if (decision.action === 'reply' && decision.reply) {
    const useVoice = config.voiceEnabled && Math.random() <= config.ttsReplyChance;
    if (useVoice) {
      try {
        sent = await sendVoiceToChat(bot, state.chatId, state.threadId, decision.reply);
        historyText = `[语音回复] ${decision.reply}`;
      } catch (error) {
        console.error('冷场 TTS 失败，回退文字:', error.message);
      }
    }
    if (!sent) {
      sent = await bot.telegram.sendMessage(state.chatId, decision.reply, threadExtra(state.threadId));
      historyText = decision.reply;
    }
  }
  if (!historyText) return false;
  pushMessage(state.chatId, state.threadId, {
    user: '[你]', text: historyText, ts: Date.now(), fromBot: true,
    telegramMessageId: sent?.message_id || null,
  });
  markBotReplied(state.chatId, state.threadId);
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
    const stored = pushMessage(chatId, threadId, {
      user: getSenderName(ctx),
      text: initialText,
      ts: Date.now(),
      fromBot: false,
      telegramMessageId: ctx.message.message_id,
      replyToMessageId: ctx.message.reply_to_message?.message_id || null,
    });

    const handledBy = await runMessageExtensions(ctx, initialText);
    if (handledBy) {
      console.log(`扩展已处理消息: chat=${chatId}, extension=${handledBy}`);
      return;
    }

    const trigger = decideTrigger(ctx, getBotInfo(), threadId);
    if (!trigger) return;
    if (!tryAcquireChatAi(chatId)) {
      console.log(`跳过并发AI触发: chat=${chatId}, mode=${trigger}`);
      return;
    }

    try {
      const media = await prepareMediaContext(ctx);
      if (media.replacementText) updateMessageText(chatId, threadId, stored.dbId, media.replacementText);
      await ctx.sendChatAction('typing');
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
    for (const state of chats.values()) {
      const config = getChatConfig(state.chatId);
      if (!isIdleEligible(state, config, now)) continue;
      if (!tryAcquireChatAi(state.chatId)) continue;

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
