import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const dataDir = await mkdtemp(resolve(tmpdir(), 'testpilot-run-progress-'));
process.env.TESTPILOT_DATA_DIR = dataDir;
process.env.TESTPILOT_BROWSER_CDP_ENDPOINT = '';
process.env.TESTPILOT_BROWSER_HEADLESS = '1';
process.env.TESTPILOT_BROWSER_CHANNEL = '';
process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN = '0';
process.env.TESTPILOT_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const { executeDocumentRun, getDocumentProjectSessionStatus, getDocumentRunProgress } = await import('../dist/adapters/document-test-workflow.js');
const { closePersistentTestPages } = await import('../dist/adapters/browser-runtime.js');
const {
  DOCUMENT_WORKFLOW_STAGES,
  completeDocumentWorkflow,
  completeDocumentWorkflowStage,
  createDocumentWorkflow,
  startDocumentWorkflowStage,
} = await import('../dist/adapters/document-workflow-record.js');

test('runId injection exposes live journal progress and the completed full run', { timeout: 30_000 }, async t => {
  const server = createServer(async (req, res) => {
    if (req.headers.accept?.includes('text/html')) await delay(250);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>Local baseline marker</h1></body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await closePersistentTestPages();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      // Windows may hold the managed browser profile's Crashpad metrics file
      // briefly after disconnect; the fixture directory is unique and contains
      // no user data, so cleanup failure must not invalidate run assertions.
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const projectId = 'progress-local-fixture';
  const project = {
    id: projectId,
    name: 'Local run progress fixture',
    fileName: 'fixture.md',
    caseMode: 'existing',
    format: 'markdown',
    targetUrl: `http://127.0.0.1:${server.address().port}/#/home`,
    sourceText: 'Local-only progress integration fixture.',
    cases: [{
      id: 'case-local-marker',
      title: 'Shows the local baseline marker',
      source: 'fixture.md:1',
      requirementRefs: ['fixture.md:1'],
      priority: 'P1',
      category: 'functional',
      confidence: 'high',
      coverageAreas: ['functional'],
      selectedForRegression: true,
      preconditions: [],
      preconditionsConfirmed: true,
      testData: [],
      sideEffectRisk: 'none',
      cleanup: '',
      kind: 'visible',
      expected: 'Local baseline marker is visible',
      steps: [{ action: 'assertExactVisible', text: 'Local baseline marker' }],
    }],
    reviewStatus: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const runId = 'local-progress-run-1';
  const runPromise = executeDocumentRun(project, {
    runId,
    runMode: 'compare',
    selectedCaseIds: ['case-local-marker'],
    beforeDeterministic: async () => ({ generatedCaseIds: [], warning: '1 UI subcheck requires a grounded locator.' }),
  });

  let active;
  for (let attempt = 0; attempt < 200; attempt++) {
    active = await getDocumentRunProgress(runId);
    if (active?.status === 'running' && active.currentCase?.id === 'case-local-marker' && active.stepGeneration) break;
    await delay(20);
  }
  assert.equal(active?.status, 'running', 'caller-selected runId must expose a running journal');
  assert.equal(active?.stage, 'deterministic');
  assert.equal(active?.currentCase?.id, 'case-local-marker', 'the active case must be observable before completion');
  assert.deepEqual(active?.stepGeneration?.generatedCaseIds, [], 'step-generation output must be visible before the long dual-lane run completes');
  assert.match(active?.stepGeneration?.warning ?? '', /grounded locator/u);
  assert.equal(active?.progress.total, 2, 'the current scope is one case in each browser lane');
  const occupiedSession = await getDocumentProjectSessionStatus(project);
  assert.equal(occupiedSession.state, 'occupied', 'session inspection must expose the active project browser lease');
  assert.equal(occupiedSession.occupied, true);
  assert.match(occupiedSession.message, /占用/u);

  const completedRun = await runPromise;
  assert.equal(completedRun.id, runId, 'the returned run must retain the injected ID');
  const finished = await getDocumentRunProgress(runId);
  assert.equal(finished?.status, 'completed');
  assert.equal(finished?.run?.id, runId);
  assert.deepEqual(finished?.run?.caseScope.selectedCaseIds, ['case-local-marker']);
  assert.equal(finished?.run?.deterministic.results[0]?.status, 'passed');
  assert.equal(finished?.progress.completed, 2);
  assert.equal(await getDocumentRunProgress('../escape'), undefined, 'invalid IDs cannot escape the runs directory');
});

test('completed run progress waits for the linked workflow finalizer before exposing terminal state', async t => {
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const runId = 'workflow-finalization-progress-run';
  const projectId = 'workflow-finalization-progress-project';
  const workflow = await createDocumentWorkflow({ projectId, runId, approvalPolicy: 'automatic' });
  const specialists = {
    'generate-cases': 'case-generator',
    'review-cases': 'case-reviewer',
    'author-steps': 'step-author',
    'human-approval': 'human-review-gate',
    'deterministic-execution': 'deterministic-executor',
    'computer-use-execution': 'computer-use-observer',
    'analyze-results': 'result-analyst',
    'generate-report': 'report-writer',
    'package-artifacts': 'report-packager',
  };
  for (const stageId of DOCUMENT_WORKFLOW_STAGES.filter(id => id !== 'package-artifacts')) {
    const started = await startDocumentWorkflowStage(workflow.workflowId, {
      stageId,
      specialist: specialists[stageId],
      input: { runId, stageId },
    });
    await completeDocumentWorkflowStage(workflow.workflowId, stageId, started.stage.attempt, [`fixture:${stageId}`]);
  }
  const packaging = await startDocumentWorkflowStage(workflow.workflowId, {
    stageId: 'package-artifacts',
    specialist: specialists['package-artifacts'],
    input: { runId, stageId: 'package-artifacts' },
  });

  const runDirectory = join(dataDir, 'document-tests', 'runs', runId);
  const now = new Date().toISOString();
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, 'execution.json'), JSON.stringify({
    version: 1,
    runId,
    projectId,
    workflowId: workflow.workflowId,
    projectDigest: 'a'.repeat(64),
    targetUrl: 'http://127.0.0.1/',
    selectedCaseIds: ['case-1'],
    startedAt: now,
    updatedAt: now,
    status: 'completed',
    stage: 'packaging',
    resumeCount: 0,
    caseResults: [],
  }));
  await writeFile(join(runDirectory, 'run.json'), JSON.stringify({
    id: runId,
    projectId,
    workflowId: workflow.workflowId,
    startedAt: now,
    completedAt: now,
    caseScope: { selectedCaseIds: ['case-1'], excludedCaseIds: [], totalCases: 1 },
    deterministic: { status: 'passed', summary: 'fixture', results: [] },
    ai: { status: 'passed', summary: 'fixture', results: [] },
    comparisons: [{ id: 'case-1', title: 'Fixture', deterministic: 'passed', computerUse: 'passed', aligned: true, issue: '' }],
    finalReady: true,
    overall: 'passed',
    report: 'fixture report',
    packagePath: join(runDirectory, 'testpilot-package.zip'),
  }));

  const pending = await getDocumentRunProgress(runId);
  assert.equal(pending?.status, 'running');
  assert.equal(pending?.stage, 'packaging');
  assert.equal(pending?.workflowStatus, 'running');
  assert.equal(pending?.run, undefined, 'terminal run payload stays hidden while its workflow is unfinished');

  await completeDocumentWorkflowStage(workflow.workflowId, 'package-artifacts', packaging.stage.attempt, [`run:${runId}:package-artifacts`]);
  await completeDocumentWorkflow(workflow.workflowId);
  const completed = await getDocumentRunProgress(runId);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.workflowStatus, 'completed');
  assert.equal(completed?.run?.id, runId);
});
