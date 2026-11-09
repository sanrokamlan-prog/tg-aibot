const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { envInt } = require('./env');

const DEFAULT_VERSION = '2.2.6';
let installation;
let catalog;
let catalogAt = 0;
let modelCursor = 0;
let service;
let serviceStarting;
const coolingModels = new Map();

function rootDir() { return path.resolve(process.env.OPENCODE_DATA_DIR || path.join(process.env.DATA_DIR || 'data', 'opencode')); }

function runProcess(executable, args, { cwd, env, input = '', timeoutMs = 60000, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const decoder = new StringDecoder('utf8');
    let bytes = 0;
    let failure;
    let forceKillTimer;
    let terminating = false;
    function kill() {
      if (!child.pid || terminating) return;
      terminating = true;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else {
        // Let the native CLI interrupt its server session before force-killing a stuck client.
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        forceKillTimer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }, 2000);
      }
    }
    const timer = setTimeout(() => { failure = new Error('OpenCode CLI 请求超时'); kill(); }, timeoutMs);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { failure = new Error('OpenCode CLI 输出超过限制'); kill(); }
      else output += decoder.write(chunk);
    });
    // Drain stderr but never expose it: it can contain prompts and credentials.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) { failure = new Error('OpenCode CLI 输出超过限制'); kill(); } });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 OpenCode CLI 或 npm，请检查安装路径')); });
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      output += decoder.end();
      if (failure) reject(failure);
      else if (code !== 0) {
        try { parseCliOutput(output); }
        catch (error) { if (error.status) return reject(error); }
        reject(new Error(`OpenCode CLI 执行失败（exit ${code}）`));
      }
      else resolve(output);
    });
    child.stdin.end(input);
  });
}

function installedBinary() {
  return resolvePackageBinary(path.join(rootDir(), 'runtime', 'node_modules', '@opencode', 'cli'));
}

function resolvePackageBinary(packageDir) {
  // The npm package declares its launcher path. It can end in .exe even on Linux.
  // The postinstall script copies the matching ELF/Mach-O/PE executable to that path.
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const relative = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.opencode;
    if (relative) {
      const binary = path.resolve(packageDir, relative);
      if (!binary.startsWith(path.resolve(packageDir) + path.sep)) throw new Error('invalid package binary');
      return binary;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('OpenCode 包的可执行文件配置无效');
  }
  return path.join(packageDir, 'bin', 'opencode.exe');
}

async function ensureOpenCode({ install = process.env.OPENCODE_AUTO_INSTALL === 'true', timeoutMs = Infinity } = {}) {
  if (process.env.OPENCODE_BIN) return path.resolve(process.env.OPENCODE_BIN);
  const binary = installedBinary();
  if (fs.existsSync(binary)) return binary;
  if (!install) throw new Error('OpenCode 尚未安装；运行 npm run opencode:install 或启用 OPENCODE_AUTO_INSTALL');
  if (!installation) {
    installation = (async () => {
      const version = process.env.OPENCODE_VERSION || DEFAULT_VERSION;
      if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('OPENCODE_VERSION 必须为明确版本号');
      const target = path.join(rootDir(), 'runtime');
      fs.mkdirSync(target, { recursive: true });
      // Use npm's JS entry point, avoiding .cmd execution and shell interpolation on Windows.
      const npmCli = process.env.OPENCODE_NPM_CLI || process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (!fs.existsSync(npmCli)) throw new Error('找不到 npm-cli.js，可设置 OPENCODE_NPM_CLI');
      await runProcess(process.execPath, [npmCli, 'install', '--prefix', target, '--save-exact', '--no-audit', '--no-fund',
        '--fetch-retries=1', '--fetch-timeout=30000', `@opencode/cli@${version}`],
        { timeoutMs: Math.min(timeoutMs, envInt('OPENCODE_INSTALL_TIMEOUT_MS', 180000)),
          env: { ...cliEnvironment(), npm_config_cache: path.join(rootDir(), 'npm-cache') } });
      const installed = installedBinary();
      if (!fs.existsSync(installed)) throw new Error('OpenCode 安装未生成可执行文件');
      return installed;
    })().finally(() => { installation = null; });
  }
  return installation;
}

