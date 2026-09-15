# 微信小程序壳（web-view 内嵌 H5）

目标：**网页项目本体零改动**，用小程序 `web-view` 组件内嵌现有看板页面。
本目录就是一个可直接用「微信开发者工具」打开的最小壳工程。

## 先看硬门槛（决定你能不能走这条路）

| 前提 | 说明 | 不满足的后果 |
|---|---|---|
| **非个人主体** | `web-view` 组件只对**企业 / 个体工商户等非个人主体**开放（需微信认证）；个人类型小程序不支持 | 个人主体无法走本方案（备选见文末） |
| **已备案 HTTPS 域名** | web-view 的 src 必须是「业务域名」：HTTPS + ICP 备案，且要在 mp 后台上传域名校验文件 | GitHub Pages 的 `*.github.io` 无法满足（不能备案、域名根不可控），所以**必须把项目部署到你自己的服务器域名下** |
| **内容合规** | 小程序场景**禁止展示加密货币行情**；金融类目可能要求资质 | 项目已预留合规开关：URL 带 `?crypto=off`（localStorage 持久化，一次生效）——壳工程已默认带上 |

## 上线步骤

1. **域名与备案**：准备一个域名并完成 ICP 备案（腾讯云服务器在腾讯云备案，约 1~2 周），
   DNS 解析到你的服务器（tencent-hermes）。
2. **服务器托管 H5**（nginx 示例）：
   ```nginx
   server {
     listen 443 ssl;
     server_name your.domain.com;
     ssl_certificate     /etc/ssl/your.domain.com.pem;   # Let's Encrypt 亦可
     ssl_certificate_key /etc/ssl/your.domain.com.key;
     root /var/www/openfinlens;

     location = /WW_verify_xxxx.txt { }                    # 微信业务域名校验文件放域名根目录
     location = /data/events/global-events.json {
       add_header Cache-Control "max-age=30";               # 事件 JSON 短缓存，吃采集提速
     }
     location / { try_files $uri $uri/ =404; }
   }
   ```
   网站文件用 `git pull` 保持更新（可与采集共用一个 cron，或每 5 分钟一次）；
   `_test/`、`_scripts/`、各 HTML 报告不必放进网站目录。
3. **配置业务域名**：mp.weixin.qq.com → 开发管理 → 开发设置 → 业务域名 → 下载校验文件
   → 上传到服务器域名根目录 → 填入域名保存。
4. **改壳工程里的域名**：`miniprogram/pages/webview/index.js` 顶部 `H5_URL`
   换成 `https://你的域名/openfinlens/?crypto=off&from=mp`。
5. **开发者工具上传**：微信开发者工具 → 导入项目 → 目录选本 `miniprogram/` →
   AppID 填你的（`project.config.json` 里替换 `touristappid`）→ 预览确认 → 上传 →
   mp 后台提交审核（类目建议：工具 > 信息查询；金融类目需资质，审核风险自负）。

## 合规注意（务必读）

- `?crypto=off` 会隐藏加密 tab/卡片/热力图/新闻（项目内置开关，`localStorage` 持久化），
  这是为小程序场景预留的——**壳 URL 必须保持带这个参数**。
- 证券行情/研报类内容在微信审核中属敏感类目，"信息查询工具"定位通常可过，
  但不要在小程序内出现"投资建议/喊单"措辞（项目文案已按此口径编写）。

## 个人主体的备选

- 直接把 H5 部署到备案域名，**手机浏览器访问 + 添加到桌面**（体验接近小程序，无需审核）；
- 或注册个体工商户主体（可微信认证，能开 web-view）后再走上面流程。
