import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDocumentExplorationDecisionAdapter } from '../../../src/adapters/ai/document-exploration-decision-adapter.ts';
import { createDocumentCaseStepAuthoringService } from '../../../src/application/cases/document-case-step-authoring-service.ts';
import { createDocumentCaseSelectionService } from '../../../src/application/cases/document-case-selection-service.ts';
import { createDocumentProjectReviewService } from '../../../src/application/projects/document-project-review-service.ts';
import { createDocumentProjectUpdateService } from '../../../src/application/projects/document-project-update-service.ts';
import { createDocumentRunApplicationService } from '../../../src/application/runs/execution/service.ts';
import { handleDocumentCaseSelectionRoute } from '../../../src/interfaces/http/document-cases/case-selection-routes.ts';
import { handleDocumentProjectReviewRoute } from '../../../src/interfaces/http/document-projects/project-review-routes.ts';
import { handleDocumentProjectUpdateRoute } from '../../../src/interfaces/http/document-projects/project-update-routes.ts';
import { validateCases, validateCasesPreservingGenerationTrace } from '../../../src/domain/documents/cases/case-validation.ts';
import { createDocumentProjectStore } from '../../../src/storage/document-projects/project-store.ts';
import { DocumentCaseEditorList } from '../../../web/src/features/document-tests/components/DocumentCaseEditorList.tsx';

const projectId = 'synthetic-exploration-adoption';
const candidateId = 'AI-EXP-001';

function renderReview(project) {
  return renderToStaticMarkup(React.createElement(DocumentCaseEditorList, {
    project,
    scope: { targetCaseIds: [], impactCaseIds: [] }, busy: false, onRunCase: () => {}, stepDrafts: {}, probeBusyKey: '', probeResults: {},
    cases: { toggleSelection: () => {}, selectOnly: () => {}, remove: () => {}, edit: () => {}, editList: () => {}, setTestDataRequirements: () => {}, setLifecycle: () => {}, confirmPreconditions: () => {}, editSteps: () => {} },
    steps: { update: () => {}, change: () => {}, add: () => {}, remove: () => {}, move: () => {}, probe: async () => {} },
  }));
}

