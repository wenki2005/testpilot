import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceTestJobService } from '../src/application/source-test-job-service.ts';

function runResult(status = 'candidate') {
  return {
    id: 'run-output', goal: 'inspect read-only flow', candidateFiles: [], status, executionState: 'completed',
    mode: 'plan', startedAt: 'start', completedAt: 'end', reportPath: 'report.md', workspacePath: 'workspace',
    changedFiles: [], protectedChanges: [], toolCalls: 0, modelRequests: 0, usage: { input: 0, output: 0 },
    runtimeStatus: 'not-run', executions: [], commandCount: 0, successfulCommands: 0, limitations: [],
  };
}

test('source-test jobs retain bounded event history and publish completion without losing the result', async () => {
  let resolveRun;
  let captured;
  const jobs = createSourceTestJobService({
    outputRoot: 'isolated-output', createId: () => 'job-1', now: () => 'now',
    run: input => { captured = input; return new Promise(resolve => { resolveRun = resolve; }); },
  });
  const job = jobs.launch('profile-1', 'read-only', 'plan', 'isolated-source');
  assert.equal(jobs.activeCount(), 1);
  assert.equal(captured.outputRoot, 'isolated-output');
  assert.equal(captured.sourceRoot, 'isolated-source');
  for (let index = 0; index < 105; index++) captured.onProgress({ type: `event-${index}` });
  assert.equal(job.events.length, 100);
  assert.equal(job.events[0].type, 'event-5');
  resolveRun(runResult());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(job.id).status, 'candidate');
  assert.deepEqual(jobs.get(job.id).result, runResult());
  assert.equal(jobs.activeCount(), 0);
});

test('source-test cancellation is reflected in terminal job status and history is capped', async () => {
  const resolves = new Map();
  let next = 0;
  const jobs = createSourceTestJobService({
    outputRoot: 'isolated-output', createId: () => `job-${++next}`, now: () => 'now', maxJobs: 2,
    run: input => new Promise(resolve => resolves.set(input.signal, resolve)),
  });
  const first = jobs.launch('profile', 'one', 'plan', 'source');
  const second = jobs.launch('profile', 'two', 'generate', 'source');
  const third = jobs.launch('profile', 'three', 'diagnose', 'source');
  assert.deepEqual(jobs.list().map(job => job.id), ['job-2', 'job-3']);
  jobs.cancel(third.id);
  jobs.cancel(first.id);
  assert.equal([...resolves.keys()].find(signal => signal.aborted) !== undefined, true);
  for (const [signal, resolve] of resolves) resolve(runResult());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(third.id).status, 'cancelled');
  assert.equal(jobs.get(second.id).status, 'candidate');
  assert.equal(jobs.get(first.id), undefined);
  assert.equal(jobs.activeCount(), 0);
});

test('source-test failures expose a safe message and report only the error class to the logger', async () => {
  const failures = [];
  const jobs = createSourceTestJobService({
    outputRoot: 'isolated-output', createId: () => 'job-error', now: () => 'now',
    run: async () => { throw new Error('private path and credential must not be returned'); },
    onFailure: name => failures.push(name),
  });
  const job = jobs.launch('profile', 'goal', 'plan', 'source');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.get(job.id).status, 'blocked');
  assert.equal(jobs.get(job.id).error, '测试任务未完成，请检查 TestPilot 模型设置和目标项目配置。');
  assert.doesNotMatch(jobs.get(job.id).error, /credential|private path/u);
  assert.deepEqual(failures, ['Error']);
  assert.equal(jobs.activeCount(), 0);
});
