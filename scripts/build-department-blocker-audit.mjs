import { readFileSync, writeFileSync } from 'node:fs';

const projectPath = 'artifacts/demo/document-tests/projects/624a5e81-e79e-493f-a746-8accc5c44b90.json';
const matrixPath = 'test-plans/department-sample-apply-v1.0-full-suite.json';
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
const latestRunId = '074bc5be-1ad8-4ef8-82b3-64493584b269';
let lastRun;
try { lastRun = JSON.parse(readFileSync(`artifacts/demo/document-tests/runs/${latestRunId}/run.json`, 'utf8')); } catch { lastRun = undefined; }
const scriptResults = new Map((lastRun?.deterministic?.results ?? []).map(item => [item.id, item]));
const visualResults = new Map((lastRun?.ai?.results ?? []).map(item => [item.id, item]));
const detail = {
  '本期范围外': ['out-of-scope', '保持取消勾选；不要进入本轮执行。'],
  '待澄清': ['clarify', '从原始需求确认明确的输入、状态和通过标准；再改写为可判定用例。'],
  '需测试环境/API/人工验证': ['api-or-integration', '先取得真实 OpenAPI/接口契约、隔离环境和可清理夹具；确认后映射到现有 API suite runner。缺接口资料时不虚构浏览器步骤。'],
  'UI 脚本待补': ['browser-planning', '由受限 BrowserStep planner 基于目标页生成操作和断言；需要账号或业务记录的用例改为 fixture/login 依赖。安全门通过后加入浏览器回归。'],
  '双通道只读 UI': ['browser-ready', '确定性脚本与 Computer Use 共用现有 Edge 会话执行并比较。'],
  '双通道只读/临时表单状态': ['browser-ready', '仅用合成输入验证前端状态；不点提交、保存、删除或外部发送。'],
};
const rows = matrix.cases.map((mapped, index) => {
  const id = `case-${index + 1}`;
  const actual = project.cases.find(item => item.id === id);
  const [lane, next] = detail[mapped.automationDisposition] ?? ['review', '核对来源、风险和状态依赖，然后决定执行通道。'];
  const script = scriptResults.get(id);
  const visual = visualResults.get(id);
  const trulyRunnable = actual?.steps?.length > 0 && actual.sideEffectRisk === 'none' && !(actual.preconditions?.length > 0 && actual.preconditionsConfirmed !== true) && actual.confidence !== 'low' && !mapped.expected.startsWith('[需澄清]');
  return {
    id, title: actual?.title ?? mapped.title, selected: actual?.selectedForRegression !== false,
    lane: trulyRunnable ? 'browser-ready' : lane,
    disposition: mapped.automationDisposition,
    deterministic: script?.status ?? 'not-run', computerUse: visual?.status ?? 'not-run',
    stepCount: actual?.steps?.length ?? 0, risk: actual?.sideEffectRisk ?? mapped.sideEffectRisk,
    preconditions: actual?.preconditions ?? mapped.preconditions,
    blocker: script?.status === 'blocked' ? script.detail : (!trulyRunnable ? (mapped.reason ?? '') : ''),
    nextAction: trulyRunnable ? '无需补步骤；纳入安全只读双通道运行。' : next,
  };
});
const groups = Object.groupBy(rows, row => row.lane);
const report = [
  '# 部门申样书用例阻塞原因与补齐清单', '',
  `数据源：项目 ${project.id}；完整矩阵 ${matrix.cases.length} 条；当前项目已选 ${rows.filter(item => item.selected).length} 条；最新全量运行 ${lastRun?.id ?? '未找到'}。`,
  `当前项目：${rows.filter(item => item.stepCount > 0).length} 条已有步骤，${rows.filter(item => !item.stepCount).length} 条缺步骤；运行门禁为确定性步骤 + 风险无副作用 + 前置条件满足 + 预期清晰。`, '',
  '## 分类汇总', '',
  ...Object.entries(groups).map(([lane, items]) => `- **${lane}**：${items.length} 条`), '',
  '## 逐条清单', '',
  ...rows.flatMap(item => [
    `### ${item.id}｜${item.title}`,
    `- 通道：${item.lane}；本轮${item.selected ? '选中' : '未选'}；脚本 ${item.deterministic}；Computer Use ${item.computerUse}。`,
    `- 步骤：${item.stepCount}；风险：${item.risk}；前置条件：${item.preconditions.length ? item.preconditions.join('；') : '无'}。`,
    `- 阻塞/处理说明：${item.blocker || '未阻塞'}；下一步：${item.nextAction}`,
    '',
  ]),
];
writeFileSync('test-plans/department-sample-apply-v1.0-blocker-audit.json', JSON.stringify({ projectId: project.id, latestRunId: lastRun?.id, summary: Object.fromEntries(Object.entries(groups).map(([lane, items]) => [lane, items.length])), cases: rows }, null, 2), 'utf8');
writeFileSync('test-plans/department-sample-apply-v1.0-blocker-audit.md', report.join('\n'), 'utf8');
console.log(JSON.stringify({ total: rows.length, selected: rows.filter(item => item.selected).length, withSteps: rows.filter(item => item.stepCount > 0).length, summary: Object.fromEntries(Object.entries(groups).map(([lane, items]) => [lane, items.length])), output: 'test-plans/department-sample-apply-v1.0-blocker-audit.md' }, null, 2));

