const { envInt } = require('./env');

async function fetchBuffer(url, options = {}, maxBytes = envInt('MEDIA_MAX_BYTES', 10 * 1024 * 1024)) {
  const timeoutMs = options.timeoutMs || envInt('MEDIA_REQUEST_TIMEOUT_MS', 20000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error(`文件超过 ${maxBytes} 字节限制`);

    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`文件超过 ${maxBytes} 字节限制`);
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), headers: response.headers, finalUrl: response.url };
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

module.exports = { fetchBuffer, downloadTelegramFile };
