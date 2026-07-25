const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function section(title, description) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
  if (description) console.log(description + '\n');
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function quoteEnv(value) {
  const text = String(value || '');
  if (!text) return '';
  if (!/[\s#"'\\]/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

async function askRequired({ title, description, question, validate, error }) {
  if (title) section(title, description);
  while (true) {
    const answer = await ask(question);
    if (validate(answer)) return answer;
    console.log(`❌ ${error}\n`);
  }
}

async function askOptional({ title, description, question, defaultValue = '', validate, error }) {
  if (title) section(title, description);
  while (true) {
    const prompt = defaultValue ? `${question}\n默认值：${defaultValue}\n直接回车使用默认值：` : `${question}\n直接回车留空：`;
    const answer = await ask(prompt);
    const value = answer || defaultValue;
    if (!validate || validate(value)) return value;
    console.log(`❌ ${error}\n`);
  }
}

async function askYesNo({ title, description, question, defaultValue = 'no' }) {
  const value = await askOptional({
    title,
    description,
    question: `${question} 输入 yes 或 no`,
    defaultValue,
    validate: (answer) => ['yes', 'no'].includes(answer.toLowerCase()),
    error: '请输入 yes 或 no。',
  });
  return value.toLowerCase() === 'yes';
}

async function askMultiline({ title, description }) {
  section(title, description);
  console.log('请输入自定义人设，可以输入多行。');
  console.log('输入完成后，单独输入一行 END，然后回车。');
  console.log('如果想取消自定义人设，直接输入 END。\n');

  const lines = [];
  while (true) {
    const line = await ask('> ');
    if (line === 'END') break;
    lines.push(line);
  }

  return lines.join('\n').trim();
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (e) {
    return false;
  }
}

function isIntegerText(value) {
  return /^\d+$/.test(value);
}

function isNumberInRange(value, min, max) {
  if (value === '') return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= min && num <= max;
}

function isCommaSeparatedIds(value) {
  if (!value) return true;
  return value.split(',').every((id) => isIntegerText(id.trim()));
}

function isCommaSeparatedChatIds(value) {
  if (!value) return true;
  return value.split(',').every((id) => /^-?\d+$/.test(id.trim()));
}

function buildEnv(config) {
  return `# 从 @BotFather 获取
BOT_TOKEN=${quoteEnv(config.botToken)}

# AI 接口配置
# chat_completions：大多数 OpenAI 兼容中转站使用这个
# responses：Codex CLI 里 wire_api = "responses" 时使用这个
AI_API_TYPE=${quoteEnv(config.apiType)}
AI_BASE_URL=${quoteEnv(config.baseUrl)}
AI_API_KEY=${quoteEnv(config.apiKey)}
AI_MODEL=${quoteEnv(config.model)}
# 随机插话、冷场复活可以单独指定更便宜的模型；留空则使用 AI_MODEL
AI_MODEL_RANDOM=${quoteEnv(config.randomModel)}
AI_MODEL_IDLE=${quoteEnv(config.idleModel)}
AI_DISABLE_RESPONSE_STORAGE=${quoteEnv(config.disableResponseStorage)}
AI_CHAT_TOKEN_FIELD=max_tokens
AI_FALLBACK_API_TYPE=chat_completions
AI_FALLBACK_BASE_URL=
AI_FALLBACK_API_KEY=
AI_FALLBACK_MODEL=

# 省钱配置：限制每次请求带多少上下文和最多输出多少 token
AI_MAX_CONTEXT_MESSAGES=${quoteEnv(config.maxContextMessages)}
AI_MAX_INPUT_CHARS=${quoteEnv(config.maxInputChars)}
AI_MAX_MESSAGE_CHARS=${quoteEnv(config.maxMessageChars)}
AI_MAX_OUTPUT_TOKENS=${quoteEnv(config.maxOutputTokens)}
AI_REQUEST_TIMEOUT_MS=30000

# 多模态功能：确认接口和模型支持后再开启
VISION_ENABLED=false
VISION_MAX_BYTES=5242880
TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=whisper-1
TRANSCRIPTION_LANGUAGE=zh
LINK_PREVIEW_ENABLED=false
LINK_PREVIEW_MAX_BYTES=524288

# TTS：部署后可在群里发送 /voice_on 开启
TTS_ENABLED=false
TTS_PROVIDER=edge
TTS_EDGE_VOICE=zh-CN-XiaoxiaoNeural
TTS_OPENAI_VOICE=alloy
TTS_MODEL=gpt-4o-mini-tts
TTS_BASE_URL=
TTS_API_KEY=
TTS_RESPONSE_FORMAT=mp3
TTS_REPLY_CHANCE=1
TTS_TIMEOUT_MS=30000

# 安全限制：只允许这些群使用机器人，多个群 ID 用英文逗号分隔；留空则不限制
# 在群里发送 /chat_id 可以查看当前群 ID
ALLOWED_CHAT_IDS=${quoteEnv(config.allowedChatIds)}

# 手动管理员白名单，多个用户 ID 用英文逗号分隔；在群里发送 /my_id 可以查看自己的用户 ID
ADMIN_USER_IDS=${quoteEnv(config.adminUserIds)}

# 如果你的中转站给的是完整接口地址，也可以不用 AI_BASE_URL，直接填：
# AI_API_URL=https://example.com/v1/chat/completions

# 贴纸配置：可在群里回复贴纸发送 /sticker_add 添加到当前群贴纸池
# STICKER_IDS 是全局贴纸池，多个 file_id 用英文逗号分隔；STICKER_REPLY_CHANCE 是 AI 想发贴纸时实际发送概率
STICKER_IDS=${quoteEnv(config.stickerIds)}
STICKER_REPLY_CHANCE=${quoteEnv(config.stickerReplyChance)}
DATA_DIR=/app/data
DATABASE_PATH=/app/data/bot.db
MESSAGE_TTL_HOURS=24
USAGE_TTL_DAYS=30
TZ=Asia/Shanghai

# 人设：留空则使用 src/persona.js 中的默认人设
PERSONA_PROMPT=${quoteEnv(config.personaPrompt)}

# 互动方式与规则扩展
REACTION_ENABLED=true
RULE_COOLDOWN_SECONDS=60
QUIET_HOURS_START=
QUIET_HOURS_END=

# 普通消息中随机插话的概率 (0-1)
RANDOM_REPLY_CHANCE=${quoteEnv(config.randomReplyChance)}

# 两次"主动"发言之间最少间隔多少秒
MIN_REPLY_INTERVAL_SECONDS=${quoteEnv(config.minReplyIntervalSeconds)}

# 距离上次发言至少要再过多少条群消息才会考虑再次随机插话
MIN_MSGS_BETWEEN_REPLIES=${quoteEnv(config.minMsgsBetweenReplies)}

# 群里冷场超过多少分钟后考虑主动发话复活气氛
IDLE_THRESHOLD_MINUTES=${quoteEnv(config.idleThresholdMinutes)}

# 两次冷场复活发言之间最少间隔多少分钟，防止刷屏
IDLE_COOLDOWN_MINUTES=${quoteEnv(config.idleCooldownMinutes)}

# 每个群最多缓存多少条历史消息作为上下文；真正发给 AI 的条数还会受 AI_MAX_CONTEXT_MESSAGES 限制
MAX_HISTORY=${quoteEnv(config.maxHistory)}
`;
}

async function main() {
  console.log('Telegram 群组 AI 机器人交互式配置');
  console.log('按提示填写，填错会提示重新输入。');
  console.log('如果不懂某个参数，通常直接回车使用默认值即可。');

  if (fs.existsSync('.env')) {
    const overwrite = await askYesNo({
      title: '检测到已有 .env',
      description: '当前目录已经有 .env。覆盖会重新生成配置；不覆盖则退出。',
      question: '是否覆盖现有 .env？',
      defaultValue: 'no',
    });

    if (!overwrite) {
      console.log('已取消，没有修改 .env。');
      return;
    }
  }

  const botToken = await askRequired({
    title: '1. Telegram Bot Token',
    description: '从 Telegram 的 @BotFather 创建机器人后获得。格式通常是 数字:一长串字符。这个填错机器人无法启动。',
    question: '请输入 BOT_TOKEN: ',
    validate: (value) => /^\d+:[A-Za-z0-9_-]{20,}$/.test(value),
    error: 'BOT_TOKEN 格式不对，应该类似 123456789:AAxxxxxxxxxxxxxxxxxxxx。',
  });

  const apiType = await askOptional({
    title: '2. API 类型',
    description: '大多数中转站选 chat_completions。如果你的 Codex CLI 配置里写着 wire_api = "responses"，就选 responses。',
    question: '请输入 API 类型：chat_completions 或 responses',
    defaultValue: 'chat_completions',
    validate: (value) => ['chat_completions', 'responses'].includes(value.toLowerCase()),
    error: '只能输入 chat_completions 或 responses。',
  });

  const baseUrlInput = await askRequired({
    title: '3. API Base URL',
    description: '中转站后台提供的接口地址。可以填 https://api.example.com/v1，也可以填 https://openapi.xz.wtf；程序会自动补 /v1。',
    question: '请输入 AI_BASE_URL: ',
    validate: isValidUrl,
    error: 'URL 格式不对，必须以 http:// 或 https:// 开头。',
  });

  const apiKey = await askRequired({
    title: '4. API Key',
    description: '中转站或模型平台提供的 Key。这个填错会出现 401 / 403。',
    question: '请输入 AI_API_KEY: ',
    validate: (value) => value.length >= 8 && !/\s/.test(value),
    error: 'API Key 看起来不对，至少 8 个字符且不能包含空格。',
  });

  const model = await askRequired({
    title: '5. 主模型 AI_MODEL',
    description: '被 @ 或回复机器人时主要使用这个模型。贵模型可以放这里，保证回复质量。',
    question: '请输入 AI_MODEL，例如 gpt-4o-mini / gpt-5.5 / llama-3.3-70b-versatile: ',
    validate: (value) => value.length >= 2 && !/\s/.test(value),
    error: '模型名不能为空，也不能包含空格。',
  });

  const randomModel = await askOptional({
    title: '6. 随机插话模型 AI_MODEL_RANDOM',
    description: '随机插话会更频繁，建议用便宜模型省钱。留空表示随机插话也使用主模型。',
    question: '请输入随机插话模型名，例如 gpt-4o-mini；不想单独设置就留空',
    defaultValue: '',
    validate: (value) => value === '' || (value.length >= 2 && !/\s/.test(value)),
    error: '模型名不能包含空格；不想单独设置就直接回车。',
  });

  const idleModel = await askOptional({
    title: '7. 冷场复活模型 AI_MODEL_IDLE',
    description: '冷场主动抛话题也可以用便宜模型。默认跟随机插话模型一样；如果随机插话模型也留空，则使用主模型。',
    question: '请输入冷场复活模型名；不想单独设置就留空',
    defaultValue: randomModel,
    validate: (value) => value === '' || (value.length >= 2 && !/\s/.test(value)),
    error: '模型名不能包含空格；不想单独设置就直接回车。',
  });

  const disableResponseStorage = await askOptional({
    title: '8. 是否禁用 Responses API 响应存储',
    description: '对应 Codex CLI 的 disable_response_storage。建议 true，表示请求时带 store:false，隐私更稳。如果中转站报 unknown parameter: store，再改成 false。',
    question: '请输入 true 或 false',
    defaultValue: 'true',
    validate: (value) => ['true', 'false'].includes(value.toLowerCase()),
    error: '请输入 true 或 false。',
  });

  const customizePersona = await askYesNo({
    title: '9. 人设 PERSONA_PROMPT',
    description: '人设决定机器人说话风格。建议先用默认人设；想改成毒舌、可爱、方言、二次元等风格时再自定义。',
    question: '是否现在自定义人设？',
    defaultValue: 'no',
  });

  let personaPrompt = '';
  if (customizePersona) {
    personaPrompt = await askMultiline({
      title: '自定义人设',
      description: '例子：你是群里的普通群友，说话简短、活泼、偶尔吐槽，不要暴露自己是 AI。',
    });
  }

  const allowedChatIds = await askOptional({
    title: '10. 群组白名单 ALLOWED_CHAT_IDS',
    description: '防止机器人被陌生人拉到其他群里乱触发、烧额度。留空表示不限制；推荐启动后在目标群发 /chat_id 获取群 ID，再填回来。多个群 ID 用英文逗号分隔。',
    question: '请输入允许使用机器人的群 ID；不知道就先留空',
    defaultValue: '',
    validate: isCommaSeparatedChatIds,
    error: '群 ID 只能是数字，可以是负数，例如 -1001234567890；多个用英文逗号分隔。',
  });

  const adminUserIds = await askOptional({
    title: '11. 管理员白名单 ADMIN_USER_IDS',
    description: '如果 Telegram 管理员判断失效，可以把你的用户 ID 写这里。启动后在群里发 /my_id 可以查看 ID。多个 ID 用英文逗号分隔。',
    question: '请输入管理员 Telegram 用户 ID；不知道就留空',
    defaultValue: '',
    validate: isCommaSeparatedIds,
    error: '管理员 ID 只能是数字，多个 ID 用英文逗号分隔，例如 123456789,987654321。',
  });

  const stickerIds = await askOptional({
    title: '12. 全局贴纸池 STICKER_IDS',
    description: '可以先留空。启动后在群里回复贴纸发送 /sticker_add，可以直接把贴纸加入当前群贴纸池，不用改服务器配置。',
    question: '请输入全局贴纸 file_id，多个用英文逗号分隔；不知道就留空',
    defaultValue: '',
  });

  const stickerReplyChance = await askOptional({
    title: '13. 贴纸发送概率 STICKER_REPLY_CHANCE',
    description: 'AI 判断适合发贴纸时，实际发送贴纸的概率。0 表示不发，1 表示每次都发。建议 0.15。',
    question: '请输入贴纸发送概率，范围 0 到 1',
    defaultValue: '0.15',
    validate: (value) => isNumberInRange(value, 0, 1),
    error: '请输入 0 到 1 之间的数字，例如 0.15。',
  });

  const maxContextMessages = await askOptional({
    title: '11. 省钱：上下文消息条数 AI_MAX_CONTEXT_MESSAGES',
    description: '每次请求最多带最近多少条聊天记录。越大越懂上下文，但越贵。建议 8-12。',
    question: '请输入每次请求最多带多少条上下文消息',
    defaultValue: '12',
    validate: (value) => isIntegerText(value) && Number(value) >= 1,
    error: '请输入大于等于 1 的整数。',
  });

  const maxInputChars = await askOptional({
    title: '12. 省钱：上下文总字符数 AI_MAX_INPUT_CHARS',
    description: '每次发给 AI 的聊天记录最多多少字符。越小越省钱。建议 1000-1500。',
    question: '请输入每次请求上下文最多多少字符',
    defaultValue: '1500',
    validate: (value) => isIntegerText(value) && Number(value) >= 200,
    error: '请输入大于等于 200 的整数。',
  });

  const maxMessageChars = await askOptional({
    title: '13. 省钱：单条消息最大字符数 AI_MAX_MESSAGE_CHARS',
    description: '群友发很长一段话时，只截取前面一部分发给 AI。建议 120-160。',
    question: '请输入单条群消息最多保留多少字符',
    defaultValue: '160',
    validate: (value) => isIntegerText(value) && Number(value) >= 20,
    error: '请输入大于等于 20 的整数。',
  });

  const maxOutputTokens = await askOptional({
    title: '14. 省钱：输出上限 AI_MAX_OUTPUT_TOKENS',
    description: 'AI 每次最多输出多少 token。群聊机器人不需要长篇大论，建议 80-120。',
    question: '请输入 AI 每次最多输出多少 token',
    defaultValue: '120',
    validate: (value) => isIntegerText(value) && Number(value) >= 20,
    error: '请输入大于等于 20 的整数。',
  });

  const randomReplyChance = await askOptional({
    title: '15. 随机插话概率 RANDOM_REPLY_CHANCE',
    description: '普通群聊时机器人随机插话的概率。越大越活跃，也越吵、越费钱。建议 0.02；不要像 0.8 那样太高。',
    question: '请输入随机插话概率，范围 0 到 1',
    defaultValue: '0.02',
    validate: (value) => isNumberInRange(value, 0, 1),
    error: '请输入 0 到 1 之间的数字，例如 0.02。',
  });

  const minReplyIntervalSeconds = await askOptional({
    title: '16. 主动发言冷却 MIN_REPLY_INTERVAL_SECONDS',
    description: '两次主动发言之间至少隔多少秒。越大越省钱，也越不吵。建议 180。',
    question: '请输入两次主动发言最少间隔秒数',
    defaultValue: '180',
    validate: (value) => isIntegerText(value) && Number(value) >= 0,
    error: '请输入大于等于 0 的整数。',
  });

  const minMsgsBetweenReplies = await askOptional({
    title: '17. 消息间隔 MIN_MSGS_BETWEEN_REPLIES',
    description: '机器人说完话后，至少再过多少条群消息才会考虑随机插话。建议 5。',
    question: '请输入距离上次发言至少间隔多少条群消息',
    defaultValue: '5',
    validate: (value) => isIntegerText(value) && Number(value) >= 0,
    error: '请输入大于等于 0 的整数。',
  });

  const idleThresholdMinutes = await askOptional({
    title: '18. 冷场阈值 IDLE_THRESHOLD_MINUTES',
    description: '群里安静多久后机器人尝试主动抛话题。建议 30 分钟。',
    question: '请输入群里安静多少分钟后尝试主动抛话题',
    defaultValue: '30',
    validate: (value) => isIntegerText(value) && Number(value) >= 1,
    error: '请输入大于等于 1 的整数。',
  });

  const idleCooldownMinutes = await askOptional({
    title: '19. 冷场发言冷却 IDLE_COOLDOWN_MINUTES',
    description: '两次冷场主动发言之间至少隔多少分钟。建议 120 分钟。',
    question: '请输入两次冷场发言之间最少间隔多少分钟',
    defaultValue: '120',
    validate: (value) => isIntegerText(value) && Number(value) >= 1,
    error: '请输入大于等于 1 的整数。',
  });

  const maxHistory = await askOptional({
    title: '20. 内存历史 MAX_HISTORY',
    description: '每个群在内存里最多保存多少条历史消息。它不等于每次都发给 AI；真正发给 AI 的数量受 AI_MAX_CONTEXT_MESSAGES 限制。建议 25。',
    question: '请输入每个群最多缓存多少条历史消息',
    defaultValue: '25',
    validate: (value) => isIntegerText(value) && Number(value) >= 1,
    error: '请输入大于等于 1 的整数。',
  });

  const env = buildEnv({
    botToken,
    apiType: apiType.toLowerCase(),
    baseUrl: normalizeBaseUrl(baseUrlInput),
    apiKey,
    model,
    randomModel,
    idleModel,
    disableResponseStorage: disableResponseStorage.toLowerCase(),
    maxContextMessages,
    maxInputChars,
    maxMessageChars,
    maxOutputTokens,
    allowedChatIds,
    adminUserIds,
    stickerIds,
    stickerReplyChance,
    personaPrompt,
    randomReplyChance,
    minReplyIntervalSeconds,
    minMsgsBetweenReplies,
    idleThresholdMinutes,
    idleCooldownMinutes,
    maxHistory,
  });

  const tempEnvPath = `.env.setup-${process.pid}`;
  fs.writeFileSync(tempEnvPath, env, { mode: 0o600 });
  fs.renameSync(tempEnvPath, '.env');
  console.log('\n✅ 配置完成，已生成 .env。');
  console.log('现在可以执行：');
  console.log('docker compose up -d --build');
}

main()
  .catch((err) => {
    console.error('配置失败:', err.message);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
