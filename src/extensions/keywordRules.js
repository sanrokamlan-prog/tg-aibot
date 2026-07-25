const { getRules } = require('../ruleStore');
const { envInt } = require('../env');
const { replyExtra } = require('../telegramMessage');

const COOLDOWN_MS = envInt('RULE_COOLDOWN_SECONDS', 60) * 1000;
const lastTriggeredAt = new Map();

async function handleKeywordRules(ctx, text) {
  if (!text) return false;
  const normalized = text.toLowerCase();

  for (const rule of getRules(ctx.chat.id)) {
    if (!rule.enabled || !normalized.includes(rule.keyword.toLowerCase())) continue;
    const cooldownKey = `${ctx.chat.id}:${rule.id}`;
    const canNotify = Date.now() - (lastTriggeredAt.get(cooldownKey) || 0) >= COOLDOWN_MS;

    if (rule.action === 'block') {
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.error(`关键词规则删除消息失败: rule=${rule.id}:`, error.message);
      }
      if (rule.response && canNotify) {
        lastTriggeredAt.set(cooldownKey, Date.now());
        await ctx.reply(rule.response, replyExtra(ctx));
      }
      return true;
    }

    if (!canNotify) return true;
    lastTriggeredAt.set(cooldownKey, Date.now());
    if (rule.response) await ctx.reply(rule.response, replyExtra(ctx, true));
    return true;
  }

  return false;
}

module.exports = { name: 'keyword-rules', handleMessage: handleKeywordRules };
