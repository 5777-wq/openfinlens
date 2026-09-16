/* _scripts/push-via-api.mjs —— github.com:443 被墙时经 gh CLI 推送的 API 执行端
   祖先校验与变更清单由 push-via-api.sh（bash）完成；本文件只做：
   D 走 Contents API 逐个删除 → A/M blob 上传 → 建树 → commit → fast-forward ref。
   用法：node _scripts/push-via-api.mjs <remoteHead> <baseTree> <changesFile>
   changesFile 行格式：<status>\t<path>（status 为 M/A/D） */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const REPO = '5777-wq/openfinlens';
const [remoteHead, baseTree, changesFile] = process.argv.slice(2);
if (!remoteHead || !baseTree || !changesFile) { console.error('usage: node push-via-api.mjs <remoteHead> <baseTree> <changesFile>'); process.exit(1); }

const api = (path, method, bodyObj) => {
  const tmp = '.tmp-api-body.json';
  writeFileSync(tmp, JSON.stringify(bodyObj || {}));
  try {
    const m = method || 'GET';
    return JSON.parse(execSync(`gh api ${m === 'GET' ? '' : `--method ${m} --input ${tmp}`} "${path}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } finally { try { unlinkSync(tmp); } catch { /* ignore */ }
  }
};

const lines = readFileSync(changesFile, 'utf8').split('\n').filter(Boolean);
if (!lines.length) {
  console.log('changesFile 为空 —— 本地与远端已知祖先无差异，无需推送');
  process.exit(0);
}

/* D（删除）不能走 tree 的 sha:null 条目：本仓库实测恒 422 GitRPC::BadObjectState。
   历史上误诊为"多文件组合触发"——失败批次恰好都含 D，成功的都是纯 A/M，单个 D 也复现。
   改走 Contents API 逐个删除（GitHub 自己接在当前 HEAD 上独立成 commit），
   再把 A/M 打成一个 tree commit。远端没有的目标文件视为已删除，跳过。 */
let headSha = remoteHead;
for (const line of lines.filter(l => l.startsWith('D\t'))) {
  const p = line.slice(2).trim();
  const enc = encodeURIComponent(p).replace(/%2F/gi, '/');
  let cur = null;
  try { cur = api('/repos/' + REPO + '/contents/' + enc, 'GET'); }
  catch { console.log('  delete', p, '—— 远端不存在，跳过'); continue; }
  api('/repos/' + REPO + '/contents/' + enc, 'DELETE',
    { message: 'delete ' + p + ' [skip ci]', sha: cur.sha, branch: 'main' });
  console.log('  deleted', p);
}
if (lines.some(l => l.startsWith('D\t'))) headSha = api('/repos/' + REPO + '/git/ref/heads/main').object.sha;
// base_tree 必须取"当前"HEAD 的树：有删除时远端树已变，调用方传入的 baseTree 已过期
const baseTreeNow = headSha === remoteHead
  ? baseTree
  : api('/repos/' + REPO + '/git/commits/' + headSha).tree.sha;

const tree = [];
for (const line of lines) {
  const tab = line.indexOf('\t');
  const status = line.slice(0, tab).trim();
  const p = line.slice(tab + 1).trim();
  if (status === 'D') continue;   // 已走 Contents API
  if (!/^[AM]$/.test(status)) {
    // R/C（重命名/复制）应由上游 .sh 用 --no-renames 拆成 A+D；出现即说明清单格式不对
    console.error('✗ 不支持的变更状态行（预期 M/A/D）: ' + line);
    process.exit(1);
  }
  const blob = api('/repos/' + REPO + '/git/blobs', 'POST',
    { content: readFileSync(p).toString('base64'), encoding: 'base64' });
  tree.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('  blob', status, p, blob.sha.slice(0, 8));
}

if (!tree.length) {
  console.log('只有删除、无 A/M 变更 —— 完成');
  process.exit(0);
}

const newTree = api('/repos/' + REPO + '/git/trees', 'POST', { base_tree: baseTreeNow, tree });
console.log('tree =', newTree.sha);

const localMsg = execSync('git log -1 --format=%B', { encoding: 'utf8' });
const commit = api('/repos/' + REPO + '/git/commits', 'POST', {
  message: localMsg,
  tree: newTree.sha,
  parents: [headSha],
  author: {
    name: execSync('git log -1 --format=%an', { encoding: 'utf8' }).trim(),
    email: execSync('git log -1 --format=%ae', { encoding: 'utf8' }).trim(),
    date: execSync('git log -1 --format=%aI', { encoding: 'utf8' }).trim(),
  },
  committer: {
    name: execSync('git log -1 --format=%cn', { encoding: 'utf8' }).trim(),
    email: execSync('git log -1 --format=%ce', { encoding: 'utf8' }).trim(),
    date: execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim(),
  },
});
console.log('commit =', commit.sha);

const upd = api('/repos/' + REPO + '/git/refs/heads/main', 'PATCH', { sha: commit.sha, force: false });
console.log('ref updated →', upd.object.sha);
console.log('NOTE: 本地提交与远端提交 sha 不同（同内容不同对象），后续网络恢复后请 '
  + '`git pull --rebase` 对齐一次。');
