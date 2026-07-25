const { DEFAULT_PERSONA } = require('./persona');
const { envInt } = require('./env');
const { recordAiUsage } = require('./usageStore');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_CONTEXT_MESSAGES = envInt('AI_MAX_CONTEXT_MESSAGES', 12);
const MAX_INPUT_CHARS = envInt('AI_MAX_INPUT_CHARS', 1500);
const MAX_MESSAGE_CHARS = envInt('AI_MAX_MESSAGE_CHARS', 160);
const MAX_OUTPUT_TOKENS = envInt('AI_MAX_OUTPUT_TOKENS', 120);
const REQUEST_TIMEOUT_MS = envInt('AI_REQUEST_TIMEOUT_MS', 30000);
const REACTIONS = new Set(['👍', '❤', '🔥', '👏', '😁', '🤔', '🤯', '😢', '😡']);

class AiHttpError extends Error {
  constructor(status, body) {
    super(`AI API error ${status}: ${body}`);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed) || /\/openai\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function providerFromEnv(prefix = 'AI') {
  const isFallback = prefix === 'AI_FALLBACK';
  const baseUrl = process.env[`${prefix}_BASE_URL`] || (isFallback ? '' : process.env.GROQ_BASE_URL || DEFAULT_API_BASE_URL);
  const apiKey = process.env[`${prefix}_API_KEY`] || (isFallback ? '' : process.env.GROQ_API_KEY);
  if (!baseUrl || !apiKey) return null;
  return {
    name: isFallback ? 'fallback' : 'primary',
    apiType: (process.env[`${prefix}_API_TYPE`] || process.env.AI_API_TYPE || 'chat_completions').trim().toLowerCase(),
    baseUrl,
    apiUrl: process.env[`${prefix}_API_URL`] || '',
    apiKey,
    model: process.env[`${prefix}_MODEL`] || process.env.AI_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  };
}

function isResponsesApi(provider) {
  return ['responses', 'response'].includes(provider.apiType);
}

function getApiUrl(provider) {
  if (provider.apiUrl) return provider.apiUrl;
  const base = normalizeBaseUrl(provider.baseUrl);
  return isResponsesApi(provider) ? `${base}/responses` : `${base}/chat/completions`;
}

function truncateText(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function getModelForMode(provider, mode, overrides = {}) {
  const override = overrides[mode];
  if (override) return override;
  if (provider.name === 'fallback') return provider.model;
  if (mode === 'random' && process.env.AI_MODEL_RANDOM) return process.env.AI_MODEL_RANDOM;
  if (mode === 'idle' && process.env.AI_MODEL_IDLE) return process.env.AI_MODEL_IDLE;
  return process.env.AI_MODEL || provider.model;
}

function buildTranscript(messages) {
  const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);
  const lines = [];
  let totalChars = 0;

  for (const message of recentMessages.reverse()) {
    const user = truncateText(message.fromBot ? '[你]' : message.user, 24);
    const text = truncateText(message.text, MAX_MESSAGE_CHARS);
    const line = `${user}: ${text}`;
    if (totalChars + line.length > MAX_INPUT_CHARS) break;
    lines.unshift(line);
    totalChars += line.length;
  }
  return lines.join('\n');
}

function buildInstruction(mode) {
  if (mode === 'mention') return '有人直接 @ 你或回复了你的消息，必须给出有效回应，优先使用 reply。';
  if (mode === 'idle') return '群里已经安静了一段时间，请抛出一个简短、轻松、能继续聊下去的话题，使用 reply 或 sticker。';
  return '这是群里正常闲聊。没有合适内容时选择 silent；轻量回应优先 reaction 或 sticker，需要表达内容时才 reply。';
}

function parseDecision(raw) {
  try {
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    let action = String(parsed.action || '').toLowerCase();
    if (!['silent', 'reaction', 'sticker', 'reply'].includes(action)) {
      if (parsed.sticker) action = 'sticker';
      else action = parsed.should_reply ? 'reply' : 'silent';
    }
    const reaction = REACTIONS.has(parsed.reaction) ? parsed.reaction : '👍';
    return {
      action,
      shouldReply: action !== 'silent',
      reply: truncateText(parsed.reply || '', 300),
      reaction,
      sticker: action === 'sticker',
      stickerTag: truncateText(parsed.sticker_tag || '', 40),
      voice: Boolean(parsed.voice),
    };
  } catch (error) {
    const fallback = truncateText(raw.trim(), 300);
    return {
      action: fallback ? 'reply' : 'silent',
      shouldReply: Boolean(fallback),
      reply: fallback,
      reaction: '👍',
      sticker: false,
      stickerTag: '',
      voice: false,
    };
  }
}

function getResponsesText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') parts.push(content.text);
      if (typeof content.output_text === 'string') parts.push(content.output_text);
    }
  }
  return parts.join('\n').trim();
}

