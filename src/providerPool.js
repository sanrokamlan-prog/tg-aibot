const fs = require('fs');
const { providerFromEnv, getModelForMode } = require('./aiClient');
const { envInt } = require('./env');

const TYPES = new Set(['chat_completions', 'responses', 'anthropic', 'gemini', 'opencode']);

function loadProviders() {
  const file = process.env.AI_PROVIDERS_FILE;
  let config;
  if (file) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error('无法读取 AI_PROVIDERS_FILE，请检查路径与 JSON 格式'); }
    if (!Array.isArray(config.providers)) throw new Error('模型池配置需要 providers 数组');
  } else {
    config = { strategy: 'failover', providers: [providerFromEnv('AI'), providerFromEnv('AI_FALLBACK')].filter(Boolean) };
  }
  const strategy = process.env.AI_POOL_STRATEGY || config.strategy || 'round_robin';
  if (!['round_robin', 'failover'].includes(strategy)) throw new Error('模型池策略必须为 round_robin 或 failover');
  const entries = [...config.providers];
  if (process.env.OPENCODE_ENABLED === 'true') {
    const models = (process.env.OPENCODE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    entries.push({ name: 'opencode', apiType: 'opencode', models: models.length ? models : ['auto-free'] });
  }
  const names = new Set();
  const providers = [];
  for (const item of entries) {
    if (item.enabled === false) continue;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(item.name || '') || names.has(item.name)) {
      throw new Error('供应商 name 必须唯一，且仅含字母、数字、下划线或短横线（最多 40 字符）');
    }
    names.add(item.name);
    const apiType = item.apiType === 'response' ? 'responses' : item.apiType || 'chat_completions';
    if (!TYPES.has(apiType)) throw new Error(`供应商 ${item.name} 的 apiType 不支持`);
    const models = item.models || [item.model];
    if (!Array.isArray(models) || !models.length || models.some(m => typeof m !== 'string' || !m.trim())) {
      throw new Error(`供应商 ${item.name} 需要 model 或 models`);
    }
    const keyNames = item.apiKeysEnv || (item.apiKeyEnv ? [item.apiKeyEnv] : []);
    if (!Array.isArray(keyNames) || keyNames.some(k => typeof k !== 'string')) throw new Error('apiKeysEnv 必须为环境变量名数组');
    const keys = keyNames.length ? keyNames.map(k => process.env[k]) : [item.apiKey || ''];
    if (apiType !== 'opencode') {
      if (keys.some(k => !k) && item.auth !== 'none') throw new Error(`供应商 ${item.name} 缺少 API Key 环境变量`);
      let url;
      try { url = new URL(item.apiUrl || item.baseUrl); } catch { throw new Error(`供应商 ${item.name} 缺少有效 URL`); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API URL 必须为不含账号密码的 HTTP(S) 地址');
    }
    for (const [keyIndex, apiKey] of keys.entries()) {
      for (const model of models) {
        providers.push({ ...item, apiType, apiKey, model, legacy: !file,
          id: `${item.name}:${keyIndex}:${model}`, supportsVision: item.supportsVision !== false && apiType !== 'opencode' });
      }
    }
  }
  if (!providers.length) throw new Error('未配置 AI 接口：设置 AI_API_KEY、AI_PROVIDERS_FILE 或 OPENCODE_ENABLED');
  if (providers.length > 100) throw new Error('模型池最多允许 100 个 Key/模型组合');
  return { providers, strategy };
}

function createProviderRouter({ now = Date.now } = {}) {
  const health = new Map();
  let cursor = 0;
  function candidates(pool, mode, overrides = {}, imageDataUrl = '') {
    const ids = new Set(pool.providers.map(p => p.id));
    for (const id of health.keys()) if (!ids.has(id)) health.delete(id);
    let entries = pool.providers.filter(p => (!p.modes || p.modes.includes(mode)) && (!imageDataUrl || p.supportsVision));
    const requested = overrides[mode];
    // A qualified override selects its provider first; backups keep their own model names.
    const owner = requested && entries.find(p => requested.startsWith(`${p.name}/`));
    entries = entries.map(p => ({ ...p, model: owner
      ? (p.name === owner.name ? requested.slice(owner.name.length + 1) : p.model)
      : getModelForMode(p, mode, overrides) }));
    if (pool.strategy === 'round_robin' && entries.length) {
      const start = cursor++ % entries.length;
      entries = [...entries.slice(start), ...entries.slice(0, start)];
    }
    if (owner) entries.sort((a, b) => Number(b.name === owner.name) - Number(a.name === owner.name));
    // Never retry cooling entries, even if the entire pool is down.
    return entries.filter(p => (health.get(p.id)?.until || 0) <= now());
  }
  return {
    candidates,
    reset() { health.clear(); cursor = 0; },
    success(p) { health.delete(p.id); },
    failure(p, error) {
      const failures = (health.get(p.id)?.failures || 0) + 1;
      const base = envInt('AI_FAILURE_COOLDOWN_MS', 60000);
      const retryAfter = Math.min(error.retryAfterMs || 0, 15 * 60000);
      health.set(p.id, { failures, until: now() + Math.max(retryAfter, Math.min(base * 2 ** (failures - 1), 15 * 60000)), reason: error.code || (error.status ? `HTTP ${error.status}` : 'request_failed') });
    },
    status(pool) {
      return pool.providers.map(p => ({ name: p.name, model: p.model, apiType: p.apiType,
        cooldownMs: Math.max(0, (health.get(p.id)?.until || 0) - now()), reason: health.get(p.id)?.reason || '' }));
    },
  };
}

const providerRouter = createProviderRouter();
module.exports = { loadProviders, createProviderRouter, providerRouter };
