require('dotenv').config();
const { ensureOpenCode, listFreeModels, requestOpenCode, runProcess, cliEnvironment, stopOpenCodeService } = require('../src/opencode');

async function main() {
  const bin = await ensureOpenCode({ install: true });
  const version = await runProcess(bin, ['--version'], { env: cliEnvironment() });
  console.log(`CLI executable OK: ${version.trim()}`);
  const models = await listFreeModels({ refresh: true });
  console.log(`CLI catalog OK: ${models.length} free model IDs discovered (availability requires an actual request)`);
  const model = process.env.OPENCODE_SMOKE_MODEL;
  if (!model) {
    console.log('Generation not tested. Set OPENCODE_SMOKE_MODEL=provider/model to verify a real reply.');
    return;
  }
  const result = await requestOpenCode({
    sys: '只输出 JSON：{"action":"reply","reply":"测试成功"}。不要使用工具。',
    userContent: '请验证中文回复。', model, mode: 'mention', timeoutMs: 60000,
  });
  console.log(`CLI generation OK: ${result.model} ${result.text}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(stopOpenCodeService);
