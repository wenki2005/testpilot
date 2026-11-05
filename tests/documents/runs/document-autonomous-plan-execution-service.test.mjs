import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentAutonomousPlanExecutionService } from '../../../src/application/runs/execution/autonomous-plan-execution-service.ts';
import { autonomousPlanContextDigest } from '../../../src/application/cases/document-autonomous-plan-service.ts';
import { validateDocumentRunScopePlan } from '../../../src/domain/documents/runs/run-scope.ts';
import { prepareDocumentRunScope } from '../../../src/application/runs/preparation/scope-preparation-service.ts';

function setup(overrides = {}) {
  const project = { id: 'p', reviewStatus: 'approved', targetUrl: 'https://example.test', siteVersions: [{ id: 'v', targetUrl: 'https://example.test', changeNotes: '列表文字更新' }], cases: [{ id: 'c1', title: '查看列表', expected: '显示列表', lifecycleStatus: 'runnable', sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true, steps: [{ action: 'openPage', url: '/' }] }] };
  const plan = { id: 'plan', projectId: 'p', siteVersionId: 'v', contextDigest: autonomousPlanContextDigest(project), targetUrlSnapshot: 'https://example.test', blockers: [], plan: { outcome: 'selected', changeNotesSnapshot: '列表文字更新', decisions: [{ caseId: 'c1', reason: '列表可见内容可能受影响', evidence: [{ source: 'change-notes', quote: '列表文字更新' }, { source: 'case-title', quote: '查看列表' }] }], selectedCaseIds: ['c1'], prerequisiteCaseIds: [], orderedCaseIds: ['c1'] } };
  let record; let calls = 0; let submits = 0;
  const deps = { getProject: async () => project, getPlan: async () => plan, getExecution: async () => record, saveExecution: async r => { record = structuredClone(r); calls++; }, createIntent: async (id, r) => { if (record) return false; record = structuredClone(r); return true; }, createRunId: () => 'run-1', now: () => 'now', getRun: async () => undefined, submit: async (_p, _o) => { submits++; await new Promise(resolve => setTimeout(resolve, 10)); return { id: 'run-1', projectId: 'p', completedAt: '2026-10-31T00:00:00.000Z', overall: 'failed' }; }, ...overrides };
  const service = createDocumentAutonomousPlanExecutionService(deps);
  return { project, plan, deps, service, get record() { return record; }, set record(v) { record = v; }, get calls() { return calls; }, get submits() { return submits; } };
}

test('rejects stale plan and blocked plan before creating intent', async () => {
  const stale = setup(); stale.project.cases[0].title = 'changed';
  await assert.rejects(stale.service.start('p', 'plan'), /过期/); assert.equal(stale.calls, 0);
  const blocked = setup(); blocked.plan.blockers = ['审核'];
  await assert.rejects(blocked.service.start('p', 'plan'), /阻塞/); assert.equal(blocked.calls, 0);
});

test('legacy or weakly grounded saved plans cannot create an execution intent', async () => {
  const x = setup();
  x.plan.plan.decisions = [];
  x.plan.plan.changeNotesSnapshot = undefined;
  await assert.rejects(x.service.start('p', 'plan'), /变更说明与用例原文双向引用/);
  assert.equal(x.record, undefined);
  assert.equal(x.submits, 0);
});

test('explicit non-executable planning outcomes never create intent or invoke executor', async () => {
  for (const outcome of ['no-relevant-cases', 'needs-clarification']) {
    const x = setup();
    x.plan.plan.outcome = outcome;
    x.plan.plan.selectedCaseIds = [];
    x.plan.plan.orderedCaseIds = [];
    await assert.rejects(x.service.start('p', 'plan'), error => error.status === 422);
    assert.equal(x.record, undefined);
    assert.equal(x.submits, 0);
  }
});

test('verified completion invokes investigation hook without changing a failed test outcome', async () => {
  const x = setup();
  let resolveHook;
  const observed = new Promise(resolve => { resolveHook = resolve; });
  x.deps.onCompleted = async run => { resolveHook(run); throw new Error('private model investigation failure'); };
  await x.service.start('p', 'plan');
  const run = await observed;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.overall, 'failed');
  assert.equal(x.record.state, 'completed');
  assert.equal(x.record.error, undefined);
});

test('scope plan conforms to production validator and concurrent calls submit once', async () => {
  const x = setup(); let actualScope;
  const originalSubmit = x.deps.submit;
  x.deps.submit = async (p, opts) => { actualScope = opts.scopePlan; prepareDocumentRunScope({ project:p, selectedCaseIds:opts.selectedCaseIds, scopePlan:opts.scopePlan, isResume:false, isChildRetest:false }); return originalSubmit(p, opts); };
  const [a, b] = await Promise.all([x.service.start('p', 'plan'), x.service.start('p', 'plan')]);
  assert.equal(x.submits, 1); assert.equal(a.runId, 'run-1'); assert.equal(b.runId, 'run-1');
  assert.deepEqual(validateDocumentRunScopePlan(actualScope, ['c1']).impactCaseIds, ['c1']);
  assert.ok(actualScope.impactReasons.c1.some(reason=>reason.includes('change-notes')));
});

test('restart with unresolved pending intent is uncertain and never resubmits', async () => {
  const x = setup(); x.record = { planId: 'plan', projectId: 'p', runId: 'run-1', state: 'pending', contextDigest: x.plan.contextDigest, frozenCaseIds: ['c1'], createdAt: 'then', updatedAt: 'then' };
  const result = await x.service.start('p', 'plan');
  assert.equal(result.state, 'uncertain'); assert.equal(x.submits, 0);
});

