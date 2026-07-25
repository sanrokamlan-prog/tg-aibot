const { envBool, envInt } = require('./env');
const { downloadTelegramFile } = require('./http');
const { transcribeAudio } = require('./transcription');
const { getLinkPreview } = require('./linkPreview');

function firstMessageUrl(message) {
  const text = message.text || message.caption || '';
  for (const entity of message.entities || message.caption_entities || []) {
    if (entity.type === 'text_link' && entity.url) return entity.url;
    if (entity.type === 'url') return text.slice(entity.offset, entity.offset + entity.length);
  }
  return text.match(/https?:\/\/[^\s<>]+/i)?.[0] || '';
}

async function prepareImage(ctx) {
  if (!envBool('VISION_ENABLED', false)) return '';
  const photo = ctx.message.photo?.at(-1);
  const imageDocument = ctx.message.document?.mime_type?.startsWith('image/') ? ctx.message.document : null;
  const file = photo || imageDocument;
  if (!file) return '';
  const maxBytes = envInt('VISION_MAX_BYTES', 5 * 1024 * 1024);
  const { buffer } = await downloadTelegramFile(ctx, file.file_id, maxBytes);
  const mime = imageDocument?.mime_type || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function prepareTranscription(ctx) {
  if (!envBool('TRANSCRIPTION_ENABLED', false)) return '';
  const media = ctx.message.voice || ctx.message.audio;
  if (!media) return '';
  const { buffer } = await downloadTelegramFile(ctx, media.file_id, envInt('TRANSCRIPTION_MAX_BYTES', 20 * 1024 * 1024));
  return transcribeAudio(buffer, {
    filename: ctx.message.audio?.file_name || (ctx.message.voice ? 'voice.ogg' : 'audio.mp3'),
    mimeType: ctx.message.audio?.mime_type || 'audio/ogg',
  });
}

async function prepareMediaContext(ctx) {
  const parts = [];
  let replacementText = '';
  let imageDataUrl = '';

  try {
    const transcription = await prepareTranscription(ctx);
    if (transcription) {
      replacementText = `[语音转写] ${transcription}`;
      parts.push(replacementText);
    }
  } catch (error) {
    console.error('语音转写失败:', error.message);
  }

  try {
    imageDataUrl = await prepareImage(ctx);
    if (imageDataUrl) parts.push('当前消息附带一张图片，请结合图片内容判断。');
  } catch (error) {
    console.error('图片下载失败:', error.message);
  }

  const url = firstMessageUrl(ctx.message);
  if (url && envBool('LINK_PREVIEW_ENABLED', false)) {
    try {
      parts.push(await getLinkPreview(url));
    } catch (error) {
      console.error('链接读取失败:', error.message);
    }
  }

  return { replacementText, imageDataUrl, extraContext: parts.join('\n\n') };
}

module.exports = { prepareMediaContext, firstMessageUrl };
