const { AI_DEFAULTS } = require('./defaults');
const { envInt } = require('./env');
const { readResponseBuffer } = require('./http');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_OUTPUT_TOKENS = envInt('AI_MAX_OUTPUT_TOKENS', AI_DEFAULTS.maxOutputTokens);
const REQUEST_TIMEOUT_MS = envInt('AI_REQUEST_TIMEOUT_MS', AI_DEFAULTS.requestTimeoutMs);
const RESPONSE_MAX_BYTES = envInt('AI_RESPONSE_MAX_BYTES', AI_DEFAULTS.responseMaxBytes);

class AiHttpError extends Error {
  constructor(status, body) {
    // Provider errors can echo credentials or the entire prompt. Keep them out of Telegram/logs.
    super(`AI API error ${status}`);
    this.status = status;
    this.retryable = [408, 409, 425, 429].includes(status) || status >= 500;
  }
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  if (/\/v\d+(?:beta)?$/.test(trimmed)) return trimmed;
  if (/\/(chat\/completions|responses|messages)$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function providerFromEnv(prefix = 'AI') {
  const isFallback = prefix === 'AI_FALLBACK';
  const baseUrl = process.env[`${prefix}_BASE_URL`] || (isFallback ? '' : process.env.GROQ_BASE_URL || DEFAULT_API_BASE_URL);
  const apiKey = process.env[`${prefix}_API_KEY`] || (isFallback ? '' : process.env.GROQ_API_KEY);
  if ((!baseUrl && !process.env[`${prefix}_API_URL`]) || !apiKey) return null;
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
  if (/\/(chat\/completions|responses|messages)$/.test(base)) return base;
  if (provider.apiType === 'anthropic') return `${base}/messages`;
  if (provider.apiType === 'gemini') return `${String(provider.baseUrl).replace(/\/+$/, '')}/models/${encodeURIComponent(provider.requestModel || provider.model)}:generateContent`;
  return isResponsesApi(provider) ? `${base}/responses` : `${base}/chat/completions`;
}

function getModelForMode(provider, mode, overrides = {}) {
  const override = overrides[mode];
  if (override && (provider.legacy !== false && ['primary', 'fallback'].includes(provider.name))) {
    if (provider.name === 'primary') return override;
  }
  if (provider.modeModels?.[mode]) return provider.modeModels[mode];
  if (!['primary', 'fallback'].includes(provider.name) || provider.legacy === false) return provider.model;
  if (provider.name === 'fallback') return provider.model;
  if (mode === 'random' && process.env.AI_MODEL_RANDOM) return process.env.AI_MODEL_RANDOM;
  if (mode === 'idle' && process.env.AI_MODEL_IDLE) return process.env.AI_MODEL_IDLE;
  return process.env.AI_MODEL || provider.model;
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

function getChatCompletionText(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('\n').trim();
}

function buildRequestBody(provider, { sys, userContent, model, imageDataUrl }) {
  const temperatureValue = provider.temperature !== undefined ? provider.temperature : process.env.AI_TEMPERATURE;
  const temperature = temperatureValue == null || temperatureValue === '' ? NaN : Number(temperatureValue);
  const maxTokens = provider.maxOutputTokens || MAX_OUTPUT_TOKENS;
  const extra = provider.extraBody || {};
  const image = imageDataUrl?.match(/^data:([^;]+);base64,(.+)$/s);
  if (provider.apiType === 'anthropic') {
    return { ...extra, model, system: sys, max_tokens: maxTokens,
      ...(Number.isFinite(temperature) ? { temperature } : {}),
      messages: [{ role: 'user', content: [
        { type: 'text', text: userContent },
        ...(image ? [{ type: 'image', source: { type: 'base64', media_type: image[1], data: image[2] } }] : []),
      ] }] };
  }
  if (provider.apiType === 'gemini') {
    return { ...extra, systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: userContent },
        ...(image ? [{ inlineData: { mimeType: image[1], data: image[2] } }] : [])] }],
      generationConfig: { ...extra.generationConfig, maxOutputTokens: maxTokens,
        ...(Number.isFinite(temperature) ? { temperature } : {}) } };
  }
  if (isResponsesApi(provider)) {
    const input = imageDataUrl ? [{
      role: 'user',
      content: [
        { type: 'input_text', text: userContent },
        { type: 'input_image', image_url: imageDataUrl },
      ],
    }] : userContent;
    return {
      ...extra,
      model,
      instructions: sys,
      input,
      max_output_tokens: maxTokens,
      ...(Number.isFinite(temperature) ? { temperature } : {}),
      ...(process.env.AI_DISABLE_RESPONSE_STORAGE === 'true' ? { store: false } : {}),
    };
  }

  const content = imageDataUrl ? [
    { type: 'text', text: userContent },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ] : userContent;
  const tokenField = provider.tokenField || process.env.AI_CHAT_TOKEN_FIELD || 'max_tokens';
  if (!['max_tokens', 'max_completion_tokens'].includes(tokenField)) throw new Error('不支持的 tokenField');
  return {
    ...extra,
    model,
    [tokenField]: maxTokens,
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    messages: [{ role: 'system', content: sys }, { role: 'user', content }],
  };
}

async function requestProvider(provider, request) {
  if (provider.apiType === 'opencode') return require('./opencode').requestOpenCode(request);
  const controller = new AbortController();
  const timeoutMs = Math.min(provider.timeoutMs || REQUEST_TIMEOUT_MS, request.timeoutMs || Infinity);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', ...provider.headers };
    for (const [header, variable] of Object.entries(provider.headersEnv || {})) {
      if (!process.env[variable]) throw new Error('缺少自定义认证 Header 环境变量');
      headers[header] = process.env[variable];
    }
    if (provider.auth !== 'none') {
      if (provider.apiType === 'anthropic') {
        headers['x-api-key'] = provider.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (provider.apiType === 'gemini') headers['x-goog-api-key'] = provider.apiKey;
      else headers[provider.authHeader || 'Authorization'] = `${provider.authPrefix ?? 'Bearer '}${provider.apiKey}`;
    }
    const response = await fetch(getApiUrl({ ...provider, requestModel: request.model }), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequestBody(provider, request)),
      signal: controller.signal,
    });
    let responseBuffer;
    try {
      responseBuffer = await readResponseBuffer(
        response,
        response.ok ? RESPONSE_MAX_BYTES : Math.min(RESPONSE_MAX_BYTES, 64 * 1024)
      );
    } catch (error) {
      if (!response.ok) throw new AiHttpError(response.status, error.message);
      throw error;
    }
    const responseText = responseBuffer.toString('utf8');
    if (!response.ok) {
      const body = responseText.replace(/\s+/g, ' ').trim().slice(0, 1000);
      const error = new AiHttpError(response.status, body);
      const retryAfter = response.headers.get('retry-after');
      error.retryAfterMs = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
      throw error;
    }
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      throw new Error('AI API 返回了无效 JSON');
    }
    if (provider.apiType === 'anthropic') return (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (provider.apiType === 'gemini') return (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n');
    return isResponsesApi(provider) ? getResponsesText(data) : getChatCompletionText(data);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`AI API 请求超时（${timeoutMs}ms）`);
    if (error instanceof AiHttpError) throw error;
    if (error.message.startsWith('AI API ') || error.message.startsWith('响应超过')) throw error;
    throw new Error('AI API 网络或响应错误');
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  AiHttpError,
  normalizeBaseUrl,
  providerFromEnv,
  getModelForMode,
  requestProvider,
  buildRequestBody,
  getApiUrl,
};