test('submitted intent resolves identically on start and get after restart, while a live run stays submitted', async () => {
  const x = setup();
  x.record = { planId: 'plan', projectId: 'p', runId: 'run-1', state: 'submitted', contextDigest: x.plan.contextDigest, frozenCaseIds: ['c1'], createdAt: 'then', updatedAt: 'then' };
  const started = await x.service.start('p', 'plan');
  const fetched = await x.service.get('p', 'plan');
  assert.equal(started.state, 'uncertain');
  assert.equal(fetched.state, 'uncertain');
  assert.equal(x.submits, 0);

  const live = setup({ isRunActive: runId => runId === 'run-1' });
  live.record = { ...x.record };
  assert.equal((await live.service.start('p', 'plan')).state, 'submitted');
  assert.equal((await live.service.get('p', 'plan')).state, 'submitted');
  assert.equal(live.submits, 0);
});

test('foreign or invalid-date run artifacts never resolve submitted intent as complete', async () => {
  for (const run of [
    { id: 'other-run', projectId: 'p', completedAt: '2026-10-31T00:00:00Z', overall: 'passed' },
    { id: 'run-1', projectId: 'p', completedAt: 'not-a-date', overall: 'passed' },
  ]) {
    const x = setup({ getRun: async () => run });
    x.record = { planId: 'plan', projectId: 'p', runId: 'run-1', state: 'submitted', contextDigest: x.plan.contextDigest, frozenCaseIds: ['c1'], createdAt: 'then', updatedAt: 'then' };
    assert.equal((await x.service.start('p', 'plan')).state, 'uncertain');
    assert.equal((await x.service.get('p', 'plan')).state, 'uncertain');
    assert.equal(x.submits, 0);
  }
});

test('intent persistence failure prevents executor submission', async () => {
  const x = setup({ createIntent: async () => { throw new Error('disk full'); } });
  await assert.rejects(x.service.start('p', 'plan'), /disk full/); assert.equal(x.submits, 0);
});

test('only matching real completed run identity resolves pending state; overall failure stays completed', async () => {
  const x = setup();
  x.record = { planId: 'plan', projectId: 'p', runId: 'run-1', state: 'pending', contextDigest: x.plan.contextDigest, frozenCaseIds: ['c1'], createdAt: 'then', updatedAt: 'then' };
  x.deps.getRun = async () => ({ id: 'run-1', projectId: 'p', completedAt: '2026-10-31T00:00:00.000Z', overall: 'failed' });
  const result = await x.service.start('p', 'plan');
  assert.equal(result.state, 'completed'); assert.equal(result.run.overall, 'failed'); assert.equal(x.submits, 0);
});

test('unapproved project, unsafe risk and API permissions block execution', async () => {
  for (const edit of [p => { p.reviewStatus = 'draft'; }, p => { p.cases[0].sideEffectRisk = 'unknown'; }, p => { p.cases[0].preconditions = ['已登录']; p.cases[0].preconditionsConfirmed = false; }, p => { p.apiContract = { allowNetwork: true }; }]) {
    const x = setup(); edit(x.project);
    x.plan.contextDigest = autonomousPlanContextDigest(x.project);
    await assert.rejects(x.service.start('p', 'plan'), error => error.status === 422); assert.equal(x.submits, 0);
  }
});

test('project-level per-run confirmation blocks an implicit start and accepts explicit user confirmation', async () => {
  const x = setup();
  x.project.confirmationRequired = true;
  x.plan.contextDigest = autonomousPlanContextDigest(x.project);
  await assert.rejects(x.service.start('p', 'plan'), error => error.status === 422 && /每次运行前/u.test(error.message));
  assert.equal(x.record, undefined);
  assert.equal(x.submits, 0);

  const started = await x.service.start('p', 'plan', { confirmBeforeStart: true });
  assert.equal(started.state, 'submitted');
  assert.equal(x.submits, 1);
});

test('foreign run identity and stale running progress never resolve a pending intent', async () => {
  const x = setup(); x.record = { planId: 'plan', projectId: 'p', runId: 'run-1', state: 'pending', contextDigest: x.plan.contextDigest, frozenCaseIds: ['c1'], createdAt: 'then', updatedAt: 'then' };
  x.deps.getRun = async () => ({ id: 'other-run', projectId: 'p', completedAt: '2026-10-31T00:00:00Z', overall: 'passed' });
  x.deps.getProgress = async runId => ({ runId, status: 'running', stage: 'deterministic', progress: {} });
  const result = await x.service.get('p', 'plan');
  assert.equal(result.state, 'uncertain'); assert.equal(result.run, undefined); assert.equal(result.progress.runId, 'run-1');
  await assert.rejects(x.service.start('other-project', 'plan'), /不存在/);
  x.record.projectId = 'other-project';
  await assert.rejects(x.service.start('p', 'plan'), /不存在/);
});

test('synchronous submit throw is persisted as sanitized failure and async save failure stays uncertain', async () => {
  const sync = setup({ submit: () => { throw new Error('secret response'); } });
  await sync.service.start('p', 'plan');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sync.record.state, 'failed'); assert.equal(sync.record.error, 'executor-submit-failed');

  const asyncSave = setup({ submit: async () => ({ id: 'run-1', projectId: 'p', completedAt: '2026-10-31T00:00:00Z', overall: 'passed' }), saveExecution: async () => { throw new Error('disk'); } });
  await asyncSave.service.start('p', 'plan');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asyncSave.record.state, 'pending');
});
