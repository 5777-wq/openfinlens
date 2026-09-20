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
# 2026-09-20：Actions 数据提交加密后 40 步远不够（一次网络调用一跳太浪费），
# 改为批量拉提交清单（每页 100、最多 5 页 = 500 深度）逐个对本地 cat-file 校验。
anchor=""
for page in 1 2 3 4 5; do
  SHAS=$(gh api "repos/$REPO/commits?sha=main&per_page=100&page=$page" --jq '.[].sha')
  [ -z "$SHAS" ] && break
  while read -r c; do
    [ -z "$c" ] && continue
    if git cat-file -e "$c" 2>/dev/null; then anchor=$c; break 2; fi
  done <<< "$SHAS"
done
if [ -z "$anchor" ]; then
  echo "✗ 远端最近 500 个提交均不在本地历史：先 git fetch 并对齐后再推" >&2
  exit 1
fi
echo "本地已知祖先 = $anchor"

# 以远端 HEAD 的树为 base（本地未推的提交以 diff 形式重放，避免与远端新提交冲突）
BASE_TREE=$(gh api "repos/$REPO/git/commits/$REMOTE" --jq .tree.sha)

# --no-renames：R 行拆成 A+D，执行端只认 M/A/D
git diff --name-status --no-renames "$anchor" HEAD > .tmp-changes.txt.raw

if [ ! -s .tmp-changes.txt.raw ]; then
  echo "本地与远端已知祖先无差异 —— 无需推送（本地/远端 sha 分叉属 API 推送的预期，网络恢复后 hard reset 对齐）"
  rm -f .tmp-changes.txt.raw
  exit 0
fi

# 内容去重：远端树上已与本地逐字节一致的文件不必重传。
# 为什么需要：API 推送产生的远端提交不在本地对象库里，祖先校验只能回退到更老的提交
# （典型是上一次 git fetch 到的那个），于是每次推送都会把"历史上所有改动"重新上传一遍——
# 内容虽然等价，但白传几十个 blob、远端提交的 diff 也永远是全量。
# 判据用 git blob sha：本地 git hash-object，远端取 base_tree 的递归清单，相同即跳过。
REMOTE_TREE=$(gh api "repos/$REPO/git/trees/$BASE_TREE?recursive=1" \
  --jq '.tree[] | select(.type=="blob") | "\(.sha)\t\(.path)"')
: > .tmp-changes.txt
skipped=0
while IFS=$'\t' read -r st p; do
  [ -z "$st" ] && continue
  [ "$st" = "D" ] && { printf '%s\t%s\n' "$st" "$p" >> .tmp-changes.txt; continue; }
  # --no-filters 是必须的：不加时 git hash-object 会对路径做属性/EOL 转换（本仓库 autocrlf=true
  # 且为 CRLF/LF 混合），而 mjs 上传的是 readFileSync 的原始字节 —— 两者 sha 永远不等，去重会全部失效。
  local_sha=$(git hash-object --no-filters "$p")
  remote_sha=$(printf '%s\n' "$REMOTE_TREE" | awk -F'\t' -v path="$p" '$2==path {print $1; exit}')
  if [ "$local_sha" = "$remote_sha" ]; then skipped=$((skipped + 1)); continue; fi
  printf '%s\t%s\n' "$st" "$p" >> .tmp-changes.txt
done < .tmp-changes.txt.raw
rm -f .tmp-changes.txt.raw
echo "内容去重：跳过 $skipped 个远端已一致的文件"

if [ ! -s .tmp-changes.txt ]; then
  echo "全部改动远端已有一致内容 —— 无需推送"
  exit 0
fi

if node _scripts/push-via-api.mjs "$REMOTE" "$BASE_TREE" .tmp-changes.txt; then
  exit 0
fi

# —— 逐文件兜底 ——
# 已知偶发：多文件 tree 一次创建会 422 GitRPC::BadObjectState（历史三次复现；单文件
# 推送全部成功，是文件组合触发的服务端问题，且原样重试永远复现）。
# 对策：拆成每文件一个远端提交，逐个推进 remoteHead/baseTree。代价是 API 提交的
# message 只能统一取本地 HEAD 的（API 提交 sha 本就与本地不同，网络恢复后
# pull --rebase 对齐一次即可）。中途失败就停：已推的文件下次靠内容去重跳过，
# 重跑本脚本自动续推剩余部分。
echo "多文件树被 422 拒绝，拆成逐文件推送…"
n=0
total=$(grep -c . .tmp-changes.txt)
while IFS=$'\t' read -r st p; do
  [ -z "$st" ] && continue
  REMOTE=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
  BASE_TREE=$(gh api "repos/$REPO/git/commits/$REMOTE" --jq .tree.sha)
  printf '%s\t%s\n' "$st" "$p" > .tmp-changes-one.txt
  if node _scripts/push-via-api.mjs "$REMOTE" "$BASE_TREE" .tmp-changes-one.txt; then
    n=$((n + 1)); echo "  [$n/$total] $st $p ✓"
  else
    echo "✗ $p 仍被拒——停止；剩余清单保留在 .tmp-changes.txt，重跑本脚本自动续推" >&2
    exit 1
  fi
  sleep 1
done < .tmp-changes.txt
rm -f .tmp-changes-one.txt
echo "逐文件兜底完成：$n/$total"
