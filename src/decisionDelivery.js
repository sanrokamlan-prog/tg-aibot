const { pushMessage, markBotReplied } = require('./contextStore');
const { envInt } = require('./env');
const { sendStickerForContext, sendStickerToChat } = require('./stickerService');
const { replyExtra, threadExtra } = require('./telegramMessage');
const { textToSpeech } = require('./tts');

const TYPING_DELAY_MIN_MS = envInt('TYPING_DELAY_MIN_MS', 800, { min: 0 });
const TYPING_DELAY_MAX_MS = envInt('TYPING_DELAY_MAX_MS', 2200, { min: 0 });

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

function shouldUseVoice(config, random = Math.random) {
  return Boolean(config.voiceEnabled) && random() < config.ttsReplyChance;
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
    if (shouldUseVoice(config)) {
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
    if (shouldUseVoice(config)) {
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

module.exports = {
  normalizeDecision,
  shouldUseVoice,
  sendContextDecision,
  sendIdleDecision,
};
