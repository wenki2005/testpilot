import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('document workflow record persists fixed specialist attempts, supports reuse and keeps completed artifacts immutable', async t => {
  const artifactsDir = resolve(root, 'artifacts', 'document-workflow-record-fixture', String(Date.now()));
  const previous = { TESTPILOT_ARTIFACTS_DIR: process.env.TESTPILOT_ARTIFACTS_DIR, TESTPILOT_DATA_DIR: process.env.TESTPILOT_DATA_DIR };
  process.env.TESTPILOT_ARTIFACTS_DIR = artifactsDir;
  delete process.env.TESTPILOT_DATA_DIR;
  t.after(async () => {
    if (previous.TESTPILOT_ARTIFACTS_DIR === undefined) delete process.env.TESTPILOT_ARTIFACTS_DIR;
    else process.env.TESTPILOT_ARTIFACTS_DIR = previous.TESTPILOT_ARTIFACTS_DIR;
    if (previous.TESTPILOT_DATA_DIR === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = previous.TESTPILOT_DATA_DIR;
  });

  const workflow = await import('../dist/adapters/document-workflow-record.js');
  const record = await workflow.createDocumentWorkflow({ projectId: 'fixture-project', approvalPolicy: 'automatic' });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.status, 'running');
  assert.match(record.recordDigest, /^[a-f0-9]{64}$/);

  const generation = await workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'generate-cases', specialist: 'case-generator', input: { requirements: ['REQ-1'], role: 'independent-generation' },
  });
  assert.equal(generation.reused, false);
  assert.equal(generation.stage.attempt, 1);
  assert.equal(generation.stage.status, 'running');
  const afterGeneration = await workflow.completeDocumentWorkflowStage(record.workflowId, 'generate-cases', 1, ['artifact:cases-v1']);
  assert.deepEqual(afterGeneration.stages[0].outputArtifactIds, ['artifact:cases-v1']);

  const reused = await workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'generate-cases', specialist: 'case-generator', input: { role: 'independent-generation', requirements: ['REQ-1'] },
  });
  assert.equal(reused.reused, true, 'canonical input digest should reuse a completed stage independent of object key order');
  assert.equal(reused.stage.attempt, 1);
  assert.deepEqual(reused.stage.outputArtifactIds, ['artifact:cases-v1']);
  await assert.rejects(workflow.completeDocumentWorkflowStage(record.workflowId, 'generate-cases', 1, ['artifact:replacement']), /status is completed/);

  const created = await workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'review-cases', specialist: 'case-reviewer', input: { casesArtifact: 'artifact:cases-v1' },
  });
  const failed = await workflow.failDocumentWorkflowStage(record.workflowId, 'review-cases', created.stage.attempt, { message: 'review source unavailable', code: 'fixture-error' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stages.at(-1).error.code, 'fixture-error');
  const retry = await workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'review-cases', specialist: 'case-reviewer', input: { casesArtifact: 'artifact:cases-v1', reviewerVersion: 2 },
  });
  assert.equal(retry.stage.attempt, 2);
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'review-cases', 2, ['artifact:review-v2']);

  const stepAuthor = await workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'author-steps', specialist: 'step-author', input: { reviewedCases: 'artifact:review-v2' },
  });
  const waiting = await workflow.waitDocumentWorkflowStage(record.workflowId, 'author-steps', stepAuthor.stage.attempt, 'The target needs an authenticated session.');
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.stages.at(-1).waitingReason, 'The target needs an authenticated session.');
  assert.equal(waiting.stages.at(-1).waits.length, 0);
  await assert.rejects(workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'deterministic-execution', specialist: 'deterministic-executor', input: { steps: 'not-yet-ready' },
  }), /still active/);
  const resumed = await workflow.resumeDocumentWorkflowStage(record.workflowId, 'author-steps', stepAuthor.stage.attempt);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.stages.at(-1).waitingReason, undefined);
  assert.equal(resumed.stages.at(-1).waits[0].reason, 'The target needs an authenticated session.');
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'author-steps', stepAuthor.stage.attempt, ['artifact:steps-v1']);

  const stages = [
    ['human-approval', 'human-review-gate'],
    ['deterministic-execution', 'deterministic-executor'],
    ['computer-use-execution', 'computer-use-observer'],
    ['analyze-results', 'result-analyst'],
    ['generate-report', 'report-writer'],
    ['package-artifacts', 'report-packager'],
  ];
  for (const [stageId, specialist] of stages) {
    const started = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId, specialist, input: { previous: stageId } });
    await workflow.completeDocumentWorkflowStage(record.workflowId, stageId, started.stage.attempt, [`artifact:${stageId}`]);
  }

  const completed = await workflow.completeDocumentWorkflow(record.workflowId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.stages.length, 10, 'retry attempts remain visible instead of replacing previous records');
  assert.equal(completed.stages.find(item => item.stageId === 'generate-cases').outputArtifactIds[0], 'artifact:cases-v1');
  assert.ok(completed.completedAt);
  assert.equal((await workflow.getDocumentWorkflow(record.workflowId)).recordDigest, completed.recordDigest);
  assert.equal((await workflow.listDocumentWorkflows({ projectId: 'fixture-project' })).length, 1);
  await assert.rejects(workflow.startDocumentWorkflowStage(record.workflowId, {
    stageId: 'generate-cases', specialist: 'case-generator', input: { requirements: ['REQ-2'] },
  }), /Completed or cancelled workflows are immutable/);
});

