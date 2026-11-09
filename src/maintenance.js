const { pruneExpiredMessages } = require('./contextStore');
const { getDatabase } = require('./database');
const { envInt } = require('./env');
const { pruneExpiredUsage } = require('./usageStore');
const { pruneExpiredExpressions } = require('./expressionStore');

function runMaintenance() {
  pruneExpiredMessages();
  pruneExpiredUsage();
  pruneExpiredExpressions();
  getDatabase().prepare('DELETE FROM conversation_memories WHERE expires_at <= ?').run(Date.now());
  getDatabase().exec('PRAGMA optimize;');
}

function startMaintenanceScheduler() {
  const intervalMs = envInt('MAINTENANCE_INTERVAL_MINUTES', 60) * 60 * 1000;
  const timer = setInterval(() => {
    try {
      runMaintenance();
    } catch (error) {
      console.error('定期数据维护失败:', error.message);
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { runMaintenance, startMaintenanceScheduler };
