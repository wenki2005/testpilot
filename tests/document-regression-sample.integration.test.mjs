import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebRegressionSampleServer } from '../examples/web-regression-sample/server.mjs';

const root = resolve(import.meta.dirname, '..');

test('local sample proves UI regression, API fixtures, cleanup, and fixed-version recovery', { timeout: 180_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-regression-sample-'));
  const projectId = 'local-web-regression-sample';
  const sample = createWebRegressionSampleServer();
  sample.listen(0, '127.0.0.1');
  await once(sample, 'listening');
  const sampleUrl = `http://127.0.0.1:${sample.address().port}`;

  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const demoPort = portProbe.address().port;
  await new Promise(done => portProbe.close(done));

  const project = {
    id: projectId,
    name: 'Local web regression sample',
    fileName: 'sample-requirements.md',
    caseMode: 'existing',
    format: 'markdown',
    targetUrl: `${sampleUrl}/?build=baseline`,
    sourceText: 'The application title remains stable across releases. API contract cases read one run-scoped synthetic record and cover a separate limit-boundary module.',
    cases: [
      {
        id: 'landing-title',
        title: 'Landing page title remains stable',
        modulePath: ['Application', 'Landing page'],
        source: 'sample-requirements.md:1',
        requirementRefs: ['sample-requirements.md:1'],
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
        expected: 'Application Overview is visible on the landing page',
        steps: [{ action: 'assertExactVisible', text: 'Application Overview' }],
      },
      {
        id: 'record-api-contract',
        title: '接口契约：记录接口返回、缺失记录和边界错误稳定',
        modulePath: ['Application', 'Record service'],
        source: 'sample-requirements.md:2',
        requirementRefs: ['sample-requirements.md:2'],
        priority: 'P1',
        category: 'functional',
        confidence: 'high',
        coverageAreas: ['functional'],
        selectedForRegression: true,
        preconditions: [],
        preconditionsConfirmed: true,
        testData: ['每轮由 fixture 创建并按 RUN_ID 清理合成记录'],
        sideEffectRisk: 'reversible',
        cleanup: '通过已审核 API fixture 删除本次运行创建的 RUN_ID 记录。',
        kind: 'visible',
        expected: '接口返回预期记录、缺失记录错误和 limit 边界错误',
        steps: [],
      },
      {
        id: 'record-boundary-api',
        title: '接口契约：记录列表 limit 上限返回边界错误',
        modulePath: ['Application', 'Data boundaries'],
        source: 'sample-requirements.md:3',
        requirementRefs: ['sample-requirements.md:3'],
        priority: 'P2',
        category: 'boundary',
        confidence: 'high',
        coverageAreas: ['boundary'],
        selectedForRegression: true,
        preconditions: [],
        preconditionsConfirmed: true,
        testData: [],
        sideEffectRisk: 'none',
        cleanup: '',
        kind: 'visible',
        expected: '接口返回 limit 大于上限时的边界错误',
        steps: [],
      },
    ],
    reviewStatus: 'draft',
    reviewNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await mkdir(join(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(join(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));

  const demo = spawn(process.execPath, ['dist/demo/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(demoPort),
      TESTPILOT_DATA_DIR: dataDir,
      TESTPILOT_BROWSER_CDP_ENDPOINT: '',
      TESTPILOT_BROWSER_HEADLESS: '1',
      TESTPILOT_BROWSER_CHANNEL: '',
      TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
      TESTPILOT_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); });
  demo.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => {
    sample.closeAllConnections();
    await Promise.race([new Promise(done => sample.close(done)), delay(2_000)]);
    if (demo.exitCode === null) {
      const exited = new Promise(resolveExit => demo.once('exit', resolveExit));
      demo.kill('SIGTERM');
      const graceful = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
      if (!graceful && demo.exitCode === null) {
        const forcedExit = new Promise(resolveExit => demo.once('exit', resolveExit));
        demo.kill('SIGKILL');
        await Promise.race([forcedExit, delay(1_000)]);
      }
    }
    if (process.platform === 'win32') {
      try {
        const session = JSON.parse(await readFile(join(dataDir, 'document-tests', 'browser-sessions', `${projectId}.json`), 'utf8'));
        if (Number.isInteger(session.pid)) {
          const killer = spawn('taskkill', ['/PID', String(session.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          await Promise.race([once(killer, 'exit'), delay(5_000)]).catch(() => undefined);
        }
      } catch { /* no managed Edge session was created */ }
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const baseUrl = `http://127.0.0.1:${demoPort}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  const runScopedPath = '/api/records/${RUN_ID}';
  const suite = {
    version: 1,
    name: 'Isolated record API regression suite',
    description: 'Run-scoped setup and guaranteed cleanup, plus success, missing-record, and numeric boundary checks.',
    baseUrl: sampleUrl,
    fixtures: {
      setup: [{
        id: 'create-record', title: 'Create one synthetic run-scoped record', source: 'sample fixture', priority: 'P1',
        request: { method: 'POST', path: '/api/records', body: { id: '${RUN_ID}', name: 'Synthetic regression record' } },
        expect: { status: 201, json: { name: 'Synthetic regression record', state: 'active' } },
      }],
      cleanup: [{
        id: 'delete-record', title: 'Delete the synthetic run-scoped record', source: 'sample fixture', priority: 'P1',
        request: { method: 'DELETE', path: runScopedPath }, expect: { status: 204 },
      }],
    },
    cases: [
      { id: 'record-read', title: 'Read the created record', source: 'sample contract', requirementRefs: ['record read'], priority: 'P1', request: { method: 'GET', path: runScopedPath }, expect: { status: 200, json: { name: 'Synthetic regression record', state: 'active' } } },
      { id: 'record-missing', title: 'Missing record returns not found', source: 'sample contract', requirementRefs: ['missing record'], priority: 'P2', request: { method: 'GET', path: '/api/records/missing-record' }, expect: { status: 404, json: { error: 'record not found' } } },
      { id: 'limit-boundary', title: 'Record limit rejects values above maximum', source: 'sample contract', requirementRefs: ['limit boundary'], priority: 'P2', request: { method: 'GET', path: '/api/records?limit=101' }, expect: { status: 400, json: { error: 'limit must be an integer from 1 to 100' } } },
    ],
  };
  const suiteResponse = await fetch(`${baseUrl}/api/api-suites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(suite) });
  const suiteBody = await suiteResponse.text();
  assert.equal(suiteResponse.status, 201, suiteBody);
  const candidate = JSON.parse(suiteBody);
  const approveSuite = await fetch(`${baseUrl}/api/api-suites/${candidate.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Isolated loopback fixture only; setup and cleanup both target the generated run ID.' }) });
  assert.equal(approveSuite.status, 200, await approveSuite.text());

  const apiConfig = {
    apiContract: {
      suiteId: candidate.id,
      mappings: [
        { documentCaseId: 'record-api-contract', apiCaseIds: ['record-read', 'record-missing'] },
        { documentCaseId: 'record-boundary-api', apiCaseIds: ['limit-boundary'] },
      ],
      allowNetwork: false,
      allowMutations: true,
      allowConcurrency: false,
    },
  };
  const updateProject = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(apiConfig) });
  const updateBody = await updateProject.text();
  assert.equal(updateProject.status, 200, updateBody);
  assert.equal(JSON.parse(updateBody).reviewStatus, 'draft', 'enabling the explicit mutation permission requires review');
  const approveProject = await fetch(`${baseUrl}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Reviewed local UI assertions, exact API case mapping, loopback-only target, run-scoped setup and cleanup.' }) });
  assert.equal(approveProject.status, 200, await approveProject.text());

  const registerVersion = async (label, build, changeNotes) => {
    const response = await fetch(`${baseUrl}/api/document-projects/${projectId}/site-versions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, environment: 'local sample', targetUrl: `${sampleUrl}/?build=${build}`, changeNotes }),
    });
    const body = await response.text();
    assert.equal(response.status, 201, body);
    const saved = JSON.parse(body);
    return saved.siteVersions.find(item => item.label === label);
  };
  const baselineVersion = await registerVersion('baseline', 'baseline', 'Initial stable sample deployment');
  const regressionVersion = await registerVersion('regression', 'regression', 'Intentional regression: landing page heading changes');
  const fixedVersion = await registerVersion('fixed', 'fixed', 'Restore the expected landing page heading');

  const allCaseIds = ['landing-title', 'record-api-contract', 'record-boundary-api'];
  const run = async (siteVersion, baselineRunId, selectedCaseIds = allCaseIds) => {
    const response = await fetch(`${baseUrl}/api/document-projects/${projectId}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runMode: 'regression', selectedCaseIds, siteVersionId: siteVersion.id, ...(baselineRunId ? { baselineRunId } : {}) }),
    });
    const body = await response.text();
    assert.equal(response.status, 202, body);
    const started = JSON.parse(body);
    for (let attempt = 0; attempt < 180; attempt++) {
      const response = await fetch(`${baseUrl}/api/document-runs/${started.runId}/progress`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200);
      const progress = await response.json();
      if (progress.status === 'completed') {
        const final = await fetch(`${baseUrl}/api/document-runs/${started.runId}`);
        assert.equal(final.status, 200);
        return await final.json();
      }
      if (progress.status === 'failed') throw new Error(`Run failed to finalize: ${JSON.stringify(progress)}; server log: ${log}`);
      await delay(200);
    }
    throw new Error(`Run ${started.runId} did not complete; server log: ${log}`);
  };

  const assertApiAndCleanup = async result => {
    assert.equal(result.deterministic.results.find(item => item.id === 'record-api-contract')?.status, 'not-applicable');
    const apiResult = result.apiContract.results.find(item => item.id === 'record-api-contract');
    assert.equal(apiResult.status, 'passed', apiResult.detail);
    assert.deepEqual(apiResult.apiCaseResults.map(item => [item.caseId, item.status]), [['record-read', 'passed'], ['record-missing', 'passed']]);
    const boundaryResult = result.apiContract.results.find(item => item.id === 'record-boundary-api');
    assert.equal(boundaryResult.status, 'passed', boundaryResult.detail);
    assert.deepEqual(boundaryResult.apiCaseResults.map(item => [item.caseId, item.status]), [['limit-boundary', 'passed']]);
    const recordList = await fetch(`${sampleUrl}/api/records?limit=100`).then(response => response.json());
    assert.deepEqual(recordList.items, [], 'fixture cleanup must leave the sample website with no records after each run');
  };

  const baseline = await run(baselineVersion);
  assert.equal(baseline.overall, 'passed');
  assert.equal(baseline.siteVersionSnapshot.id, baselineVersion.id);
  assert.equal(baseline.deterministic.results.find(item => item.id === 'landing-title')?.status, 'passed');
  await assertApiAndCleanup(baseline);

  const regressed = await run(regressionVersion, baseline.id);
  assert.equal(regressed.overall, 'failed');
  assert.equal(regressed.deterministic.results.find(item => item.id === 'landing-title')?.status, 'failed');
  assert.equal(regressed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'regression');
  assert.equal(regressed.baselineComparison.find(item => item.caseId === 'record-api-contract')?.disposition, 'unchanged');
  await assertApiAndCleanup(regressed);

  const fixed = await run(fixedVersion, regressed.id);
  assert.equal(fixed.overall, 'passed');
  assert.equal(fixed.deterministic.results.find(item => item.id === 'landing-title')?.status, 'passed');
  assert.equal(fixed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'fixed');
  await assertApiAndCleanup(fixed);

  const singleCase = await run(baselineVersion, undefined, ['record-api-contract']);
  assert.deepEqual(singleCase.caseScope.selectedCaseIds, ['record-api-contract']);
  assert.equal(singleCase.overall, 'passed');
  assert.deepEqual(singleCase.apiContract.results.map(item => item.id), ['record-api-contract']);
  assert.ok(singleCase.apiContract.scope.some(item => item === 'Executed API cases: 2/3 (selected record-read, record-missing)'), 'a single document case must execute only its explicitly mapped API cases');
  const afterSingleCase = await fetch(`${sampleUrl}/api/records?limit=100`).then(response => response.json());
  assert.deepEqual(afterSingleCase.items, [], 'the single-case fixture is cleaned independently');

  const selectedModules = ['Application / Record service', 'Application / Data boundaries'];
  const multiModuleCaseIds = project.cases.filter(item => selectedModules.includes(item.modulePath.join(' / '))).map(item => item.id);
  const multiModuleRun = await run(baselineVersion, undefined, multiModuleCaseIds);
  assert.deepEqual(multiModuleRun.caseScope.selectedCaseIds, ['record-api-contract', 'record-boundary-api']);
  assert.equal(multiModuleRun.overall, 'passed');
  assert.deepEqual(multiModuleRun.apiContract.results.map(item => item.id), ['record-api-contract', 'record-boundary-api']);
  assert.ok(multiModuleRun.apiContract.scope.some(item => item === 'Executed API cases: 3/3 (selected record-read, record-missing, limit-boundary)'), 'selecting multiple modules must run exactly their mapped suite cases');
  const afterMultiModuleRun = await fetch(`${sampleUrl}/api/records?limit=100`).then(response => response.json());
  assert.deepEqual(afterMultiModuleRun.items, [], 'multi-module fixtures are cleaned independently');
});
