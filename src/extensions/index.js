const keywordRules = require('./keywordRules');

const extensions = [keywordRules];

async function runMessageExtensions(ctx, text) {
  for (const extension of extensions) {
    if (await extension.handleMessage(ctx, text)) return extension.name;
  }
  return null;
}

function getExtensionNames() {
  return extensions.map((extension) => extension.name);
}

module.exports = { runMessageExtensions, getExtensionNames };
