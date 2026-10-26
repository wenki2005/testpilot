import fs from 'node:fs';
import path from 'node:path';
import { validateCases } from '../src/adapters/document-test-workflow.ts';

const root = process.cwd();
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const suite = read('test-plans/department-sample-apply-v1.0-full-suite.json');
const audit1 = read('test-plans/department-sample-apply-cases-1-79-repair-report.json');
const audit2 = read('test-plans/department-sample-apply-v1.0-step-audit-80-156.json');
const baseline = read('output/target-full-run-2026-10-18.json');
const currentProject = read('artifacts/demo/document-tests/projects/624a5e81-e79e-493f-a746-8accc5c44b90.json');
const detailed = fs.readFileSync(path.join(root, 'test-plans/department-sample-apply-v1.0-run-074bc5be-analysis.md'), 'utf8');
const diagnosis = fs.readFileSync(path.join(root, 'output/blocked-cases-156-diagnosis-2026-10-18.md'), 'utf8');

const a1 = new Map(audit1.cases.map(c => [Number(c.id.replace('xmind-', '')), c]));
const a2 = new Map(audit2.cases.map(c => [Number(c.id.replace('xmind-', '')), c]));
const runByLane = (lane) => new Map((baseline[lane]?.results ?? []).map(r => [Number(r.id.replace('case-', '')), r]));
const deterministic = runByLane('deterministic');
const visual = runByLane('ai');
const currentProjectCases = new Map(currentProject.cases.map(c => [Number(c.id.replace('case-', '')), c]));
const baselineRun = '7ba26500-8f6e-4717-abfb-8a6b523795c7';
const actions = new Set(['assertText','assertVisible','assertNotVisible','assertExactVisible','assertRoleVisible','assertRoleDisabled','assertMaxLengthOrMessage','assertValue','assertDisabled','assertFieldInvalid','assertNoFetchOrXhr','assertNoHorizontalOverflow','setViewport','fillByLabel','selectByLabel','clickByRole','clickExactText','startFetchOrXhrCapture']);
const danger = /submit|save|delete|remove|approve|cancel order|lock|shipment|dispatch|stock|inventory|send.*message|create order|订单|审批|出库|库存|推送|提交|保存|删除|锁单|发货|撤回|退单/i;
const clarifIds = new Set([3,5,16,20,23,28,36,71,72,76,118,120,131,156]);
const naIds = new Set([16,95,102]);