function cliEnvironment() {
  const root = rootDir();
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_IDENTIFIER']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const sub of ['config', 'data', 'cache', 'state', 'work']) fs.mkdirSync(path.join(root, sub), { recursive: true });
  const isolated = process.env.OPENCODE_ISOLATED !== 'false';
  if (!isolated) {
    for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  Object.assign(env, {
    ...(isolated ? {
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    } : {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      update: 'disable', share: 'disabled', snapshots: false,
      // Retain the native agent and tool definitions. Noninteractive run rejects
      // permission requests; ask prevents executing chat instructions as tools.
      permissions: [{ action: '*', resource: '*', effect: 'ask' }],
    }),
  });
  return env;
}

async function startOpenCodeService({ timeoutMs = 30000 } = {}) {
  if (service) return service.ensure();
  if (!serviceStarting) serviceStarting = (async () => {
    const binary = await ensureOpenCode({ timeoutMs });
    const env = cliEnvironment();
    const { OpenCodeService } = require('./opencodeService');
    service = new OpenCodeService({ binary, env, cwd: path.join(rootDir(), 'work'), run: runProcess,
      startupTimeoutMs: Math.min(timeoutMs, envInt('OPENCODE_STARTUP_TIMEOUT_MS', 30000)),
      healthIntervalMs: envInt('OPENCODE_HEALTH_INTERVAL_MS', 30000) });
    return service.start();
  })().finally(() => { serviceStarting = null; });
  return serviceStarting;
}

async function stopOpenCodeService() {
  // Wait for an in-flight installation/start so shutdown cannot orphan a late server.
  try { await serviceStarting; } catch { /* Startup failure still has a managed process. */ }
  await service?.stop();
  service = null;
}

function openCodeServiceStatus() { return service?.status() || { running: false, pid: null, restarts: 0 }; }

async function listFreeModels({ refresh = false, timeoutMs = 30000 } = {}) {
  if (!refresh && catalog && Date.now() - catalogAt < envInt('OPENCODE_MODEL_CACHE_MS', 3600000)) return catalog;
  const bin = await ensureOpenCode({ timeoutMs });
  const connection = await startOpenCodeService({ timeoutMs });
  const output = await runProcess(bin, ['models', '--server', connection.url], { cwd: path.join(rootDir(), 'work'), env: connection.env, timeoutMs });
  const models = [...new Set(output.split(/\r?\n/).map(s => s.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter(s => /^opencode\/[a-zA-Z0-9._-]+$/.test(s) && (s.endsWith('-free') || s === 'opencode/big-pickle')))];
  if (!models.length) throw new Error('OpenCode 未发现免费模型，请刷新目录或配置 OPENCODE_MODELS');
  catalog = models;
  catalogAt = Date.now();
  return models;
}

function parseCliOutput(output) {
  const parts = new Map();
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'error') {
      const status = Number(event.error?.status);
      const error = new Error(`OpenCode 模型请求失败${status >= 400 && status <= 599 ? `（HTTP ${status}）` : ''}`);
      if (status >= 400 && status <= 599) error.status = status;
      error.retryAfterMs = Number(event.error?.retryAfterMs) || 0;
      throw error;
    }
    // JSON output contains completed text parts, never reasoning/tool output.
    if (event.type === 'text' && typeof event.part?.text === 'string' && !seen.has(line)) {
      seen.add(line);
      const id = event.part.id || String(parts.size);
      // run --format json emits deltas, including when one part is reconciled later.
      parts.set(id, (parts.get(id) || '') + event.part.text);
    }
  }
  const text = [...parts.values()].join('\n').trim();
  if (!text) throw new Error('OpenCode 模型未返回文字');
  return text;
}

async function requestOpenCode({ sys, userContent, model, mode, timeoutMs = 90000 }, { run = runProcess, ensure = ensureOpenCode, discover = listFreeModels, connect = startOpenCodeService } = {}) {
  const started = Date.now();
  const bin = await ensure({ timeoutMs });
  const connection = await connect({ timeoutMs });
  const models = model === 'auto-free' ? await discover({ timeoutMs: Math.min(timeoutMs, 30000) }) : [model];
  const start = modelCursor++ % models.length;
  const ordered = [...models.slice(start), ...models.slice(0, start)].filter(m => (coolingModels.get(m) || 0) <= Date.now());
  let lastError;
  for (const selected of ordered.slice(0, envInt('OPENCODE_MAX_ATTEMPTS', 3))) {
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/#-]+$/.test(selected)) throw new Error('OpenCode 模型必须为 provider/model');
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    try {
      const output = await run(bin, ['run', '--server', connection.url, '--format', 'json', '--agent', 'build', '--model', selected, '--archived'], {
        cwd: path.join(rootDir(), 'work'), env: connection.env,
        input: `${sys}\n\n${userContent}`, timeoutMs: Math.min(remaining, envInt('OPENCODE_REQUEST_TIMEOUT_MS', 40000)),
      });
      const text = parseCliOutput(output);
      // Validate here too, so auto-free can change models after invalid output.
      const decision = require('./aiPrompt').parseDecision(text, { strict: true });
      if (mode === 'mention' && !decision.reply) throw new Error('OpenCode 模型未返回有效回复');
      coolingModels.delete(selected);
      return { text, model: selected };
    } catch (error) {
      lastError = error;
      coolingModels.set(selected, Date.now() + Math.max(envInt('AI_FAILURE_COOLDOWN_MS', 60000), Math.min(error.retryAfterMs || 0, 15 * 60000)));
    }
  }
  throw lastError || new Error('OpenCode 免费模型全部冷却中或请求总时限已到');
}

module.exports = { DEFAULT_VERSION, ensureOpenCode, listFreeModels, requestOpenCode, parseCliOutput, cliEnvironment, runProcess, resolvePackageBinary,
  startOpenCodeService, stopOpenCodeService, openCodeServiceStatus };
