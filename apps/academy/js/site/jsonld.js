/* site/jsonld.js —— 结构化数据（JSON-LD）纯函数
   约定：不碰 DOM、不读 location、不发起请求。路由、参数、内容都由调用方传入，
   因此 Node 测试可以直接执行本文件并检查返回对象。

   API：
     window.JsonLd.build(route, params, data)
        route: 路由 id 字符串（'home' / 'concept' / 'term' / 'assets' …），
               也可以直接传 Router.current() 返回的 route 对象，或 '#/concept/inflation'。
        params: { id, q, … }，缺省时尝试从 route 字符串里解析。
        data:   该页已知内容，兼容 { article } / { meta } / { term } / 文章对象本身。
        return: 单个带 @context 的 JSON-LD 对象。
     window.JsonLd.serialize(obj)
        return: 可安全塞进 <script type="application/ld+json"> 的字符串——
                转义了 </script>（以及 <、U+2028/U+2029），JSON.parse 仍可还原。
*/
(function (root) {
  'use strict';

  var SITE_URL = (window.ACADEMY_SITE && window.ACADEMY_SITE.selfUrl) || 'https://5777-wq.github.io/openfinlens/academy/';
  var SITE_NAME = '白话金融 · OpenFin Academy';
  var SITE_SHORT = '白话金融';
  var LANG = 'zh-CN';

  var SECTION = {
    concepts: { name: '货币与利率', path: '/concepts' },
    crisis: { name: '危机复盘', path: '/crisis' },
    assets: { name: '标的百科', path: '/assets' },
    chains: { name: '产业链图谱', path: '/chains' },
    cycles: { name: '周期与镜鉴', path: '/cycles' },
    family: { name: '家庭理财', path: '/family' },
    reports: { name: '读懂财报', path: '/reports' },
    path: { name: '新手路径', path: '/path' },
    terms: { name: '术语库', path: '/terms' },
    data: { name: '速查表', path: '/data' },
  };

  /* 路由 id → 栏目键。Article 类路由需要知道正文属于哪个栏目。 */
  var ARTICLE_SECTION = {
    concept: 'concepts',
    'crisis-one': 'crisis',
    asset: 'assets',
    cycle: 'cycles',
    'family-one': 'family',
    report: 'reports',
  };

  function routeId(route) {
    if (!route) return '';
    if (typeof route === 'string') {
      var s = String(route).trim().replace(/^#/, '');
      if (s.charAt(0) === '/') {
        s = s.split('?')[0].split('/').filter(Boolean)[0] || 'home';
      }
      if (s === '') return 'home';
      return s;
    }
    if (typeof route === 'object') {
      if (typeof route.id === 'string') return route.id;
      if (route.route && typeof route.route.id === 'string') return route.route.id;
      if (typeof route.path === 'string') return routeId(route.path);
    }
    return '';
  }

  function routePathFromString(route) {
    if (typeof route !== 'string') return '';
    var s = String(route).trim();
    if (s.charAt(0) !== '#' && s.charAt(0) !== '/') return '';
    s = s.replace(/^#/, '').replace(/[?#].*$/, '');
    return s || '/';
  }

  function pathParam(route, name) {
    var p = routePathFromString(route);
    if (!p) return '';
    var segs = p.split('/').filter(Boolean);
    if (segs.length < 2) return '';
    try { return decodeURIComponent(segs[1]); } catch (e) { return segs[1]; }
  }

  function pickParam(params, route, name) {
    if (params && params[name] != null && params[name] !== '') return String(params[name]);
    if (typeof route === 'object' && route.params && route.params[name] != null) return String(route.params[name]);
    if (typeof route === 'string') return pathParam(route, name);
    return '';
  }

  function firstString() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  /** 从任意 data 形态里取文章元信息：data / data.article / data.meta 都行。 */
  function articleOf(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.article && typeof data.article === 'object') return data.article;
    if (data.meta && typeof data.meta === 'object') return data.meta;
    return data;
  }

  function termOf(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.term && typeof data.term === 'object') return data.term;
    if (data.meta && data.meta.term) return data.meta;
    return data;
  }

  function siteUrl(data) {
    if (data && typeof data.baseUrl === 'string' && /^https?:\/\//.test(data.baseUrl)) {
      return data.baseUrl.charAt(data.baseUrl.length - 1) === '/' ? data.baseUrl : data.baseUrl + '/';
    }
    return SITE_URL;
  }

  function hashUrl(base, path) {
    return base + '#' + (String(path).charAt(0) === '/' ? path : '/' + path);
  }

  function encoded(id) {
    try { return encodeURIComponent(String(id)); } catch (e) { return String(id); }
  }

  function breadcrumbList(base, items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map(function (item, i) {
        var node = {
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
        };
        if (item.path) node.item = item.path.charAt(0) === '#' ? base + item.path : hashUrl(base, item.path);
        return node;
      }),
    };
  }

  function website(base) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      alternateName: SITE_SHORT,
      url: base,
      description: '把美债收益率、黄金、纳指、原油、A股和 AI 产业链讲成金融小白听得懂的话。零后端、零密钥、零构建的金融科普站。',
      inLanguage: LANG,
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: base,
      },
    };
  }

  function breadcrumbFor(route, id, base, data) {
    var rid = routeId(route);
    var sectionKey = ARTICLE_SECTION[rid];
    var path = '';
    var name = '';

    if (sectionKey) {
      path = SECTION[sectionKey].path;
      name = firstString(
        data && data.sectionName,
        data && data.meta && data.meta.tag,
        SECTION[sectionKey].name,
      );
    } else if (rid === 'term') {
      path = '/terms';
      name = '术语库';
    } else if (rid === 'chain') {
      path = '/chains';
      name = '产业链图谱';
    } else if (SECTION[rid]) {
      path = SECTION[rid].path;
      name = SECTION[rid].name;
    } else if (rid === 'search') {
      path = '/search';
      name = '搜索';
    } else if (rid !== 'home') {
      path = '/' + rid;
      name = firstString(data && data.routeTitle, rid);
    }

    var items = [{ name: '首页', path: '/' }];
    if (path && path !== '/') items.push({ name: name || path, path: path });
    if (id) items.push({ name: id, path: path + '/' + encoded(id) });
    return items;
  }

  function article(base, route, params, data, id) {
    var a = articleOf(data);
    var rid = routeId(route);
    var sectionKey = ARTICLE_SECTION[rid];
    var section = SECTION[sectionKey] || { name: firstString(data && data.sectionName, '文章'), path: '/#' };
    var title = firstString(a.title, data && data.title, rid === 'asset' ? id : '', '文章');
    var desc = firstString(a.dek, a.description, data && data.description, '');
    var path = section.path + '/' + encoded(id);
    var url = firstString(data && data.url, hashUrl(base, path));
    var published = firstString(a.dataAsOf, a.datePublished, a.updatedAt, '');
    var modified = firstString(a.updatedAt, a.dataAsOf, a.dateModified, published);
    var breadcrumb = breadcrumbList(base, breadcrumbFor(route, id, base, data));

    var obj = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      name: title,
      url: url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: LANG,
      author: { '@type': 'Organization', name: SITE_NAME, url: base },
      publisher: { '@type': 'Organization', name: SITE_NAME, url: base },
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: base },
      breadcrumb: breadcrumb,
    };
    if (desc) obj.description = desc;
    if (published) obj.datePublished = published;
    if (modified) obj.dateModified = modified;
    if (a.tags && Array.isArray(a.tags) && a.tags.length) obj.keywords = a.tags.join(',');
    if (a.readMinutes) obj.timeRequired = 'PT' + Number(a.readMinutes) + 'M';
    return obj;
  }

  function definedTerm(base, params, data, id) {
    var t = termOf(data);
    var name = firstString(t.term, t.name, data && data.title, id, '术语');
    var desc = firstString(t.one, t.description, data && data.description, '');
    var url = firstString(data && data.url, hashUrl(base, '/term/' + encoded(id)));
    var obj = {
      '@context': 'https://schema.org',
      '@type': 'DefinedTerm',
      name: name,
      url: url,
      inLanguage: LANG,
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        name: SITE_NAME + ' · 术语库',
        url: hashUrl(base, '/terms'),
      },
    };
    if (desc) obj.description = desc;
    if (t.alias) obj.alternateName = String(t.alias);
    if (t.cat) obj.termCode = String(t.cat);
    return obj;
  }

  /** 入口：按路由返回一个 JSON-LD 对象；未知路由按 WebSite 兜底。 */
  function build(route, params, data) {
    var rid = routeId(route);
    var base = siteUrl(data);
    var id = firstString(
      pickParam(params, route, 'id'),
      data && data.id,
      data && data.article && data.article.id,
    );

    if (rid === 'term') return definedTerm(base, params, data, id);
    if (ARTICLE_SECTION[rid]) return article(base, route, params, data, id);
    if (rid === 'home') return website(base);

    // 栏目页 / 列表页 / 工具页：用面包屑表达层级；不伪造正文。
    var items = breadcrumbFor(route, '', base, data);
    if (items.length === 1 && rid !== 'search') {
      var sec = SECTION[rid];
      items = [{ name: '首页', path: '/' }, { name: sec ? sec.name : firstString(data && data.routeTitle, rid), path: '/' + rid }];
    }
    return breadcrumbList(base, items);
  }

  /** 安全序列化：JSON.parse 能还原，字符串里不会出现可提前闭合的 </script>。 */
  function serialize(obj) {
    if (obj === undefined) return 'null';
    var BS = String.fromCharCode(92);
    var LS = String.fromCharCode(0x2028);
    var PS = String.fromCharCode(0x2029);
    return JSON.stringify(obj)
      .replace(/</g, BS + 'u003c')
      .replace(/>/g, BS + 'u003e')
      .replace(/&/g, BS + 'u0026')
      .replace(new RegExp(LS, 'g'), BS + 'u2028')
      .replace(new RegExp(PS, 'g'), BS + 'u2029');
  }

  var JsonLd = {
    SITE_URL: SITE_URL,
    SITE_NAME: SITE_NAME,
    build: build,
    serialize: serialize,
    routeId: routeId,
  };

  root.JsonLd = JsonLd;
  if (typeof module !== 'undefined' && module.exports) module.exports = JsonLd;
})(typeof window !== 'undefined' ? window : globalThis);
