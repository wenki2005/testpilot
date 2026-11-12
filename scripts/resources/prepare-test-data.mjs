#!/usr/bin/env node
/**
 * 准备回归所需业务数据：提交 2 张待审批申请。
 *
 * 用法：
 *   node scripts/resources/prepare-test-data.mjs --system <系统ID>
 *   node scripts/resources/prepare-test-data.mjs --system <系统ID> --base http://127.0.0.1:4323
 *
 * 作用：跑 1-050、1-039 两条提交用例，各自真实提交一单。
 * 跑完后：
 *   1. 提醒打印出「待审批」数量
 *   2. 请对应审批人处理：一单通过、一单驳回（驳回可选，用于驳回类用例）
 *
 * 注意：每条用例都会真实建单并给审批人发企微通知，这是预期行为。
 */
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = argOf('--base', 'http://127.0.0.1:4323');
const systemId = argOf('--system', process.env.TESTPILOT_SYSTEM_ID);
const api = `${base}/api/system-module-regression`;

if (!systemId) {
  console.error('缺少 --system（部门申样系统的系统 ID）。');
  process.exit(1);
}

const cases = ['xmind-1-050', 'xmind-1-039'];

const post = async (path, body) => {
  const res = await fetch(api + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body ?? {})
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} 失败：${JSON.stringify(json).slice(0, 200)}`);
  return json;
};

const catalog = await (await fetch(`${api}/case-editor?systemId=${systemId}`)).json();
const moduleId = catalog.cases.find((c) => c.id === cases[0])?.moduleId;
if (!moduleId) throw new Error('找不到提交类用例，请确认系统与用例库。');

console.log(`准备数据：提交 ${cases.length} 张申请（${cases.join('、')}）`);
const batch = await post('/batches', {
  systemId,
  moduleIds: [moduleId],
  requestId: crypto.randomUUID(),
  scope: 'custom',
  runMode: 'fixed',
  caseSelections: { [moduleId]: cases }
});

const deadline = Date.now() + 15 * 60 * 1000;
let final;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  final = await (await fetch(`${api}/batches/${batch.id}`)).json();
  if (final.phase === 'completed' || final.phase === 'interrupted') break;
}

const rows = [];
for (const job of final?.jobs ?? []) for (const r of job.results ?? []) rows.push(r);
const passed = rows.filter((r) => r.status === 'passed').length;
console.log(`批次 ${final?.phase}：通过 ${passed}/${rows.length}`);
for (const r of rows) console.log(`  ${r.caseId} [${r.status}] ${String(r.detail ?? '').slice(0, 60)}`);

console.log('');
console.log('下一步：');
console.log('  1. 让审批人在企业微信里处理这些新申请：');
console.log('     · 一张「同意」→ 用于已通过/待发货/取消类用例');
console.log('     · 一张「驳回」→ 用于驳回类用例（没有驳回需求可忽略）');
console.log('  2. 审批完成后直接跑回归，用例会按状态自动取最新一条，不需要改任何单号。');
