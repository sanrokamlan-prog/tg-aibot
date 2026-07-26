const {
  normalizeBaseUrl,
  providerFromEnv,
  getModelForMode,
  requestProvider,
} = require('./aiClient');
const { buildDecisionPrompt, parseDecision } = require('./aiPrompt');
const { recordAiUsage } = require('./usageStore');

function recordAiUsageSafely(entry) {
  try {
    recordAiUsage(entry);
  } catch (error) {
    console.error('记录 AI 用量失败:', error.message);
  }
}

async function decideAndReply({
  chatId,
  persona,
  messages,
  mode,
  stickerTags = [],
  imageDataUrl = '',
  extraContext = '',
  modelOverrides = {},
}) {
  const primary = providerFromEnv('AI');
  if (!primary) throw new Error('缺少 AI_API_KEY 或 GROQ_API_KEY');
  const fallback = providerFromEnv('AI_FALLBACK');
  const { sys, userContent } = buildDecisionPrompt({ persona, messages, mode, stickerTags, extraContext });
  const startedAt = Date.now();
  let provider = primary;
  let model = getModelForMode(provider, mode, modelOverrides);

  try {
    let raw;
    try {
      raw = await requestProvider(provider, { sys, userContent, model, imageDataUrl });
    } catch (error) {
      const canFallback = error.retryable || error.name === 'TypeError' ||
        error.message.includes('请求超时') || (imageDataUrl && error.status === 400);
      if (!fallback || !canFallback) throw error;
      console.warn(`主 AI 接口失败，切换备用接口: ${error.message}`);
      provider = fallback;
      model = getModelForMode(provider, mode, modelOverrides);
      raw = await requestProvider(provider, { sys, userContent, model, imageDataUrl });
    }
    const decision = parseDecision(raw);
    if (chatId != null) {
      recordAiUsageSafely({
        chatId, mode, model, latencyMs: Date.now() - startedAt,
        inputChars: sys.length + userContent.length, outputChars: String(raw || '').length, success: true,
      });
    }
    return { ...decision, model, provider: provider.name };
  } catch (error) {
    if (chatId != null) {
      recordAiUsageSafely({
        chatId, mode, model, latencyMs: Date.now() - startedAt,
        inputChars: sys.length + userContent.length, outputChars: 0, success: false, error: error.message,
      });
    }
    throw error;
  }
}

module.exports = { decideAndReply, parseDecision, normalizeBaseUrl, getModelForMode };