function buildRequestBody(provider, { sys, userContent, model, imageDataUrl }) {
  const temperature = Number(process.env.AI_TEMPERATURE);
  if (isResponsesApi(provider)) {
    const input = imageDataUrl ? [{
      role: 'user',
      content: [
        { type: 'input_text', text: userContent },
        { type: 'input_image', image_url: imageDataUrl },
      ],
    }] : userContent;
    return {
      model,
      instructions: sys,
      input,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      ...(Number.isFinite(temperature) ? { temperature } : {}),
      ...(process.env.AI_DISABLE_RESPONSE_STORAGE === 'true' ? { store: false } : {}),
    };
  }

  const content = imageDataUrl ? [
    { type: 'text', text: userContent },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ] : userContent;
  const tokenField = process.env.AI_CHAT_TOKEN_FIELD || 'max_tokens';
  return {
    model,
    [tokenField]: MAX_OUTPUT_TOKENS,
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    messages: [{ role: 'system', content: sys }, { role: 'user', content }],
  };
}

async function requestProvider(provider, request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(getApiUrl(provider), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(buildRequestBody(provider, request)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = truncateText(await response.text(), 1000);
      throw new AiHttpError(response.status, body);
    }
    const data = await response.json();
    return isResponsesApi(provider) ? getResponsesText(data) : data.choices?.[0]?.message?.content || '';
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`AI API 请求超时（${REQUEST_TIMEOUT_MS}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
  const transcript = buildTranscript(messages);
  const stickerText = stickerTags.length ? `\n当前可用贴纸标签：${stickerTags.join('、')}` : '';
  const sys = `${persona || DEFAULT_PERSONA}

你会看到最近群聊记录。${buildInstruction(mode)}
只输出 JSON，不要 markdown：
{"action":"silent|reaction|sticker|reply","reply":"文字内容","reaction":"👍","sticker_tag":"标签","voice":false}
回复通常不超过 40 个中文字。reaction 只能从 👍 ❤ 🔥 👏 😁 🤔 🤯 😢 😡 中选择。${stickerText}`;
  const userContent = `最近聊天记录：\n${transcript || '(暂无记录)'}${extraContext ? `\n\n补充内容：\n${extraContext}` : ''}\n\n请给出 JSON。`;
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
      recordAiUsage({
        chatId, mode, model, latencyMs: Date.now() - startedAt,
        inputChars: sys.length + userContent.length, outputChars: raw.length, success: true,
      });
    }
    return { ...decision, model, provider: provider.name };
  } catch (error) {
    if (chatId != null) {
      recordAiUsage({
        chatId, mode, model, latencyMs: Date.now() - startedAt,
        inputChars: sys.length + userContent.length, outputChars: 0, success: false, error: error.message,
      });
    }
    throw error;
  }
}

module.exports = { decideAndReply, parseDecision, normalizeBaseUrl, getModelForMode };
