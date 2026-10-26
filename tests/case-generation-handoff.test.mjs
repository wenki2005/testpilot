import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createExecutionDraftFromCaseGeneration } from '../dist/adapters/case-generation-handoff.js';

function makeGeneration() {
  return {
    requirements: [{ id: 'R1', text: '用户可以查看自己的申请记录', source: '需求文档：申请记录', priority: 'P1', confidence: 'high', scopeStatus: 'in-scope', scopeRationale: '本期需求' }],
    cases: [
      { id: 'ai-001', origin: 'ai-draft', title: '查看自己的申请记录', requirementIds: ['R1'], sourceRefs: ['需求文档：申请记录'], scenarioType: 'positive', priority: 'P1', preconditions: [], testData: [], actions: ['以已登录用户身份打开申请记录页', '确认列表仅包含该用户创建的记录'], expectedResult: '页面仅展示当前用户创建的申请记录。', confidence: 'high', clarificationNeeded: [] },
      { id: 'EXISTING-001', origin: 'existing', title: '旧基准：查看申请记录', requirementIds: [], sourceRefs: ['留出用例集：CASE-001'], scenarioType: 'existing', priority: 'P2', preconditions: [], testData: [], actions: [], expectedResult: '用户能看到其申请记录。', confidence: 'medium', clarificationNeeded: [] },
    ],
    coverageMatrix: [{ requirementId: 'R1', scopeStatus: 'in-scope', coverageStatus: 'covered', aiCaseIds: ['ai-001'], referenceCaseIds: ['EXISTING-001'], referenceStatus: 'partial', rationale: '新用例覆盖了当前用户隔离检查。' }],
    quality: {
      duplicateCount: 0,
      untracedCaseIds: [],
      clarificationCount: 0,
      uncoveredByDraftsRequirementIds: [],
      aiDraftScore: { average: 100, completeCases: 1, assessedCases: 1 },
      semanticReview: { average: 100, strongCases: 1, needsReviewCases: 0, assessedCases: 1, dimensions: [
        { name: '步骤可执行性', average: 100, issueCount: 0 }, { name: '预期可判定性', average: 100, issueCount: 0 },
        { name: '需求依据', average: 100, issueCount: 0 }, { name: '单一检查点', average: 100, issueCount: 0 },
        { name: '测试数据就绪度', average: 100, issueCount: 0 },
      ], cases: [{ aiCaseId: 'ai-001', score: 100, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: [] }] },
      scopeSummary: { inScope: 1, covered: 1, uncovered: 0, outOfScope: 0, deferred: 0, uncertain: 0 },
      benchmarkComparison: { referenceCount: 1, evaluatedCases: 1, duplicateCandidates: 0, overlapCount: 1, novelCount: 0, items: [{ aiCaseId: 'ai-001', relation: 'overlap', referenceCaseIds: ['EXISTING-001'], rationale: '相同主流程，隔离检查更具体。' }] },
    },
    warnings: [],
    sources: [
      { kind: 'requirements', label: '需求资料' },
      { kind: 'existing-cases', label: '留出基准用例，仅用于生成后比较' },
    ],
  };
}

function handoff(generation = makeGeneration()) {
  return createExecutionDraftFromCaseGeneration({ targetUrl: 'https://example.test/app', generation });
}

test('rejects malformed generation fields and enum values with a field path', () => {
  const generation = makeGeneration();
  generation.cases[0].priority = 'P9';
  assert.throws(() => handoff(generation), /cases\.0\.priority/);

  const incomplete = makeGeneration();
  delete incomplete.quality.semanticReview;
  assert.throws(() => handoff(incomplete), /quality\.semanticReview/);
});

test('rejects duplicate requirement and case IDs', () => {
  const duplicateRequirement = makeGeneration();
  duplicateRequirement.requirements.push({ ...duplicateRequirement.requirements[0] });
  assert.throws(() => handoff(duplicateRequirement), /需求清单存在重复 ID/);

  const duplicateCase = makeGeneration();
  duplicateCase.cases.push({ ...duplicateCase.cases[0], title: '另一条重复 ID 用例' });
  assert.throws(() => handoff(duplicateCase), /用例清单存在重复 ID/);
});

test('rejects dangling requirement and benchmark references', () => {
  const badRequirementReference = makeGeneration();
  badRequirementReference.cases[0].requirementIds = ['R404'];
  assert.throws(() => handoff(badRequirementReference), /引用了不存在的需求 ID「R404」/);

  const badBaselineReference = makeGeneration();
  badBaselineReference.quality.benchmarkComparison.items[0].referenceCaseIds = ['EXISTING-404'];
  assert.throws(() => handoff(badBaselineReference), /不存在的基准用例 ID「EXISTING-404」/);
});

test('preserves long manual actions, complete source references, and original generation artifact', () => {
  const generation = makeGeneration();
  const longAction = `按页面提示逐项检查并记录：${'业务步骤-'.repeat(800)}`;
  const longSourceRef = `需求文档第 18 页与流程图：${'审批链路节点/'.repeat(300)}`;
  generation.cases[0].actions = [longAction];
  generation.cases[0].sourceRefs = [longSourceRef];

  const project = handoff(generation);
  const draftCase = project.cases[0];
  assert.equal(draftCase.caseGenerationTrace.actions[0], longAction);
  assert.equal(draftCase.caseGenerationTrace.sourceRefs[0], longSourceRef);
  assert.equal(draftCase.caseGenerationTrace.original.actions[0], longAction);
  assert.equal(draftCase.source, '完整来源引用见用例生成追溯记录');
  assert.equal(draftCase.source.includes(longAction), false, 'manual actions are stored as structured trace, never concatenated into source');
  assert.equal(project.caseGeneration.rawResult.cases[0].actions[0], longAction);
  assert.equal(project.caseGeneration.rawResult.cases[0].sourceRefs[0], longSourceRef);
  assert.equal(project.caseGeneration.digest, createHash('sha256').update(JSON.stringify(generation)).digest('hex'));
});

test('keeps held-out baseline cases in provenance only and transfers AI drafts alone', () => {
  const generation = makeGeneration();
  const project = handoff(generation);
  assert.equal(project.cases.length, 1);
  assert.equal(project.cases[0].caseGenerationTrace.sourceCaseId, 'ai-001');
  assert.deepEqual(project.caseGeneration.transferredCases, [{ sourceCaseId: 'ai-001', projectCaseId: 'AI-001' }]);
  assert.equal(project.caseGeneration.rawResult.cases.find(item => item.id === 'EXISTING-001').origin, 'existing');
  assert.equal(project.caseGeneration.rawResult.quality.benchmarkComparison.referenceCount, 1);
});

test('rejects project fields that would otherwise be silently truncated or fail later validation', () => {
  const longTitle = makeGeneration();
  longTitle.cases[0].title = 'T'.repeat(161);
  assert.throws(() => handoff(longTitle), /标题超过测试项目的 160 字限制/);

  const longExpected = makeGeneration();
  longExpected.cases[0].expectedResult = 'E'.repeat(301);
  assert.throws(() => handoff(longExpected), /预期结果超过测试项目的 300 字限制/);
});
