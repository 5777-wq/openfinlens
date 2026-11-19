// scripts/serve.mjs —— monorepo 统一零依赖本地静态服务器（Phase 1）
// 骨架与 MIME 表沿用 _qa/serve.mjs（那份服务于压缩前后 A/B 对比，保持不动）；
// 这份服务于「monorepo 新旧布局并行的本地联调」。
//
// 路由（Phase 4 前后自动切换，无需改代码）：
//   /              → apps/terminal/index.html 存在即用；否则回退仓库根旧布局 index.html
//   /core/*        → core/*（Phase 2 抽取后生效；目录无 index 时返回列表页）
//   /academy/*     → apps/academy/*（Phase 4 迁入；此前返回占位说明页）
//   /data/* /api/* → 三级回退：.data-local/<repo相对路径> → 远程 data 分支 raw 直链（6s 超时）
//                    → 仓库内同名文件 → 404
//   其余           → 仓库根（旧布局 /js/ /css/ /assets/ /lib/ 原样可用）
//
// 设计约定：
//   - 零第三方依赖：node:http / node:fs / node:path / node:url，原生 ESM
//   - 全部响应 no-store：本地联调绝不吃旧缓存（http-server 缓存教训见 docs/FIELD-NOTES）
//   - 路径穿越防护：resolve 后必须仍落在对应根内，否则 403
//   - .data-local/ 内部目录结构与仓库一致（如 .data-local/data/events/x.json、
//     .data-local/api/v1/health.json），已被 .gitignore 忽略
//   - 远程回退仅缓存 200 响应（内存 Map，>50 条整体清空），断网/超时/分支未建时
//     静默落回下一级，绝不让本地服务因网络问题崩掉
//
// 用法：node scripts/serve.mjs [port]   （默认 8765）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8765);
const TERMINAL_DIR = path.join(ROOT, 'apps', 'terminal');
const ACADEMY_DIR = path.join(ROOT, 'apps', 'academy');
const CORE_DIR = path.join(ROOT, 'core');
const LOCAL_OVERRIDE = path.join(ROOT, '.data-local');
// data 分支 raw 直链：采集产物以 data 分支为准，本地没有 .data-local 时用它联调最新数据
const REMOTE_DATA_BASE = 'https://raw.githubusercontent.com/5777-wq/openfinlens/data/';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8',
};

const remoteCache = new Map(); // rel → Buffer

function typeOf(rel) {
  return TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream';
}

function safeJoin(base, rel) {
  // Windows 上 path.resolve(base, '/x') 会把开头斜杠解析成「当前盘符根」，
  // 把合法的根内路径误判成逃逸——先剥掉开头斜杠（URL 路径语义里它无意义），
  // 空串按 '.' 处理（= 根目录本身）； '..' 造成的逃逸仍被 startsWith 拦下。
  const clean = String(rel).replace(/^\/+/, '');
  const abs = path.resolve(base, clean || '.');
  return abs === base || abs.startsWith(base + path.sep) ? abs : null;
}

