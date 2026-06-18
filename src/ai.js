const { DEFAULT_PERSONA } = require('./persona');

const DEFAULT_API_BASE_URL = 'https://api.groq.com/openai/v1';
const API_BASE_URL = (process.env.AI_BASE_URL || process.env.GROQ_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
const API_URL = process.env.AI_API_URL || `${API_BASE_URL}/chat/completions`;
const MODEL = process.env.AI_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_KEY = process.env.AI_API_KEY || process.env.GROQ_API_KEY;

function buildTranscript(messages) {
  return messages.map((m) => `${m.fromBot ? '[你]' : m.user}: ${m.text}`).join('\n');
}

function buildInstruction(mode) {
  if (mode === 'mention') {
    return '群里有人直接 @ 你或回复了你的消息，请基于上下文给出回复。';
  }
  if (mode === 'idle') {
    return '群里已经安静了一段时间，请基于最近的话题抛出一个能让大家继续聊下去的话题或问题；如果完全没有上下文，可以随便起个轻松的话题。';
  }
  return '这是群里正常的闲聊，你可以选择插一句话，也可以选择不说话（如果没有特别合适接的内容，倾向于不说话）。';
}

function parseDecision(raw) {
  try {
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      shouldReply: Boolean(parsed.should_reply),
      reply: (parsed.reply || '').trim(),
    };
  } catch (e) {
    const fallback = raw.trim();
    return { shouldReply: fallback.length > 0, reply: fallback };
  }
}

async function decideAndReply({ persona, messages, mode }) {
  const transcript = buildTranscript(messages);
  const sys = `${persona || DEFAULT_PERSONA}

你会看到最近的群聊记录。${buildInstruction(mode)}
请只输出一个 JSON 对象，不要包含任何其他文字、不要用 markdown 代码块包裹，格式必须是：
{"should_reply": true 或 false, "reply": "要发送的内容，如果 should_reply 为 false 则留空字符串"}`;

  const body = {
    model: MODEL,
    max_tokens: 300,
    temperature: 0.9,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `最近聊天记录：\n${transcript || '(暂无记录)'}\n\n请给出 JSON。` },
    ],
  };

  if (!API_KEY) {
    throw new Error('缺少 AI_API_KEY 或 GROQ_API_KEY');
  }

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return parseDecision(raw);
}

module.exports = { decideAndReply };
