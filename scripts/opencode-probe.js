require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { envInt } = require('../src/env');
const { listFreeModels, requestOpenCode, openCodeServiceStatus, stopOpenCodeService } = require('../src/opencode');

async function probeFreeModels() {
  const models = [...await listFreeModels({ refresh: true })];
  if (models.includes('opencode/deepseek-v4.1-flash-free')) models.push('opencode/deepseek-v4.1-flash-free#high');
  const filename = path.resolve(process.env.DATA_DIR || 'data', 'opencode-model-probe.json');
  const report = { startedAt: new Date().toISOString(), serverBefore: openCodeServiceStatus(), models: [] };
  const save = () => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, JSON.stringify(report, null, 2)); };
  save();
  for (const model of models) {
    const started = Date.now();
    let result;
    try {
      const reply = await requestOpenCode({ sys: '只输出 JSON：{"action":"reply","reply":"你好，测试成功"}。不使用工具。',
        userContent: '请用中文打招呼。', model, mode: 'mention', timeoutMs: envInt('OPENCODE_PROBE_TIMEOUT_MS', 30000) });
      result = { model, ok: true, reply: JSON.parse(reply.text).reply };
    } catch (error) {
      result = { model, ok: false, status: error.status || null, error: error.message, retryAfterMs: error.retryAfterMs || 0 };
    }
    result.elapsedMs = Date.now() - started;
    report.models.push(result);
    report.serverAfter = openCodeServiceStatus();
    save();
    console.log(JSON.stringify(result));
  }
  report.completedAt = new Date().toISOString();
  save();
  console.log(`逐模型测试完成：${report.models.filter(m => m.ok).length}/${models.length} 成功；报告 ${filename}`);
  return report;
}

if (require.main === module) probeFreeModels().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(stopOpenCodeService);
module.exports = { probeFreeModels };
