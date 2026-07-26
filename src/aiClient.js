const { AI_DEFAULTS } = require('./defaults');
const { envInt } = require('./env');
const { readResponseBuffer } = require('./http');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const MAX_OUTPUT_TOKENS = envInt('AI_MAX_OUTPUT_TOKENS', AI_DEFAULTS.maxOutputTokens);
const REQUEST_TIMEOUT_MS = envInt('AI_REQUEST_TIMEOUT_MS', AI_DEFAULTS.requestTimeoutMs);
const RESPONSE_MAX_BYTES = envInt('AI_RESPONSE_MAX_BYTES', AI_DEFAULTS.responseMaxBytes);

class AiHttpError extends Error {
  constructor(status, body) {
    super(`AI API error ${status}: ${body}`);
    this.status = status;
    this.retryable = [408, 409, 425, 429].includes(status) || status >= 500;
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

function getModelForMode(provider, mode, overrides = {}) {
  const override = overrides[mode];
  if (override) return override;
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
      throw new AiHttpError(response.status, body);
    }
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      throw new Error('AI API 返回了无效 JSON');
    }
    return isResponsesApi(provider) ? getResponsesText(data) : getChatCompletionText(data);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`AI API 请求超时（${REQUEST_TIMEOUT_MS}ms）`);
    throw error;
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
};
