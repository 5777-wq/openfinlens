# 自建服务器采集全球事件（替代被拖慢的 GitHub Actions 定时器）

## 为什么

`collect.yml` 的 cron 是 `*/5`，但 GitHub 对免费仓库的 schedule 高负载时**延迟严重**——
实测 2026-09-14~15 的实际运行间隔为 4~6 小时（00:33 / 22:06 / 18:45 / 13:22 / 06:44）。
采集跑得晚，数据就旧："最新事件 N 小时前"主要是这个原因。把采集搬到自己的服务器上
用 cron 每 2 分钟跑一次，端到端延迟（事件发生 → 页面可见）约 **2~5 分钟**。

## 服务器要求

- Linux + Node ≥ 18 + git + flock（util-linux，主流发行版自带）
- 一个有本仓库写权限的 GitHub PAT（Settings → Developer settings → Tokens，勾 `repo`）
- 网络：新浪财经 7x24 必须可达（这是主源之一）；GDELT 国内服务器大概率不可达——
  脚本会自动降级为只用新浪（页面数据源标签随之变为"新浪财经7x24"，属预期）。

## 部署步骤

```bash
# 1. clone（URL 里带 PAT，推送免交互；PAT 泄漏风险自担，建议用细粒度短有效期 token）
git clone https://<YOUR_TOKEN>@github.com/5777-wq/openfinlens.git
cd openfinlens
git config user.name  "openfinlens-server"
git config user.email "server@users.noreply.github.com"

# 2. 手动跑一次验证
bash _scripts/server-collect.sh
#   期待输出：[gdelt]/[sina] 条数 → 写入 ... → pushed

# 3. 加入 crontab（每 2 分钟）
crontab -e
# 新增一行：
*/2 * * * * /path/to/openfinlens/_scripts/server-collect.sh >> $HOME/openfinlens-collect.log 2>&1
```

## 行为说明

- **防重入**：flock 锁，上一轮没跑完直接跳过（采集本身约 30 秒）。
- **对齐远端**：每轮先 `git pull --rebase`——GitHub Actions 的 collect.yml 保留作备份，
  它跑得再慢也无害（无变化不提交；两边都带 rebase + 重试推送）。
- **降级**：GDELT 不可达 → 只用新浪；**全部来源失败 → 不改旧文件、退出 1**（宁缺毋假）。
- **需要 GDELT**（海外服务器或给国内服务器配代理）：给 cron 环境设 `HTTPS_PROXY`，
  脚本内的 fetch 会继承。
- **关掉 Actions 备份源**（可选）：仓库网页 → Actions → collect → ⋯ → Disable workflow。
  不关也无害。

## 延迟链（部署后）

事件发生 → 服务器 cron（≤2 min）→ 采集+推送（~30s）→ Pages 部署（~1 min）→
前端 60s 轮询（停在事件页时）→ **端到端 ≈ 2~5 分钟**。

## 未来：把网站也搬到自己服务器

网站本身是纯静态目录，nginx 直接托管即可。注意两点：
1. 对 `data/events/global-events.json` 设 `add_header Cache-Control "max-age=30"`（或 no-cache），
   否则 nginx 缓存会吃掉采集提速；
2. 采集脚本直写 webroot 后甚至可以不经过 GitHub（进一步改造再议）。
