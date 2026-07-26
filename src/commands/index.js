const { registerGeneralCommands } = require('./general');
const { registerPersonaRuleCommands } = require('./personaRules');
const { registerSettingsCommands } = require('./settings');
const { registerStickerCommands } = require('./stickers');
const { BOT_COMMANDS, formatConfig, panelMarkup } = require('./shared');

function registerCommands(bot, getBotInfo) {
  registerGeneralCommands(bot, getBotInfo);
  registerSettingsCommands(bot, getBotInfo);
  registerPersonaRuleCommands(bot);
  registerStickerCommands(bot);
}

module.exports = { registerCommands, BOT_COMMANDS, formatConfig, panelMarkup };
