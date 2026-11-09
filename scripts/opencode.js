require('dotenv').config();
const { ensureOpenCode, listFreeModels, runProcess, cliEnvironment, stopOpenCodeService } = require('../src/opencode');

async function main() {
  if (process.argv[2] === 'install') {
    const bin = await ensureOpenCode({ install: true });
    const version = await runProcess(bin, ['--version'], { env: cliEnvironment() });
    console.log(`OpenCode 已安装：${version.trim()}\n${bin}`);
  } else if (process.argv[2] === 'models') {
    console.log((await listFreeModels({ refresh: true })).join('\n'));
  } else throw new Error('用法：node scripts/opencode.js install|models');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(stopOpenCodeService);
