const { requireAllowedChat } = require('../access');
const { addChatSticker, getChatStickers, clearChatStickers } = require('../stickerStore');
const { requireAdmin } = require('./shared');

function registerStickerCommands(bot) {
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
    const lines = stickers.slice(0, 50)
      .map((item, index) => `${index + 1}. ${item.tags.join('、') || '无标签'}\n${item.fileId}`);
    const text = lines.length ? `当前贴纸 ${stickers.length} 个：\n${lines.join('\n')}` : '当前群还没有贴纸。';
    return ctx.reply(text.slice(0, 4000));
  });

  bot.command('sticker_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    clearChatStickers(ctx.chat.id);
    return ctx.reply('已清空当前群贴纸池。');
  });
}

module.exports = { registerStickerCommands };
