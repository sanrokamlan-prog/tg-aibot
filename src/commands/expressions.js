const { listExpressions, deleteExpression, clearExpressions } = require('../expressionStore');
const { getThreadId } = require('../telegramMessage');
const { requireAdmin } = require('./shared');

function registerExpressionCommands(bot) {
  bot.command('expressions', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    const items = listExpressions(ctx.chat.id, getThreadId(ctx));
    return ctx.reply((items.length ? items.slice(0, 30).map(item =>
      `${item.id}. ${item.expression}（${item.situation}）`).join('\n') : '当前话题还没有学到的表达。') +
      (items.length > 30 ? `\n共 ${items.length} 条，当前展示最常用的 30 条。` : '') +
      '\n\n只学习有原始消息可核对的真人文字，不学习转发、媒体和机器人回复。\n/expression_del ID 删除一条\n/expression_clear 清空当前话题\n默认保留 30 天；EXPRESSION_LEARNING_ENABLED=false 可关闭学习和使用。');
  });
  bot.command('expression_del', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    const id = Number(ctx.message.text.trim().split(/\s+/)[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return ctx.reply('用法：/expression_del ID');
    return ctx.reply(deleteExpression(ctx.chat.id, getThreadId(ctx), id) ? '已删除这条表达。' : '当前话题没有这条表达。');
  });
  bot.command('expression_clear', async ctx => {
    if (!(await requireAdmin(ctx))) return;
    clearExpressions(ctx.chat.id, getThreadId(ctx));
    return ctx.reply('已清空当前话题学到的表达。');
  });
}

module.exports = { registerExpressionCommands };
