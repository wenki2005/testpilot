import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const sourceFile = 'C:/Users/A/Documents/WXWork/1688857165920788/Cache/File/2026-10/部门申样书_V1.0_测试用例.xmind';
const targetUrl = 'https://cdn.yibentushu.com/test-sample-apply/#/home';
const projectId = '624a5e81-e79e-493f-a746-8accc5c44b90';
const root = JSON.parse(strFromU8(unzipSync(readFileSync(sourceFile))['content.json']))[0].rootTopic;
const leaves = [];

function walk(node, path = []) {
  const next = [...path, node.title];
  const children = node.children?.attached ?? [];
  if (!children.length) leaves.push({ path: next.slice(1), leaf: node.title });
  for (const child of children) walk(child, next);
}

walk(root);
const cases = leaves.map(({ path, leaf }, index) => {
  const clean = leaf.replace(/^[✅❌⚠️🔄\s]+/u, '').replace(/\s+P[0-3]$/u, '');
  const priority = leaf.match(/\bP[0-3]\b/u)?.[0] ?? 'P2';
  const pending = /待澄清|需澄清/u.test(leaf);
  const outOfScope = /本期不做|计划下期|不纳入本期/u.test(path.join(' '));
  const fullPath = path.join(' › ');
  // Scope and risk come from the individual check, not a parent topic. A path such
  // as “申请提交” describes the feature and must not make every child irreversible.
  const apiOrBackend = /接口|API|服务端|后端|数据库|事务|回调|Job|lock|白盒扫描|数据迁移|配置参数|localStorage|OAuth|token/iu.test(leaf);
  const adminOrIntegration = /管理端|后台|旺店通|易诚通|企微审批|WMS|消息推送|物流接口|模板ID|仓库ID|店铺ID|迁移/iu.test(leaf);
  const explicitMutation = /(?:提交申请成功|创建审批单|审批通过后.*锁单|锁定.{0,8}仓发货|推送.{0,12}(?:出库单|发货)|创建其他出库单|迁移回滚|落库异常|重复锁单|删除(?:该行|订单)|取消订单)/iu.test(leaf);
  const isUiValidation = /字段|输入|提示|按钮|页面|展示|可见|不可见|拦截|置灰|标红|表单|下拉|选择|文案|跳转|响应式|H5/iu.test(leaf);
  const exactNotice = /页面提示文案「如有调样、周边产品等样书申请需求，请OA申请」/u.test(leaf);
  const safeStepsByLeaf = new Map([
    ['✅ 0<字数≤30：正常提交', [
      { action: 'fillByLabel', label: '备注', value: '仅做页面校验' },
      { action: 'assertValue', label: '备注', value: '仅做页面校验' },
    ]],
    ['✅ 文本≤20字：通过', [
      { action: 'fillByLabel', label: '收件人', value: '测试收件人' },
      { action: 'assertValue', label: '收件人', value: '测试收件人' },
    ]],
    ['✅ 11位数字：通过', [
      { action: 'fillByLabel', label: '手机号码', value: '13800138000' },
      { action: 'assertValue', label: '手机号码', value: '13800138000' },
    ]],
    ['❌ 非11位/含非数字字符：红色提示「手机号格式错误」P1', [
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'assertText', text: '手机号格式错误' },
    ]],
    ['✅ 手动输入≤20字：通过', [
      { action: 'fillByLabel', label: '详细地址', value: '测试地址一号' },
      { action: 'assertValue', label: '详细地址', value: '测试地址一号' },
    ]],
    ['✅ 新增一行含物流编码、图书数量、图书名称、出版社、定价字段', [
      { action: 'clickExactText', text: '继续添加样书' },
      { action: 'assertText', text: '物流编码' },
    ]],
  ]);
  const safeSteps = safeStepsByLeaf.get(leaf);

  let steps = [];
  let selectedForRegression = false;
  let method = apiOrBackend || adminOrIntegration ? '需 API/后台/隔离环境' : '待补可执行步骤';
  let reason = apiOrBackend || adminOrIntegration
    ? '该检查涉及目标 H5 网址之外的接口、管理端、第三方联调或隔离数据；先保留为待接入项，不伪造浏览器步骤。'
    : '预期已保留；由步骤规划器补齐可定位的页面操作与断言后再运行。';
  let sideEffectRisk = explicitMutation ? 'irreversible' : isUiValidation ? 'none' : 'unknown';
  if (pending) {
    method = '待澄清';
    reason = '原始用例已标记待澄清；本轮不猜测验收标准。';
  } else if (outOfScope) {
    method = '本期范围外';
    reason = '原始用例标明本期不做/计划下期。';
    sideEffectRisk = 'none';
  } else if (exactNotice) {
    steps = [{ action: 'assertExactVisible', text: '如有调样、周边产品等样书申请需求，请OA申请' }];
    selectedForRegression = true;
    method = '双通道只读 UI';
    reason = '在目标 H5 当前首页精确核验文案；无需填写或提交表单。';
    sideEffectRisk = 'none';
  } else if (safeSteps) {
    steps = safeSteps;
    selectedForRegression = true;
    method = '双通道只读/临时表单状态';
    reason = '只使用合成数据在当前页面验证控件；不提交、不保存，页面刷新即清除临时输入。';
    sideEffectRisk = 'none';
    } else if (!apiOrBackend && !adminOrIntegration && isUiValidation) {
    method = 'UI 脚本待补';
    reason = '该项属于目标网页的可见行为，缺少步骤时应由受限步骤规划器生成草稿；不应因缺步骤被静默标为后端阻塞。';
  }

  let category = 'functional';
  if (/权限|越权|token|登录|鉴权/u.test(leaf)) category = 'authorization';
  else if (/手机号|数量|超重|必填|校验|长度|格式/u.test(leaf)) category = 'input-validation';
  else if (apiOrBackend || adminOrIntegration) category = 'resilience';
  if (pending) category = 'other';

  return {
    id: `xmind-${index + 1}`,
    title: clean.slice(0, 180),
    source: `部门申样书_V1.0_测试用例.xmind › ${fullPath}`,
    requirementRefs: [fullPath],
    priority,
    category,
    confidence: pending ? 'low' : 'medium',
    coverageAreas: [category],
    // Only executable, reviewed-safe checks are selected. Unresolved, out-of-scope,
    // backend and fixture-dependent cases remain visible in the matrix without
    // masquerading as runnable browser cases.
    selectedForRegression: selectedForRegression && !pending && !outOfScope,
    preconditions: (apiOrBackend || adminOrIntegration) && !pending && !outOfScope ? ['需要对应接口/管理端/隔离测试数据'] : [],
    preconditionsConfirmed: !(apiOrBackend || adminOrIntegration),
    testData: [],
    sideEffectRisk,
    cleanup: '只在隔离测试环境执行；本轮不提交、不保存、不触发审批/锁单/出库/订单/库存/消息。',
    kind: 'visible',
    expected: pending ? `[需澄清] ${clean}` : clean,
    steps,
    automationDisposition: method,
    reason,
  };
});

