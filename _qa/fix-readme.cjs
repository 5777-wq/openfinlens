const fs = require('fs');
const p = 'D:/57的vibe coding内容/global-fin-dashboard/README.md';
let s = fs.readFileSync(p, 'utf8');
const n = (s.match(/\\`/g) || []).length;
s = s.split('\\`').join('`');
fs.writeFileSync(p, s, 'utf8');
console.log('before', n, 'after', (s.match(/\\`/g) || []).length);
const i = s.indexOf('docs/UI-V2-SPEC.md');
console.log(JSON.stringify(s.slice(i - 30, i + 20)));
