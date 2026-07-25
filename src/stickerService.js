const { envList } = require('./env');
const { getChatConfig } = require('./chatConfigStore');
const { getChatStickers } = require('./stickerStore');
const { replyExtra, threadExtra } = require('./telegramMessage');

function getStickerTags(chatId) {
  return Array.from(new Set(getChatStickers(chatId).flatMap((item) => item.tags))).filter(Boolean);
}

function pickStickerId(chatId, tag = '') {
  const chatStickers = getChatStickers(chatId);
  const envStickers = envList('STICKER_IDS').map((fileId) => ({ fileId, tags: [] }));
  const stickers = [...chatStickers, ...envStickers];
  if (!stickers.length) return null;
  const normalized = String(tag || '').trim().toLowerCase();
  const matched = normalized
    ? stickers.filter((item) => item.tags.some((itemTag) => itemTag.toLowerCase() === normalized))
    : [];
  const pool = matched.length ? matched : stickers;
  return pool[Math.floor(Math.random() * pool.length)].fileId;
}

function shouldSendSticker(chatId) {
  return Math.random() <= getChatConfig(chatId).stickerReplyChance;
}

async function sendStickerForContext(ctx, tag = '', { quote = false } = {}) {
  if (!shouldSendSticker(ctx.chat.id)) return null;
  const stickerId = pickStickerId(ctx.chat.id, tag);
  if (!stickerId) return null;
  return ctx.replyWithSticker(stickerId, replyExtra(ctx, quote));
}

async function sendStickerToChat(bot, chatId, threadId, tag = '') {
  if (!shouldSendSticker(chatId)) return null;
  const stickerId = pickStickerId(chatId, tag);
  if (!stickerId) return null;
  return bot.telegram.sendSticker(chatId, stickerId, threadExtra(threadId));
}

module.exports = { getStickerTags, pickStickerId, sendStickerForContext, sendStickerToChat };
