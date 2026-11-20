#!/usr/bin/env node
/* bump-assets.mjs —— 给 index.html 里的业务资源统一打版本号
   用法：node _scripts/bump-assets.mjs [版本号]
        （不给版本号就用今天：YYYYMMDD）

   为什么需要：静态托管（GitHub Pages）会给 js/css 设缓存头，发布之后
   用户可能最长十分钟拿到旧文件——内容页看着对，行为却是旧的（分类数、
   词条顺序这类改动尤其难察觉）。给每个业务资源挂一个 ?v= 版本号，
   改版时 bump 一次，浏览器就会重新拉。

   纪律：
   · 所有业务资源（css/ 与 js/ 下的文件）版本号必须**同一个**——
     不统一就等于有的文件刷新了、有的没刷新，比不 bump 还难查。
   · vendor 的第三方库不参与：它们的 ?v= 是锁定的语义化版本，不能被业务版本覆盖。
   · 脚本本身不做检查，只做改写；一致性由 _test/run-all.mjs 断言。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');

const arg = process.argv[2];
const version = /^\d{8}$/.test(arg || '') ? arg : new Date().toISOString().slice(0, 10).replace(/-/g, '');

let html = readFileSync(INDEX, 'utf8');

// 业务资源：css/… 与 js/…，以及 vendor/core/…（从 OpenFinLens 同步来的副本，
// 它们也会随同步改动，同样要能被浏览器重新拉——不然就是「改了没生效」）
// 注意：文件名部分不能把已有的 ?v= 一起吃掉，否则会变成 xxx.js?v=old?v=new
let touched = 0;
html = html.replace(/(href|src)="((?:css|js|vendor\/core)\/[^"?]+)(\?v=[^"]*)?"/g, (m, attr, file) => {
  touched++;
  return `${attr}="${file}?v=${version}"`;
});

writeFileSync(INDEX, html, 'utf8');
console.log(`[bump-assets] ${touched} 个业务资源 → ?v=${version}`);
