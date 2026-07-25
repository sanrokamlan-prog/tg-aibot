const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TTS_API_URL = 'https://example.test/audio/speech';
process.env.TTS_API_KEY = 'test-key';
process.env.TRANSCRIPTION_API_URL = 'https://example.test/audio/transcriptions';
process.env.TRANSCRIPTION_API_KEY = 'test-key';

const { openAiSpeech } = require('../src/tts');
const { transcribeAudio } = require('../src/transcription');

test('creates speech through an OpenAI-compatible endpoint', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.input, '你好');
    return new Response(Buffer.from('audio-data'), { status: 200 });
  };
  try {
    const result = await openAiSpeech('你好');
    assert.equal(result.buffer.toString(), 'audio-data');
    assert.equal(result.filename, 'reply.mp3');
  } finally {
    global.fetch = originalFetch;
  }
});

test('transcribes audio through an OpenAI-compatible endpoint', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.ok(options.body instanceof FormData);
    return Response.json({ text: '转写内容' });
  };
  try {
    const text = await transcribeAudio(Buffer.from('voice'), { filename: 'voice.ogg' });
    assert.equal(text, '转写内容');
  } finally {
    global.fetch = originalFetch;
  }
});
