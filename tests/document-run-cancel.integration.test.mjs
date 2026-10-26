import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const dataDir = await mkdtemp(resolve(tmpdir(), 'testpilot-run-cancel-'));
process.env.TESTPILOT_DATA_DIR = dataDir;
process.env.TESTPILOT_BROWSER_CDP_ENDPOINT = '';
process.env.TESTPILOT_BROWSER_HEADLESS = '1';
process.env.TESTPILOT_BROWSER_CHANNEL = '';
process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN = '0';
process.env.TESTPILOT_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const { cancelDocumentRun, executeDocumentRun, getDocumentRunProgress } = await import('../dist/adapters/document-test-workflow.js');
const { closePersistentTestPages } = await import('../dist/adapters/browser-runtime.js');

test('manual cancellation preserves completed cases, marks the active case cancelled and the remaining cases not-run', { timeout: 45_000 }, async t => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>Cancellation fixture is ready</h1></body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await closePersistentTestPages();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const makeCase = (id, expected, steps) => ({
    id,
    title: id,
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
    expected,
    steps,
  });
  const project = {
    id: 'cancel-local-fixture',
    name: 'Cancel local fixture',
    fileName: 'fixture.md',
    caseMode: 'existing',
    format: 'markdown',
    targetUrl: `http://127.0.0.1:${server.address().port}/`,
    sourceText: 'A controllable local cancellation fixture.',
    cases: [
      makeCase('case-already-passed', 'The fixture marker is visible', [{ action: 'assertExactVisible', text: 'Cancellation fixture is ready' }]),
      makeCase('case-interrupted', 'A text that never appears is visible', [{ action: 'assertText', text: 'This marker is intentionally absent' }]),
      makeCase('case-not-started', 'The fixture marker is visible', [{ action: 'assertExactVisible', text: 'Cancellation fixture is ready' }]),
    ],
    reviewStatus: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runId = 'manual-cancel-run-1';
  const runPromise = executeDocumentRun(project, { runId, runMode: 'regression', selectedCaseIds: project.cases.map(item => item.id) });
  let active;
  for (let attempt = 0; attempt < 300; attempt++) {
    active = await getDocumentRunProgress(runId);
    if (active?.currentCase?.id === 'case-interrupted') break;
    await delay(20);
  }
  assert.equal(active?.status, 'running');
  assert.equal(active?.results.find(item => item.id === 'case-already-passed')?.status, 'passed', 'the completed result is durable before stopping');
  assert.equal(active?.currentCase?.id, 'case-interrupted');

  assert.equal(await cancelDocumentRun(runId), 'requested');
  const run = await runPromise;
  assert.equal(run.overall, 'cancelled');
  assert.equal(run.finalReady, false);
  assert.deepEqual(run.deterministic.results.map(item => [item.id, item.status]), [
    ['case-already-passed', 'passed'],
    ['case-interrupted', 'cancelled'],
    ['case-not-started', 'not-run'],
  ]);
  assert.match(run.report, /取消 1、未运行 1/u);
  const terminal = await getDocumentRunProgress(runId);
  assert.equal(terminal?.status, 'cancelled');
  assert.equal(terminal?.run?.id, runId);

  const rerun = await executeDocumentRun(project, { runId: 'manual-cancel-run-2', runMode: 'regression', selectedCaseIds: ['case-already-passed'] });
  assert.equal(rerun.overall, 'passed', 'a new run must reconnect or recover after cancellation');
  assert.equal(rerun.deterministic.results[0]?.status, 'passed');
});
