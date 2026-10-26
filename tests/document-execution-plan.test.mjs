import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyComparison, deriveGroundedEmptyRequiredFieldSubcheck, deriveRelatedInvalidInputSubcheck, nonBrowserCaseWithoutStimulus, planCaseExecution } from '../dist/adapters/document-test-workflow.js';
import { runComputerUseLane } from '../dist/adapters/computer-use.js';

const item = (title, expected = title, coverageGap = '', steps = []) => ({ title, source: title, expected, coverageGap, steps });

test('routes unresolved business scope to clarification with an actionable next step', () => {
  const plan = planCaseExecution(item('待澄清：H5是否支持申请编号搜索', '[需澄清] 待澄清：H5是否支持申请编号搜索'));
  assert.equal(plan.route, 'clarification');
  assert.match(plan.nextAction, /产品负责人确认/);
});

test('routes integration and persistence checks to API contract evidence', () => {
  const plan = planCaseExecution(item('审批流回调后端落库并幂等'));
  assert.equal(plan.route, 'api-contract');
  assert.match(plan.nextAction, /OpenAPI|接口契约/);
});

test('routes role and business record prerequisites without fabricating a fixture', () => {
  const role = planCaseExecution(item('管理员越权检查'));
  const fixture = planCaseExecution(item('历史订单记录显示已退单状态'));
  assert.equal(role.route, 'fixture-or-role');
  assert.equal(fixture.route, 'fixture-or-role');
  assert.match(fixture.nextAction, /合成 fixture/);
});

test('routes source security checks away from the browser lane', () => {
  assert.equal(planCaseExecution(item('token明文存localStorage应加固')).route, 'source-review');
});

test('does not fail fixture/API-only assertions before their required state has been established', () => {
  const fixtureOnly = { ...item('订单记录展示已退单', '已退单状态', '需要订单记录夹具', [{ action: 'assertText', text: '已退单' }]), confidence: 'high' };
  assert.equal(nonBrowserCaseWithoutStimulus(fixtureOnly)?.route, 'fixture-or-role');
  const apiOnly = { ...item('后端审批流水落库', '数据库存在审批记录', '需要 API 契约', [{ action: 'assertText', text: '审批已完成' }]), confidence: 'high' };
  assert.equal(nonBrowserCaseWithoutStimulus(apiOnly)?.route, 'api-contract');
  const visibleUi = { ...item('固定显示发货方式', '发货方式固定为快递', '', [{ action: 'assertText', text: '发货方式：仅支持快递' }]), confidence: 'high' };
  assert.equal(nonBrowserCaseWithoutStimulus(visibleUi), undefined);
  const visibleFixtureNamedField = { ...item('Required field is visibly invalid', 'Fixture code field border is red/invalid', '', [{ action: 'assertFieldInvalid', label: 'Fixture code' }]), confidence: 'high' };
  assert.equal(planCaseExecution(visibleFixtureNamedField).route, 'browser-ui', 'a field label containing the word Fixture is not a missing business fixture');
  const fixtureWithStimulus = { ...fixtureOnly, steps: [{ action: 'clickExactText', text: '历史申请' }, { action: 'assertText', text: '已退单' }] };
  assert.equal(nonBrowserCaseWithoutStimulus(fixtureWithStimulus), undefined, 'an actual UI action can establish a bounded visible subcheck');
});

test('keeps explicit scope exclusions and ambiguous UI data as separate dispositions', () => {
  assert.equal(planCaseExecution(item('本期不做旧版导出')).route, 'out-of-scope');
  assert.equal(planCaseExecution({ ...item('WMS库存优先级'), source: '需求 › 本期不做（计划下期） › WMS库存优先级' }).route, 'out-of-scope', 'scope inherited from the XMind hierarchy must apply to child cases');
  assert.equal(planCaseExecution(item('字段错误样式', '字段标红', '未指定字段、格式、非法值和触发时机')).route, 'clarification');
});

