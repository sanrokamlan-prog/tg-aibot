const { envInt } = require('./env');

async function readResponseBuffer(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`响应超过 ${maxBytes} 字节限制`);
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`响应超过 ${maxBytes} 字节限制`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchBuffer(url, options = {}, maxBytes = envInt('MEDIA_MAX_BYTES', 10 * 1024 * 1024)) {
  const { timeoutMs = envInt('MEDIA_REQUEST_TIMEOUT_MS', 20000), ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    if (!response.ok) {
      const errorBuffer = await readResponseBuffer(response, Math.min(maxBytes, 64 * 1024));
      const detail = errorBuffer.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 500);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const buffer = await readResponseBuffer(response, maxBytes);
    if (!buffer.length) throw new Error('响应内容为空');
    return { buffer, headers: response.headers, finalUrl: response.url };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`请求超时（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadTelegramFile(ctx, fileId, maxBytes) {
  const url = await ctx.telegram.getFileLink(fileId);
  return fetchBuffer(url, {}, maxBytes);
}

module.exports = { readResponseBuffer, fetchBuffer, downloadTelegramFile };
