const { envInt } = require('./env');

function senderId(ctx) {
  // Anonymous admins and channel senders must not inherit the anonymous bot's ID.
  if (ctx.message?.sender_chat?.id != null) return `chat:${ctx.message.sender_chat.id}`;
  return ctx.from?.id == null ? null : `user:${ctx.from.id}`;
}

function isAcknowledgement(text) {
  return /^(?:嗯+|哦+|噢+|好[的吧]?|行|可以|收到|知道了|明白了|谢+|谢谢你|哈哈+|[oO][kK]|不用回[了复]?|不聊了|晚安)[\s\p{P}\p{S}]*$/u.test(String(text || '').trim());
}

function isNaturalFollowup(ctx, state, now = Date.now()) {
  const windowMs = envInt('CONVERSATION_FOLLOWUP_SECONDS', 120, { min: 0 }) * 1000;
  const id = senderId(ctx);
  if (!id || !windowMs || isAcknowledgement(ctx.message.text || ctx.message.caption)) return false;
  // An explicit reply to another person or another @mention takes precedence.
  if (ctx.message.reply_to_message || (ctx.message.entities || ctx.message.caption_entities || [])
    .some(entity => ['mention', 'text_mention'].includes(entity.type))) return false;
  const botIndex = state.messages.findLastIndex(m => m.fromBot && m.telegramMessageId);
  if (botIndex < 0) return false;
  const lastBot = state.messages[botIndex];
  if (now - lastBot.ts < 0 || now - lastBot.ts > windowMs) return false;
  const addressed = state.messages.slice(0, botIndex).findLast(m =>
    !m.fromBot && m.telegramMessageId === lastBot.replyToMessageId);
  if (!addressed?.senderId || addressed.senderId !== id) return false;
  const since = state.messages.slice(botIndex + 1).filter(m => !m.fromBot);
  return since.length <= 3 && since.every(m => m.senderId === id);
}

function buildConversationHints(messages, replyTarget) {
  const recent = messages.slice(-24);
  const human = recent.filter(m => !m.fromBot && m.learningEligible);
  const hints = [];
  if (replyTarget?.isFollowup) hints.push('对方正在承接你刚才的话，不需要重新打招呼或把话题从头讲一遍；如果只是在结束对话，就自然收住。');
  if (human.length >= 4) {
    const sortedLengths = human.map(m => String(m.text || '').length).sort((a, b) => a - b);
    const median = sortedLengths[Math.floor(sortedLengths.length / 2)];
    hints.push(median <= 25
      ? '最近群友多用短句，轻松接话可以只说半句或一句；认真问题仍完整回答。'
      : '最近群友在展开讨论，回答可以讲清细节，不必强压成一句话。');
    const emojiCount = human.filter(m => /\p{Extended_Pictographic}/u.test(m.text)).length;
    if (emojiCount / human.length < 0.2) hints.push('最近群友很少用表情，本轮也不必刻意加表情。');
  }
  const own = recent.filter(m => m.fromBot && !/^\[(Reaction|贴纸)/.test(m.text)).slice(-3);
  if (own.length) hints.push('留意下面你自己最近的说法，避免反复用同一个开场、比喻或结尾：\n' +
    own.map(m => JSON.stringify(String(m.text).slice(0, 120))).join('\n'));
  return hints.join('\n');
}

module.exports = { senderId, isAcknowledgement, isNaturalFollowup, buildConversationHints };
