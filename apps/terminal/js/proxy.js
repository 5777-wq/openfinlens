/* proxy.js —— 代理前缀 + 数据源状态登记（降级角标用） */

// 部署到静态站且直连被墙时，把这里改成你的 Cloudflare Worker 地址：
// window.PROXY = 'https://your-worker.workers.dev/';
window.PROXY = window.PROXY || '';

// 数据源健康状态：记录每个逻辑源最近一次结果，供页脚 / 角标展示
const SourceState = {
  _m: new Map(),
  ok(key, via) { this._m.set(key, { ok: true, via: via || 'primary', at: Date.now() }); },
  fail(key, msg) {
    const prev = this._m.get(key) || {};
    this._m.set(key, { ok: false, via: prev.via || null, at: Date.now(), msg: String(msg || '') });
  },
  get(key) { return this._m.get(key) || null; },
  all() { return Array.from(this._m.entries()); },
};

window.SourceState = SourceState;
