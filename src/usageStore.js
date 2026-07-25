const { getDatabase } = require('./database');
const { envInt } = require('./env');

function recordAiUsage({ chatId, mode, model, latencyMs, inputChars, outputChars, success, error = '' }) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO ai_usage(
      chat_id, mode, model, latency_ms, input_chars, output_chars, success, error, ts
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(chatId), mode, model, Math.round(latencyMs), inputChars, outputChars,
    success ? 1 : 0, String(error).slice(0, 500), Date.now()
  );
  const cutoff = Date.now() - envInt('USAGE_TTL_DAYS', 30) * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM ai_usage WHERE ts < ?').run(cutoff);
}

function getUsageSummary(chatId, sinceMs = 24 * 60 * 60 * 1000) {
  return getDatabase().prepare(`
    SELECT COUNT(*) AS requests,
      SUM(success) AS successes,
      COALESCE(SUM(input_chars), 0) AS input_chars,
      COALESCE(SUM(output_chars), 0) AS output_chars,
      COALESCE(ROUND(AVG(latency_ms)), 0) AS avg_latency_ms
    FROM ai_usage WHERE chat_id = ? AND ts >= ?
  `).get(String(chatId), Date.now() - sinceMs);
}

module.exports = { recordAiUsage, getUsageSummary };
