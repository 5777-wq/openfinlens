#!/usr/bin/env bash
# push-via-api.sh —— github.com:443 被墙时的推送通道（校验前置 + 调用执行端）
# 背景：git push 走 github.com:443 会被 GFW 间歇性阻断，而 gh CLI / api.github.com 往往仍通。
# 本脚本做 Git Data API 推送需要的前置校验（祖先校验在 bash 端做，node execSync 走 cmd.exe
# 会把 {commit} 尾缀和引号拆碎），再调 push-via-api.mjs 执行 blob/tree/commit/ref 四步。
# 用法：bash _scripts/push-via-api.sh
# 环境变量：REPO（默认 5777-wq/openfinlens）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REPO="${REPO:-5777-wq/openfinlens}"

REMOTE=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
echo "remote HEAD = $REMOTE"

# 祖先校验：沿远端 parent 链回溯，必须命中一个本地已知提交（cat-file 可找到）。
# 断网期 Actions/服务器的数据提交本地天然没有，跳过它们即可；远程积压的分叉/数据
# 提交可能很多，回溯深度给到 40（15 曾不够用），仍找不到则先 fetch 对齐。
cursor=$REMOTE
anchor=""
for i in $(seq 1 40); do
  if git cat-file -e "$cursor" 2>/dev/null; then anchor=$cursor; break; fi
  cursor=$(gh api "repos/$REPO/git/commits/$cursor" --jq '.parents[0].sha')
done
if [ -z "$anchor" ]; then
  echo "✗ 远端最近 40 个提交均不在本地历史：先 git fetch 并对齐后再推" >&2
  exit 1
fi
echo "本地已知祖先 = $anchor"

# 以远端 HEAD 的树为 base（本地未推的提交以 diff 形式重放，避免与远端新提交冲突）
BASE_TREE=$(gh api "repos/$REPO/git/commits/$REMOTE" --jq .tree.sha)

# --no-renames：R 行拆成 A+D，执行端只认 M/A/D
git diff --name-status --no-renames "$anchor" HEAD > .tmp-changes.txt

if [ ! -s .tmp-changes.txt ]; then
  echo "本地与远端已知祖先无差异 —— 无需推送（本地/远端 sha 分叉属 API 推送的预期，网络恢复后 hard reset 对齐）"
  exit 0
fi

node _scripts/push-via-api.mjs "$REMOTE" "$BASE_TREE" .tmp-changes.txt
