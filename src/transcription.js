const { normalizeBaseUrl } = require('./ai');
const { envInt } = require('./env');

function getTranscriptionUrl() {
  if (process.env.TRANSCRIPTION_API_URL) return process.env.TRANSCRIPTION_API_URL;
  const base = normalizeBaseUrl(process.env.TRANSCRIPTION_BASE_URL || process.env.AI_BASE_URL);
  return `${base}/audio/transcriptions`;
}

async function transcribeAudio(buffer, { filename = 'voice.ogg', mimeType = 'audio/ogg' } = {}) {
  const apiKey = process.env.TRANSCRIPTION_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) throw new Error('缺少 TRANSCRIPTION_API_KEY 或 AI_API_KEY');
  const controller = new AbortController();
  const timeoutMs = envInt('TRANSCRIPTION_TIMEOUT_MS', 60000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const form = new FormData();
    form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1');
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    if (process.env.TRANSCRIPTION_LANGUAGE) form.append('language', process.env.TRANSCRIPTION_LANGUAGE);

    const response = await fetch(getTranscriptionUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 500);
      throw new Error(`语音转写接口错误 ${response.status}: ${body}`);
    }
    const data = await response.json();
    return String(data.text || '').trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`语音转写超时（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { transcribeAudio, getTranscriptionUrl };
