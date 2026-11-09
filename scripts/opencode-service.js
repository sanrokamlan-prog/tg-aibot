require('dotenv').config();
const { startOpenCodeService, stopOpenCodeService, openCodeServiceStatus } = require('../src/opencode');
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stopOpenCodeService();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
(async () => {
  await startOpenCodeService({ timeoutMs: 180000 });
  console.log('OpenCode 常驻服务已启动', JSON.stringify(openCodeServiceStatus()));
  if (process.argv.includes('--probe-all')) await require('./opencode-probe').probeFreeModels();
  console.log('OpenCode 继续常驻，等待调用；进程退出或健康检查失败时自动重启。');
})().catch(async error => { console.error(error.message); await shutdown(); process.exitCode = 1; });
