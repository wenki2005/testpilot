import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDocumentCaseStepAuthoringService } from '../src/application/cases/document-case-step-authoring-service.ts';
import { createDocumentProjectStore } from '../src/storage/document-project-store.ts';
import { buildDocumentBrowserCaseMessages, validateDraftLocatorsAgainstEvidence } from '../src/demo/runtime.ts';
import { validateCases, validateCasesPreservingGenerationTrace } from '../src/domain/document-case-validation.ts';
import { createDocumentProjectUpdateService } from '../src/application/projects/document-project-update-service.ts';

function createCandidateGenerationService({ cases, evidence, onCollect = () => {}, onGenerateSteps = () => {} }) {
  return createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: candidate => !(candidate.steps ?? []).some(step => ['assertText', 'assertVisible', 'assertExactVisible', 'assertRoleVisible'].includes(step.action)),
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases: candidates => candidates,
    saveProject: async () => {},
    collectPageEvidence: async () => { onCollect(); return evidence; },
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async () => { onGenerateSteps(); return []; },
    generateBrowserCases: async () => cases,
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace: candidates => candidates,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
  });
}

function candidateCase(id, requirementRefs, expected = '待审核预期。') {
  return {
    id, title: id, expected, requirementRefs, source: 'synthetic source', priority: 'P1', category: 'functional',
    confidence: 'low', coverageAreas: ['functional'], selectedForRegression: false,
    preconditions: [], preconditionsConfirmed: false, testData: [], sideEffectRisk: 'unknown', cleanup: '',
    kind: 'visible', steps: [],
  };
}

test('project update boundary strips caller-forged exploration evidence and preserves trusted evidence by case id', async () => {
  const trusted = { evidenceId: 'trusted-evidence', snapshotSha256: 'a'.repeat(64), capturedAt: '2026-11-02T00:00:00.000Z', route: '/synthetic', observedFactSha256: 'b'.repeat(64) };
  const existing = { ...candidateCase('DRAFT-1', ['R1']), caseOrigin: 'ai-generated', lifecycleStatus: 'draft', explorationEvidence: trusted };
  const project = { id: 'synthetic-update', targetUrl: 'http://127.0.0.1:1/', cases: [existing], reviewStatus: 'draft' };
  const service = createDocumentProjectUpdateService({
    projects: { saveProject: async () => undefined },
    validateTarget: value => new URL(value).href,
    validateCases: (incoming, stored) => validateCasesPreservingGenerationTrace(incoming, stored),
    containsCredentialLikeValue: () => false,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-02T00:01:00.000Z',
  });
  const forged = { ...existing, explorationEvidence: { ...trusted, evidenceId: 'attacker-forged' } };
  await assert.rejects(service.update(project, { cases: [forged] }), /不能由更新请求替换/u);
  await service.update(project, { cases: [{ ...existing, explorationEvidence: undefined }] });
  assert.deepEqual(project.cases[0].explorationEvidence, trusted, 'the request cannot replace trusted stored evidence');
  const newCandidate = { ...candidateCase('DRAFT-2', ['R2']), caseOrigin: 'ai-generated', lifecycleStatus: 'draft', explorationEvidence: { ...trusted, evidenceId: 'model-forged' } };
  await service.update(project, { cases: [newCandidate] });
  assert.equal(project.cases[0].explorationEvidence, undefined, 'untrusted evidence on a new candidate is stripped');
  assert.equal(project.cases[0].selectedForRegression, false, 'candidate remains unselected');
  assert.equal(project.cases[0].lifecycleStatus, 'draft', 'candidate remains a draft');
});

