import test from 'node:test';
import assert from 'node:assert/strict';

const { validateDraftLocatorsAgainstEvidence, generateDocumentCaseSteps } = await import('../dist/demo/runtime.js');
const { explainBlockedBrowserStepDraft, partialUiFindingNote } = await import('../dist/adapters/document-test-workflow.js');

test('step generator rejects assertion copy that appears in neither requirement nor live evidence', () => {
  const evidence = JSON.stringify({
    controls: [
      { tag: 'button', role: 'button', name: '已通过', visibleText: '已通过' },
      { tag: 'button', role: 'button', name: '已驳回', visibleText: '已驳回' },
    ],
    headings: ['历史申请记录'],
    links: [],
  });
  const requirement = '按状态筛选（待审批/已通过/已驳回）生效';

  assert.doesNotThrow(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertVisible', text: '已通过' },
    { action: 'assertVisible', text: '已驳回' },
  ], evidence, requirement));

  assert.throws(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertVisible', text: '审批状态' },
  ], evidence, requirement), /既不在需求原文，也不在当前页面证据/u);

  assert.throws(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertNotVisible', text: '管理员审批权限' },
  ], evidence, requirement), /未在需求原文中出现/u);
});

test('step generator rejects ambiguous duplicate visible labels unless the case names a supported row index', () => {
  const evidence = JSON.stringify({ controls: [
    { tag: 'input', name: 'Fixture code' },
    { tag: 'input', name: 'Fixture code' },
  ], headings: [], links: [], visibleText: [] });

  assert.throws(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertFieldInvalid', label: 'Fixture code' },
  ], evidence), /2 个同名控件“Fixture code”/u);
  assert.doesNotThrow(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertFieldInvalid', label: 'Fixture code', rowIndex: 1 },
  ], evidence));
  assert.throws(() => validateDraftLocatorsAgainstEvidence([
    { action: 'assertFieldInvalid', label: 'Fixture code', rowIndex: 2 },
  ], evidence), /rowIndex 2 超出页面证据范围/u);
});

test('step generator fails before a model call when the target-page snapshot has no visible evidence', async () => {
  await assert.rejects(generateDocumentCaseSteps('https://example.test/', {
    title: '首页显示 Ready 标题', source: '需求 §1', expected: '页面显示“Ready”', kind: 'visible',
  }, JSON.stringify({ title: '', headings: [], controls: [], links: [], visibleText: [] })), /目标页面快照为空/u);
});

test('blocked step drafts preserve the concrete fixture prerequisite beside the generation failure', () => {
  const reason = explainBlockedBrowserStepDraft({
    id: 'case-56',
    title: '所有审批状态均展示查看明细入口',
    expected: '每一种状态的申请记录都应显示查看明细入口',
    source: '历史申请记录 › 状态明细',
    steps: [],
    confidence: 'medium',
    coverageGap: '需为待审批、已通过、已驳回各准备一条隔离申请记录，并确认测试账号可以查看。',
  });

  assert.match(reason, /未生成可执行的只读断言/u);
  assert.match(reason, /缺少可重复的测试数据或环境/u);
  assert.match(reason, /隔离申请记录/u);
  assert.doesNotMatch(reason, /仅需要页面标题|没有明确的通过条件/u);
});

test('comparison reporting keeps a concrete partial UI defect visible while the full case stays unresolved', () => {
  const note = partialUiFindingNote([
    { status: 'blocked', detail: 'Entering 1000 showed 1000 while focused, but after Tab blur the field visibly changed to 999. Thus the front end does not allow the legal value.' },
    { status: 'blocked', detail: 'API Contract 缺少已审核 suite。' },
  ]);
  assert.match(note, /部分 UI 检查发现疑似产品缺陷/u);
  assert.match(note, /after Tab blur the field visibly changed to 999/u);
});
