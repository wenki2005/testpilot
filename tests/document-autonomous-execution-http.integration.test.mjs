import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createAutonomousRegressionPlanner } from '../src/application/cases/document-autonomous-regression-planner.ts';
import { createDocumentAutonomousPlanService } from '../src/application/cases/document-autonomous-plan-service.ts';
import { createDocumentAutonomousPlanStore } from '../src/storage/document-autonomous-plan-store.ts';
import { createDocumentAutonomousExecutionStore } from '../src/storage/document-autonomous-execution-store.ts';
import { createDocumentAutonomousPlanExecutionService } from '../src/application/runs/document-autonomous-plan-execution-service.ts';
import { handleDocumentAutonomousExecutionRoutes } from '../src/interfaces/http/document-autonomous-execution-routes.ts';
import { validateDocumentRunScopePlan } from '../src/domain/document-run-scope.ts';

test('HTTP execution links frozen plans through durable intent, deduplicates and reconciles real run outcomes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tp-plan-execution-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const versionId = randomUUID();
  const item = (id, dependsOnCaseIds = []) => ({ id, title: id, source: 'fixture', expected: 'Ready',
    lifecycleStatus: 'runnable', preconditions: [], preconditionsConfirmed: true, sideEffectRisk: 'none',
    dependsOnCaseIds, steps: [{ action: 'assertExactVisible', text: 'Ready' }] });
  const project = { id: 'local-project', workflowId: 'old-workflow', reviewStatus: 'approved', confirmationRequired: true, cases: [item('setup'), item('target', ['setup'])],
    targetUrl: 'https://never-open.invalid/', siteVersions: [{ id: versionId, targetUrl: 'https://never-open.invalid/', changeNotes: 'target changed' }] };
  const plans = createDocumentAutonomousPlanStore(path.join(directory, 'plans'));
  const executions = createDocumentAutonomousExecutionStore(path.join(directory, 'executions'));
  const planService = createDocumentAutonomousPlanService({ getProject: async id => id === project.id ? project : undefined,
    planner: createAutonomousRegressionPlanner({ evaluator: { assess: async () => ({ selectedCaseIds: ['target'],
      decisions: [{ caseId: 'target', reason: 'Mock impact', evidence: [
        { source: 'change-notes', quote: 'target changed' }, { source: 'case-title', quote: 'target' },
      ] }] }) } }),
    repository: plans, createId: randomUUID, now: () => new Date().toISOString() });
  const plan = await planService.create(project.id, { siteVersionId: versionId });
  let resolveRun;
  const runPromise = new Promise(resolve => { resolveRun = resolve; });
  const runs = new Map(); let submitted = 0;
  const deps = { getProject: async () => project, getPlan: plans.get, createIntent: executions.createIntent,
    getExecution: executions.get, saveExecution: executions.save, createRunId: randomUUID, now: () => new Date().toISOString(),
    getRun: async id => runs.get(id), submit: async (snapshot, options) => {
      submitted++;
      assert.equal(snapshot.workflowId, undefined);
      assert.equal(project.workflowId, 'old-workflow');
      assert.deepEqual(options.selectedCaseIds, ['setup', 'target']);
      assert.deepEqual(validateDocumentRunScopePlan(options.scopePlan, options.selectedCaseIds).impactCaseIds, ['target']);
      assert.equal((await executions.get(plan.id)).runId, options.runId, 'intent must exist before submission');
      return runPromise;
    } };
  let service = createDocumentAutonomousPlanExecutionService(deps);
  const server = createServer(async (req, res) => {
    if (!await handleDocumentAutonomousExecutionRoutes(req, res, new URL(req.url, 'http://127.0.0.1'), service)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/document-projects/${project.id}/autonomous-regression-plans/${plan.id}/execution`;
  assert.equal((await fetch(endpoint)).status, 404);
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{"selectedCaseIds":["setup"]}' })).status, 400);
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 422, 'per-run confirmation policy blocks implicit start');
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{"confirmBeforeStart":false}' })).status, 400);
  const confirmedBody = JSON.stringify({ confirmBeforeStart: true });
  const responses = await Promise.all([fetch(endpoint, { method: 'POST', body: confirmedBody }), fetch(endpoint, { method: 'POST', body: confirmedBody })]);
  const records = await Promise.all(responses.map(response => response.json()));
  assert.equal(records[0].runId, records[1].runId);
  assert.equal(submitted, 1);
  const restarted = createDocumentAutonomousPlanExecutionService({ ...deps, submit: () => { throw new Error('must not resubmit'); } });
  assert.equal((await restarted.start(project.id, plan.id)).state, 'uncertain');
  const pending = await executions.get(plan.id);
  await executions.save({ ...pending, state: 'submitted', updatedAt: new Date().toISOString() });
  service = restarted;
  const repeatedPost = await fetch(endpoint, { method: 'POST', body: confirmedBody });
  assert.equal(repeatedPost.status, 200, 'unknown old submission must not be acknowledged as a running worker');
  assert.equal((await repeatedPost.json()).state, 'uncertain');
  assert.equal((await (await fetch(endpoint)).json()).state, 'uncertain');
  assert.equal(submitted, 1, 'restarting the service must not submit the old intent again');
  const run = { id: records[0].runId, projectId: project.id, completedAt: new Date().toISOString(), overall: 'failed' };
  runs.set(run.id, run); resolveRun(run);
  let result;
  for (let index = 0; index < 30; index++) {
    result = await (await fetch(endpoint)).json();
    if (result.state === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.state, 'completed');
  assert.equal(result.overall, 'failed');
  assert.equal(submitted, 1);
  assert.equal((await executions.get(plan.id)).state, 'completed');
  const foreign = endpoint.replace('/local-project/', '/foreign-project/');
  assert.equal((await fetch(foreign)).status, 404);
  assert.equal((await fetch(foreign, { method: 'POST', body: '{}' })).status, 404);
});
