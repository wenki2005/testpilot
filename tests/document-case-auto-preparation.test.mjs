import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentCaseStepAuthoringService } from '../src/application/cases/document-case-step-authoring-service.ts';
import { validateCases } from '../src/domain/document-case-validation.ts';
import { canAuthorReadOnlyBrowserSteps } from '../src/domain/document-case-authoring.ts';
import { missingDirectAssertion } from '../src/domain/document-case-assertion-quality.ts';

function fixture(overrides = {}, generatedSteps = [{ action: 'assertExactVisible', text: 'Ready' }], dependencyOverrides = {}) {
  const context = { sources: [{ label: 'form', path: 'form.ts', sha256: 'a'.repeat(64), startLine: 1, endLine: 1, excerpt: 'SOURCE_OBSERVATION' }], database: { connected: false, capability: 'read-only-explorer', resultEvidence: false }, warnings: [] };
  const evidence = JSON.stringify({ evidenceId: '3b4c4f0e-359d-44f1-8a19-3fc4d8046ed1', title: 'Form', route: '/', controls: [], visibleText: ['Ready'] });
  const item = { id: 'c', title: '页面提示文案', expected: 'Ready', source: 'requirement', kind: 'visible', priority: 'P2', confidence: 'medium', steps: [], lifecycleStatus: 'draft', selectedForRegression: false, sideEffectRisk: 'none', preconditions: [], ...overrides };
  const project = { id: 'p', targetUrl: 'http://127.0.0.1:9000/', cases: [item], reviewStatus: 'draft', confirmationRequired: false };
  const calls = [];
  const service = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false, deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false, deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false, hasOnlyGenericShellAssertions: () => false,
    browserStepDraftBlockReason: () => undefined, explainBlockedBrowserStepDraft: () => 'Concrete prerequisite unresolved',
    canAuthorReadOnlyBrowserSteps: () => true, draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases, saveProject: async () => {}, collectPageEvidence: async () => evidence,
    modelAvailable: () => true, draftEvidenceBoundUiCheck: () => undefined, validateDraftLocatorsAgainstEvidence: () => {},
    collectAuthoringContext: async () => context,
    generateSteps: async (...args) => { calls.push(args); return generatedSteps; },
    generateBrowserCases: async () => [], mergeBrowserCases: existing => existing,
    validateCasesPreservingGenerationTrace: cases => cases, requiresManualReview: () => false,
    hasAutoRunnableSelectedCase: () => false,
    ...dependencyOverrides,
  });
  return { service, project, calls, context };
}

test('authoring binds a discovered page only after fresh route evidence and retains existing case expectations', async () => {
  const visited = [];
  const { service, project, calls } = fixture({}, undefined, {
    resolveNavigationEvidence: async () => ({ mapId: 'map-1', pageId: 'page-1', route: '/records' }),
    collectPageEvidence: async p => { visited.push(p.targetUrl); return JSON.stringify({ evidenceId: '3b4c4f0e-359d-44f1-8a19-3fc4d8046ed1', capturedAt: new Date().toISOString(), route: p.targetUrl.endsWith('/records') ? '/records' : '/', headings: ['Records'], controls: [], visibleText: ['Ready'] }); },
  });
  const beforeExpected = project.cases[0].expected;
  const outcome = await service.prepareSelectedBrowserCases(project, ['c']);
  assert.deepEqual(outcome.readyCaseIds, ['c']); assert.equal(project.cases[0].entryPath, '/records');
  assert.ok(visited.includes('http://127.0.0.1:9000/records')); assert.equal(calls[0][0], 'http://127.0.0.1:9000/records');
  assert.equal(project.cases[0].expected, beforeExpected); assert.match(outcome.warning, /map-1/u);
});

test('a discovered route redirecting elsewhere cannot become an executable case', async () => {
  const { service, project, calls } = fixture({}, undefined, { resolveNavigationEvidence: async () => ({ mapId: 'm', pageId: 'p', route: '/missing' }) });
  const result = await service.prepareSelectedBrowserCases(project, ['c']);
  assert.deepEqual(result.readyCaseIds, []); assert.equal(calls.length, 0); assert.equal(project.cases[0].entryPath, undefined);
  assert.match(result.pending[0].reason ?? result.caseResults[0].detail, /没有到达原页面/u);
});

test('a navigation model failure blocks only that case and cannot fall back to home or abort other cases',async()=>{
  const {service,project,calls}=fixture({},undefined,{resolveNavigationEvidence:async(_project,item)=>{if(item.id==='c')throw Error('用例页面尚未确认：当前订单为空，详情不存在。');return undefined;}});
  project.cases.push({...project.cases[0],id:'other'});
  const result=await service.prepareSelectedBrowserCases(project,['c','other']);
  assert.deepEqual(result.readyCaseIds,['other']);assert.match(result.caseResults.find(r=>r.caseId==='c').detail,/当前订单为空/u);
  assert.equal(calls.length,1);assert.equal(calls[0][1].id,'other');
});

test('agent preparation promotes only a complete page-grounded read-only draft and retains source provenance', async () => {
  const { service, project, calls, context } = fixture();
  const result = await service.prepareSelectedBrowserCases(project, ['c']);
  assert.deepEqual(result.readyCaseIds, ['c']);
  assert.equal(project.cases[0].lifecycleStatus, 'runnable');
  assert.equal(project.reviewStatus, 'approved');
  assert.deepEqual(calls[0][4], context, 'model receives the actual source observations');
  assert.equal(result.caseResults[0].authoringContext.sources[0].sha256, 'a'.repeat(64));
  assert.equal(JSON.stringify(result.caseResults).includes('SOURCE_OBSERVATION'), false, 'raw source is not persisted in case result');
  assert.equal(result.regressionStarted, false, 'preparation is not a fabricated execution result');
});

