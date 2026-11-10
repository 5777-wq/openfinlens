// serve.mjs —— 静态文件服务（带 gzip），只为「压缩前/后同条件对比」用
// 系统 http.server 不压缩、GitHub Pages 会压缩，本地测出来会失真；
// 这个服务的行为尽量贴近 Pages：文本类资源按 Accept-Encoding 回 gzip。
// 用法：node _qa/serve.mjs <dir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.argv[2] || '.');
const PORT = Number(process.argv[3] || 8125);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const gzCache = new Map();

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
    else { res.writeHead(404); res.end('not found'); return; }
  }
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const compressible = /text|javascript|json|svg|xml|manifest/.test(type);
  const wantsGz = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const headers = { 'content-type': type, 'cache-control': 'no-cache' };
  let body = buf;
  if (wantsGz) {
    const key = file + ':' + buf.length;
    let g = gzCache.get(key);
    if (!g) { g = zlib.gzipSync(buf, { level: 9 }); gzCache.set(key, g); }
    body = g; headers['content-encoding'] = 'gzip';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT));
