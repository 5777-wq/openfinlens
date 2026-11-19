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
# 推送目标（2026-11-19 monorepo 分支解耦，Phase 1.5）：采集产物不再直推 main——
# main 只保存代码，产物统一由 _scripts/push-data-branch.sh 写入 data 分支
# （read-tree FETCH_HEAD 增量保留 + commit-tree + 冲突重试），线上站点由
# deploy-pages.yml 把 main 与 data 分支拼装后发布。此前直推 main 的写法在切仓后
# 会被拼装逻辑无视，生产端事件流会静默停更——所以必须同步改造。
#
# 说明：
# - Polymarket 概率每 30 分钟窗口采一轮（gamma-api 国内大概率连不通：失败自动跳过，
#   Actions 侧每 30 分钟兜底采集，两边幂等不撞车）。
# - GDELT 国内服务器大概率连不通：collect-events.mjs 会自动降级为只用新浪财经7x24，
#   数据源标签随之变化，属预期；需要 GDELT 时给 cron 环境配 HTTPS_PROXY 即可（脚本继承）。
# - GitHub Actions 的 collect.yml 保留作备份（它跑得再慢也无害：无变化不提交；
#   两边写 data 分支都走 push-data-branch.sh 的增量保留与冲突重试，撞车概率极低，
#   撞上也只影响一轮，且互不覆盖对方的产物路径）。
# - main 的 pull --rebase 保留：只为了保持服务器 clone 的脚本本身新鲜（产物已不在
#   main 上，不会再有数据提交冲突）。
# - 依赖：Node ≥18、git、flock（util-linux，主流 Linux 自带）。

set -euo pipefail
# 仓库根从脚本自身位置推导（cron 的工作目录是 $HOME，不能用 git rev-parse 探测；
# 需要 Hack 时可设 OPENFINLENS_DIR 覆盖）
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "${OPENFINLENS_DIR:-$SCRIPT_DIR/..}"

# 防重入：上一轮没跑完就直接跳过（cron 每 2 分钟一跳，采集本身 ~30s）
exec 9>"/tmp/openfinlens-collect.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) 上一轮仍在进行，跳过"; exit 0; }

# 防御：历史版本可能遗留 rebase 中间态（push 重试冲突时没有 --abort），不清理的话
# 每轮 pull 都报 "unstaged changes" 直接退出，采集通道静默断更
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  git rebase --abort 2>/dev/null || true
  echo "$(date -u +%FT%TZ) 清理遗留 rebase 中间态"
fi

# 1. 对齐远端 main（保持脚本本身新鲜；产物已不在 main 上，不会再有数据提交冲突）
if ! git pull --rebase origin main; then
  echo "$(date -u +%FT%TZ) pull --rebase 失败，本轮放弃（下一轮重试）"
  exit 1
fi

# 2. 采集：GDELT（可达时）+ 新浪 7x24（国内可达）；全失败脚本自己退出 1 且不改旧文件
if ! node _scripts/collect-events.mjs; then
  echo "$(date -u +%FT%TZ) 采集失败，保留旧数据"
  exit 1
fi

# 2.5 Polymarket 事件概率：30 分钟一轮（窗口判断与 collect.yml 相同；cron */2 在窗口内
#     会重复触发，脚本幂等——内容无变化不写盘）。国内服务器连不通时失败跳过，不阻塞主流程。
H=$(date -u +%H); M=$(date -u +%M); MINS=$((10#$H * 60 + 10#$M))
if [ $(( MINS % 30 )) -lt 10 ]; then
  node _scripts/collect-polymarket.mjs || echo "$(date -u +%FT%TZ) polymarket 采集失败（保留旧数据，Actions 兜底）"
fi

# 3. 产物写入 data 分支（与 collect.yml / 未来 collect-meridian 共用同一实现；
#    无变化时脚本内部判 no changes 并退出 0，写失败重试 3 次后退出 1）
if ! bash "$SCRIPT_DIR/push-data-branch.sh" -m "data: refresh global events" \
     data/events/global-events.json data/events/polymarket.json; then
  echo "$(date -u +%FT%TZ) ✗ data 分支连续写入失败（检查服务器到 github.com 的连通性/PAT 是否过期）"
  exit 1
fi
echo "$(date -u +%FT%TZ) data 分支已更新"