function send(req, res, code, body, type) {
  res.writeHead(code, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function page(title, bodyHtml) {
  return Buffer.from(
    '<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
    '<body style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;line-height:1.7">' +
    bodyHtml + '</body>',
  );
}

function listDir(dirRoot, urlBase) {
  const base = urlBase.replace(/\/+$/, '') + '/';
  const rows = fs.readdirSync(dirRoot, { withFileTypes: true })
    .map((d) => '<li><a href="' + base + d.name + (d.isDirectory() ? '/' : '') + '">' +
      d.name + (d.isDirectory() ? '/' : '') + '</a></li>')
    .join('');
  return page('index of ' + base, '<h3>index of ' + base + '</h3><ul>' + rows + '</ul>');
}

async function fetchRemote(rel) {
  if (remoteCache.has(rel)) return remoteCache.get(rel);
  try {
    const r = await fetch(REMOTE_DATA_BASE + rel, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (remoteCache.size > 50) remoteCache.clear();
    remoteCache.set(rel, buf);
    return buf;
  } catch {
    return null;
  }
}

// /data/* 与 /api/* 共用：rel = URL 去掉开头斜杠 = 仓库相对路径
async function serveDataish(req, res, rel) {
  const type = typeOf(rel);
  const override = safeJoin(LOCAL_OVERRIDE, rel);
  if (override && fs.existsSync(override) && fs.statSync(override).isFile()) {
    return send(req, res, 200, fs.readFileSync(override), type);
  }
  const remote = await fetchRemote(rel);
  if (remote) return send(req, res, 200, remote, type);
  const repo = safeJoin(ROOT, rel);
  if (repo && fs.existsSync(repo) && fs.statSync(repo).isFile()) {
    return send(req, res, 200, fs.readFileSync(repo), type);
  }
  send(req, res, 404, Buffer.from('not found: ' + rel), 'text/plain; charset=utf-8');
}

// 静态目录通用服务：目录 → index.html；文件 → 按扩展名回类型；都没有 → 404
function serveStatic(req, res, abs, notFoundNote) {
  if (!abs) return send(req, res, 403, Buffer.from('forbidden'), 'text/plain');
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const idx = path.join(abs, 'index.html');
    if (fs.existsSync(idx)) return send(req, res, 200, fs.readFileSync(idx), TYPES['.html']);
    return send(req, res, 404, Buffer.from(notFoundNote || 'not found'), 'text/plain; charset=utf-8');
  }
  if (fs.existsSync(abs)) return send(req, res, 200, fs.readFileSync(abs), typeOf(abs));
  return send(req, res, 404, Buffer.from(notFoundNote || 'not found'), 'text/plain; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  try {
    let url;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      return send(req, res, 400, Buffer.from('bad url'), 'text/plain');
    }
    if (!url.startsWith('/')) url = '/' + url;

    // 1) 采集产物：/data/* 与 /api/*，走三级回退
    if (url === '/data' || url.startsWith('/data/') || url.startsWith('/api/')) {
      return await serveDataish(req, res, url.replace(/^\/+/, ''));
    }

    // 2) /core/*：共享内核（Phase 2 起有内容；目录无 index 时给列表页方便核对骨架）
    if (url === '/core' || url.startsWith('/core/')) {
      const rel = url.slice('/core'.length) || '/';
      const abs = safeJoin(CORE_DIR, rel);
      if (!abs) return send(req, res, 403, Buffer.from('forbidden'), 'text/plain');
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const idx = path.join(abs, 'index.html');
        if (fs.existsSync(idx)) return send(req, res, 200, fs.readFileSync(idx), TYPES['.html']);
        return send(req, res, 200, listDir(abs, url), TYPES['.html']);
      }
      return serveStatic(req, res, abs, 'core/ 下还没有这个文件（Phase 2 抽取后可用）');
    }

    // 3) /academy/*：Phase 4 迁入前返回占位页（骨架目录已存在但还没有 index.html，
    //    所以判断依据是 index.html 是否就位，而不是目录是否存在）
    if (url === '/academy' || url.startsWith('/academy/')) {
      const tIdx = path.join(ACADEMY_DIR, 'index.html');
      if (!fs.existsSync(tIdx)) {
        return send(req, res, 200, page('/academy/ 尚未迁入',
          '<h3>/academy/ 尚未迁入（monorepo Phase 4）</h3>' +
          '<p>白话金融科普站仍独立部署于原仓 openfin-academy；Phase 4 迁入后，' +
          '此路由将直接服务 apps/academy/。</p>'), TYPES['.html']);
      }
      const rel = url.slice('/academy'.length) || '/';
      return serveStatic(req, res, safeJoin(ACADEMY_DIR, rel), 'not found');
    }

    // 4) / 与 /index.html：apps/terminal 优先，为空则回退仓库根旧布局（Phase 4 切换前）
    if (url === '/' || url === '/index.html') {
      const tIdx = path.join(TERMINAL_DIR, 'index.html');
      if (fs.existsSync(tIdx)) return send(req, res, 200, fs.readFileSync(tIdx), TYPES['.html']);
      return serveStatic(req, res, path.join(ROOT, 'index.html'), 'no index');
    }

    // 5) 其余：仓库根旧布局
    return serveStatic(req, res, safeJoin(ROOT, url));
  } catch (e) {
    send(req, res, 500, Buffer.from('server error: ' + (e && e.message || e)), 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('monorepo dev server → http://127.0.0.1:' + PORT);
  console.log('  /          apps/terminal/index.html（空则回退仓库根旧布局）');
  console.log('  /core/     core/（Phase 2 抽取后生效）');
  console.log('  /academy/  apps/academy/（Phase 4 迁入，此前为占位页）');
  console.log('  /data/ /api/  .data-local → 远程 data 分支 → 仓库副本 → 404');
});