test('page-grounded step drafts retain a privacy-preserving evidence digest and per-step locator matches', async () => {
  const storeDirectory = await mkdtemp(path.join(os.tmpdir(), 'testpilot-page-evidence-'));
  try {
    const pageEvidence = JSON.stringify({
    evidenceId: '3b4c4f0e-359d-44f1-8a19-3fc4d8046ed1',
    capturedAt: '2026-11-01T10:00:00.000Z',
    title: 'Sample application', route: '/apply/new/123456789',
    controls: [{ tag: 'input', name: 'Department' }, { tag: 'button', role: 'button', name: 'Search' }],
    headings: ['New application'], links: [], visibleText: ['Ready', 'SENSITIVE_PAGE_VALUE_8291'],
  });
    const item = {
    id: 'AI-001', title: 'Verify department label', expected: 'The page shows "Ready".',
    requirementRefs: ['R1 [in-scope]'], source: 'Requirement R1', priority: 'P1', category: 'functional',
    confidence: 'high', coverageAreas: ['functional'], selectedForRegression: false,
    preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '',
    kind: 'visible', steps: [], caseGenerationTrace: { actions: ['Open the application page'] },
  };
    const project = { id: 'project-provenance', targetUrl: 'https://example.test/apply/new', cases: [item] };
    const steps = [
    { action: 'fillByLabel', label: 'Department', value: 'Synthetic department' },
    { action: 'clickByRole', role: 'button', name: 'Search' },
    { action: 'assertVisible', text: 'Ready' },
  ];
    const service = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: candidate => !(candidate.steps ?? []).some(step => ['assertText', 'assertVisible', 'assertExactVisible'].includes(step.action)),
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases: candidates => candidates,
    saveProject: async () => {},
    collectPageEvidence: async () => pageEvidence,
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async () => steps,
    generateBrowserCases: async () => [],
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace: candidates => candidates,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-01T10:01:00.000Z',
  });

    const result = await service.generateSelectedBrowserSteps(project, ['AI-001']);
    assert.deepEqual(result.generatedCaseIds, ['AI-001']);
    const evidence = project.stepAuthoring.results[0].pageEvidence;
    assert.ok(evidence);
    assert.equal(evidence.evidenceId, '3b4c4f0e-359d-44f1-8a19-3fc4d8046ed1');
    assert.equal(evidence.capturedAt, '2026-11-01T10:00:00.000Z');
    assert.equal(evidence.route, '/apply/new/:segment', 'dynamic path segments must be masked in stored provenance');
    assert.equal(evidence.sha256, createHash('sha256').update(pageEvidence).digest('hex'));
    const store = createDocumentProjectStore(storeDirectory);
    await store.saveProject(project);
    const stepRevisions = await store.listRevisions(project.id, { kind: 'steps', entityId: 'AI-001' });
    assert.equal(stepRevisions.items.length, 1);
    assert.equal(evidence.stepRevisionDigest, stepRevisions.items[0].digest, 'page provenance must reference the exact persisted BrowserStep revision');
    const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, entry]) => [key, canonicalize(entry)]))
      : value;
    const previousRevisionFormatDigest = createHash('sha256').update(`testpilot-project-revision-v1\0steps\0AI-001\0${JSON.stringify(canonicalize(steps))}`).digest('hex');
    assert.equal(evidence.stepRevisionDigest, previousRevisionFormatDigest, 'shared revision hashing must preserve existing history digests');
    const storedRevision = await store.getRevision(project.id, stepRevisions.items[0].id);
    assert.deepEqual(storedRevision.snapshot, steps);
    const caseRevisions = await store.listRevisions(project.id, { kind: 'case', entityId: 'AI-001' });
    assert.equal(caseRevisions.items.length, 1);
    const storedCaseRevision = await store.getRevision(project.id, caseRevisions.items[0].id);
    assert.equal(evidence.caseRevisionDigest, storedCaseRevision.digest, 'page provenance must reference the exact requirement and expected case revision');
    const evidenceRevisions = await store.listRevisions(project.id, { kind: 'step-evidence', entityId: 'AI-001' });
    assert.equal(evidenceRevisions.items.length, 1, 'page evidence must be an immutable project revision');
    const evidenceRevision = await store.getRevision(project.id, evidenceRevisions.items[0].id);
    assert.equal(evidenceRevision.snapshot.pageEvidence.stepRevisionDigest, storedRevision.digest);
    assert.deepEqual(evidenceRevision.snapshot.pageEvidence, evidence);
    assert.equal(JSON.stringify(evidenceRevision.snapshot).includes('SENSITIVE_PAGE_VALUE_8291'), false, 'immutable evidence revisions must contain no raw page text');
    assert.deepEqual(evidence.matchedLocators.map(item => [item.stepIndex, item.kind]), [
    [0, 'control-label'], [1, 'role-name'], [2, 'visible-text'],
    ]);
    assert.equal(JSON.stringify(result).includes('SENSITIVE_PAGE_VALUE_8291'), false, 'raw page text must not be persisted in the provenance record');
    assert.equal(JSON.stringify(await store.getProject(project.id)).includes('SENSITIVE_PAGE_VALUE_8291'), false, 'raw page text must not be persisted in the saved project');
    project.updatedAt = '2026-11-01T10:01:30.000Z';
    await store.saveProject(project);
    assert.equal((await store.listRevisions(project.id, { kind: 'step-evidence', entityId: 'AI-001' })).items.length, 1, 'unchanged evidence must not duplicate its immutable revision');
    project.cases[0].steps = [...steps, { action: 'assertVisible', text: 'Another state' }];
    project.cases[0].expected = 'An intentionally changed expectation.';
    project.stepAuthoring = { generatedAt: '2026-11-01T10:02:00.000Z', results: [{ caseId: 'AI-001', status: 'blocked', stepCount: 0, detail: 'A later generation attempt was blocked.' }] };
    await store.saveProject(project);
    const retainedEvidenceRevisions = await store.listRevisions(project.id, { kind: 'step-evidence', entityId: 'AI-001' });
    assert.equal(retainedEvidenceRevisions.items.length, 1, 'overwriting current authoring status must not erase prior evidence revisions');
    const retainedEvidence = await store.getRevision(project.id, retainedEvidenceRevisions.items[0].id);
    assert.equal(retainedEvidence.snapshot.pageEvidence.caseRevisionDigest, storedCaseRevision.digest);
    assert.equal(retainedEvidence.snapshot.pageEvidence.stepRevisionDigest, storedRevision.digest);
  } finally {
    await rm(storeDirectory, { recursive: true, force: true });
  }
});

