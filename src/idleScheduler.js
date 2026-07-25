const { envInt } = require('./env');

function startIdleScheduler(runIdleCheck) {
  const intervalMs = envInt('IDLE_CHECK_INTERVAL_SECONDS', 60) * 1000;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runIdleCheck();
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { startIdleScheduler };
