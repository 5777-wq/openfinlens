/* worldbank.js —— 世界经济仪表盘数据源（世界银行公开 API，免密钥、CORS *）
   实测（2026-09）：api.worldbank.org 直连可达，format=json&mrnev=1 返回每国最新非空值。
   指标为年度数据（与 TradingView 经济热图同源口径），缓存 24h 足够。
   输出：rows = [{ iso, name, values: { gdp:{v,date}, growth:{...}, ... } }]，缺失为 null。 */

const WorldBankSource = (() => {
  const { request } = window.U;
  const BASE = 'https://api.worldbank.org/v2';

  const INDICATORS = {
    gdp: { code: 'NY.GDP.MKTP.CD', label: 'GDP', hint: '总量（万亿美元）' },
    growth: { code: 'NY.GDP.MKTP.KD.ZG', label: 'GDP增长', hint: '实际同比 %' },
    cpi: { code: 'FP.CPI.TOTL.ZG', label: '通胀率', hint: 'CPI 同比 %' },
    unemp: { code: 'SL.UEM.TOTL.ZS', label: '失业率', hint: '总失业 %（ILO 估计）' },
    // ⚠️ 代码以 ZS 结尾（% of labor force）。曾误写成 ZG——世行无此指标，
    // 接口返回空数组，失业率整列 8 国静默全空（第四轮审核 N-1）
    debt: { code: 'GC.DOD.TOTL.GD.ZS', label: '政府债务', hint: '中央政府债务占 GDP %（世行仅此口径，中国/日本/法国等无此数据）' },
    cab: { code: 'BN.CAB.XOKA.GD.ZS', label: '经常账户', hint: '占 GDP %' },
  };
  const COUNTRIES = [
    { iso: 'US', name: '美国', flag: 'us' },
    { iso: 'CN', name: '中国', flag: 'cn' },
    { iso: 'JP', name: '日本', flag: 'jp' },
    { iso: 'DE', name: '德国', flag: 'de' },
    { iso: 'GB', name: '英国', flag: 'gb' },
    { iso: 'FR', name: '法国', flag: 'fr' },
    { iso: 'IN', name: '印度', flag: 'in' },
    { iso: 'KR', name: '韩国', flag: 'kr' },
  ];

  async function fetchIndicator(code) {
    const url = `${BASE}/country/${COUNTRIES.map(c => c.iso).join(';')}/indicator/${code}` +
      '?format=json&mrnev=1&per_page=30';
    try {
      const j = await request(url, { timeout: 12000 });
      // 返回 [meta, rows]；国家无该指标数据时可能只有 meta 或空数组。
      // 索引键用 country.id（两位 ISO 码 CN，与 COUNTRIES 表的 c.iso 同一口径）：
      // 旧实现用 countryiso3code（三位码 CHN）建索引、取数用两位码查，
      // 永远对不上 → 所有指标为 null → 招牌的"世界经济仪表盘"整屏空白。
      const rows = Array.isArray(j) && j[1] ? j[1] : [];
      const out = {};
      rows.forEach(r => {
        const iso = r && r.country && r.country.id ? String(r.country.id).toUpperCase() : null;
        if (iso && typeof r.value === 'number') {
          out[iso] = { v: r.value, date: String(r.date || '') };
        }
      });
      return out;
    } catch (e) {
      window.SourceState.fail('worldbank', code + ': ' + e.message);
      return {};
    }
  }

  // 并发拉全部指标 → 按国家组装
  async function getMacro() {
    const keys = Object.keys(INDICATORS);
    const parts = await Promise.all(keys.map(k => fetchIndicator(INDICATORS[k].code)));
    const byInd = {};
    keys.forEach((k, i) => { byInd[k] = parts[i]; });
    const rows = COUNTRIES.map(c => {
      const values = {};
      keys.forEach(k => { values[k] = byInd[k][c.iso] || null; });
      return { iso: c.iso, name: c.name, flag: c.flag, values };
    });
    const filled = rows.reduce((s, r) => s + Object.values(r.values).filter(Boolean).length, 0);
    if (!filled) return null;   // 全空 → 上层走缓存/降级（"空但成功"不 ok 不 fail，角标维持旧态）
    window.SourceState.ok('worldbank');
    return { rows, indicators: INDICATORS, updatedAt: Date.now(), lastUpdated: null };
  }

  return { getMacro, INDICATORS, COUNTRIES };
})();

window.WorldBankSource = WorldBankSource;