test('candidate generation reuses one synthetic page snapshot and keeps exploration as a visible-state draft', async () => {
  const pageEvidence = JSON.stringify({
    evidenceId: '73f72b08-5b81-44b7-9f49-6e1c59622b18',
    capturedAt: '2026-11-01T10:00:00.000Z',
    route: '/synthetic/apply',
    headings: ['申请信息'], links: [], visibleText: ['当前状态：待提交'],
    controls: [{ role: 'button', name: '保存草稿' }],
  });
  const requirementCase = {
    id: 'REQ-001', title: '申请流程规则待核实', expected: '业务预期依据待补充。',
    requirementRefs: ['R1 [in-scope]'], source: 'Requirement R1', priority: 'P1', category: 'functional',
    confidence: 'low', coverageAreas: ['functional'], selectedForRegression: false,
    preconditions: ['申请角色待确认'], preconditionsConfirmed: false, testData: [], sideEffectRisk: 'unknown', cleanup: '',
    kind: 'visible', steps: [], caseGenerationTrace: { actions: ['inspect'] },
  };
  const exploratoryCase = {
    ...requirementCase,
    id: 'EXP-001', title: 'Click save and submit', expected: 'The page shows 保存草稿 and submits successfully.',
    requirementRefs: [], source: 'model generated',
    entryPath: 'https://model.invalid/submit', modulePath: ['Unconfirmed module'], dependsOnCaseIds: ['REQ-001'], tags: ['P0'],
    testDataRequirements: [{ key: 'approvedRequest', description: 'already approved', required: true }],
    baseline: { strategy: 'unavailable', reason: 'Model claimed the baseline is missing.' },
    executionReason: 'The model says the case should execute now.', nextAction: 'Submit and reverse the approval.',
    steps: [{ action: 'clickExactText', text: '保存草稿' }, { action: 'assertVisible', text: '当前状态：待提交' }],
  };
  const authoredEvidence = [];
  let collectCount = 0;
  let candidateEvidence;
  const service = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: candidate => !(candidate.steps ?? []).some(step => ['assertText', 'assertVisible', 'assertExactVisible', 'assertRoleVisible'].includes(step.action)),
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases: candidates => candidates,
    saveProject: async () => {},
    collectPageEvidence: async () => { collectCount += 1; return pageEvidence; },
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async (_url, _item, evidence) => { authoredEvidence.push(evidence); return [{ action: 'assertExactVisible', text: '业务预期依据待补充。' }]; },
    generateBrowserCases: async (_source, _examples, evidence) => { candidateEvidence = evidence; return [requirementCase, exploratoryCase]; },
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace: candidates => candidates,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-01T10:01:00.000Z',
  });
  const project = { id: 'candidate-evidence', targetUrl: 'https://example.test', sourceText: 'R1', researchExamples: [], caseMode: 'browser', cases: [] };

  await service.generateBrowserCaseSet(project);

  assert.equal(collectCount, 1, 'the snapshot is collected once for the entire generation request');
  assert.deepEqual(JSON.parse(candidateEvidence).pages[0], JSON.parse(pageEvidence), 'gap analysis receives the snapshot inside the evidence archive');
  assert.deepEqual(JSON.parse(authoredEvidence[0]).pages[0], JSON.parse(pageEvidence), 'step authoring receives that same archived snapshot');
  const exploration = project.cases.find(item => item.id === 'EXP-001');
  assert.equal(exploration.lifecycleStatus, 'draft');
  assert.equal(exploration.selectedForRegression, false);
  assert.equal(exploration.priority, 'P3', 'page observation cannot claim business priority');
  assert.equal(exploration.category, 'visual', 'page observation cannot claim a business test category');
  assert.equal(exploration.kind, 'visible');
  assert.deepEqual(exploration.coverageAreas, ['visual']);
  assert.equal(exploration.confidence, 'low');
  assert.equal(exploration.expected, '当前页面观察到“保存草稿”；业务预期待确认。');
  assert.deepEqual(exploration.testData, []);
  assert.equal(exploration.sideEffectRisk, 'unknown');
  assert.equal(exploration.cleanup, '');
  assert.equal(exploration.entryPath, '/synthetic/apply', 'entry path is derived from the server snapshot, not the model URL');
  for (const field of ['modulePath', 'dependsOnCaseIds', 'tags', 'testDataRequirements', 'baseline', 'executionReason', 'nextAction', 'caseGenerationTrace']) {
    assert.equal(Object.hasOwn(exploration, field), false, `untrusted exploratory metadata ${field} is discarded`);
  }
  assert.match(exploration.source, /evidenceId=73f72b08-5b81-44b7-9f49-6e1c59622b18/);
  assert.match(exploration.source, new RegExp(`snapshotSha256=${createHash('sha256').update(pageEvidence).digest('hex')}`));
  assert.deepEqual(exploration.explorationEvidence, {
    evidenceId: '73f72b08-5b81-44b7-9f49-6e1c59622b18',
    snapshotSha256: createHash('sha256').update(pageEvidence).digest('hex'),
    capturedAt: '2026-11-01T10:00:00.000Z',
    route: '/synthetic/apply',
    observedFactSha256: createHash('sha256').update('保存草稿').digest('hex'),
  }, 'candidate stores a structured, privacy-preserving reference to its observed fact');
  const { caseGenerationTrace: _fixtureTrace, ...validatedCandidate } = exploration;
  const trustedStoredCandidate = { ...validatedCandidate };
  assert.equal(validateCases([validatedCandidate])[0].explorationEvidence, undefined);
  assert.deepEqual(validateCasesPreservingGenerationTrace([validatedCandidate], [], new Map([['EXP-001', exploration.explorationEvidence]]))[0].explorationEvidence, exploration.explorationEvidence,
    'fresh server-grounded evidence survives through the explicit trusted path');
  assert.throws(() => validateCasesPreservingGenerationTrace([{ ...validatedCandidate, explorationEvidence: { ...exploration.explorationEvidence, snapshotSha256: 'f'.repeat(64) } }], [trustedStoredCandidate]), /不能由更新请求替换/u);
  assert.deepEqual(validateCasesPreservingGenerationTrace([{ ...validatedCandidate }], [trustedStoredCandidate])[0].explorationEvidence, exploration.explorationEvidence,
    'ordinary updates retain the stored trusted reference when omitted');
  assert.deepEqual(validateCasesPreservingGenerationTrace([{ ...validatedCandidate, lifecycleStatus: 'runnable', caseOrigin: 'manual', selectedForRegression: true }], [trustedStoredCandidate])[0].explorationEvidence, exploration.explorationEvidence,
    'human lifecycle promotion keeps the trusted page evidence attached to the adopted case');
  const replacementEvidence = { ...exploration.explorationEvidence, snapshotSha256: 'c'.repeat(64) };
  assert.deepEqual(validateCasesPreservingGenerationTrace([{ ...validatedCandidate }], [trustedStoredCandidate], new Map([['EXP-001', replacementEvidence]]))[0].explorationEvidence, replacementEvidence,
    'same-ID regeneration may replace a stored reference only through the fresh server-grounded path');
  assert.match(exploration.coverageGap, /业务预期/);
  assert.deepEqual(exploration.steps, [{ action: 'assertRoleVisible', role: 'button', name: '保存草稿' }], 'exploration is limited to readonly assertions grounded in the snapshot');
  const explorationResult = project.stepAuthoring.results.find(result => result.caseId === 'EXP-001');
  assert.equal(explorationResult.status, 'partial');
  assert.equal(explorationResult.pageEvidence.evidenceId, '73f72b08-5b81-44b7-9f49-6e1c59622b18');
  const archivedEvidence = JSON.stringify({ ...JSON.parse(pageEvidence), version: 1, explorationStatus: 'legacy-single-page', decisionTrace: [], pages: [JSON.parse(pageEvidence)] });
  assert.equal(explorationResult.pageEvidence.sha256, createHash('sha256').update(archivedEvidence).digest('hex'));
  assert.ok(explorationResult.pageEvidence.caseRevisionDigest);
  assert.ok(explorationResult.pageEvidence.stepRevisionDigest);
  const generatedStoreDirectory = await mkdtemp(path.join(os.tmpdir(), 'testpilot-generated-page-evidence-'));
  try {
    const store = createDocumentProjectStore(generatedStoreDirectory);
    await store.saveProject(project);
    const revisions = await store.listRevisions(project.id, { kind: 'step-evidence', entityId: 'EXP-001' });
    assert.equal(revisions.items.length, 1, 'the generated exploration persists as a page-evidence revision for its case');
    const revision = await store.getRevision(project.id, revisions.items[0].id);
    assert.equal(revision.snapshot.pageEvidence.evidenceId, explorationResult.pageEvidence.evidenceId);
    assert.equal(revision.snapshot.pageEvidence.caseRevisionDigest, explorationResult.pageEvidence.caseRevisionDigest);
    assert.equal(revision.snapshot.pageEvidence.stepRevisionDigest, explorationResult.pageEvidence.stepRevisionDigest);
  } finally {
    await rm(generatedStoreDirectory, { recursive: true, force: true });
  }
  assert.equal(project.cases.find(item => item.id === 'REQ-001').lifecycleStatus, 'draft');
  assert.equal(project.cases.find(item => item.id === 'REQ-001').selectedForRegression, false);
});

