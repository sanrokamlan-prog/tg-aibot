const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { requestProvider, getApiUrl } = require('../src/aiClient');

test('sends native Anthropic, Gemini, Responses and compatible requests to a real HTTP server', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(data) });
    res.setHeader('Content-Type', 'application/json');
    const text = '{"action":"reply","reply":"ok"}';
    res.end(JSON.stringify(req.url.includes('generateContent') ? { candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' }, { text }] } }] }
      : req.url.endsWith('/messages') ? { content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text }] }
        : req.url.endsWith('/responses') ? { output: [{ content: [{ type: 'output_text', text }] }] }
          : { choices: [{ message: { content: text } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const apiType of ['anthropic', 'gemini', 'responses', 'chat_completions']) {
      const raw = await requestProvider({ apiType, apiKey: 'test', baseUrl: `${url}/${apiType === 'gemini' ? 'v1beta' : 'v1'}`, model: 'configured', tokenField: 'max_completion_tokens', extraBody: { custom: true } },
        { sys: 'system', userContent: 'user', model: 'selected', imageDataUrl: 'data:image/png;base64,AAAA' });
      assert.equal(JSON.parse(raw).reply, 'ok');
    }
    assert.equal(requests[0].headers['x-api-key'], 'test');
    assert.equal(requests[0].body.messages[0].content[1].source.data, 'AAAA');
    assert.equal(requests[1].url, '/v1beta/models/selected:generateContent');
    assert.equal(requests[1].headers['x-goog-api-key'], 'test');
    assert.equal(requests[1].body.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(requests[2].body.input[0].content[1].type, 'input_image');
    assert.equal(requests[3].body.max_completion_tokens, 600);
    assert.equal(requests[3].body.custom, true);
    assert.equal('temperature' in requests[3].body, false);
    assert.equal(getApiUrl({ apiType: 'chat_completions', baseUrl: `${url}/v1/chat/completions` }), `${url}/v1/chat/completions`);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('does not forward provider error bodies or credentials', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('secret-key and conversation', { status: 403 });
  try {
    await assert.rejects(requestProvider({ apiKey: 'secret-key', baseUrl: 'https://invalid.test/v1' }, { model: 'x' }), error => error.status === 403 && !error.message.includes('secret'));
  } finally { global.fetch = original; }
});
