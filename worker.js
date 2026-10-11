/* worker.js —— Cloudflare Worker 代理（可选）
   用途：给需要自定义请求头的数据源补 Referer / UA（浏览器端 fetch 无法设置 Referer）。
   本看板默认全部直连即可运行；只有下列场景需要部署本代理：
     1) 想启用新浪源（hq.sinajs.cn 无 Referer 必 403）；
     2) 部署环境访问不到某些直连域名（如 api.binance.com / www.okx.com）。

   部署：
     wrangler deploy worker.js        （或在 Cloudflare 控制台粘贴）
   启用：
     在 index.html 的 js/proxy.js 之前加一行：
       <script>window.PROXY = 'https://<你的worker>.workers.dev/';</script>
*/

// 只允许代理这些域名，避免被当成开放代理滥用
const ALLOW_HOSTS = [
  'qt.gtimg.cn',
  'web.ifzq.gtimg.cn',
  'ifzq.gtimg.cn',
  'hq.sinajs.cn',
  'feed.mix.sina.com.cn',
  'push2.eastmoney.com',
  'push2delay.eastmoney.com',
  'push2his.eastmoney.com',
  'push2hisdelay.eastmoney.com',
  'searchapi.eastmoney.com',
  'search-codetable.eastmoney.com',
  'reportapi.eastmoney.com',
  'np-listapi.eastmoney.com',
  'api.binance.com',
  'api1.binance.com',
  'data-api.binance.vision',
  'www.okx.com',
  'aws.okx.com',
  'api.coinpaprika.com',
  'api.coingecko.com',
  'api.stlouisfed.org',
];

// 按目标站点补齐必要请求头
function headersFor(host) {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': '*/*',
  };
  if (host.includes('sina')) h.Referer = 'https://finance.sina.com.cn/';
  else if (host.includes('eastmoney')) h.Referer = 'https://quote.eastmoney.com/';
  else if (host.includes('gtimg')) h.Referer = 'https://gu.qq.com/';
  return h;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400 });

    let t;
    try { t = new URL(target); }
    catch { return new Response('bad url', { status: 400 }); }
    if (!/^https?:$/.test(t.protocol)) return new Response('bad scheme', { status: 400 });
    if (!ALLOW_HOSTS.includes(t.hostname)) {
      return new Response('host not allowed: ' + t.hostname, { status: 403 });
    }

    const cacheKey = new Request('https://gfd-proxy/' + encodeURIComponent(target), { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let res;
    try {
      res = await fetch(target, { headers: headersFor(t.hostname), redirect: 'follow' });
    } catch (e) {
      return new Response('upstream error: ' + e.message, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const body = await res.arrayBuffer();
    const out = new Response(body, {
      status: res.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        // 行情 10s、其余（新闻/研报）30s，缓解上游压力
        'Cache-Control': 'public, max-age=' + (t.hostname.includes('list') || t.hostname.includes('report') ? 30 : 10),
        // 保留上游 Content-Type（GBK 源必须原样透传，前端自己解码）
        'Content-Type': res.headers.get('Content-Type') || 'text/plain',
        'X-Proxy-Host': t.hostname,
      },
    });
    if (res.ok) await cache.put(cacheKey, out.clone());
    return out;
  },
};