test('missing page evidence blocks exploration and step authoring without recollection', async () => {
  let collectCount = 0;
  let candidateEvidence = 'not-called';
  let authorCount = 0;
  const requirements = {
    id: 'REQ-002', title: '业务流程待确认', expected: '业务预期待确认。',
    requirementRefs: ['R2 [in-scope]'], source: 'Requirement R2', priority: 'P1', category: 'functional', confidence: 'low', coverageAreas: ['functional'], selectedForRegression: false,
    preconditions: ['角色待确认'], preconditionsConfirmed: false, testData: [], sideEffectRisk: 'unknown', cleanup: '', kind: 'visible', steps: [],
  };
  const exploratory = { ...requirements, id: 'EXP-002', title: 'Observe guessed page', expected: 'The page is approved.', requirementRefs: [], source: 'model', steps: [{ action: 'clickExactText', text: 'Approve' }] };
  const service = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: () => true,
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases: candidates => candidates,
    saveProject: async () => {},
    collectPageEvidence: async () => { collectCount += 1; throw new Error('Login required: SECRET_PAGE_TEXT must not leak into persisted warning'); },
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async () => { authorCount += 1; return []; },
    generateBrowserCases: async (_source, _examples, evidence) => { candidateEvidence = evidence; return [requirements, exploratory]; },
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace: candidates => candidates,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
  });
  const project = { id: 'missing-candidate-evidence', targetUrl: 'https://example.test', sourceText: 'R2', researchExamples: [], caseMode: 'browser', cases: [] };

  await service.generateBrowserCaseSet(project);

  assert.equal(collectCount, 1, 'failed collection is not retried within the same request');
  assert.equal(candidateEvidence, undefined);
  assert.equal(authorCount, 0, 'steps are not authored without the snapshot');
  assert.match(project.generationWarning, /页面探索未完成/);
  assert.match(project.generationWarning, /人工完成登录/);
  assert.doesNotMatch(project.generationWarning, /SECRET_PAGE_TEXT|Login required/);
  const exploration = project.cases.find(item => item.id === 'EXP-002');
  assert.equal(exploration.lifecycleStatus, 'draft');
  assert.equal(exploration.selectedForRegression, false);
  assert.deepEqual(exploration.steps, []);
  assert.match(exploration.coverageGap, /页面探索未完成/);
  assert.match(exploration.source, /页面探索未完成/);
  const explorationResult = project.stepAuthoring.results.find(result => result.caseId === 'EXP-002');
  assert.equal(explorationResult.status, 'blocked');
  assert.match(explorationResult.detail, /页面探索未完成/);
  assert.equal(project.stepAuthoring.results.find(result => result.caseId === 'REQ-002').status, 'blocked');
});