const suite = {
  name: '部门申样书 V1.0 完整用例矩阵',
  sourceFile,
  targetUrl,
  sourceNodeCount: 300,
  caseCount: cases.length,
  safety: '生产站点只跑选中的只读断言；不提交、不保存、不触发审批/锁单/出库/订单/库存/消息。后端和联调案例需在隔离测试环境执行。',
  cases,
};

const response = await fetch(`http://127.0.0.1:4317/api/document-projects/${projectId}/update`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases }),
});
const project = await response.json();
if (!response.ok) throw new Error(`TestPilot project update failed (${response.status}): ${JSON.stringify(project)}`);
const stepDraftIds = cases.filter(testCase => !testCase.steps.length && testCase.automationDisposition === 'UI 脚本待补' && testCase.sideEffectRisk === 'none').map(testCase => testCase.id);
let stepDraftResult = null;
if (stepDraftIds.length) {
  const stepResponse = await fetch(`http://127.0.0.1:4317/api/document-projects/${projectId}/generate-steps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: stepDraftIds }),
  });
  stepDraftResult = await stepResponse.json();
  if (!stepResponse.ok) throw new Error(`Safe UI step drafting failed (${stepResponse.status}): ${JSON.stringify(stepDraftResult)}`);
  const refreshed = await fetch(`http://127.0.0.1:4317/api/document-projects`);
  const projects = await refreshed.json();
  const saved = projects.find(item => item.id === projectId);
  if (saved) for (const item of cases) {
    const current = saved.cases.find(candidate => candidate.id === item.id);
    if (current) item.steps = current.steps ?? [];
  }
}
writeFileSync('test-plans/department-sample-apply-v1.0-full-suite.json', JSON.stringify(suite, null, 2), 'utf8');
const counts = cases.reduce((result, testCase) => {
  result[testCase.automationDisposition] = (result[testCase.automationDisposition] ?? 0) + 1;
  return result;
}, {});
const markdown = [
  '# 部门申样书 V1.0 完整用例矩阵', '',
  `来源：${sourceFile}`, `目标：${targetUrl}`, `XMind 节点：${suite.sourceNodeCount}；末级检查项：${cases.length}。`, '',
  '## 执行边界', '', suite.safety, '',
  '## 自动化状态', '', ...Object.entries(counts).map(([name, count]) => `- ${name}：${count} 条`), '',
  ...(stepDraftResult ? [`安全 UI 步骤草稿：请求 ${stepDraftResult.requested} 条；生成 ${stepDraftResult.generatedCaseIds.length} 条；仍缺少 ${stepDraftResult.failedCaseIds.length} 条。生成内容仍需按项目审核策略确认。`, ''] : []),
  '## 全量检查项', '',
  ...cases.flatMap(testCase => [
    `### ${testCase.id}｜${testCase.title}`, '',
    `- 来源：${testCase.source}`,
    `- 优先级：${testCase.priority}；风险：${testCase.sideEffectRisk}；处理：${testCase.automationDisposition}`,
    `- 预期：${testCase.expected}`,
    `- 处理说明：${testCase.reason}`,
    `- 浏览器步骤：${testCase.steps.length ? JSON.stringify(testCase.steps) : '尚无可安全执行的浏览器步骤；根据通道/范围要求保留具体原因。'}`,
    '',
  ]),
];
writeFileSync('test-plans/department-sample-apply-v1.0-full-suite.md', markdown.join('\n'), 'utf8');
console.log(JSON.stringify({
  count: cases.length,
  counts,
  selected: cases.filter(testCase => testCase.selectedForRegression).map(({ id, title, steps }) => ({ id, title, steps })),
  projectId: project.id,
  reviewStatus: project.reviewStatus,
  stepDraftResult,
  json: 'test-plans/department-sample-apply-v1.0-full-suite.json',
  markdown: 'test-plans/department-sample-apply-v1.0-full-suite.md',
}));
