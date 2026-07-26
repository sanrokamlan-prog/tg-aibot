const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');
const { normalizeBaseUrl } = require('./aiClient');
const { envInt, envNumber } = require('./env');
const { fetchBuffer } = require('./http');

async function edgeSpeech(text) {
  const filename = path.join(
    os.tmpdir(),
    `tg-aibot-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
  );
  const tts = new EdgeTTS({
    voice: process.env.TTS_EDGE_VOICE || process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural',
    rate: process.env.TTS_RATE || 'default',
    pitch: process.env.TTS_PITCH || 'default',
    timeout: envInt('TTS_TIMEOUT_MS', 30000),
  });

  try {
    await tts.ttsPromise(text, filename);
    const buffer = await fs.readFile(filename);
    const maxBytes = envInt('TTS_MAX_BYTES', 10 * 1024 * 1024);
    if (buffer.length > maxBytes) throw new Error(`TTS 音频超过 ${maxBytes} 字节限制`);
    return { buffer, filename: 'reply.mp3' };
  } finally {
    await fs.unlink(filename).catch(() => {});
  }
}

async function openAiSpeech(text) {
  const apiKey = process.env.TTS_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) throw new Error('缺少 TTS_API_KEY 或 AI_API_KEY');
  const base = normalizeBaseUrl(process.env.TTS_BASE_URL || process.env.AI_BASE_URL);
  const url = process.env.TTS_API_URL || `${base}/audio/speech`;
  const format = process.env.TTS_RESPONSE_FORMAT || 'mp3';
  const timeoutMs = envInt('TTS_TIMEOUT_MS', 30000);
  const { buffer } = await fetchBuffer(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.TTS_OPENAI_VOICE || 'alloy',
      input: text,
      response_format: format,
      speed: envNumber('TTS_SPEED', 1, { min: 0.25, max: 4 }),
      ...(process.env.TTS_INSTRUCTIONS ? { instructions: process.env.TTS_INSTRUCTIONS } : {}),
    }),
    timeoutMs,
  }, envInt('TTS_MAX_BYTES', 10 * 1024 * 1024));
  return { buffer, filename: `reply.${format}` };
}

async function textToSpeech(text) {
  const provider = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();
  if (provider === 'openai') return openAiSpeech(text);
  if (provider === 'edge') return edgeSpeech(text);
  throw new Error(`不支持的 TTS_PROVIDER: ${provider}`);
}

module.exports = { textToSpeech, edgeSpeech, openAiSpeech };