test('model supplied exploration evidence is stripped when page facts are absent or do not match', async () => {
  const fake = candidateCase('EXP-FAKE', [], 'Not present on the page.');
  fake.explorationEvidence = { evidenceId: '73f72b08-5b81-44b7-9f49-6e1c59622b18', snapshotSha256: 'a'.repeat(64), capturedAt: '2026-11-01T10:00:00.000Z', route: '/fake', observedFactSha256: 'b'.repeat(64) };
  const evidence = JSON.stringify({ evidenceId: '3b4c4f0e-359d-44f1-8a19-3fc4d8046ed1', capturedAt: '2026-11-01T10:00:00.000Z', route: '/real', headings: ['Actually visible'] });
  const project = { id: 'fake-exploration', targetUrl: 'https://example.test', sourceText: 'R1', researchExamples: [], caseMode: 'browser', cases: [] };
  await createCandidateGenerationService({ cases: [fake], evidence }).generateBrowserCaseSet(project);
  const candidate = project.cases.find(item => item.id === 'EXP-FAKE');
  assert.equal(candidate.explorationEvidence, undefined);
  assert.equal(candidate.lifecycleStatus, 'draft');
  assert.equal(candidate.selectedForRegression, false);
  assert.equal(candidate.steps.length, 0);
});