test('coverage gaps, unconfirmed specific prerequisites, disabled cases and review requirements never auto-promote', async () => {
  for (const changes of [{ coverageGap: 'Need backend readback' }, { preconditions: ['An approved order exists'], preconditionsConfirmed: false }, { lifecycleStatus: 'disabled' }]) {
    const { service, project } = fixture(changes);
    const result = await service.prepareSelectedBrowserCases(project, ['c']);
    assert.deepEqual(result.readyCaseIds, []);
    assert.equal(result.pending.length, 1);
    assert.equal(project.cases[0].lifecycleStatus, changes.lifecycleStatus ?? 'draft');
  }
  const { service, project } = fixture(); project.confirmationRequired = true;
  assert.deepEqual((await service.prepareSelectedBrowserCases(project, ['c'])).readyCaseIds, []);
  assert.equal(project.reviewStatus, 'draft');
});

test('existing complete regression scripts do not collect page evidence or invoke authoring', async () => {
  const { service, project, calls } = fixture({ lifecycleStatus: 'runnable', steps: [{ action: 'assertExactVisible', text: 'Ready' }] });
  const result = await service.prepareCompareRun(project, ['c'], async () => { throw new Error('must not collect'); });
  assert.deepEqual(result.generatedCaseIds, []);
  assert.equal(calls.length, 0);
});

test('empty search results and region field selection are authorable UI cases rather than assumed missing fixtures', () => {
  for (const title of ['无匹配客户：下拉无结果并提示', '逐级选择成功回填所在地区']) {
    assert.equal(canAuthorReadOnlyBrowserSteps({ title, expected: title, source: '', confidence: 'medium', steps: [] }), true);
  }
  assert.equal(canAuthorReadOnlyBrowserSteps({ title: '审批通过后扣减库存', expected: '数据库库存扣减', source: '', confidence: 'medium', steps: [] }), false);
});

test('the exact real-world false passes are rejected in authoring and both runtime lanes', () => {
  assert.match(missingDirectAssertion({ title: '无匹配客户：下拉无结果并提示', expected: '下拉无结果并提示', steps: [
    { action: 'fillByRoleIndex', role: 'combobox', index: 1, value: 'no-client' }, { action: 'assertText', text: '总计：¥0.00' },
  ] }), /空结果/);
  assert.match(missingDirectAssertion({ title: '逐级选择成功回填所在地区', expected: '逐级选择成功回填所在地区', steps: [
    { action: 'assertVisible', text: '请选择省' }, { action: 'assertVisible', text: '请选择市' }, { action: 'assertVisible', text: '请选择区' },
  ] }), /三级实际选择/);
  assert.equal(missingDirectAssertion({ title: '逐级选择成功回填所在地区', expected: '逐级选择成功回填所在地区', steps: ['省', '市', '区'].flatMap((value, index) => [
    { action: 'selectByRoleIndex', role: 'combobox', index, value }, { action: 'assertValueByPlaceholder', placeholder: `请选择${value}`, value },
  ]) }), undefined);
});

test('an unrelated model assertion gets one corrective attempt and cannot become runnable', async () => {
  const { service, project, calls } = fixture({ title: '逐级选择成功回填所在地区', expected: '逐级选择成功回填所在地区' });
  const result = await service.prepareSelectedBrowserCases(project, ['c']);
  assert.deepEqual(result.readyCaseIds, []);
  assert.equal(calls.length, 2);
  assert.match(calls[1][3], /三级实际选择/);
  assert.equal(result.caseResults[0].status, 'blocked');
  assert.equal(project.cases[0].lifecycleStatus, 'draft');
});

test('database fixture validation receives frozen context and rejects missing observed values without changing source literals', async () => {
  const { service, project, calls, context } = fixture({}, undefined, {
    databaseFixtureAssertionGap: (_project, item, frozen) => {
      assert.equal(frozen,context); assert.equal(item.expected,'Ready');
      return '缺少数据库夹具逐行小计 28.00';
    },
  });
  const result=await service.prepareSelectedBrowserCases(project,['c']);
  assert.deepEqual(result.readyCaseIds,[]); assert.equal(calls.length,2);
  assert.match(result.caseResults[0].detail,/28\.00/u);assert.equal(project.cases[0].expected,'Ready');
});

test('a previously generated weak script also enters correction and is withdrawn from the runnable scope', async () => {
  const { service, project, calls } = fixture({ title: '逐级选择成功回填所在地区', expected: '逐级选择成功回填所在地区', lifecycleStatus: 'runnable', steps: [{ action: 'assertVisible', text: '请选择省' }] });
  const result = await service.prepareSelectedBrowserCases(project, ['c']);
  assert.equal(calls.length, 2, 'existing invalid steps must not bypass the AI correction queue');
  assert.match(calls[0][3], /三级实际选择/);
  assert.equal(result.caseResults[0].status, 'blocked');
  assert.deepEqual(result.readyCaseIds, []);
  assert.equal(project.cases[0].lifecycleStatus, 'draft');
  assert.equal(project.cases[0].selectedForRegression, false);
});

test('importer boilerplate is never reported as proof of a missing account when step generation fails', async () => {
  const { service, project } = fixture({ preconditions: ['需要目标系统专用测试环境和/或测试账号、接口 mock/沙箱数据'] }, []);
  const result = await service.generateSelectedBrowserSteps(project, ['c']);
  assert.equal(result.caseResults[0].status, 'blocked');
  assert.doesNotMatch(result.caseResults[0].detail, /缺少角色|需要核实角色|缺少.{0,8}账号/);
  assert.match(result.caseResults[0].detail, /步骤编写或页面证据不足/);
});
