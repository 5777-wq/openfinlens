# Third-party vendored libraries

All loaded locally. No runtime CDN.

| File | Package | Version | License | Upstream |
|---|---|---|---|---|
| `lib/lightweight-charts.standalone.production.js` | lightweight-charts | 4.2.3 | Apache-2.0 | github.com/tradingview/lightweight-charts |
| `lib/topojson-client.min.js` | topojson-client | 3.1.0 | ISC | github.com/topojson/topojson-client |
| `lib/d3-geo.min.js` | d3-geo | 3.1.1 | ISC | github.com/d3/d3-geo |
| `lib/d3-array.min.js` | d3-array（d3-geo 的外部依赖） | 3.2.4 | ISC | github.com/d3/d3-array |
| `assets/globe/countries-110m.json` | world-atlas (Natural Earth 110m) | 2.0.2 | ISC (data: public domain Natural Earth) | github.com/topojson/world-atlas |
| `assets/icons/crypto/*` | cryptocurrency icon set | — | MIT | (see assets/icons/crypto) |

## Removed

| File | Package | Note |
|---|---|---|
| `lib/globe.gl.min.js` | globe.gl 2.46.2 | 2026-09-14 随 3D 地球下线移除（用户决策：事件页只留平面地图）；文件不再被引用 |
