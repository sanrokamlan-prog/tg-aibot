const { getChatConfig, setChatConfig } = require('../chatConfigStore');
const { addRule, getRules, deleteRule, clearRules } = require('../ruleStore');
const { requireAdmin } = require('./shared');

function registerPersonaRuleCommands(bot) {
  bot.command('persona', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const rules = getChatConfig(ctx.chat.id).personaRules || [];
    return ctx.reply(rules.length
      ? rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')
      : '当前群没有额外人设规则。');
  });

  bot.command('persona_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const typed = ctx.message.text.replace(/^\/persona_add(@\w+)?\s*/i, '').trim();
    const replied = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption || '';
    const rule = (typed || replied).trim().slice(0, 500);
    if (!rule) return ctx.reply('用法：/persona_add 规则内容，或回复文字发送 /persona_add');
    const config = getChatConfig(ctx.chat.id);
    const rules = [...(config.personaRules || []), rule].slice(0, 30);
    setChatConfig(ctx.chat.id, { personaRules: rules });
    return ctx.reply(`已添加人设规则 ${rules.length}：\n${rule}`);
  });

  bot.command('persona_del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const index = Number.parseInt(ctx.message.text.split(/\s+/)[1], 10) - 1;
    const config = getChatConfig(ctx.chat.id);
    const rules = [...(config.personaRules || [])];
    if (!Number.isInteger(index) || index < 0 || index >= rules.length) return ctx.reply('用法：/persona_del 序号');
    const [removed] = rules.splice(index, 1);
    setChatConfig(ctx.chat.id, { personaRules: rules });
    return ctx.reply(`已删除：${removed}`);
  });

  bot.command('persona_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    setChatConfig(ctx.chat.id, { personaRules: [] });
    return ctx.reply('已清空当前群额外人设规则。');
  });

  bot.command('rule_add', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const input = ctx.message.text.replace(/^\/rule_add(@\w+)?\s*/i, '').trim();
    const match = /^(reply|block)\s+(.+?)\s*=>\s*(.*)$/i.exec(input);
    if (!match) return ctx.reply('用法：/rule_add reply 关键词 => 回复内容\n或 /rule_add block 广告词 => 删除提示');
    const [, action, rawKeyword, response] = match;
    const keyword = rawKeyword.trim().slice(0, 100);
    if (!keyword) return ctx.reply('关键词不能为空。');
    const id = addRule(ctx.chat.id, action.toLowerCase(), keyword, response.trim().slice(0, 500));
    return ctx.reply(`已添加规则 #${id}`);
  });

  bot.command('rule_list', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const rules = getRules(ctx.chat.id);
    return ctx.reply(rules.length
      ? rules.map((rule) => `#${rule.id} [${rule.action}] ${rule.keyword} => ${rule.response || '(无提示)'}`).join('\n').slice(0, 4000)
      : '当前群没有关键词规则。');
  });

  bot.command('rule_del', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const id = Number.parseInt(ctx.message.text.split(/\s+/)[1], 10);
    if (!Number.isInteger(id) || id <= 0) return ctx.reply('用法：/rule_del 规则编号');
    return ctx.reply(deleteRule(ctx.chat.id, id) ? `已删除规则 #${id}` : '没有找到该规则。');
  });

  bot.command('rule_clear', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    clearRules(ctx.chat.id);
    return ctx.reply('已清空当前群关键词规则。');
  });
}

module.exports = { registerPersonaRuleCommands };
