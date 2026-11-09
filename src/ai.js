const {
  normalizeBaseUrl,
  getModelForMode,
  requestProvider,
} = require('./aiClient');
const { buildDecisionPrompt, parseDecision } = require('./aiPrompt');
const { recordAiUsage } = require('./usageStore');
const { loadProviders, providerRouter } = require('./providerPool');
const { envInt } = require('./env');

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
  memoryContext = '',
  replyTarget = null,
}) {
  const pool = loadProviders();
  const { sys, userContent } = buildDecisionPrompt({ persona, messages, mode, stickerTags, extraContext, memoryContext, replyTarget });
  const startedAt = Date.now();
  let model = '';

  try {
    const maxAttempts = envInt('AI_MAX_ATTEMPTS', 6);
    const budgetMs = envInt('AI_TOTAL_TIMEOUT_MS', 90000);
    let lastError;
    let attempts = 0;
    for (const provider of providerRouter.candidates(pool, mode, modelOverrides, imageDataUrl).slice(0, maxAttempts)) {
      const remaining = budgetMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      model = provider.model;
      attempts += 1;
      try {
        const output = await requestProvider(provider, { sys, userContent, model, mode, imageDataUrl, timeoutMs: remaining });
        const raw = typeof output === 'string' ? output : output.text;
        if (output.model) model = output.model;
        const decision = parseDecision(raw, { strict: true });
        if (mode === 'mention' && !decision.reply.trim()) throw new Error('AI 未返回可发送的文字');
        providerRouter.success(provider);
        if (chatId != null) recordAiUsageSafely({
          chatId, mode, model, latencyMs: Date.now() - startedAt,
          inputChars: sys.length + userContent.length, outputChars: raw.length, success: true,
        });
        return { ...decision, model, provider: provider.name, attempts };
      } catch (error) {
        providerRouter.failure(provider, error);
        lastError = error;
        console.warn(`AI 尝试失败: provider=${provider.name}, attempt=${attempts}, status=${error.status || error.code || 'failed'}`);
      }
    }
    throw lastError || new Error('AI 模型池暂无可用项（冷却中、无匹配能力或请求总时限已到）');
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
