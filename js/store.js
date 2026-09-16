/* store.js —— localStorage：自选 / 设置 */

const Store = {
  get(key, def) {
    try {
      const v = JSON.parse(localStorage.getItem('gfd_' + key));
      return v === null || v === undefined ? def : v;
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('gfd_' + key, JSON.stringify(val)); } catch { /* 隐私模式忽略 */ }
  },

  // 自选：统一存 { symbol, name, market }，symbol 跨市场唯一（sh600519 / usAAPL / BTCUSDT / EM:171.US10Y）
  watchlist: {
    all() { return Store.get('watchlist', []); },
    has(sym) { return this.all().some(x => x.symbol === sym); },
    toggle(item) {
      const a = this.all();
      const i = a.findIndex(x => x.symbol === item.symbol);
      if (i >= 0) { a.splice(i, 1); Store.set('watchlist', a); return false; }
      a.push({ symbol: item.symbol, name: item.name, market: item.market });
      Store.set('watchlist', a);
      return true;
    },
  },

  settings: {
    get() {
      return Object.assign(
        { updown: 'red', refresh: 10, showDegraded: true },
        Store.get('settings', {})
      );
    },
    set(s) { Store.set('settings', Object.assign(this.get(), s)); },
  },

  // 到价提醒（2026-09-17）：纯本地规则，行情 tick 里判定。
  // alert = { id, symbol, name, market, dir:'above'|'below', price, note,
  //           createdAt, triggeredAt:null, triggeredPrice:null }
  alerts: {
    all() { return Store.get('alerts', []); },
    active() { return this.all().filter(x => !x.triggeredAt); },
    add(a) {
      const list = this.all();
      const rec = Object.assign({
        id: 'al_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: Date.now(), triggeredAt: null, triggeredPrice: null, note: '',
      }, a);
      list.push(rec);
      Store.set('alerts', list);
      return rec;
    },
    remove(id) { Store.set('alerts', this.all().filter(x => x.id !== id)); },
    update(id, patch) {
      const list = this.all();
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return null;
      Object.assign(list[i], patch);
      Store.set('alerts', list);
      return list[i];
    },
  },
};

window.Store = Store;