test('synthetic page exploration candidate keeps trusted evidence through HTTP review, versions, and human run eligibility', { timeout: 30_000 }, async t => {
  const target = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/approvals') res.end('<!doctype html><html><body><main><h1>Approvals</h1><p>Approval queue empty</p></main></body></html>');
    else res.end('<!doctype html><html><body><main><h1>Home</h1><a href="/approvals">Approvals</a></main></body></html>');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  t.after(() => new Promise(resolve => target.close(resolve)));
  const targetAddress = target.address();
  const targetUrl = `http://127.0.0.1:${targetAddress.port}/`;
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-exploration-adoption-'));
  t.after(() => rm(storageDir, { recursive: true, force: true }));

  const modelRequests = [];
  const modelDecisions = [
    { decision: 'follow-link', index: 0 },
    { decision: 'stop', reason: 'No more relevant visible pages in this synthetic fixture.' },
  ];
  const modelServer = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer local-synthetic-key');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      modelRequests.push(payload);
      assert.equal(payload.model, 'synthetic-local-model');
      assert.equal(payload.stream, false, 'case planning and page decisions use the non-streaming Chat Completions contract');
      const systemPrompt = payload.messages.find(message => message.role === 'system')?.content ?? '';
      let content;
      if (systemPrompt.includes('read-only website exploration decision maker')) {
        content = JSON.stringify(modelDecisions.shift());
      } else if (systemPrompt.includes("TestPilot's test-case planner")) {
        const userPrompt = payload.messages.find(message => message.role === 'user')?.content ?? '';
        assert.match(userPrompt, /Explore visible navigation and report concrete observed page content/);
        assert.match(userPrompt, /Approval queue empty/);
        assert.match(userPrompt, /"route":"\/approvals"/);
        content = JSON.stringify({ cases: [{
          id: candidateId, title: 'All applications have been approved', source: 'I inferred completed approvals from the queue.', requirementRefs: ['探索性检查'],
          priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'],
          preconditions: ['A manager account is signed in.'], testData: ['An approved request'],
          sideEffectRisk: 'irreversible', cleanup: 'Undo the approval after this check.', kind: 'visible',
          expected: 'Approval queue empty proves every application was approved.',
          steps: [{ action: 'clickByRole', role: 'link', name: 'Approvals' }],
        }] });
      } else throw new Error('Unexpected model stage in the synthetic exploration test.');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    }
  });
  modelServer.listen(0, '127.0.0.1');
  await once(modelServer, 'listening');
  t.after(() => new Promise(resolve => modelServer.close(resolve)));
  const previousModelEnvironment = Object.fromEntries(['TESTPILOT_DATA_DIR', 'TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL'].map(key => [key, process.env[key]]));
  process.env.TESTPILOT_DATA_DIR = storageDir;
  process.env.TESTPILOT_API_KEY = 'local-synthetic-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${modelServer.address().port}/v1`;
  process.env.TESTPILOT_MODEL = 'synthetic-local-model';
  t.after(() => {
    for (const [key, value] of Object.entries(previousModelEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const [{ compatibleChatModelProvider }, { generateDocumentBrowserCases }] = await Promise.all([
    import('../../../src/adapters/ai/compatible-chat.ts'),
    import('../../../src/server/runtime.ts'),
  ]);
  const explorationDecision = createDocumentExplorationDecisionAdapter(compatibleChatModelProvider);
  const store = createDocumentProjectStore(storageDir);
  const project = {
    id: projectId, name: 'Synthetic exploration project', fileName: 'synthetic.txt', format: 'txt',
    targetUrl, sourceText: 'Explore visible navigation and report concrete observed page content.',
    cases: [], caseMode: 'ai', confirmationRequired: true, reviewStatus: 'draft', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
  };
  await store.saveProject(project);

  let pageSequence = 0;
  let latestSnapshot;
  const openPageExploration = async () => ({
    async capture() { return latestSnapshot ??= await snapshot('/'); },
    async followLink(evidenceId, index) {
      assert.equal(evidenceId, '20000000-0000-4000-8000-000000000001');
      assert.equal(index, 0);
      latestSnapshot = await snapshot('/approvals');
      return latestSnapshot;
    },
    async promoteSession() {},
    async close() {},
  });
  async function snapshot(route) {
    const response = await fetch(new URL(route, targetUrl));
    assert.equal(response.status, 200);
    const html = await response.text();
    const sequence = ++pageSequence;
    const heading = html.match(/<h1>([^<]+)<\/h1>/iu)?.[1] ?? '';
    const visibleText = [...html.matchAll(/<(?:h1|p|a)\b[^>]*>([^<]+)<\/(?:h1|p|a)>/giu)].map(match => match[1].trim());
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/giu)].map(match => ({ label: match[2].trim(), href: match[1] }));
    return JSON.stringify({
      evidenceId: `20000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      capturedAt: `2026-11-02T00:00:0${sequence}.000Z`, route,
      title: heading,
      headings: [heading],
      controls: [],
      links,
      visibleText,
    });
  }

  const authoring = createDocumentCaseStepAuthoringService({
    deriveGroundedEmptyListNavigationSubcheck: () => false,
    deriveGroundedCustomerLookupSubcheck: () => false,
    deriveGroundedEmptyRequiredFieldSubcheck: () => false,
    deriveRelatedInvalidInputSubcheck: () => false,
    addNoApiNetworkAssertion: () => false,
    hasOnlyGenericShellAssertions: () => false,
    browserStepDraftBlockReason: () => undefined,
    explainBlockedBrowserStepDraft: () => 'blocked',
    canAuthorReadOnlyBrowserSteps: () => true,
    draftGroundedReadOnlyBrowserSteps: () => undefined,
    validateCases,
    saveProject: store.saveProject,
    collectPageEvidence: async () => { throw new Error('legacy collector should not be used'); },
    openPageExploration,
    decidePageExploration: explorationDecision.decide,
    modelAvailable: () => true,
    draftEvidenceBoundUiCheck: () => undefined,
    validateDraftLocatorsAgainstEvidence: () => {},
    generateSteps: async () => [],
    generateBrowserCases: generateDocumentBrowserCases,
    mergeBrowserCases: (_existing, generated) => generated,
    validateCasesPreservingGenerationTrace,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-02T00:00:10.000Z',
  });
  await authoring.generateBrowserCaseSet(project);
  assert.equal(project.cases[0].id, candidateId, 'the production case planner candidate reaches the project authoring pipeline');
  assert.equal(project.cases[0].caseOrigin, 'ai-generated');
  assert.equal(project.cases[0].title, '页面当前可见：Approval queue empty');
  assert.equal(project.cases[0].priority, 'P3', 'the server downgrades a page observation to exploratory priority');
  assert.equal(project.cases[0].category, 'visual');
  assert.equal(project.cases[0].confidence, 'low');
  assert.equal(project.cases[0].expected, '当前页面观察到“Approval queue empty”；业务预期待确认。');
  assert.deepEqual(project.cases[0].preconditions, ['当前页面可见状态不等于业务长期预期；业务预期、角色、测试数据和副作用范围待确认。']);
  assert.deepEqual(project.cases[0].testData, []);
  assert.equal(project.cases[0].sideEffectRisk, 'unknown');
  assert.equal(project.cases[0].cleanup, '', 'untrusted model cleanup instructions do not survive into a read-only observation candidate');
  assert.deepEqual(project.cases[0].steps, [{ action: 'assertExactVisible', text: 'Approval queue empty' }]);
  assert.equal(project.cases[0].lifecycleStatus, 'draft');
  assert.equal(project.cases[0].selectedForRegression, false);
  assert.equal(project.cases[0].explorationEvidence.route, '/approvals');
  assert.ok(project.stepAuthoring.results[0].pageEvidence, JSON.stringify(project.stepAuthoring));
  assert.equal(project.stepAuthoring.results[0].pageEvidence.explorationStatus, 'stopped');
  assert.deepEqual(project.stepAuthoring.results[0].pageEvidence.decisionTrace.map(entry => entry.decision), ['follow-link', 'stop']);
  assert.equal(modelRequests.length, 3, 'production model adapters decide both page transitions, then the production case planner generates an evidence-backed candidate');
  assert.deepEqual(modelRequests.map(request => request.response_format), [{ type: 'json_object' }, { type: 'json_object' }, { type: 'json_object' }]);
  const firstModelInput = JSON.parse(modelRequests[0].messages[1].content);
  assert.equal(firstModelInput.requirements, project.sourceText);
  assert.deepEqual(firstModelInput.visitedPages.map(page => page.route), ['/']);
  assert.deepEqual(firstModelInput.currentPageLinkIndexes, [{ index: 0, label: 'Approvals', href: '/approvals' }]);
  const secondModelInput = JSON.parse(modelRequests[1].messages[1].content);
  assert.deepEqual(secondModelInput.visitedPages.map(page => page.route), ['/', '/approvals']);
  assert.ok(secondModelInput.visitedPages[1].visibleText.includes('Approval queue empty'));
  assert.deepEqual(secondModelInput.currentPageLinkIndexes, []);
  const plannerRequest = modelRequests[2];
  assert.match(plannerRequest.messages[1].content, /two tracks/);
  assert.match(plannerRequest.messages[1].content, new RegExp(project.sourceText));
  assert.match(plannerRequest.messages[1].content, /Approval queue empty/);
  await store.saveProject(project);

  const updateService = createDocumentProjectUpdateService({
    projects: store,
    validateTarget: value => new URL(value).href,
    validateCases: (value, existing) => validateCasesPreservingGenerationTrace(value, existing),
    containsCredentialLikeValue: () => false,
    requiresManualReview: () => true,
    hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-02T00:00:20.000Z',
  });
  const reviewService = createDocumentProjectReviewService({
    projects: store,
    validateCases: cases => validateCasesPreservingGenerationTrace(cases, cases),
    ensureWorkflow: async () => ({ workflowId: 'synthetic-workflow' }),
    completeApprovalGate: async () => {},
    now: () => '2026-11-02T00:00:30.000Z',
  });
  const selectionService = createDocumentCaseSelectionService({
    projects: store, requiresManualReview: () => true, hasAutoRunnableSelectedCase: () => false,
    now: () => '2026-11-02T00:00:25.000Z',
  });
  let executedCaseIds = [];
  const runService = createDocumentRunApplicationService({
    getProject: store.getProject,
    executor: async (_project, options) => { executedCaseIds = options.selectedCaseIds; return { id: 'synthetic-run', projectId, selectedCaseIds: options.selectedCaseIds }; },
  });
  const api = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const getProject = id => store.getProject(id);
    if (await handleDocumentProjectUpdateRoute(req, res, url.pathname, { getProject, update: updateService.update })) return;
    if (await handleDocumentCaseSelectionRoute(req, res, url.pathname, selectionService.select)) return;
    if (await handleDocumentProjectReviewRoute(req, res, url.pathname, { getProject, approve: reviewService.approve })) return;
    res.writeHead(404); res.end();
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise(resolve => api.close(resolve)));
  const apiBase = `http://127.0.0.1:${api.address().port}`;
  const post = (route, body) => fetch(`${apiBase}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const afterGeneration = await store.getProject(projectId);
  const evidenceId = afterGeneration.cases[0].explorationEvidence.evidenceId;
  assert.equal(afterGeneration.cases[0].selectedForRegression, false);
  const revisions = async (kind) => (await store.listRevisions(projectId, { kind, entityId: candidateId })).items;
  assert.equal((await revisions('case')).length, 1);
  assert.equal((await revisions('steps')).length, 1);
  assert.equal((await revisions('step-evidence')).length, 1);

  const blockedDraftSelection = await post(`/api/document-projects/${projectId}/selection`, { caseIds: [candidateId], selected: true });
  assert.equal(blockedDraftSelection.status, 422, await blockedDraftSelection.text());

  // The review UI's save-before-review update request must preserve the server's
  // trusted evidence and decision trace when it resubmits the case snapshot.
  const saveResponse = await post(`/api/document-projects/${projectId}/update`, { cases: afterGeneration.cases, targetUrl });
  assert.equal(saveResponse.status, 200, await saveResponse.text());
  let reloaded = await store.getProject(projectId);
  assert.equal(reloaded.cases[0].explorationEvidence.evidenceId, evidenceId);
  assert.equal(reloaded.stepAuthoring.results[0].pageEvidence.decisionTrace[0].selectedPath, '/approvals');
  let html = renderReview(reloaded);
  assert.match(html, /AI 页面探索决策复核/);
  assert.match(html, /跟随第 1 个可见链接「Approvals」/);
  assert.match(html, new RegExp(evidenceId));
  assert.match(html, /草稿/);

  // Human edits the candidate into a runnable case, then explicitly selects it.
  const runnableCase = {
    ...reloaded.cases[0], lifecycleStatus: 'runnable', selectedForRegression: false,
    sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true,
  };
  const runnableSave = await post(`/api/document-projects/${projectId}/update`, { cases: [runnableCase] });
  assert.equal(runnableSave.status, 200, await runnableSave.text());
  reloaded = await store.getProject(projectId);
  assert.equal(reloaded.cases[0].lifecycleStatus, 'runnable');
  assert.equal(reloaded.cases[0].selectedForRegression, false);
  assert.equal(reloaded.cases[0].explorationEvidence.evidenceId, evidenceId, 'trusted provenance survives human lifecycle changes');
  assert.equal(reloaded.reviewStatus, 'draft', 'changing readiness does not auto-approve');

  const selectResponse = await post(`/api/document-projects/${projectId}/selection`, { caseIds: [candidateId], selected: true });
  assert.equal(selectResponse.status, 200, await selectResponse.text());
  reloaded = await store.getProject(projectId);
  assert.equal(reloaded.cases[0].selectedForRegression, true);
  assert.equal(reloaded.reviewStatus, 'draft', 'selection alone does not approve a manual-review project');
  await assert.rejects(runService.execute(projectId, { selectedCaseIds: [candidateId] }), /尚未审核通过/u, 'selected runnable case is still blocked from execution before review');

  const approvalResponse = await post(`/api/document-projects/${projectId}/review`, { decision: 'approve', notes: 'Reviewed synthetic page evidence and read-only assertion.' });
  assert.equal(approvalResponse.status, 200, await approvalResponse.text());
  const approved = await store.getProject(projectId);
  assert.equal(approved.reviewStatus, 'approved');
  assert.equal(approved.cases[0].explorationEvidence.evidenceId, evidenceId);
  const eligibleRunIds = approved.cases.filter(item => item.lifecycleStatus === 'runnable' && item.selectedForRegression !== false).map(item => item.id);
  assert.deepEqual(eligibleRunIds, [candidateId], 'only a human-readied, explicitly selected, reviewed case enters run selection');
  await runService.execute(projectId, { selectedCaseIds: eligibleRunIds });
  assert.deepEqual(executedCaseIds, [candidateId], 'the run application receives the reviewed selection');

  const caseRevisions = await revisions('case');
  const stepRevisions = await revisions('steps');
  const evidenceRevisions = await revisions('step-evidence');
  assert.ok(caseRevisions.length >= 2, 'manual lifecycle changes create a new case revision');
  assert.ok(stepRevisions.length >= 1);
  assert.ok(evidenceRevisions.length >= 1);
  const latestCaseRevision = await store.getRevision(projectId, caseRevisions[0].id);
  const latestStepsRevision = await store.getRevision(projectId, stepRevisions[0].id);
  const latestEvidenceRevision = await store.getRevision(projectId, evidenceRevisions[0].id);
  assert.equal(latestCaseRevision.snapshot.explorationEvidence.evidenceId, evidenceId);
  assert.deepEqual(latestStepsRevision.snapshot, [{ action: 'assertExactVisible', text: 'Approval queue empty' }]);
  assert.deepEqual(latestEvidenceRevision.snapshot.pageEvidence.decisionTrace.map(entry => entry.decision), ['follow-link', 'stop']);
});