test('candidate planner prompt reserves page-exploration slots and states the two evidence tracks', () => {
  const messages = buildDocumentBrowserCaseMessages('需要依据的申请业务规则。', [], JSON.stringify({ visibleText: ['合成页面缺口'] }));
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /two tracks/);
  assert.match(prompt, /Reserve up to 3 of the 12 slots/);
  assert.match(prompt, /omit every directly visible page gap/);
  assert.match(prompt, /合成页面缺口/);
  assert.match(prompt, /assertExactVisible\/assertRoleVisible/);
  assert.match(prompt, /当前页面观察到/);
  assert.throws(() => buildDocumentBrowserCaseMessages('明确需求', [], 'x'.repeat(30_001)), /30000/u, 'page evidence must reject oversize input rather than silently truncate it');
});

test('server caps exploration at three and total new candidates at twelve with an omission warning', async () => {
  const evidence = JSON.stringify({
    evidenceId: '8730649f-b88f-4e11-b41a-79dd35b87e8a', capturedAt: '2026-11-01T10:00:00.000Z',
    headings: [], links: [], visibleText: ['Page fact 0', 'Page fact 1', 'Page fact 2', 'Page fact 3'], controls: [],
  });
  const modelCases = [
    ...Array.from({ length: 12 }, (_, index) => candidateCase(`REQ-${index}`, ['R1 [in-scope]'])),
    ...Array.from({ length: 4 }, (_, index) => candidateCase(`EXP-${index}`, [], `Observe Page fact ${index}`)),
  ];
  const project = { id: 'candidate-cap', targetUrl: 'https://example.test', sourceText: 'R1', researchExamples: [], caseMode: 'browser', cases: [] };
  await createCandidateGenerationService({ cases: modelCases, evidence }).generateBrowserCaseSet(project);

  assert.equal(project.cases.length, 12);
  assert.equal(project.cases.filter(item => !(item.requirementRefs ?? []).length).length, 3);
  assert.equal(project.cases.filter(item => (item.requirementRefs ?? []).length).length, 9);
  assert.ok(project.cases.some(item => item.id === 'EXP-0'), 'an exploration candidate remains within the total cap');
  assert.match(project.generationWarning, /省略4条模型候选/);
  assert.match(project.generationWarning, /需求3条、探索1条/);
});

test('valid page evidence with no model exploration candidate warns that page-gap discovery is incomplete', async () => {
  const evidence = JSON.stringify({
    evidenceId: '45f74b2a-5cd1-41c8-85fb-445440ded922', capturedAt: '2026-11-01T10:00:00.000Z',
    headings: [], links: [], visibleText: ['Visible synthetic page fact'], controls: [],
  });
  const project = { id: 'candidate-no-exploration', targetUrl: 'https://example.test', sourceText: 'R1', researchExamples: [], caseMode: 'browser', cases: [] };
  await createCandidateGenerationService({ cases: [candidateCase('REQ-ONLY', ['R1 [in-scope]'])], evidence }).generateBrowserCaseSet(project);

  assert.deepEqual(project.cases.map(item => item.id), ['REQ-ONLY'], 'requirement-backed candidates are retained without inventing a generic page gap');
  assert.match(project.generationWarning, /页面探索未完成/);
  assert.match(project.generationWarning, /没有返回页面探索候选/);
  assert.match(project.generationWarning, /页面缺口发现未完成/);
});

