import { readFileSync, writeFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';

const runId = process.argv[2] ?? '63cf1846-8feb-437d-8724-8c491d6adad1';
const runDir = `artifacts/demo/document-tests/runs/${runId}`;
const runnerZip = readFileSync(`${runDir}/testpilot-package.zip`);
const runnerEntries = unzipSync(runnerZip);
const entries = {
  'README.md': strToU8([
    '# 部门申样书 V1.0 全量用例与本轮可执行包', '',
    '包含原始 XMind 的 156 条末级检查项、TestPilot 本轮报告和可执行回归脚本包。',
    `本轮已将原始 XMind 的 156 条用例全部交给 TestPilot 的确定性与 Computer Use 两条通道。逐条状态见 engine-run/report.md；blocked 表示工具没有完成该项验证，不能视为通过。`,
    '需要测试账号、接口 mock、管理员权限、库存/OA/ERP 的场景应在隔离测试环境运行；生产站点仅运行只读检查和不会提交的临时表单输入。',
    '本轮没有提交申请、保存数据、创建审批、锁单、下单或发货。', '',
  ].join('\n')),
  'full-suite/department-sample-apply-v1.0-full-suite.json': strToU8(readFileSync('test-plans/department-sample-apply-v1.0-full-suite.json', 'utf8')),
  'full-suite/department-sample-apply-v1.0-full-suite.md': strToU8(readFileSync('test-plans/department-sample-apply-v1.0-full-suite.md', 'utf8')),
  'full-suite/self-review.md': strToU8(readFileSync('test-plans/department-sample-apply-v1.0-self-review.md', 'utf8')),
  'engine-run/report.md': strToU8(readFileSync(`${runDir}/report.md`, 'utf8')),
};
for (const [name, bytes] of Object.entries(runnerEntries)) entries[`engine-run/playwright-package/${name}`] = bytes;
const output = `${runDir}/department-sample-apply-v1.0-complete-suite.zip`;
writeFileSync(output, zipSync(entries, { level: 6 }));
console.log(JSON.stringify({ output, files: Object.keys(entries).length, runnerFiles: Object.keys(runnerEntries) }));
