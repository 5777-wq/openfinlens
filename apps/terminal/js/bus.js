/* bus.js —— 轻量事件总线（几十行，不引状态管理框架）
   把 地球 / 事件列表 / K线 / 资金 通过同一套消息连起来：
     Bus.emit('event:select', ev)   选中一条全球事件
     Bus.emit('symbol:open', t)     请求打开标的详情（复用现有 openDetail）
     Bus.emit('chart:event', m)     用户点中K线上的事件 marker
   监听器抛错只吞掉本监听器，不炸整条链。 */

const Bus = (() => {
  const map = new Map();

  function on(evt, fn) {
    if (!map.has(evt)) map.set(evt, []);
    map.get(evt).push(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn) {
    const list = map.get(evt);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(evt, payload) {
    const list = map.get(evt);
    if (!list) return;
    list.slice().forEach(fn => {
      try { fn(payload); } catch { /* 单个监听器坏了不许拖垮别的模块 */ }
    });
  }

  return { on, off, emit };
})();

window.Bus = Bus;