test('case generation follows bounded model-selected pages and binds exploration provenance to the matched page', async () => {
  const pageOne = {
    evidenceId: '8730649f-b88f-4e11-b41a-79dd35b87e8a', capturedAt: '2026-11-01T10:00:00.000Z',
    route: '/home', title: 'Home', headings: ['Home'], links: [{ label: 'Approvals', href: '/approvals' }], visibleText: ['Home page'], controls: [],
  };
  const pageTwo = {
    evidenceId: '45f74b2a-5cd1-41c8-85fb-445440ded922', capturedAt: '2026-11-01T10:00:01.000Z',
    route: '/approvals', title: 'Approvals', headings: ['Approval queue'], links: [], visibleText: ['Approval queue is empty'], controls: [],
  };
  assert.doesNotThrow(() => validateDraftLocatorsAgainstEvidence(
    [{ action: 'assertExactVisible', text: 'Approval queue is empty' }],
    JSON.stringify({ version: 1, pages: [pageOne, pageTwo] }),
  ), 'step locators and assertions may be grounded against any visited page');
  const calls = [];
  const project = { id: 'bounded-exploration', targetUrl: 'https://example.test/home', sourceText: 'R1: Review approvals.', researchExamples: [], caseMode: 'ai', cases: [] };
  const service = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: candidate => !(candidate.steps ?? []).some(step => ['assertText', 'assertVisible', 'assertExactVisible', 'assertRoleVisible'].includes(step.action)),
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases: candidates => candidates,
    saveProject: async () => {},
    collectPageEvidence: async () => { throw new Error('legacy single-page collector should not run'); },
    openPageExploration: async () => ({
      capture: async () => JSON.stringify(pageOne),
      followLink: async (evidenceId, index) => { calls.push(['follow', evidenceId, index]); return JSON.stringify(pageTwo); },
      promoteSession: async () => calls.push(['promote']),
      close: async () => calls.push(['close']),
    }),
    decidePageExploration: async ({ visitedPages }) => {
      calls.push(['decide', visitedPages.length]);
      return visitedPages.length === 1 ? { decision: 'follow-link', index: 0 } : { decision: 'stop', reason: 'Bearer synthetic-secret-token No further page.' };
    },
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async (_url, _item, pageEvidence) => {
      assert.equal(JSON.parse(pageEvidence).pages.length, 2);
      return [{ action: 'assertExactVisible', text: 'Approval queue is empty' }];
    },
    generateBrowserCases: async (_source, _examples, evidence) => {
      const pages = JSON.parse(evidence).pages;
      assert.equal(pages.length, 2);
      return [
        candidateCase('REQ-APPROVAL', ['R1 [in-scope]'], 'Approval queue is empty.'),
        candidateCase('EXP-APPROVAL', [], '当前页面观察到“Approval queue is empty”；业务预期待确认。'),
      ];
    },
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace: candidates => candidates,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
  });

  await service.generateBrowserCaseSet(project);

  assert.deepEqual(calls, [
    ['decide', 1],
    ['follow', pageOne.evidenceId, 0],
    ['decide', 2],
    ['promote'],
    ['close'],
  ]);
  const candidate = project.cases.find(item => item.id === 'EXP-APPROVAL');
  assert.equal(candidate.explorationEvidence.evidenceId, pageTwo.evidenceId);
  assert.equal(candidate.explorationEvidence.route, '/approvals');
  assert.deepEqual(candidate.steps, [{ action: 'assertExactVisible', text: 'Approval queue is empty' }]);
  const generatedRequirement = project.stepAuthoring.results.find(item => item.caseId === 'REQ-APPROVAL');
  assert.equal(generatedRequirement.pageEvidence.evidenceId, undefined, 'aggregate evidence must not claim one page as the source');
  assert.deepEqual(generatedRequirement.pageEvidence.pages.map(page => page.evidenceId), [pageOne.evidenceId, pageTwo.evidenceId]);
  assert.equal(generatedRequirement.pageEvidence.pages[0].route, '/home');
  assert.deepEqual(generatedRequirement.pageEvidence.pages[0].matchedLocators, []);
  assert.equal(generatedRequirement.pageEvidence.pages[1].route, '/approvals');
  assert.deepEqual(generatedRequirement.pageEvidence.pages[1].matchedLocators.map(match => [match.stepIndex, match.kind]), [[0, 'visible-text']]);
  assert.equal(generatedRequirement.pageEvidence.explorationStatus, 'stopped');
  assert.deepEqual(generatedRequirement.pageEvidence.decisionTrace.map(entry => [entry.decision, entry.status, entry.latestEvidenceId]), [
    ['follow-link', 'followed', pageOne.evidenceId],
    ['stop', 'stopped', pageTwo.evidenceId],
  ]);
  assert.deepEqual(generatedRequirement.pageEvidence.decisionTrace[0].inputEvidenceIds, [pageOne.evidenceId]);
  assert.equal(generatedRequirement.pageEvidence.decisionTrace[0].linkIndex, 0);
  assert.equal(generatedRequirement.pageEvidence.decisionTrace[0].selectedPath, '/approvals');
  assert.equal(generatedRequirement.pageEvidence.decisionTrace[0].resultingEvidenceId, pageTwo.evidenceId);
  assert.match(generatedRequirement.pageEvidence.decisionTrace[1].reason, /No further page/u);
  assert.doesNotMatch(generatedRequirement.pageEvidence.decisionTrace[1].reason, /synthetic-secret-token/u, 'stop-reason redaction remains applied from the domain utility');
  assert.match(generatedRequirement.pageEvidence.decisionTrace[1].reason, /\[REDACTED\]/u);
});