test('derives a bounded invalid-phone subcheck from a concrete sibling and preserves the broader gap', () => {
  const phone = {
    id: 'case-phone', title: '非11位手机号提示格式错误', expected: '手机号格式错误', source: '员工端表单',
    steps: [
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'assertText', text: '手机号格式错误' },
    ],
  };
  const broad = {
    id: 'case-broad', title: '存在漏填或格式校验失败：字段标红，不跳转', expected: '存在漏填或格式校验失败：字段标红，不跳转',
    steps: [], sideEffectRisk: 'irreversible', preconditionsConfirmed: false,
  };
  assert.equal(deriveRelatedInvalidInputSubcheck(broad, [phone, broad]), true);
  assert.deepEqual(broad.steps.map(step => step.action), ['captureCurrentUrl', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertCurrentUrlUnchanged']);
  assert.equal(broad.steps.some(step => step.action === 'triggerClientValidation'), false, 'must not attempt submit while required fields keep the button disabled');
  assert.equal(broad.sideEffectRisk, 'none');
  assert.equal(broad.preconditionsConfirmed, true);
  assert.match(broad.coverageGap, /不点击提交/);
  assert.match(broad.coverageGap, /只覆盖一种格式规则/);
});

test('does not fabricate validation steps when the suite has no concrete matching sibling', () => {
  const broad = { id: 'case-broad', title: '存在格式校验失败：字段标红', expected: '字段标红', steps: [] };
  assert.equal(deriveRelatedInvalidInputSubcheck(broad, [broad]), false);
  assert.deepEqual(broad.steps, []);
});

test('derives a non-submitting empty required-field UI check from the canonical source path', () => {
  const required = {
    id: 'case-42', title: '为空：字段标红提示必填', expected: '为空：字段标红提示必填',
    source: '需求 › 员工端-样书申请表单页 › 收件信息 › 填写收件人 › ❌ 为空：字段标红提示必填',
    steps: [
      { action: 'captureCurrentUrl' },
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'triggerClientValidation', name: '提交申请' },
      { action: 'assertFieldInvalid', label: '手机号码' },
      { action: 'assertCurrentUrlUnchanged' },
    ],
    sideEffectRisk: 'none', preconditionsConfirmed: true,
  };
  assert.equal(deriveGroundedEmptyRequiredFieldSubcheck(required), true);
  assert.deepEqual(required.steps.map(step => step.action), ['captureCurrentUrl', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertCurrentUrlUnchanged']);
  assert.deepEqual(required.steps.filter(step => step.action === 'fillByLabel').map(step => [step.label, step.value]), [['收件人', '']]);
  assert.equal(required.steps.some(step => step.action === 'triggerClientValidation'), false);
  assert.match(required.coverageGap, /不提交/);
  assert.match(required.coverageGap, /完整用例仍需保留/);
  assert.equal(planCaseExecution(required).route, 'api-contract', 'the UI partial check must not erase the unresolved full-case/API disposition');
});

test('does not invent a required-field locator when the source path does not identify the field', () => {
  const required = { id: 'missing-field', title: '为空：字段标红提示必填', expected: '为空：字段标红提示必填', source: '需求 › 表单校验', steps: [] };
  assert.equal(deriveGroundedEmptyRequiredFieldSubcheck(required), false);
  assert.deepEqual(required.steps, []);
});

test('repairs a partial generated invalid-input plan with blur, invalid-field and no-navigation assertions', () => {
  const sibling = {
    id: 'case-phone', title: '非11位手机号提示格式错误', expected: '手机号格式错误', source: '员工端表单',
    steps: [
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'assertText', text: '手机号格式错误' },
    ],
  };
  const partial = {
    id: 'case-broad', title: '存在漏填或格式校验失败：字段标红，不跳转', expected: '存在漏填或格式校验失败：字段标红，不跳转',
    steps: [{ action: 'fillByLabel', label: '手机号码', value: '123' }, { action: 'blurByLabel', label: '手机号码' }, { action: 'assertFieldInvalid', label: '手机号码' }],
  };
  assert.equal(deriveRelatedInvalidInputSubcheck(partial, [sibling, partial]), true);
  assert.deepEqual(partial.steps.map(step => step.action), ['captureCurrentUrl', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertCurrentUrlUnchanged']);
});

test('repairs a persisted legacy invalid-input plan that tries to click a disabled submit button', () => {
  const sibling = {
    id: 'case-45', title: '非11位/含非数字字符：红色提示「手机号格式错误」', expected: '手机号格式错误',
    steps: [{ action: 'fillByLabel', label: '手机号码', value: '123' }, { action: 'assertText', text: '手机号格式错误' }],
  };
  const persisted = {
    id: 'case-51', title: '存在漏填或格式校验失败：对应字段输入框标红，不跳转', expected: '存在漏填或格式校验失败：对应字段输入框标红，不跳转',
    steps: [
      { action: 'captureCurrentUrl' },
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'triggerClientValidation', name: '提交申请' },
      { action: 'assertFieldInvalid', label: '手机号码' },
      { action: 'assertCurrentUrlUnchanged' },
    ],
  };
  assert.equal(deriveRelatedInvalidInputSubcheck(persisted, [sibling, persisted]), true);
  assert.deepEqual(persisted.steps.map(step => step.action), ['captureCurrentUrl', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertCurrentUrlUnchanged']);
});

test('repairs the intermediate stale-message draft after target evidence disproves that copy', () => {
  const sibling = {
    id: 'case-45', title: '非11位/含非数字字符：手机号校验', expected: '手机号格式错误',
    steps: [{ action: 'fillByLabel', label: '手机号码', value: '123' }, { action: 'assertText', text: '手机号格式错误' }],
  };
  const persisted = {
    id: 'case-51', title: '存在漏填或格式校验失败：对应字段输入框标红，不跳转', expected: '存在漏填或格式校验失败：对应字段输入框标红，不跳转',
    steps: [
      { action: 'captureCurrentUrl' },
      { action: 'fillByLabel', label: '手机号码', value: '123' },
      { action: 'assertText', text: '手机号格式错误' },
      { action: 'assertCurrentUrlUnchanged' },
    ],
  };
  assert.equal(deriveRelatedInvalidInputSubcheck(persisted, [sibling, persisted]), true);
  assert.deepEqual(persisted.steps.map(step => step.action), ['captureCurrentUrl', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertCurrentUrlUnchanged']);
});

test('does not let parent XMind API wording block a directly observable leaf assertion', () => {
  const leaf = {
    ...item('1004.00 外部客户—合作客户：正常展示可选'),
    source: '需求 › 调用易诚通客户接口，仅拉取指定分类 › 1004.00 外部客户—合作客户：正常展示可选',
  };
  assert.equal(planCaseExecution(leaf).route, 'browser-ui');
});

test('requests exact old and new URLs before authoring a legacy-entry migration check', () => {
  const plan = planCaseExecution(item('原「教师服务系统-员工福利订单」入口下线或跳转至新地址，不再重复展示'));
  assert.equal(plan.route, 'clarification');
  assert.match(plan.nextAction, /旧系统 URL、新系统 URL/);
});

test('routes visible UI assertions and otherwise ungrounded cases distinctly', () => {
  assert.equal(planCaseExecution(item('页面文案显示提示文字')).route, 'browser-ui');
  assert.equal(planCaseExecution(item('检查业务流程正确')).route, 'manual-analysis');
});

test('separates actual lane disagreement from unresolved blocked cases and N/A scope', () => {
  assert.equal(classifyComparison('passed', 'passed'), 'aligned');
  assert.equal(classifyComparison('failed', 'failed'), 'aligned');
  assert.equal(classifyComparison('passed', 'failed'), 'mismatch');
  assert.equal(classifyComparison('blocked', 'blocked'), 'unresolved');
  assert.equal(classifyComparison('blocked', 'passed'), 'unresolved');
  assert.equal(classifyComparison('not-applicable', 'not-applicable'), 'not-applicable');
});

test('out-of-scope visual cases are retained as N/A without launching a browser or calling an AI model', async () => {
  const lane = await runComputerUseLane('https://example.invalid/', [{ id: 'na-1', title: '本期不做的能力', executionRoute: 'out-of-scope' }]);
  assert.equal(lane.status, 'not-applicable');
  assert.equal(lane.results.length, 1);
  assert.equal(lane.results[0].status, 'not-applicable');
  assert.match(lane.summary, /N\/A/);
});
