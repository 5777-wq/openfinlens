// 修复「双 CR」损坏：之前用 (CR+LF).join(split(LF)) 处理 CRLF 文件，给已有 \r 的行走成了 \r\r\n
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/57的vibe coding内容/global-fin-dashboard';
const SKIP_DIRS = new Set(['.git', 'node_modules', '_qa', '.mimosa', '.zcode', '.workbuddy', 'android', 'keystore-20261005']);
const TEXT = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.md', '.json', '.yml', '.yaml', '.txt', '.sh', '.svg', '.webmanifest']);

let fixed = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (!TEXT.has(ext)) continue;
    const p = path.join(dir, e.name);
    const buf = fs.readFileSync(p);
    if (buf.includes(Buffer.from('\r\r\n'))) {
      const s = buf.toString('utf8');
      const n = (s.match(/\r\r\n/g) || []).length;
      fs.writeFileSync(p, s.split('\r\r\n').join('\r\n'), 'utf8');
      fixed++;
      console.log('fixed', path.relative(ROOT, p), n, 'occurrences');
    }
  }
}
walk(ROOT);
console.log('files fixed:', fixed);
