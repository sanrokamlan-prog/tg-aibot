function envInt(name, defaultValue, { min = 1 } = {}) {
  const value = Number.parseInt(process.env[name] ?? String(defaultValue), 10);
  return Number.isFinite(value) && value >= min ? value : defaultValue;
}

function envNumber(name, defaultValue, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : defaultValue;
}

function envBool(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function envList(name) {
  return (process.env[name] || '').split(',').map((value) => value.trim()).filter(Boolean);
}

module.exports = { envInt, envNumber, envBool, envList };
