const net = require('net');
const { spawn } = require('child_process');
const { randomBytes } = require('crypto');

function stopProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

// Own exactly one headless CLI server. Its generated credential stays in memory.
class OpenCodeService {
  constructor({ binary, env, cwd, run, launch = spawn, healthIntervalMs = 30000, startupTimeoutMs = 30000, restartDelayMs = 1000 }) {
    Object.assign(this, { binary, env, cwd, run, launch, healthIntervalMs, startupTimeoutMs, restartDelayMs });
    this.stopped = true;
    this.restarts = 0;
  }

  async start() {
    this.stopped = false;
    if (!this.monitor) {
      this.monitor = setInterval(() => this.check().catch(() => {}), this.healthIntervalMs);
    }
    return this.ensure();
  }

  async ensure() {
    if (this.stopped) throw new Error('OpenCode 常驻服务已停止');
    if (this.ready && this.child?.exitCode === null && this.child.signalCode === null && !this.child.killed) return this.connection();
    if (!this.starting) this.starting = this.boot().finally(() => { this.starting = null; });
    return this.starting;
  }

  connection() { return { url: this.url, env: { ...this.env, OPENCODE_SERVER_PASSWORD: this.password } }; }

  async boot() {
    const port = await freePort();
    if (this.stopped) throw new Error('OpenCode 常驻服务已停止');
    this.url = `http://127.0.0.1:${port}`;
    this.password = randomBytes(32).toString('base64url');
    // Use the CLI's own standalone server protocol and hold its stdin lease open.
    // This preserves native startup behavior, without printing a service password.
    const child = this.launch(this.binary, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: this.cwd, env: { ...this.env, OPENCODE_PASSWORD: this.password }, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.on('error', () => {});
    this.ready = false;
    child.stdin.on('error', () => {});
    child.stderr.resume();
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('OpenCode 常驻服务启动超时')), this.startupTimeoutMs);
        const finish = error => {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          child.off('error', onError);
          child.off('exit', onExit);
          error ? reject(error) : resolve();
        };
        const onData = chunk => {
          output = (output + chunk.toString('utf8')).slice(-8192);
          for (const line of output.split(/\r?\n/)) {
            try { if (JSON.parse(line).url === this.url) return finish(); } catch { /* Incomplete readiness line. */ }
          }
        };
        const onError = () => finish(new Error('无法启动 OpenCode 常驻服务'));
        const onExit = () => finish(new Error('OpenCode 常驻服务在启动时退出'));
        child.stdout.on('data', onData);
        child.once('error', onError);
        child.once('exit', onExit);
      });
      // Validate the authenticated API, not the web UI's catch-all HTTP 200 page.
      await this.health();
      if (this.stopped || this.child !== child || child.exitCode !== null || child.signalCode !== null) throw new Error('OpenCode 常驻服务已退出');
      this.ready = true;
      child.once('exit', () => {
        if (this.child === child) { this.ready = false; this.scheduleRestart(); }
      });
      return this.connection();
    } catch (error) {
      stopProcess(child);
      this.ready = false;
      this.scheduleRestart();
      throw error;
    } finally {
      // Drain output without logging startup passwords or request contents.
      child.stdout.resume();
      child.stderr.resume();
    }
  }

  async health() {
    await this.run(this.binary, ['models', '--server', this.url], {
      cwd: this.cwd, env: this.connection().env, timeoutMs: 10000,
    });
  }

  async check() {
    if (this.stopped || this.starting || this.checking) return;
    this.checking = true;
    try { await this.ensure(); await this.health(); }
    catch {
      this.ready = false;
      stopProcess(this.child);
      this.scheduleRestart();
    } finally { this.checking = false; }
  }

  scheduleRestart() {
    if (this.stopped || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restarts++;
      this.ensure().catch(() => this.scheduleRestart());
    }, Math.min(30000, this.restartDelayMs * 2 ** Math.min(this.restarts, 5)));
  }

  status() { return { running: !!this.ready, pid: this.child?.pid || null, restarts: this.restarts, url: this.url }; }

  async stop() {
    this.stopped = true;
    clearInterval(this.monitor); this.monitor = null;
    clearTimeout(this.restartTimer); this.restartTimer = null;
    const child = this.child;
    const exited = child?.pid && child.exitCode === null && child.signalCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    stopProcess(child);
    await exited;
    this.ready = false;
    this.password = undefined;
  }
}

module.exports = { OpenCodeService };
