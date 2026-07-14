const { DEFAULT_PERSONA } = require('./persona');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const RAW_API_BASE_URL = process.env.AI_BASE_URL || process.env.GROQ_BASE_URL || DEFAULT_API_BASE_URL;
const API_TYPE = (process.env.AI_API_TYPE || 'chat_completions').trim().toLowerCase();
const DEFAULT_MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_KEY = process.env.AI_API_KEY || process.env.GROQ_API_KEY;

function envInt(name, defaultValue) {
  const value = parseInt(process.env[name] || String(defaultValue), 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

const MAX_CONTEXT_MESSAGES = envInt('AI_MAX_CONTEXT_MESSAGES', 12);
const MAX_INPUT_CHARS = envInt('AI_MAX_INPUT_CHARS', 1500);
const MAX_MESSAGE_CHARS = envInt('AI_MAX_MESSAGE_CHARS', 160);
const MAX_OUTPUT_TOKENS = envInt('AI_MAX_OUTPUT_TOKENS', 120);
const REQUEST_TIMEOUT_MS = envInt('AI_REQUEST_TIMEOUT_MS', 30000);

function normalizeBaseUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed) || /\/openai\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function isResponsesApi() {
  return API_TYPE === 'responses' || API_TYPE === 'response';
}

function getApiUrl() {
  if (process.env.AI_API_URL) return process.env.AI_API_URL;
  const baseUrl = normalizeBaseUrl(RAW_API_BASE_URL);
  return isResponsesApi() ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
}

function truncateText(text, maxChars) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…`;
}

function getModelForMode(mode) {
  if (mode === 'random' && process.env.AI_MODEL_RANDOM) return process.env.AI_MODEL_RANDOM;
  if (mode === 'idle' && process.env.AI_MODEL_IDLE) return process.env.AI_MODEL_IDLE;
  return DEFAULT_MODEL;
}

function buildTranscript(messages) {
  const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);
  const lines = [];
  let totalChars = 0;

  for (const m of recentMessages.reverse()) {
    const user = truncateText(m.fromBot ? '[你]' : m.user, 24);
    const text = truncateText(m.text, MAX_MESSAGE_CHARS);
    const line = `${user}: ${text}`;

    if (totalChars + line.length > MAX_INPUT_CHARS) break;
    lines.unshift(line);
    totalChars += line.length;
  }

  return lines.join('\n');
}

function buildInstruction(mode) {
  if (mode === 'mention') {
    return '群里有人直接 @ 你或回复了你的消息，请基于上下文给出简短回复。';
  }
  if (mode === 'idle') {
    return '群里已经安静了一段时间，请基于最近的话题抛出一个简短、轻松、能让大家继续聊下去的话题；如果完全没有上下文，可以随便起个轻松话题。';
  }
  return '这是群里正常的闲聊，你可以选择简短插一句话，也可以选择不说话（如果没有特别合适接的内容，倾向于不说话）。';
}

function parseDecision(raw) {
  try {
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      shouldReply: Boolean(parsed.should_reply),
      reply: truncateText(parsed.reply || '', 300),
      sticker: Boolean(parsed.sticker),
      stickerTag: truncateText(parsed.sticker_tag || '', 40),
    };
  } catch (e) {
    const fallback = truncateText(raw.trim(), 300);
    return { shouldReply: fallback.length > 0, reply: fallback, sticker: false, stickerTag: '' };
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

function getChatCompletionsText(data) {
  return data.choices?.[0]?.message?.content || '';
}

function buildRequestBody({ sys, userContent, mode }) {
  const model = getModelForMode(mode);

  if (isResponsesApi()) {
    return {
      model,
      instructions: sys,
      input: userContent,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.8,
      store: process.env.AI_DISABLE_RESPONSE_STORAGE === 'true' ? false : undefined,
    };
  }

  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.8,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ],
  };
}

async function decideAndReply({ persona, messages, mode, stickerTags = [] }) {
  const transcript = buildTranscript(messages);
  const stickerTagText = stickerTags.length ? `\n当前可用贴纸标签：${stickerTags.join('、')}` : '';
  const sys = `${persona || DEFAULT_PERSONA}

你会看到最近的群聊记录。${buildInstruction(mode)}
请只输出一个 JSON 对象，不要包含任何其他文字、不要用 markdown 代码块包裹，格式必须是：
{"should_reply": true 或 false, "reply": "要发送的内容，如果 should_reply 为 false 则留空字符串", "sticker": true 或 false, "sticker_tag": "想使用的贴纸标签，没有则留空"}
回复必须短，通常不要超过 40 个中文字。只有在语气适合用贴纸时，才把 sticker 设为 true。如果设置 sticker 为 true，请优先从可用贴纸标签里选择一个最匹配的 sticker_tag。${stickerTagText}`;

  const userContent = `最近聊天记录：\n${transcript || '(暂无记录)'}\n\n请给出 JSON。`;
  const body = buildRequestBody({ sys, userContent, mode });

  if (!API_KEY) {
    throw new Error('缺少 AI_API_KEY 或 GROQ_API_KEY');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(getApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`AI API error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    const raw = isResponsesApi() ? getResponsesText(data) : getChatCompletionsText(data);
    return parseDecision(raw);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`AI API 请求超时（${REQUEST_TIMEOUT_MS}ms）`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { decideAndReply };
