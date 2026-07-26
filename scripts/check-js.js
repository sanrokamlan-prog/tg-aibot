const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
  return files;
}

const files = ['src', 'scripts', 'test'].flatMap(collectJavaScriptFiles).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `语法检查失败: ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`JavaScript syntax OK (${files.length} files)`);
