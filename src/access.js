const { envList } = require('./env');

function getManualAdminIds() {
  return envList('ADMIN_USER_IDS');
}

function getAllowedChatIds() {
  return envList('ALLOWED_CHAT_IDS');
}

function isAllowedChat(ctx) {
  const allowed = getAllowedChatIds();
  return allowed.length === 0 || allowed.includes(String(ctx.chat?.id));
}

function requireAllowedChat(ctx) {
  if (isAllowedChat(ctx)) return true;
  console.log(`拒绝未授权群组: chat=${ctx.chat?.id}, title=${ctx.chat?.title || ''}`);
  return false;
}

async function isAdmin(ctx) {
  const fromId = ctx.from?.id?.toString();
  if (fromId && getManualAdminIds().includes(fromId)) return true;

  if (ctx.message?.sender_chat?.id && ctx.message.sender_chat.id === ctx.chat?.id) {
    return true;
  }
  if (!fromId || !ctx.chat?.id || ctx.chat.type === 'private') return false;

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error('检查管理员身份失败:', error.message);
    return false;
  }
}

module.exports = { getManualAdminIds, getAllowedChatIds, isAllowedChat, requireAllowedChat, isAdmin };