function uniqueSteps(steps) {
  const seen = new Set();
  return (steps ?? []).filter(s => {
    const k = JSON.stringify(s);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function routeFor(c, audit, n) {
  if (naIds.has(n)) return { category: 'N/A', route: 'exclude-with-reason', blocker: '原需求明确标记本期不做/已排除；保留追踪，不进入通过率。', unblock: '无需解阻；若范围变更，产品补充版本及验收标准后重新纳入。' };
  if (clarifIds.has(n) || audit?.status === 'not_executable_until_requirement_clarified' || audit?.classification === 'clarification-required') return { category: '待澄清', route: 'manual-product-decision', blocker: audit?.reason ?? '需求文本含“待澄清”或缺少唯一验收口径。', unblock: '产品负责人确认规则、边界值、预期状态/文案，并更新需求基线。' };
  const rawClass = audit?.classification ?? '';
  // Ignore the importer's generic API/mock boilerplate; it is not a verified case prerequisite.
  const requirementText = `${c.title} ${c.expected}`;
  const text = `${requirementText} ${audit?.remainingGap ?? audit?.gap ?? ''}`;
  const hasUI = Boolean(audit?.steps?.length || audit?.proposedReadOnlyDslSteps?.length);
  const gap = audit?.remainingGap ?? audit?.gap ?? '';
  const hasApi = /API|后端|服务端|数据库|事务|并发|迁移|接口|回调|库存|消息|企微|易诚通|旺店通|易查单|配置正确/i.test(requirementText);
  const role = /指定身份|测试账号|权限|无权限|非本公司|管理员|未登录|越权|token|授权|身份判定|非发起人|分享纯URL/i.test(requirementText);
  const data = /订单|申请记录|历史|迁移前|fixture|记录|数据|匹配|物流|商品|图书|库存|分页|筛选|搜索/i.test(text);
  const effects = danger.test(requirementText) || c.sideEffectRisk === 'irreversible';
  const auditPartial = ['partial','partial-ui-plus-named-gap','partialUiWithNamedGap'].includes(rawClass) || audit?.status === 'partial';
  const auditedComplete = rawClass === 'safe' || rawClass === 'safe-browser-assertable' || audit?.classification === 'safeBrowserAssertable';
  if (auditedComplete) return { category: '完整 UI 只读', route: 'deterministic-browser', blocker: '', unblock: '无需新增夹具；草稿仍须在登录目标页核对定位器和断言后审批执行。' };
  if (auditPartial) {
    return { category: '可安全执行的部分 UI', route: 'deterministic-browser-partial-plus-prerequisite', blocker: gap || '现有断言只覆盖部分可见 UI，完整验收仍需补充有证据支持的状态/数值断言。', unblock: `先仅执行下面列出的只读子断言，并将结果标记为 partial；按逐条缺口补齐真实数据、身份、API 或 DSL 能力后，再为原验收点增加完整断言。缺口：${gap || '需重新核对 XMind 原文和目标状态。'}` };
  }
  const isPrereq = (n <= 79 && audit1.caseGroups.prerequisite.includes(`xmind-${n}`)) || rawClass === 'apiDataOrSideEffectPrerequisite' || rawClass === 'api_data_or_business_fixture_prerequisite' || rawClass === 'prerequisite';
  if (isPrereq || hasApi || role || effects) {
    const kind = role ? '角色/认证夹具前置' : hasApi ? 'API/后端/服务夹具前置' : '数据/副作用夹具前置';
    const unblock = role ? '提供专用可复用的授权/未授权测试账号或受控认证 mock、预期身份；不要切换/清理当前登录会话。' : hasApi ? '提供接口契约、隔离沙箱、合成数据、可查日志/读回断言及回滚/清理方案；建立 API lane。' : '提供隔离环境、专用合成数据、触发路径、可验证副作用以及恢复/清理契约，经审批后执行。';
    return { category: kind, route: role ? 'role-fixture' : hasApi ? 'api-contract-and-sandbox' : 'isolated-data-fixture', blocker: gap || '审计确认该项依赖未提供的账号、数据、接口或副作用隔离条件。', unblock };
  }
  return { category: '数据/API/角色前置', route: 'named-prerequisite', blocker: gap || '既无证据支持安全可执行的浏览器步骤，也未给出足够的业务值/前置状态。', unblock: `按需求补齐${role ? '测试角色、' : ''}${data ? '合成记录/期望值、' : ''}${hasApi ? '接口契约/日志证据、' : ''}目标页面入口与清理方式后再写完整脚本。` };
}

const cases = suite.cases.map((c, i) => {
  const n = i + 1;
  const authoritative = currentProjectCases.get(n);
  const audit = n <= 79 ? a1.get(n) : a2.get(n);
  const route = routeFor(c, audit, n);
  let drafted = n <= 79 ? (audit?.steps ?? []) : (audit?.proposedReadOnlyDslSteps ?? audit?.existingDraftSteps ?? []);
  if (!drafted.length) drafted = c.steps ?? [];
  drafted = uniqueSteps(drafted);
  const invalidActions = drafted.filter(s => !actions.has(s.action)).map(s => s.action);
  const likelySideEffect = drafted.some(s => ['clickByRole','clickExactText','fillByLabel','selectByLabel'].includes(s.action)) && drafted.some(s => danger.test(`${s.text ?? ''} ${s.label ?? ''} ${s.name ?? ''}`));
  const det = deterministic.get(n) ?? null;
  const vis = visual.get(n) ?? null;
  const evidence = audit?.evidenceRefs ?? (n >= 80 ? ['逐条步骤审计 80–156','XMind 完整用例基线'] : ['逐条步骤修复审计 1–79','历史页面截图/独立 E2E 证据（按 case audit refs）']);
  return {
    id: c.id, ordinal: n, title: c.title, source: c.source, priority: c.priority, category: c.category,
    expected: c.expected, sourceSuiteSteps: c.steps ?? [], authoritativeProjectSteps: authoritative?.steps ?? [], sourceSteps: authoritative?.steps ?? [], proposedSteps: drafted,
    proposedStepsOrigin: audit ? (n <= 79 ? 'cases-1-79-repair-audit' : 'steps-audit-80-156') : 'source-suite-existing-steps',
    classification: route.category, lane: route.route, blocker: route.blocker, unblockAction: route.unblock,
    preconditions: c.preconditions ?? [], preconditionsConfirmed: c.preconditionsConfirmed ?? false,
    testData: c.testData ?? [], risk: c.sideEffectRisk ?? 'unknown', cleanup: c.cleanup ?? '',
    coverageGap: audit?.remainingGap ?? audit?.gap ?? c.coverageGap ?? '', evidenceRefs: evidence,
    baseline: { runId: baselineRun, deterministic: det ? { status: det.status, detail: det.detail ?? '' } : null, visual: vis ? { status: vis.status, detail: vis.detail ?? '' } : null },
    draftValidation: { supportedDslActions: [...new Set(drafted.map(s => s.action))], unsupportedActions: [...new Set(invalidActions)], hasBusinessAssertion: drafted.some(s => s.action.startsWith('assert')), readOnlyOnly: !drafted.some(s => ['clickByRole','clickExactText','fillByLabel','selectByLabel'].includes(s.action)), sideEffectActionNeedsReview: likelySideEffect, approvedForExecution: false },
  };
});

const validationInput = cases.filter(c => c.proposedSteps.length).map(c => ({
  id: c.id, title: c.title, source: c.source, requirementRefs: [c.source], priority: ['P0','P1','P2','P3'].includes(c.priority) ? c.priority : 'P2',
  category: ['authorization','functional','input-validation','resilience','other'].includes(c.category) ? c.category : 'other',
  confidence: 'medium', coverageAreas: [(['authorization','functional','input-validation','resilience','other'].includes(c.category) ? c.category : 'other')],
  selectedForRegression: true, preconditions: c.preconditions, preconditionsConfirmed: false, testData: c.testData, sideEffectRisk: c.risk,
  cleanup: c.cleanup, kind: 'visible', expected: c.expected.slice(0,300), steps: c.proposedSteps,
}));
let validatedDrafts = [];
let dslValidationErrors = [];
const validatedByInputId = new Map();
try { validatedDrafts = validateCases(validationInput); }
catch (error) {
  // Validate each case separately so every invalid draft remains traceable.
  for (const item of validationInput) {
    try { const [checked] = validateCases([item]); validatedDrafts.push(checked); validatedByInputId.set(item.id, checked); }
    catch (caseError) { dslValidationErrors.push({id:item.id,error:String(caseError)}); }
  }
}
if (validatedDrafts.length === validationInput.length) validationInput.forEach((item, index) => validatedByInputId.set(item.id, validatedDrafts[index]));
const validatedIds = new Set(validatedByInputId.keys());
const genericShell = /^(?:小额样书申请|部门样书|样书申请|申请表单|本人申领|收货信息|基本信息|样书明细|我的申请|订单|订单列表|我的|个人信息|申请记录|历史申请|申请详情)$/;
function assertionQuality(c) {
  const assertions = c.proposedSteps.filter(s => s.action.startsWith('assert'));
  const expectation = c.expected;
  const specific = assertions.filter(s => {
    const text = s.text ?? s.label ?? s.name ?? '';
    if (!text || genericShell.test(text.trim())) return false;
    if (s.action === 'assertFieldInvalid') return /标红|变红|红色|无效|校验|拦截|错误|禁止|输入|格式|范围|必填|上限|下限/i.test(expectation);
    if (s.action === 'assertRoleVisible' || s.action === 'assertRoleDisabled') return expectation.includes(s.name) && /入口|按钮|控件|不展示|展示|可见|禁用|置灰/i.test(expectation);
    if (s.action === 'assertValue') return expectation.includes(s.label) && (expectation.includes(s.value) || /回显|自动带出|原样/i.test(expectation));
    if (s.action === 'assertExactVisible') return expectation.includes(s.text) || expectation.includes(s.text.replace(/[「」“”"']/g,''));
    if (s.action === 'assertNoHorizontalOverflow') return /响应式|移动端适配|横向溢出/i.test(expectation);
    return expectation.includes(text) && text.length >= 2;
  });
  const structureLabels = ['订单号','申请编号','申请时间','申请用途','申请人','申请诉求','申请状态','手机号码','所在地区','详细地址','图书名称','出版社','定价','数量','状态','价格','总本数','物流轨迹','驳回原因','复制'];
  const structural = assertions.some(s => structureLabels.some(k => (s.text ?? s.label ?? s.name ?? '').includes(k) && expectation.includes(k)));
  const strength = specific.length ? 'specific-expectation-subcheck' : structural ? 'structural-subcheck-only' : assertions.length ? 'generic-shell-only' : 'no-assertion';
  return { hasBusinessAssertion: specific.length > 0 || structural, assertionStrength: strength, genericShellAssertions: assertions.length - specific.length, specificAssertionCount: specific.length, limitation: strength === 'generic-shell-only' || strength === 'no-assertion' ? '当前断言只检查通用页面壳/导航，未命中需求的具体验收点。' : '' };
}
for (const c of cases) {
  c.draftValidation.schemaValid = c.proposedSteps.length ? validatedIds.has(c.id) : null;
  if (c.proposedSteps.length && !validatedIds.has(c.id)) c.draftValidation.validationError = dslValidationErrors.find(e => e.id === c.id)?.error ?? 'validateCases rejected draft';
  if (c.proposedSteps.length && validatedIds.has(c.id)) c.proposedSteps = validatedByInputId.get(c.id).steps;
  Object.assign(c.draftValidation, assertionQuality(c));
}

const counts = Object.fromEntries([...new Set(cases.map(c => c.classification))].map(k => [k, cases.filter(c => c.classification === k).length]));
const runnableDrafts = cases.filter(c => c.proposedSteps.length).length;
const withUsefulNewSteps = cases.filter(c => c.proposedSteps.length && c.authoritativeProjectSteps.length === 0).length;
const totalEmptyOriginal = suite.cases.filter(c => !c.steps?.length).length;
const runCounts = (lane) => Object.fromEntries(['passed','failed','blocked'].map(s => [s, cases.filter(c => c.baseline[lane]?.status === s).length]));
const matrix = {
  title: '部门申样书 XMind 156 项逐条可执行矩阵（不修改权威项目）', generatedAt: new Date().toISOString(),
  source: { suite: 'test-plans/department-sample-apply-v1.0-full-suite.json', caseCount: suite.cases.length, targetUrl: suite.targetUrl, audits: ['test-plans/department-sample-apply-cases-1-79-repair-report.json','test-plans/department-sample-apply-v1.0-step-audit-80-156.json'], baselineRunFile: 'output/target-full-run-2026-10-18.json', baselineRunId: baselineRun, authoritativeProjectFile: 'artifacts/demo/document-tests/projects/624a5e81-e79e-493f-a746-8accc5c44b90.json', projectFileModified: false, authenticatedEdgeTouched: false },
  summary: { counts, total: cases.length, sourceSuiteHadSteps: suite.cases.filter(c => c.steps?.length).length, sourceSuiteEmptySteps: totalEmptyOriginal, authoritativeProjectCaseCount: currentProject.cases.length, authoritativeProjectHadSteps: currentProject.cases.filter(c => c.steps?.length).length, authoritativeProjectEmptySteps: currentProject.cases.filter(c => !c.steps?.length).length, draftsWithSteps: runnableDrafts, schemaValidatedDrafts: validatedIds.size, dslValidationErrors, previouslyEmptyAuthoritativeCasesNowHaveDraftSteps: withUsefulNewSteps, previouslyEmptyAuthoritativeCasesNowHaveMeaningfulDrafts: cases.filter(c => !c.authoritativeProjectSteps.length && c.proposedSteps.length && c.draftValidation.hasBusinessAssertion).length, draftsWithAtLeastOneMeaningfulAssertion: cases.filter(c => c.proposedSteps.length && c.draftValidation.hasBusinessAssertion).length, draftsOnlyCheckingGenericShell: cases.filter(c => c.proposedSteps.length && c.draftValidation.assertionStrength === 'generic-shell-only').length, deterministicBaseline: runCounts('deterministic'), visualBaseline: runCounts('visual'), baselineOverall: baseline.overall, warnings: ['本文件提供的是待复核草稿，不是批准/已运行脚本。','既有 full run 的 passed/failed/blocked 来自 2026-10-18 基准执行；部分 UI 子断言过关仍不能代表完整用例通过。','两条浏览器 lane 共用当前页面/登录态，不构成独立复现。','N/A 保留在清单，但不应进入通过率分母。'] }, cases,
};
const jsonPath = 'output/department-sample-apply-156-executable-matrix-2026-10-18.json';
fs.writeFileSync(path.join(root, jsonPath), JSON.stringify(matrix, null, 2) + '\n');

const md = [];
md.push('# 部门申样书 XMind：156 项逐条可执行矩阵');
md.push('');
md.push(`生成时间：${matrix.generatedAt}。源用例共 ${cases.length} 条；全量基准运行 ${baselineRun}。此矩阵为独立草稿，没有改写正式项目 JSON，也没有操作登录 Edge。`);
md.push('');
md.push('## 汇总'); md.push('');
md.push('| 路由 | 条数 |'); md.push('|---|---:|');
for (const [k,v] of Object.entries(counts)) md.push(`| ${k} | ${v} |`);
md.push(`| 源 XMind suite 原有步骤 / 空步骤 | ${matrix.summary.sourceSuiteHadSteps} / ${matrix.summary.sourceSuiteEmptySteps} |`);
md.push(`| 当前权威项目已有步骤 / 空步骤 | ${matrix.summary.authoritativeProjectHadSteps} / ${matrix.summary.authoritativeProjectEmptySteps} |`);
md.push(`| 本审计产出有意义验收断言的草稿 | ${matrix.summary.draftsWithAtLeastOneMeaningfulAssertion} |`);
md.push(`| 仅检查通用页面壳的草稿 | ${matrix.summary.draftsOnlyCheckingGenericShell} |`);
md.push(`| 权威项目原空步骤、现已填入任意审计草稿（含页面壳断言） | ${withUsefulNewSteps} |`);
md.push(`| 权威项目原来空步骤、现有有意义草稿 | ${matrix.summary.previouslyEmptyAuthoritativeCasesNowHaveMeaningfulDrafts} |`);
md.push(`| TestPilot validateCases DSL schema 校验通过 | ${validatedIds.size}/${runnableDrafts} |`);
md.push(`| 当前权威项目已有可复用步骤 | ${matrix.summary.authoritativeProjectHadSteps}/156 |`);
md.push('');
md.push(`基准确定性：${JSON.stringify(matrix.summary.deterministicBaseline)}；Computer Use：${JSON.stringify(matrix.summary.visualBaseline)}；总体：${baseline.overall}。基准总计选择 156 项，确定性通过 8 项，Computer Use 通过 3、失败 7、阻塞 146。`);
md.push('');
md.push('## 逐项矩阵'); md.push('');
md.push('| ID | 类别 / 通道 | 用例 | 草稿步骤 | 已知缺口 / 解阻动作 | 基准确定性 / 视觉 |');
md.push('|---|---|---|---|---|---|');
for (const c of cases) {
  const quality = c.proposedSteps.length ? `**${c.draftValidation.assertionStrength}**<br>` : '';
  const steps = c.proposedSteps.length ? `${quality}${c.proposedSteps.map(s => `\`${s.action}${s.text ? `: ${s.text}` : s.label ? `: ${s.label}` : s.name ? `: ${s.name}` : ''}\``).join('<br>')}` : '（无；需补充前置证据后编写）';
  const gap = [c.blocker, `解阻：${c.unblockAction}`].filter(Boolean).join('<br>');
  md.push(`| ${c.id} | ${c.classification}<br>${c.lane} | ${c.title.replaceAll('|','\\|')} | ${steps.replaceAll('|','\\|')} | ${gap.replaceAll('|','\\|')} | ${c.baseline.deterministic?.status ?? '—'}<br>${c.baseline.visual?.status ?? '—'} |`);
}
md.push('');
md.push('## 运行时失败的可复核证据'); md.push('');
md.push('本基准明确失败案例：'); md.push('');
for (const n of [10,26,27,31,42,45,46,49,94]) {
  const c = cases[n-1];
  md.push(`- ${c.id}：脚本=${c.baseline.deterministic?.status ?? '无'}；Computer Use=${c.baseline.visual?.status ?? '无'}。${c.baseline.deterministic?.detail || c.baseline.visual?.detail || '具体结果见基准运行文件。'}`);
}
md.push('');
md.push('## 可执行约束'); md.push('');
md.push('- 所有步骤均以 `proposedSteps` 独立存档，并标为未批准。`draftValidation.unsupportedActions` 非空的条目不可执行，需先扩充并验证 DSL。');
md.push('- 有填值/选择/点击的草稿属于页面临时交互；仅在当前步骤能保证不触发订单、审批、库存、发货、消息等业务副作用时执行。含副作用动词的步骤保持需人工审核。');
md.push('- 先只读检查确实安全的完整 UI 项，再对部分 UI 项保留 partial 结果；缺身份、数据、API、后端、澄清的用例各自按该条 `unblockAction` 建夹具/补契约/找产品确认，不能用页面壳断言替代。');
md.push('- `N/A` 项保留追踪，不当成 blocked/failed，也不计 pass。');
md.push('- 要实现“全部跑一遍”，需将矩阵中的 156 项都路由到执行状态：完整 UI/部分 UI 在复用同一浏览器会话中运行；API 项在隔离沙箱运行；角色和历史数据项由具名 fixtures 提供；待澄清/N/A 明确留档。当前线上目标没有后端/服务端/API 契约或用户角色夹具，所以本矩阵不能虚称全部端到端执行完。');
md.push('');
md.push(`逐条详情与结构化脚本见 \`${jsonPath}\`。${detailed.length && diagnosis.length ? '详情基于两份逐条审计及基准运行诊断文件。' : ''}`);
fs.writeFileSync(path.join(root, 'output/department-sample-apply-156-executable-matrix-2026-10-18.md'), md.join('\n') + '\n');

console.log(JSON.stringify({jsonPath, markdown: 'output/department-sample-apply-156-executable-matrix-2026-10-18.md', caseCount: cases.length, counts, sourceSteps: matrix.summary.sourceSuiteHadSteps, emptySteps: totalEmptyOriginal, draftsWithSteps: runnableDrafts, emptyCasesWithDraftSteps: withUsefulNewSteps, deterministic: matrix.summary.deterministicBaseline, visual: matrix.summary.visualBaseline, unsupportedActions: cases.filter(c=>c.draftValidation.unsupportedActions.length).map(c=>c.id)}, null, 2));
