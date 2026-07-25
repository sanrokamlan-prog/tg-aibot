const { DEFAULT_PERSONA } = require('./persona');
const { getChatConfig } = require('./chatConfigStore');

function getPersona(chatId) {
  const base = process.env.PERSONA_PROMPT || DEFAULT_PERSONA;
  const rules = (getChatConfig(chatId).personaRules || []).slice(0, 30);
  if (!rules.length) return base;
  return `${base}\n\n本群额外人设规则：\n${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`;
}

module.exports = { getPersona };
