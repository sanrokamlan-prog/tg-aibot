const { normalizeBaseUrl } = require('./aiClient');
const { envInt } = require('./env');
const { fetchBuffer } = require('./http');

function getTranscriptionUrl() {
  if (process.env.TRANSCRIPTION_API_URL) return process.env.TRANSCRIPTION_API_URL;
  const base = normalizeBaseUrl(process.env.TRANSCRIPTION_BASE_URL || process.env.AI_BASE_URL);
  return `${base}/audio/transcriptions`;
}

async function transcribeAudio(buffer, { filename = 'voice.ogg', mimeType = 'audio/ogg' } = {}) {
  const apiKey = process.env.TRANSCRIPTION_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) throw new Error('缺少 TRANSCRIPTION_API_KEY 或 AI_API_KEY');
  const timeoutMs = envInt('TRANSCRIPTION_TIMEOUT_MS', 60000);
  const form = new FormData();
  form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1');
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  if (process.env.TRANSCRIPTION_LANGUAGE) form.append('language', process.env.TRANSCRIPTION_LANGUAGE);

  const { buffer: responseBuffer } = await fetchBuffer(getTranscriptionUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    timeoutMs,
  }, envInt('TRANSCRIPTION_RESPONSE_MAX_BYTES', 1024 * 1024));
  let data;
  try {
    data = JSON.parse(responseBuffer.toString('utf8'));
  } catch (error) {
    throw new Error('语音转写接口返回了无效 JSON');
  }
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('语音转写接口没有返回文本');
  return text;
}

module.exports = { transcribeAudio, getTranscriptionUrl };
