function getThreadId(ctx) {
  return ctx.message?.message_thread_id || ctx.callbackQuery?.message?.message_thread_id || 0;
}

function getSenderName(ctx) {
  return ctx.from?.username || ctx.from?.first_name || ctx.message?.sender_chat?.title || '某人';
}

function normalizeMessageText(message) {
  if (message.text) return message.text.trim();
  if (message.caption) return `[媒体] ${message.caption.trim()}`;
  if (message.sticker) return `[贴纸${message.sticker.emoji ? ` ${message.sticker.emoji}` : ''}]`;
  if (message.voice) return '[语音消息]';
  if (message.audio) return `[音频${message.audio.title ? ` ${message.audio.title}` : ''}]`;
  if (message.photo) return '[图片]';
  if (message.video) return '[视频]';
  if (message.animation) return '[动图]';
  if (message.document) return `[文件 ${message.document.file_name || ''}]`.trim();
  return '';
}

function replyExtra(ctx, quote = false) {
  const extra = {};
  const threadId = getThreadId(ctx);
  if (threadId) extra.message_thread_id = threadId;
  if (quote && ctx.message?.message_id) {
    extra.reply_parameters = { message_id: ctx.message.message_id };
  }
  return extra;
}

function threadExtra(threadId) {
  return threadId ? { message_thread_id: threadId } : {};
}

module.exports = { getThreadId, getSenderName, normalizeMessageText, replyExtra, threadExtra };
