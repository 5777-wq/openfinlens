/* engine/mock-data.js —— 引擎测试与演示用的样例数据（结构 = engine/types.js 契约）
   ① 伊朗局势：四家外媒四条同事件报道（用户给定的标准用例）→ 应聚为 1 个 Event
   ② 日本央行加息：跨类别关联资产的影响链示例
   全部为**人工编写的测试语料**，不是真实新闻，不得当作数据展示给用户。 */

const EngineMockData = {
  /** @returns {Array<{title,url,source,publishedAt}>} 未标准化的原始新闻 */
  iranTension() {
    const t0 = Date.UTC(2026, 8, 10, 8);           // 2026-09-10 08:00 UTC
    const h = 3600 * 1000;
    return [
      { title: 'Iran tensions rise as navy holds Strait of Hormuz drill', url: 'https://example.com/reuters/iran-1', source: 'Reuters', publishedAt: t0 },
      { title: 'Iran tensions escalate after Gulf naval exercise', url: 'https://example.com/bbc/iran-2', source: 'BBC', publishedAt: t0 + 2 * h },
      { title: 'New developments in Iran Gulf standoff', url: 'https://example.com/ap/iran-3', source: 'AP', publishedAt: t0 + 4 * h },
      { title: 'Oil reacts to Iran tensions in the Gulf', url: 'https://example.com/bloomberg/iran-oil', source: 'Bloomberg', publishedAt: t0 + 6 * h },
    ];
  },

  /** 日本央行加息（不同类别关键词，验证 central_bank 分类 + 影响链） */
  bojHike() {
    const t0 = Date.UTC(2026, 8, 10, 1);
    return [
      { title: '日本央行加息25个基点，行长暗示继续收紧', url: 'https://example.com/nikkei/boj-1', source: 'Nikkei', publishedAt: t0 },
      { title: 'BOJ rate hike lifts JGB yields, yen strengthens', url: 'https://example.com/reuters/boj-2', source: 'Reuters', publishedAt: t0 + 3 * 3600 * 1000 },
    ];
  },

  /** 地震（natural_disaster 分类 + 影响链） */
  earthquake() {
    return [
      { title: 'Strong earthquake hits Tokyo area, no tsunami warning', url: 'https://example.com/jma/eq-1', source: 'JMA', publishedAt: Date.UTC(2026, 8, 10, 5) },
    ];
  },

  /** 无地理归属的市场快讯（global 桶用例） */
  globalMarket() {
    return [
      { title: 'Global stocks slide as bond yields climb worldwide', url: 'https://example.com/ft/global-1', source: 'FT', publishedAt: Date.UTC(2026, 8, 10, 7) },
      { title: 'World equities fall with bond yields on the rise', url: 'https://example.com/bloomberg/global-2', source: 'Bloomberg', publishedAt: Date.UTC(2026, 8, 10, 9) },
    ];
  },
};

if (typeof window !== 'undefined') window.EngineMockData = EngineMockData;
if (typeof module !== 'undefined' && module.exports) module.exports = EngineMockData;
