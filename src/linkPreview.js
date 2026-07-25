const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');
const { envBool, envInt } = require('./env');

function isPrivateIp(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIp(mapped[1]);
  if (net.isIP(normalized) !== 4) return false;
  const parts = normalized.split('.').map(Number);
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 http/https 链接');
  if (url.username || url.password) throw new Error('链接不能包含认证信息');
  if (envBool('LINK_PREVIEW_ALLOW_PRIVATE', false)) return url;
  if (url.hostname === 'localhost') throw new Error('拒绝本地链接');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('拒绝内网或无法解析的链接');
  }
  return url;
}

async function fetchPage(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  const controller = new AbortController();
  const timeoutMs = envInt('LINK_PREVIEW_TIMEOUT_MS', 10000);
  const maxBytes = envInt('LINK_PREVIEW_MAX_BYTES', 512 * 1024);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'tg-aibot/2.0 link preview' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = await assertPublicUrl(new URL(response.headers.get('location'), url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error(`不支持的内容类型: ${contentType}`);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('网页内容过大');
        chunks.push(Buffer.from(chunk));
      }
      return { html: Buffer.concat(chunks).toString('utf8'), url: url.toString() };
    }
    throw new Error('链接重定向次数过多');
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`链接读取超时（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getLinkPreview(rawUrl) {
  const { html, url } = await fetchPage(rawUrl);
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text()).trim();
  const description = (
    $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
  ).trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1800);
  return [`链接：${url}`, title && `标题：${title}`, description && `描述：${description}`, body && `正文：${body}`]
    .filter(Boolean).join('\n').slice(0, 2400);
}

module.exports = { getLinkPreview, assertPublicUrl, isPrivateIp };
