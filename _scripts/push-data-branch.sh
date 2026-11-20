#!/usr/bin/env bash
# push-data-branch.sh —— 采集产物写入 data 分支的唯一实现
# （collect.yml / server-collect.sh / 未来的 collect-meridian.yml 共用，避免三处各自维护）
#
# 为什么不用 worktree、也不能从空树重建：data 分支是所有采集链的公共地盘——
# collect.yml 写 data/events、data/actors、api/**，collect-meridian.yml 写 data/us-signals.json，
# 服务器通道写 data/events。每次从 --empty 重建会清掉别家产物（跨流水线覆盖 bug，
# 2026-11-19 Gemini 审查裁定）。正确做法：把基点树整体读进临时索引（read-tree FETCH_HEAD），
# 再只 add 本流水线负责的路径（-A 语义：新增/修改/删除都如实反映），其余文件原样保留。
#
# 用法：bash _scripts/push-data-branch.sh -m <提交信息> [-b <正文>] <产物路径...>
# 环境约定：
#   DATA_BRANCH   目标分支名（默认 data）
#   DATA_RETRY    冲突重试次数（默认 3）
#   RUNNER_TEMP   临时索引目录（Actions 提供；缺省 /tmp）
#   调用方自行设置 git user.name / user.email（CI 是 openfinlens-bot，服务器是 openfinlens-server，
#                 身份语义归调用方管，本脚本不代设）
# 产物路径说明：相对仓库根，与 data 分支内路径一致（Pages 按同路径拼装覆盖）。
#   路径从工作区读取——所以调用方必须先在仓库根跑完采集脚本再调本脚本。
# 退出码：0 = 成功或无语义变化；1 = 连续重试仍写入失败；2 = 用法错误
#
# 全程不动调用方的工作区与主索引：临时索引由 GIT_INDEX_FILE 指向独立文件，
# trap EXIT 保证清理。

set -u

DATA_BRANCH="${DATA_BRANCH:-data}"
DATA_RETRY="${DATA_RETRY:-3}"

MSG=""; BODY=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MSG="${2:?}"; shift 2 ;;
    -b) BODY="${2:-}"; shift 2 ;;   # BODY 允许空串（全绿轮无失败无跳过，2026-11-20 首次踩中）
    --) shift; break ;;
    -*) echo "[push-data] 未知参数 $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
if [ -z "$MSG" ]; then echo "[push-data] 缺少 -m 提交信息" >&2; exit 2; fi
if [ $# -eq 0 ]; then echo "[push-data] 缺少产物路径参数" >&2; exit 2; fi
PRODUCTS="$*"

TMP_INDEX="${RUNNER_TEMP:-/tmp}/push-data-branch.$$.index"
trap 'rm -f "$TMP_INDEX"' EXIT

HAS_BASE=0
PARENT=""
# fetch 必须放守卫里：data 分支尚不存在时 git 会报错，不能让脚本直接挂掉（孤儿首建路径）
if git fetch --quiet --depth=1 origin "refs/heads/$DATA_BRANCH" 2>/dev/null; then
  HAS_BASE=1
  PARENT=$(git rev-parse FETCH_HEAD)
fi

build_tree() {
  # 1) 初始化临时索引：有基点 → 整棵读入（增量保留别家采集链的产物）；
  #    无基点 → 空树（仅首次孤儿创建时）
  export GIT_INDEX_FILE="$TMP_INDEX"
  if [ "$HAS_BASE" = "1" ]; then
    git read-tree FETCH_HEAD
  else
    git read-tree --empty
  fi
  # 2) 只写本流水线负责的路径（-A：工作区没有而基点有的，按删除如实进树）
  for p in $PRODUCTS; do
    git add -A -- "$p"
  done
  TREE=$(git write-tree)
  unset GIT_INDEX_FILE
}

ok=0
i=0
while [ "$i" -lt "$DATA_RETRY" ]; do
  i=$((i + 1))
  build_tree
  if [ "$HAS_BASE" = "1" ] && [ "$TREE" = "$(git rev-parse FETCH_HEAD^{tree})" ]; then
    echo "no changes（产物树与 $DATA_BRANCH 基点一致，不产生提交）"
    ok=2
    break
  fi
  if [ "$HAS_BASE" = "1" ]; then
    if [ -n "$BODY" ]; then
      COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "$MSG" -m "$BODY")
    else
      COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "$MSG")
    fi
  else
    # 孤儿首建：分支尚不存在，无父提交
    if [ -n "$BODY" ]; then
      COMMIT=$(git commit-tree "$TREE" -m "$MSG" -m "$BODY")
    else
      COMMIT=$(git commit-tree "$TREE" -m "$MSG")
    fi
  fi
  if git push origin "$COMMIT:refs/heads/$DATA_BRANCH"; then
    ok=1
    break
  fi
  # 冲突（data 分支被并发推进）：必须重拉基点、重读树、重新 add——否则会把
  # 并发者刚写入的邻近文件覆盖回旧值
  echo "[push-data] $DATA_BRANCH 写入冲突（第 ${i} 次失败），重拉基点重试"
  if git fetch --quiet --depth=1 origin "refs/heads/$DATA_BRANCH" 2>/dev/null; then
    HAS_BASE=1
    PARENT=$(git rev-parse FETCH_HEAD)
  else
    HAS_BASE=0
    PARENT=""
  fi
done

if [ "$ok" = "0" ]; then
  echo "[push-data] ✗ $DATA_BRANCH 分支连续 $DATA_RETRY 次写入失败——产物未上远端" >&2
  exit 1
fi
exit 0