test('approval-required stages pause explicitly and can only resume after approval', async t => {
  const artifactsDir = resolve(root, 'artifacts', 'document-workflow-approval-fixture', String(Date.now()));
  const previous = process.env.TESTPILOT_ARTIFACTS_DIR;
  process.env.TESTPILOT_ARTIFACTS_DIR = artifactsDir;
  t.after(() => { if (previous === undefined) delete process.env.TESTPILOT_ARTIFACTS_DIR; else process.env.TESTPILOT_ARTIFACTS_DIR = previous; });
  const workflow = await import('../dist/adapters/document-workflow-record.js');
  const record = await workflow.createDocumentWorkflow({ projectId: 'approval-project', approvalPolicy: 'confirm-before-execution' });
  const generation = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'generate-cases', specialist: 'case-generator', input: { request: 'generate' } });
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'generate-cases', generation.stage.attempt, ['artifact:cases']);

  const gate = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'human-approval', specialist: 'human-review-gate', input: { suite: 'approved-candidate' } });
  assert.equal(gate.stage.status, 'waiting');
  assert.equal(gate.stage.approval.status, 'pending');
  await assert.rejects(workflow.resumeDocumentWorkflowStage(record.workflowId, 'human-approval', 1), /Resolve the pending approval/);
  const approved = await workflow.approveDocumentWorkflowStage(record.workflowId, 'human-approval', 1, { approved: true, note: 'Reviewed the read-only test scope.' });
  assert.equal(approved.stages.at(-1).status, 'running');
  assert.equal(approved.stages.at(-1).approval.status, 'approved');
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'human-approval', 1, ['artifact:approval']);
  const execution = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'deterministic-execution', specialist: 'deterministic-executor', input: { suite: 'approved-candidate' } });
  assert.equal(execution.stage.status, 'running', 'one human approval gates both execution lanes');
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'deterministic-execution', 1, ['artifact:deterministic-results']);
  const nextExecution = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'computer-use-execution', specialist: 'computer-use-observer', input: { suite: 'approved-candidate' } });
  assert.equal(nextExecution.stage.status, 'running');
  const rejected = await workflow.failDocumentWorkflowStage(record.workflowId, 'computer-use-execution', 1, { message: 'fixture failure' });
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.stages.at(-1).error.message, 'fixture failure');
});

