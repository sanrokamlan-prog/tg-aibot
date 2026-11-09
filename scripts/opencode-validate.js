require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { envInt } = require('../src/env');
const cli = require('../src/opencode');
const { decideAndReply } = require('../src/ai');

// Only canned prompts and bounded public replies go into this report. Never
// upload the CLI data/config/log directories, which may contain session data.
async function validate({ client = cli, decide = decideAndReply } = {}) {
  const reportFile = path.resolve(process.env.DATA_DIR || 'data', 'opencode-validation', 'report.json');
  const report = { startedAt: new Date().toISOString(), platform: process.platform,
    architecture: process.arch, stages: {}, models: [], ok: false };
  const save = () => {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  };
  const errorInfo = error => ({ status: error.status || null,
    // Only our own stable categories; upstream error bodies are not published.
    error: error.status ? `HTTP ${error.status}` : /超时/.test(error.message) ? 'timeout' : 'request_failed' });
  const budgetMs = envInt('OPENCODE_VALIDATION_TIMEOUT_MS', 35000);
  try {
    const binary = await client.ensureOpenCode({ install: true });
    report.stages.install = { ok: true };
    const env = client.cliEnvironment();
    const version = await client.runProcess(binary, ['--version'], { env });
    report.stages.executable = { ok: true, version: version.trim().slice(0, 80) };
    const catalog = await client.listFreeModels({ refresh: true });
    report.stages.catalog = { ok: true, models: catalog };
    const connection = await client.startOpenCodeService();
    report.stages.resident = { ok: true, running: client.openCodeServiceStatus().running };
    const requested = (process.env.OPENCODE_VALIDATION_MODELS ||
      'opencode/deepseek-v4.1-flash-free#high,opencode/iceman-free,opencode/big-pickle')
      .split(',').map(s => s.trim()).filter(Boolean);
    const selected = [...new Set(requested)].filter(model => catalog.includes(model.split('#')[0]))
      .slice(0, Math.min(6, envInt('OPENCODE_VALIDATION_MAX_MODELS', 3)));
    if (!selected.length) throw new Error('没有可测试的免费模型');
    save();
    console.log(`Installed ${report.stages.executable.version}; ${catalog.length} free models; testing ${selected.length}.`);
    for (const model of selected) {
      const entry = { model };
      report.models.push(entry);
      // Native CLI with a plain greeting establishes whether the endpoint can
      // generate at all; the bot path additionally requires valid decision JSON.
      const started = Date.now();
      try {
        const raw = await client.runProcess(binary,
          ['run', '--server', connection.url, '--format', 'json', '--agent', 'build', '--model', model, '--archived'],
          { cwd: path.join(process.env.OPENCODE_DATA_DIR || path.join(process.env.DATA_DIR || 'data', 'opencode'), 'work'),
            env: connection.env, input: '你好，请用中文简单打个招呼，不要使用任何工具。', timeoutMs: budgetMs });
        const reply = client.parseCliOutput(raw);
        entry.native = { ok: Boolean(reply.trim()), reply: reply.slice(0, 300), elapsedMs: Date.now() - started };
      } catch (error) { entry.native = { ok: false, ...errorInfo(error), elapsedMs: Date.now() - started }; }
      save();
      // Exercise the real provider router -> CLI -> strict decision parser.
      const adapterStarted = Date.now();
      const originalModels = process.env.OPENCODE_MODELS;
      try {
        process.env.OPENCODE_MODELS = model;
        const decision = await decide({ mode: 'mention',
          messages: [{ user: '测试用户', text: '你好，今天有点累，想随便聊两句。', ts: Date.now(), fromBot: false }],
          replyTarget: { user: '测试用户', text: '你好，今天有点累，想随便聊两句。' } });
        entry.bot = { ok: decision.action === 'reply' && Boolean(decision.reply?.trim()),
          action: decision.action, reply: decision.reply?.slice(0, 300), elapsedMs: Date.now() - adapterStarted };
      } catch (error) { entry.bot = { ok: false, ...errorInfo(error), elapsedMs: Date.now() - adapterStarted }; }
      finally {
        if (originalModels == null) delete process.env.OPENCODE_MODELS;
        else process.env.OPENCODE_MODELS = originalModels;
      }
      console.log(JSON.stringify(entry));
      save();
    }
    report.ok = report.models.some(entry => entry.bot.ok);
  } catch (error) {
    report.failure = errorInfo(error);
  } finally {
    await client.stopOpenCodeService();
    report.completedAt = new Date().toISOString();
    save();
  }
  console.log(`Real bot generation: ${report.ok ? 'PASS' : 'FAIL'}; report: ${reportFile}`);
  return report;
}

if (require.main === module) validate().then(report => { process.exitCode = report.ok ? 0 : 1; })
  .catch(() => { console.error('OpenCode validation failed'); process.exitCode = 1; });
module.exports = { validate };
