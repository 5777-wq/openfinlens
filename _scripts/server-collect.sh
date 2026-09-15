#!/usr/bin/env bash
# server-collect.sh —— 在自建服务器上跑全球事件采集并推送回仓库（替代被 GitHub 拖慢的 Actions 定时器）
#
# 背景：GitHub 对免费仓库的 schedule 高负载时延迟严重（实测 */5 被拖成 4~6 小时一次），
# 这是"最新事件 N 小时前"的主要根因。放到自己服务器上用 cron 每 2 分钟跑一次，
# 端到端延迟 = cron 2min + 推送 ~10s + Pages 部署 ~1min + 前端 60s 轮询 ≈ 2~5 分钟。
#
# 一次性部署（服务器上）：
#   1. clone（用有写权限的 PAT 免交互推送）：
#      git clone https://<YOUR_TOKEN>@github.com/5777-wq/openfinlens.git
#      cd openfinlens
#      git config user.name  "openfinlens-server"
#      git config user.email "server@users.noreply.github.com"
#   2. crontab -e 加一行（每 2 分钟）：
#      */2 * * * * /path/to/openfinlens/_scripts/server-collect.sh >> $HOME/openfinlens-collect.log 2>&1
#
# 说明：
# - GDELT 国内服务器大概率连不通：collect-events.mjs 会自动降级为只用新浪财经7x24，
#   数据源标签随之变化，属预期；需要 GDELT 时给 cron 环境配 HTTPS_PROXY 即可（脚本继承）。
# - GitHub Actions 的 collect.yml 保留作备份（它跑得再慢也无害：无变化不提交；两边都用
#   pull --rebase + 重试推送，撞车概率极低，撞上也只影响一轮）。
# - 依赖：Node ≥18、git、flock（util-linux，主流 Linux 自带）。

set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "${OPENFINLENS_DIR:?请在本仓库内运行或设 OPENFINLENS_DIR}")"

# 防重入：上一轮没跑完就直接跳过（cron 每 2 分钟一跳，采集本身 ~30s）
exec 9>"/tmp/openfinlens-collect.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) 上一轮仍在进行，跳过"; exit 0; }

# 1. 对齐远端（Actions 备份源仍可能提交）
if ! git pull --rebase origin main; then
  echo "$(date -u +%FT%TZ) pull --rebase 失败，本轮放弃（下一轮重试）"
  exit 1
fi

# 2. 采集：GDELT（可达时）+ 新浪 7x24（国内可达）；全失败脚本自己退出 1 且不改旧文件
if ! node _scripts/collect-events.mjs; then
  echo "$(date -u +%FT%TZ) 采集失败，保留旧数据"
  exit 1
fi

# 3. 有变化才提交推送；推送重试 5 次（每次 rebase 对齐远端可能的 Actions 提交）
git add data/events/global-events.json
if git diff --cached --quiet; then
  echo "$(date -u +%FT%TZ) no changes"
  exit 0
fi
git commit -q -m "data: refresh global events [skip ci]"
ok=0
for i in 1 2 3 4 5; do
  if git push origin main; then ok=1; break; fi
  git pull --rebase origin main || true
  sleep 10
done
if [ "$ok" != "1" ]; then
  echo "$(date -u +%FT%TZ) ✗ push 连续 5 次失败（检查服务器到 github.com 的连通性/PAT 是否过期）"
  exit 1
fi
echo "$(date -u +%FT%TZ) pushed"
