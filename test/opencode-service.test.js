const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { OpenCodeService } = require('../src/opencodeService');
const { runProcess } = require('../src/opencode');

test('resident CLI stays alive, shares concurrent starts, restarts while idle and stops its process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ai-daemon-'));
  const fixture = path.join(dir, 'cli.cjs');
  fs.writeFileSync(fixture, `
const http = require('http');
const args = process.argv.slice(2);
if (args[0] === 'serve') {
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('opencode:'+process.env.OPENCODE_PASSWORD).toString('base64');
    res.writeHead(ok ? 200 : 401); res.end('opencode/fixture-free');
  });
  server.listen(Number(args[args.indexOf('--port')+1]), '127.0.0.1', () => {
    process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})+'\\n');
  });
} else {
  fetch(args[args.indexOf('--server')+1], {headers:{Authorization:'Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')}})
    .then(async r => { if (!r.ok) process.exitCode=1; else process.stdout.write(await r.text()); }).catch(()=>{process.exitCode=1;});
}
`);
  const service = new OpenCodeService({ binary: process.execPath, env: { ...process.env }, cwd: dir,
    launch: (bin, args, options) => spawn(bin, [fixture, ...args], options),
    run: (bin, args, options) => runProcess(bin, [fixture, ...args], options),
    healthIntervalMs: 200, restartDelayMs: 25, startupTimeoutMs: 5000 });
  try {
    const connections = await Promise.all(Array.from({ length: 6 }, () => service.start()));
    assert.equal(new Set(connections.map(c => c.url)).size, 1);
    assert.equal(service.status().running, true);
    const firstPid = service.status().pid;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(service.status().pid, firstPid);
    service.child.kill('SIGKILL');
    const deadline = Date.now() + 10000;
    while ((!service.status().running || service.status().pid === firstPid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(service.status().running, true);
    assert.notEqual(service.status().pid, firstPid);
    assert.ok(service.status().restarts >= 1);
    const lastPid = service.status().pid;
    await service.stop();
    assert.equal(service.status().running, false);
    assert.throws(() => process.kill(lastPid, 0));
    await assert.rejects(service.ensure(), /已停止/);
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed resident startup is bounded and can be stopped', async () => {
  const service = new OpenCodeService({ binary: path.join(os.tmpdir(), 'nonexistent-cli-tg-aibot'), env: {}, run: async () => {} });
  await assert.rejects(service.start(), /无法启动/);
  await service.stop();
  assert.equal(service.status().running, false);
});
