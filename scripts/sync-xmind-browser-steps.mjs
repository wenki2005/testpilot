import { readFile, writeFile } from 'node:fs/promises';

const projectId = '624a5e81-e79e-493f-a746-8accc5c44b90';
const suitePath = 'test-plans/department-sample-apply-v1.0-full-suite.json';
const suite = JSON.parse(await readFile(suitePath, 'utf8'));
const projects = await (await fetch('http://127.0.0.1:4317/api/document-projects')).json();
const project = projects.find(item => item.id === projectId);
if (!project) throw new Error(`Project ${projectId} was not found.`);
for (let i = 0; i < suite.cases.length; i++) {
  const item = suite.cases[i];
  const source = project.cases[i];
  if (!source || source.id !== `case-${i + 1}`) throw new Error(`Case order mismatch at XMind item ${i + 1}.`);
  item.steps = source.steps ?? [];
  item.executableStepStatus = item.steps.length ? source.sideEffectRisk === 'none' ? 'reviewed-safe-draft' : 'draft-needs-fixtures-or-risk-review' : 'missing';
  item.sideEffectRisk = source.sideEffectRisk;
  item.preconditions = source.preconditions ?? [];
  item.preconditionsConfirmed = source.preconditionsConfirmed;
}
await writeFile(suitePath, JSON.stringify(suite, null, 2), 'utf8');
const counts = suite.cases.reduce((acc, item) => { acc[item.executableStepStatus] = (acc[item.executableStepStatus] ?? 0) + 1; return acc; }, {});
const lines = ['# 部门申样书 V1.0 完整测试矩阵', '', `来源：${suite.sourceFile}`, `目标：${suite.targetUrl}`, `XMind 节点：${suite.sourceNodeCount}；末级检查项：${suite.caseCount}。`, '', '## 自动化步骤状态', '', ...Object.entries(counts).map(([key, count]) => `- ${key}：${count} 条`), '', 'AI 生成步骤仍需对照页面与测试数据审查；有步骤不代表可安全执行，也不代表测试已通过。', '', '## 全量检查项', ''];
for (const item of suite.cases) {
  lines.push(`### ${item.id}｜${item.title}`, '', `- 来源：${item.source}`, `- 优先级：${item.priority}；风险：${item.sideEffectRisk}；步骤状态：${item.executableStepStatus}`, `- 预期：${item.expected}`, `- 前置条件：${item.preconditions?.length ? item.preconditions.join('；') : '无'}`, `- 浏览器步骤：${item.steps.length ? JSON.stringify(item.steps) : '尚无受限浏览器步骤；需 API、沙箱夹具、澄清或测试能力扩展。'}`, '');
}
await writeFile('test-plans/department-sample-apply-v1.0-full-suite.md', lines.join('\n'), 'utf8');
console.log(JSON.stringify({ projectId, cases: suite.cases.length, stepStatusCounts: counts }));
