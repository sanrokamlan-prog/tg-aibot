const { listMemories, addMemory, deleteMemory, clearMemories } = require('../memoryStore');
const { getThreadId } = require('../telegramMessage');
const { requireAdmin } = require('./shared');

function registerMemoryCommands(bot) {
  bot.command('memory', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    const notes = listMemories(ctx.chat.id, getThreadId(ctx));
    return ctx.reply((notes.length ? notes.map(m => `${m.id}. ${m.text}`).join('\n') : '当前话题没有记忆。') +
      '\n\n/memory_add 内容：记住群友偏好、黑话或话题约定\n/memory_del ID：删除\n/memory_clear：清空\n默认保留 30 天；记忆仅供当前群的当前话题使用。');
  });
  bot.command('memory_add', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    const text = ctx.message.text.replace(/^\/memory_add(@\w+)?\s*/i, '').trim();
    try { addMemory(ctx.chat.id, getThreadId(ctx), text); }
    catch (error) { return ctx.reply(error.message); }
    return ctx.reply('已记住。可用 /memory 查看或删除。');
  });
  bot.command('memory_del', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    const id = Number(ctx.message.text.trim().split(/\s+/)[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return ctx.reply('用法：/memory_del ID');
    return ctx.reply(deleteMemory(ctx.chat.id, getThreadId(ctx), id) ? '已删除记忆。' : '没有找到当前话题的这条记忆。');
  });
  bot.command('memory_clear', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    clearMemories(ctx.chat.id, getThreadId(ctx));
    return ctx.reply('已清空当前话题记忆。');
  });
}

module.exports = { registerMemoryCommands };