test('exploration decision timeout and navigation failure persist explicit incomplete trace entries', async () => {
  const page = { evidenceId: 'c8e3d616-7a33-4ec0-8f32-55216ca7e001', capturedAt: '2026-11-02T10:00:00.000Z', route: '/home', title: 'Home', headings: ['Home'], links: [{ label: 'Details', href: '/details' }], visibleText: ['Home'], controls: [] };
  const run = async (decision, capture = async () => JSON.stringify(page), promotionFails = false) => {
    const project = { id: 'trace-failure', targetUrl: 'https://example.test/home', sourceText: 'R1: Inspect page.', researchExamples: [], caseMode: 'ai', cases: [] };
    const service = createDocumentCaseStepAuthoringService({
      deriveGroundedEmptyListNavigationSubcheck: () => false, deriveGroundedCustomerLookupSubcheck: () => false,
      deriveGroundedEmptyRequiredFieldSubcheck: () => false, deriveRelatedInvalidInputSubcheck: () => false,
      addNoApiNetworkAssertion: () => false, hasOnlyGenericShellAssertions: () => false,
      browserStepDraftBlockReason: () => undefined, explainBlockedBrowserStepDraft: () => 'blocked',
      canAuthorReadOnlyBrowserSteps: () => true, draftGroundedReadOnlyBrowserSteps: () => undefined,
      validateCases: cases => cases, saveProject: async () => {}, collectPageEvidence: async () => JSON.stringify(page),
      openPageExploration: async () => ({ capture, followLink: async () => { throw new Error('Synthetic navigation failure'); }, promoteSession: async () => { if (promotionFails) throw new Error('Synthetic unsafe handoff'); }, close: async () => {} }),
      decidePageExploration: decision, modelAvailable: () => true, draftEvidenceBoundUiCheck: () => undefined,
      validateDraftLocatorsAgainstEvidence: () => {}, generateSteps: async () => [{ action: 'assertExactVisible', text: 'Home' }],
      generateBrowserCases: async () => [candidateCase('REQ-TRACE', ['R1 [in-scope]'], 'Home')],
      mergeBrowserCases: (_existing, generated) => generated, validateCasesPreservingGenerationTrace: cases => cases,
      requiresManualReview: () => true, hasAutoRunnableSelectedCase: () => false,
    });
    await service.generateBrowserCaseSet(project);
    return project.stepAuthoring.results.find(item => item.caseId === 'REQ-TRACE');
  };
  const timeout = await run(async () => { throw new Error('model timeout'); });
  assert.equal(timeout.pageEvidence.explorationStatus, 'incomplete');
  assert.equal(timeout.pageEvidence.decisionTrace.at(-1).status, 'incomplete');
  assert.match(timeout.pageEvidence.decisionTrace.at(-1).reason, /AI 页面决策超时/u);
  assert.deepEqual(timeout.pageEvidence.decisionTrace.at(-1).inputEvidenceIds, [page.evidenceId]);
  const navigation = await run(async () => ({ decision: 'follow-link', index: 0 }));
  assert.equal(navigation.pageEvidence.explorationStatus, 'incomplete');
  assert.equal(navigation.pageEvidence.decisionTrace[0].status, 'failed');
  assert.equal(navigation.pageEvidence.decisionTrace[0].linkIndex, 0);
  assert.equal(navigation.pageEvidence.decisionTrace[0].latestEvidenceId, page.evidenceId);
  assert.match(navigation.pageEvidence.decisionTrace[0].reason, /链接导航失败/u);
  const initialFailure = await run(async () => ({ decision: 'stop', reason: 'unused' }), async () => { throw new Error('Synthetic initial capture failure'); });
  assert.equal(initialFailure.status, 'blocked');
  assert.equal(initialFailure.pageEvidence.explorationStatus, 'incomplete');
  assert.equal(initialFailure.pageEvidence.route, '');
  assert.deepEqual(initialFailure.pageEvidence.pages, []);
  assert.deepEqual(initialFailure.pageEvidence.matchedLocators, []);
  assert.equal(initialFailure.pageEvidence.decisionTrace[0].status, 'incomplete');
  assert.deepEqual(initialFailure.pageEvidence.decisionTrace[0].inputEvidenceIds, []);
  const unsafeHandoff = await run(async () => ({ decision: 'stop', reason: 'Synthetic stop.' }), async () => JSON.stringify(page), true);
  assert.equal(unsafeHandoff.pageEvidence.explorationStatus, 'incomplete', 'a model stop cannot become complete when browser session preservation is blocked');
  assert.match(unsafeHandoff.pageEvidence.decisionTrace.at(-1).reason, /无法安全保留同源人工认证会话/u);
});