test('workflow cancellation closes active stages and rejects pending approval', async t => {
  const artifactsDir = resolve(root, 'artifacts', 'document-workflow-cancel-fixture', String(Date.now()));
  const previous = process.env.TESTPILOT_ARTIFACTS_DIR;
  process.env.TESTPILOT_ARTIFACTS_DIR = artifactsDir;
  t.after(() => { if (previous === undefined) delete process.env.TESTPILOT_ARTIFACTS_DIR; else process.env.TESTPILOT_ARTIFACTS_DIR = previous; });
  const workflow = await import('../dist/adapters/document-workflow-record.js');
  const record = await workflow.createDocumentWorkflow({ projectId: 'cancelled-project', approvalPolicy: 'confirm-before-execution' });
  const generated = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'generate-cases', specialist: 'case-generator', input: { request: 'generate' } });
  await workflow.completeDocumentWorkflowStage(record.workflowId, 'generate-cases', generated.stage.attempt, ['artifact:cases']);
  const approval = await workflow.startDocumentWorkflowStage(record.workflowId, { stageId: 'human-approval', specialist: 'human-review-gate', input: { suite: 'candidate' } });
  assert.equal(approval.stage.status, 'waiting');

  const cancelled = await workflow.cancelDocumentWorkflow(record.workflowId, 'Stopped by the QA user.');
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelledAt);
  const cancelledApproval = cancelled.stages.at(-1);
  assert.equal(cancelledApproval.status, 'cancelled');
  assert.equal(cancelledApproval.error.message, 'Stopped by the QA user.');
  assert.equal(cancelledApproval.approval.status, 'rejected');
  assert.equal((await workflow.cancelDocumentWorkflow(record.workflowId)).recordDigest, cancelled.recordDigest, 'repeated cancellation is idempotent');
  await assert.rejects(workflow.resumeDocumentWorkflowStage(record.workflowId, 'human-approval', approval.stage.attempt), /cancelled|Cannot/u);
  await assert.rejects(workflow.completeDocumentWorkflow(record.workflowId), /cancelled/i);
});

test('workflow records reject unsupported schema versions and tampered content', async t => {
  const artifactsDir = resolve(root, 'artifacts', 'document-workflow-integrity-fixture', String(Date.now()));
  const previous = process.env.TESTPILOT_ARTIFACTS_DIR;
  process.env.TESTPILOT_ARTIFACTS_DIR = artifactsDir;
  t.after(() => { if (previous === undefined) delete process.env.TESTPILOT_ARTIFACTS_DIR; else process.env.TESTPILOT_ARTIFACTS_DIR = previous; });
  const workflow = await import('../dist/adapters/document-workflow-record.js');
  const record = await workflow.createDocumentWorkflow({ projectId: 'integrity-project' });
  const directory = resolve(artifactsDir, 'document-workflows');
  const file = resolve(directory, `${record.workflowId}.json`);
  const original = await readFile(file, 'utf8');
  const unsupported = JSON.parse(original);
  unsupported.schemaVersion = 77;
  await writeFile(file, JSON.stringify(unsupported));
  await assert.rejects(workflow.getDocumentWorkflow(record.workflowId), /schema\/version validation/);
  await writeFile(file, original);
  const changed = JSON.parse(original);
  changed.projectId = 'tampered-project';
  await writeFile(file, JSON.stringify(changed));
  await assert.rejects(workflow.getDocumentWorkflow(record.workflowId), /digest mismatch/);

  const invalid = await workflow.createDocumentWorkflow({ projectId: 'invalid-input-project' });
  await assert.rejects(workflow.startDocumentWorkflowStage(invalid.workflowId, {
    stageId: 'generate-cases', specialist: 'case-reviewer', input: {},
  }), /must use specialist case-generator/);
  assert.equal(await mkdir(directory, { recursive: true }).then(() => true), true);
});
