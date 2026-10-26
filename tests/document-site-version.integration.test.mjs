import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { strFromU8, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('website versions bind UI runs, reports, packages and retests to the selected deployment', { timeout: 180_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-site-version-'));
  const projectId = 'site-version-fixture';
  const hits = { one: 0, two: 0, three: 0 };
  const makeTarget = (key, includeLandingPage, buildMarker) => createServer((req, res) => {
    hits[key]++;
    const sessionView = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('session');
    const sessionScript = sessionView === 'primary'
      ? `<script>sessionStorage.setItem('testpilot-project-marker','primary');document.getElementById('project-session-marker').textContent='Session marker: '+sessionStorage.getItem('testpilot-project-marker')</script>`
      : `<script>document.getElementById('project-session-marker').textContent='Session marker: '+(sessionStorage.getItem('testpilot-project-marker')||'empty')</script>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body><h1>${includeLandingPage ? 'Regression landing page' : 'Updated landing page'}</h1><p>${buildMarker}</p><p id="project-session-marker">Session marker: loading</p><label>Scenario marker<input aria-label="Scenario marker" value="${buildMarker}"></label>${sessionScript}</body></html>`);
  });
  const targetOne = makeTarget('one', true, 'Build one');
  const targetTwo = makeTarget('two', false, 'Build two · regression introduced');
  const targetThree = makeTarget('three', true, 'Build three · regression fixed');
  for (const server of [targetOne, targetTwo, targetThree]) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const urlOne = `http://127.0.0.1:${targetOne.address().port}/?session=primary`;
  const urlTwo = `http://127.0.0.1:${targetTwo.address().port}/`;
  const urlThree = `http://127.0.0.1:${targetThree.address().port}/`;
  const demoServer = createServer();
  demoServer.listen(0, '127.0.0.1');
  await once(demoServer, 'listening');
  const port = demoServer.address().port;
  await new Promise(done => demoServer.close(done));

  const project = {
    id: projectId,
    name: 'Site version fixture',
    fileName: 'fixture.md',
    caseMode: 'existing',
    format: 'markdown',
    targetUrl: urlOne,
    sourceText: 'Two local website deployments for immutable regression version checks.',
    sourceMaterials: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', fileName: 'fixture.md', role: 'requirements', sha256: 'a'.repeat(64), byteLength: 58, createdAt: new Date().toISOString() }],
    testDataSets: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Synthetic smoke input', values: { scenarioMarker: 'reusable synthetic value' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    cases: [{
      id: 'stable-landing',
      title: 'Stable landing page remains visible',
      modulePath: ['Landing page'],
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
      expected: 'Regression landing page is visible',
      steps: [
        { action: 'fillByLabel', label: 'Scenario marker', value: '{{param:scenarioMarker}}' },
        { action: 'assertValue', label: 'Scenario marker', value: '{{param:scenarioMarker}}' },
        { action: 'assertExactVisible', text: 'Regression landing page' },
      ],
    }],
    reviewStatus: 'approved',
    reviewNotes: 'Reviewed local read-only fixture.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const secondProjectId = 'second-site-session-isolation';
  const secondProject = {
    id: secondProjectId,
    name: 'Second independent site',
    fileName: 'second-site.md',
    caseMode: 'existing',
    format: 'markdown',
    targetUrl: urlOne.replace('session=primary', 'session=secondary'),
    sourceText: 'A second site project must receive its own browser session and run history.',
    cases: [{
      id: 'second-site-session',
      title: 'Second site starts with its own browser session',
      source: 'second-site.md:1',
      requirementRefs: ['second-site.md:1'],
      priority: 'P1',
      category: 'authentication',
      confidence: 'high',
      coverageAreas: ['authentication'],
      selectedForRegression: true,
      preconditions: [],
      preconditionsConfirmed: true,
      testData: [],
      sideEffectRisk: 'none',
      cleanup: '',
      kind: 'visible',
      expected: 'Session marker: empty',
      steps: [{ action: 'assertExactVisible', text: 'Session marker: empty' }],
    }],
    reviewStatus: 'approved',
    reviewNotes: 'Reviewed local session-isolation fixture.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(join(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(join(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  await writeFile(join(dataDir, 'document-tests', 'projects', `${secondProjectId}.json`), JSON.stringify(secondProject));

  const demo = spawn(process.execPath, ['dist/demo/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
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
  let browser;
  t.after(async () => {
    if (browser) await Promise.race([browser.close(), delay(5_000)]);
    for (const server of [targetOne, targetTwo, targetThree]) {
      server.closeAllConnections();
      await Promise.race([new Promise(done => server.close(done)), delay(2_000)]);
    }
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
      const managedPids = new Set();
      for (const sessionProjectId of [projectId, secondProjectId]) {
        try {
          const savedSession = JSON.parse(await readFile(join(dataDir, 'document-tests', 'browser-sessions', `${sessionProjectId}.json`), 'utf8'));
          if (Number.isInteger(savedSession.pid)) managedPids.add(savedSession.pid);
        } catch { /* no managed Edge session was created */ }
      }
      for (const pid of managedPids) {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        await Promise.race([once(killer, 'exit'), delay(5_000)]).catch(() => undefined);
      }
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(8_000);
  await page.goto(`${baseUrl}/?documentProject=${projectId}`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('步骤 1 动作').inputValue(), 'fillByLabel', 'the saved BrowserSteps are exposed in the visual editor');
  assert.equal(await page.getByLabel('步骤 2 字段标签').inputValue(), 'Scenario marker');
  await page.getByRole('heading', { name: '用例、步骤与资料修订' }).waitFor();
  await page.getByLabel('修订类型').selectOption('case');
  await page.getByLabel('修订实体 ID').fill('stable-landing');
  await page.locator('.doc-revision-list article').first().waitFor();
  assert.match(await page.locator('.doc-revision-list').innerText(), /Stable landing page remains visible/u);
  await page.getByRole('button', { name: '查看快照' }).first().click();
  assert.match(await page.locator('.doc-revision-list pre').first().innerText(), /Stable landing page remains visible/u, 'the visible project history opens a verifiable immutable case snapshot');
  const saveVersion = async ({ label, url, notes }) => {
    const versionForm = page.locator('.doc-site-version-form');
    if (!(await versionForm.evaluate(element => element.open))) await versionForm.locator('summary').click();
    await page.getByLabel('版本标识').fill(label);
    await page.getByLabel('测试环境').fill('主环境');
    await page.getByLabel('部署网址', { exact: true }).fill(url);
    await page.getByLabel('本次迭代说明').fill(notes);
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/site-versions`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存网站版本' }).click();
    const response = await responsePromise;
    const body = await response.text();
    assert.equal(response.status(), 201, body);
    return JSON.parse(body);
  };

  const registeredOne = await saveVersion({ label: 'build-one', url: urlOne, notes: '第一版基线' });
  const versionOne = registeredOne.siteVersions.find(item => item.label === 'build-one');
  assert.ok(versionOne);
  const registeredTwo = await saveVersion({ label: 'build-two', url: urlTwo, notes: 'Landing page visual polish; keep existing landing page behavior' });
  const versionTwo = registeredTwo.siteVersions.find(item => item.label === 'build-two');
  assert.ok(versionTwo);
  assert.equal(registeredTwo.activeSiteVersionId, versionTwo.id);
  const caseSelection = page.locator('.doc-case-select input');
  await caseSelection.uncheck();
  const analyzeImpactPromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/impact-reviews`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '分析迭代影响' }).click();
  const analyzeImpactResponse = await analyzeImpactPromise;
  const analyzeImpactBody = await analyzeImpactResponse.text();
  assert.equal(analyzeImpactResponse.status(), 201, analyzeImpactBody);
  const impactAnalysis = JSON.parse(analyzeImpactBody).analysis;
  assert.equal(impactAnalysis.status, 'pending');
  assert.ok(impactAnalysis.suggestions.some(item => item.caseId === 'stable-landing' && item.evidence.length > 0));
  assert.equal(await caseSelection.isChecked(), false, 'analyzing changes must not alter the local run selection');

  const acceptImpactPromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/impact-reviews`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '确认所选影响用例' }).click();
  const acceptImpactResponse = await acceptImpactPromise;
  const acceptImpactBody = await acceptImpactResponse.text();
  assert.equal(acceptImpactResponse.status(), 200, acceptImpactBody);
  const acceptedAnalysis = JSON.parse(acceptImpactBody).analysis;
  assert.equal(acceptedAnalysis.status, 'accepted');
  assert.deepEqual(acceptedAnalysis.selectedCaseIds, ['stable-landing']);
  assert.equal(await caseSelection.isChecked(), false, 'review acceptance must not change the execution selection');
  assert.equal(JSON.parse(acceptImpactBody).project.cases[0].selectedForRegression, true, 'review acceptance must not persist a scope change');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '将已确认用例加入本轮范围' }).waitFor();
  assert.equal(await page.locator('.doc-impact-card').getByText('已确认', { exact: true }).count(), 1, 'the accepted review is restored from project history after a reload');
  await page.getByRole('button', { name: '将已确认用例加入本轮范围' }).click();
  assert.equal(await caseSelection.isChecked(), true, 'the separate explicit action adds reviewed cases to the local scope');
  const registeredThree = await saveVersion({ label: 'build-three', url: urlThree, notes: '修复落地页标题回归' });
  const versionThree = registeredThree.siteVersions.find(item => item.label === 'build-three');
  assert.ok(versionThree);
  assert.equal(registeredThree.activeSiteVersionId, versionThree.id);

  const directUrlEdit = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUrl: urlThree }),
  });
  assert.equal(directUrlEdit.status, 200, 'setting the unchanged project URL remains harmless');
  const forbiddenUrlEdit = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUrl: 'http://127.0.0.1:1/' }),
  });
  assert.equal(forbiddenUrlEdit.status, 422, 'versioned project URLs can only change by appending a version record');

  const selectVersion = async (version, selectedBaselineRunId = '') => {
    await page.getByLabel('本轮测试的网站版本').selectOption(version.id);
    await page.getByLabel('复用已保存的数据组').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    if (selectedBaselineRunId) {
      await page.waitForFunction(id => {
        const selector = document.querySelector('select[aria-label="历史回归基线"]');
        return !!selector && [...selector.options].some(option => option.value === id);
      }, selectedBaselineRunId);
    }
    await page.getByLabel('历史回归基线').selectOption(selectedBaselineRunId);
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/start`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^(运行常规回归|审核并运行常规回归)$/u }).click();
    const response = await responsePromise;
    const responseBody = await response.text();
    assert.equal(response.status(), 202, responseBody);
    const started = JSON.parse(responseBody);
    assert.deepEqual(response.request().postDataJSON().selectedCaseIds, ['stable-landing']);
    assert.equal(response.request().postDataJSON().siteVersionId, version.id);
    assert.equal(response.request().postDataJSON().baselineRunId ?? '', selectedBaselineRunId);
    assert.equal(response.request().postDataJSON().testDataSetId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const progressResponse = await fetch(`${baseUrl}/api/document-runs/${started.runId}/progress`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(progressResponse.status, 200);
      const progress = await progressResponse.json();
      if (progress.status === 'completed') return await fetch(`${baseUrl}/api/document-runs/${started.runId}`).then(result => result.json());
      if (progress.status === 'failed') throw new Error(`Run failed to finalize: ${JSON.stringify(progress)}`);
      await delay(100);
    }
    throw new Error(`Run ${started.runId} did not complete after 12 seconds; server log: ${log}`);
  };

  await page.getByLabel('复用已保存的数据组').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await page.getByLabel('参数 scenarioMarker').fill('updated synthetic input');
  const updateDataSetPromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/update`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '更新当前数据组' }).click();
  const updateDataSetResponse = await updateDataSetPromise;
  const updateDataSetBody = await updateDataSetResponse.text();
  assert.equal(updateDataSetResponse.status(), 200, updateDataSetBody);
  assert.equal(JSON.parse(updateDataSetBody).testDataSets[0].values.scenarioMarker, 'updated synthetic input');
  const credentialDataResponse = await fetch(baseUrl + '/api/document-projects/' + projectId + '/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ testDataSets: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Credential attempt', values: { scenarioMarker: 'Bearer opaque-token-value' } }] }),
  });
  assert.equal(credentialDataResponse.status, 422, 'credential-like values are rejected before being saved');
  assert.match(await credentialDataResponse.text(), /令牌.*认证凭据/u);

  const runOne = await selectVersion(versionOne);
  assert.equal(runOne.siteVersionSnapshot.id, versionOne.id);
  assert.equal(runOne.siteVersionSnapshot.targetUrl, urlOne);
  assert.equal(runOne.siteVersionSnapshot.changeNotes, '第一版基线');
  assert.match(runOne.materialVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(runOne.sourceMaterialsSnapshot.map(({ fileName, role, sha256 }) => ({ fileName, role, sha256 })), [{ fileName: 'fixture.md', role: 'requirements', sha256: 'a'.repeat(64) }]);
  assert.equal(runOne.deterministic.results[0]?.status, 'passed');
  assert.deepEqual(runOne.parameterValues, { scenarioMarker: 'updated synthetic input' });
  assert.equal(runOne.testDataSetId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.match(runOne.testDataVersion, /^[a-f0-9]{64}$/);
  assert.ok(hits.one > 0, 'build-one target must receive the first regression run');
  assert.equal(hits.two, 0, 'build-two must not be visited during the build-one run');

  const sessionStatusResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/session-status?siteVersionId=${versionOne.id}`);
  assert.equal(sessionStatusResponse.status, 200);
  const sessionStatus = await sessionStatusResponse.json();
  assert.equal(sessionStatus.state, 'connected', 'the existing project Edge page is reported without opening another browser');
  assert.equal(sessionStatus.manualLoginRequired, false, 'the local target is not showing a login page');
  const sessionIdentityResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/session-identity`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identityNote: 'QA 只读审核员' }),
  });
  assert.equal(sessionIdentityResponse.status, 200);
  const projectWithIdentity = await sessionIdentityResponse.json();
  assert.equal(projectWithIdentity.reviewStatus, 'approved', 'identity notes do not reset case approval');
  assert.equal(projectWithIdentity.sessionIdentityNote, 'QA 只读审核员');
  const sessionStatusWithIdentity = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/session-status?siteVersionId=${versionOne.id}`)).json();
  assert.equal(sessionStatusWithIdentity.identityNote, 'QA 只读审核员');
  assert.equal(sessionStatusWithIdentity.identitySource, 'user-confirmed');
  const targetHitsBeforeProbe = hits.one;
  const stepProbeResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/probe-step`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'stable-landing', stepIndex: 0, siteVersionId: versionOne.id }),
  });
  assert.equal(stepProbeResponse.status, 200);
  const stepProbe = await stepProbeResponse.json();
  assert.deepEqual({ status: stepProbe.status, locatorKind: stepProbe.locatorKind, matchCount: stepProbe.matchCount, visibleCount: stepProbe.visibleCount }, {
    status: 'found', locatorKind: '字段标签', matchCount: 1, visibleCount: 1,
  });
  assert.match(stepProbe.detail, /没有执行步骤动作/u);
  assert.deepEqual(stepProbe.elementTypes, ['input']);
  assert.equal(hits.one, targetHitsBeforeProbe, 'locator probing must not reload the target or submit data');

  const projectsResponse = await fetch(`${baseUrl}/api/document-projects`);
  assert.equal(projectsResponse.status, 200);
  const projects = await projectsResponse.json();
  assert.deepEqual(new Set(projects.map(item => item.id)), new Set([projectId, secondProjectId]), 'both website projects are retained independently');
  assert.equal(projects.find(item => item.id === projectId).targetUrl, urlThree, 'the primary project follows its selected active deployment version');
  assert.equal(projects.find(item => item.id === projectId).sessionIdentityNote, 'QA 只读审核员');
  assert.equal(projects.find(item => item.id === secondProjectId).targetUrl, secondProject.targetUrl);
  assert.equal(projects.find(item => item.id === secondProjectId).sessionIdentityNote, undefined, 'identity notes remain scoped to their own website project');
  assert.deepEqual(projects.find(item => item.id === secondProjectId).cases.map(item => item.id), ['second-site-session']);
  const secondStartResponse = await fetch(`${baseUrl}/api/document-projects/${secondProjectId}/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'regression', selectedCaseIds: ['second-site-session'] }),
  });
  const secondStartBody = await secondStartResponse.text();
  assert.equal(secondStartResponse.status, 202, secondStartBody);
  const secondStarted = JSON.parse(secondStartBody);
  let secondRun;
  const secondRunDeadline = Date.now() + 30_000;
  while (Date.now() < secondRunDeadline) {
    const progress = await fetch(`${baseUrl}/api/document-runs/${secondStarted.runId}/progress`, { signal: AbortSignal.timeout(5_000) }).then(response => response.json());
    if (progress.status === 'completed') { secondRun = await fetch(`${baseUrl}/api/document-runs/${secondStarted.runId}`).then(response => response.json()); break; }
    if (progress.status === 'failed') throw new Error(`Second project run failed: ${JSON.stringify(progress)}`);
    await delay(100);
  }
  assert.ok(secondRun, `Second project run did not finish; server log: ${log}`);
  assert.equal(secondRun.projectId, secondProjectId);
  assert.deepEqual(secondRun.caseScope.selectedCaseIds, ['second-site-session']);
  assert.equal(secondRun.deterministic.results[0]?.status, 'passed', 'same-origin sessionStorage from the first project must not leak into the second project');
  const primaryRunsAfterSecond = await fetch(`${baseUrl}/api/document-projects/${projectId}/runs`).then(response => response.json());
  const secondRuns = await fetch(`${baseUrl}/api/document-projects/${secondProjectId}/runs`).then(response => response.json());
  assert.ok(!primaryRunsAfterSecond.some(item => item.id === secondRun.id));
  assert.deepEqual(secondRuns.map(item => item.id), [secondRun.id]);

  const runOnePackage = await fetch(`${baseUrl}/api/document-runs/${runOne.id}/package`);
  assert.equal(runOnePackage.status, 200);
  const entries = unzipSync(new Uint8Array(await runOnePackage.arrayBuffer()));
  const packagedCases = JSON.parse(strFromU8(entries['cases.json']));
  assert.equal(packagedCases.siteVersionSnapshot.id, versionOne.id, 'downloaded cases are bound to the run deployment snapshot');
  assert.equal(packagedCases.targetUrl, urlOne);
  assert.equal(packagedCases.materialVersion, runOne.materialVersion);
  assert.equal(JSON.parse(strFromU8(entries['source-materials.json']))[0].sha256, 'a'.repeat(64));
  const packagedInputStep = packagedCases.cases.find(item => item.id === 'stable-landing')?.steps.find(step => step.action === 'fillByLabel');
  assert.equal(packagedInputStep?.value, 'updated synthetic input', 'the standalone runner receives the resolved parameter snapshot');
  const packagedRun = JSON.parse(strFromU8(entries['run.json']));
  assert.deepEqual(packagedRun.parameterValues, { scenarioMarker: 'updated synthetic input' });
  assert.equal(packagedRun.materialVersion, runOne.materialVersion);
  assert.equal(packagedRun.testDataVersion, runOne.testDataVersion);

  const runTwo = await selectVersion(versionTwo, runOne.id);
  assert.equal(runTwo.siteVersionSnapshot.id, versionTwo.id);
  assert.equal(runTwo.siteVersionSnapshot.targetUrl, urlTwo);
  assert.equal(runTwo.siteVersionSnapshot.changeNotes, 'Landing page visual polish; keep existing landing page behavior');
  assert.equal(runTwo.deterministic.results[0]?.status, 'failed');
  assert.equal(runTwo.caseVersion, runOne.caseVersion, 'changing only the deployed website version must not invent a new test-case version');
  assert.equal(runTwo.materialVersion, runOne.materialVersion, 'changing only the deployed website version must not invent a new source-material version');
  assert.equal(runTwo.testDataVersion, runOne.testDataVersion, 'the same data set and values retain one test-data version across website deployments');
  assert.equal(runTwo.baselineRunId, runOne.id);
  assert.equal(runTwo.baselineTestDataChanged, false, 'matching data snapshots do not produce a test-data drift warning');
  assert.equal(runTwo.baselineComparison?.[0]?.disposition, 'regression');
  assert.equal(runTwo.comparisons[0]?.triage?.category, 'suspected-product-regression');
  assert.equal(runTwo.comparisons[0]?.triage?.confidence, 'tentative', 'the triage calls it a suspected regression pending human review');
  assert.match(runTwo.report, /疑似产品回归/u);
  assert.ok(hits.two > 0, 'build-two target must receive the second regression run');

  const runThree = await selectVersion(versionThree, runTwo.id);
  assert.equal(runThree.siteVersionSnapshot.id, versionThree.id);
  assert.equal(runThree.deterministic.results[0]?.status, 'passed');
  assert.equal(runThree.baselineRunId, runTwo.id);
  assert.equal(runThree.baselineComparison?.[0]?.disposition, 'fixed');
  assert.ok(hits.three > 0, 'the fixed deployment must receive the third regression run');

  const projectPath = join(dataDir, 'document-tests', 'projects', `${projectId}.json`);
  const savedProject = JSON.parse(await readFile(projectPath, 'utf8'));
  const originalMaterialHash = savedProject.sourceMaterials[0].sha256;
  savedProject.sourceMaterials[0].sha256 = 'c'.repeat(64);
  await writeFile(projectPath, JSON.stringify(savedProject));
  const runFour = await selectVersion(versionThree, runOne.id);
  assert.notEqual(runFour.materialVersion, runOne.materialVersion);
  assert.equal(runFour.baselineMaterialChanged, true, 'a changed test-material revision is called out separately from case outcome changes');
  assert.equal(runFour.testDataVersion, runOne.testDataVersion);
  assert.equal(runFour.baselineTestDataChanged, false);
  assert.equal(runFour.baselineComparison?.[0]?.disposition, 'unchanged');
  const unsafeRetest = await fetch(`${baseUrl}/api/document-projects/${projectId}/retest`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentRunId: runOne.id, caseIds: ['stable-landing'] }),
  });
  assert.equal(unsafeRetest.status, 409, 'a retest cannot silently reuse a parent result after source materials change');
  savedProject.sourceMaterials[0].sha256 = originalMaterialHash;
  await writeFile(projectPath, JSON.stringify(savedProject));

  const retestResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/retest`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentRunId: runOne.id, caseIds: ['stable-landing'], notes: 'Repeat the original build-one check.' }),
  });
  const retestBody = await retestResponse.text();
  assert.equal(retestResponse.status, 202, retestBody);
  const retestStart = JSON.parse(retestBody);
  let retest;
  const retestDeadline = Date.now() + 30_000;
  while (Date.now() < retestDeadline) {
    const progress = await fetch(`${baseUrl}/api/document-runs/${retestStart.runId}/progress`, { signal: AbortSignal.timeout(5_000) }).then(response => response.json());
    if (progress.status === 'completed') {
      retest = await fetch(`${baseUrl}/api/document-runs/${retestStart.runId}`).then(response => response.json());
      break;
    }
    if (progress.status === 'failed') throw new Error(`Retest failed to finalize: ${JSON.stringify(progress)}`);
    await delay(100);
  }
  assert.ok(retest, `Retest did not finish; server log: ${log}`);
  assert.equal(retest.parentRunId, runOne.id);
  assert.equal(retest.siteVersionSnapshot.id, versionOne.id, 'targeted retest inherits the parent deployment even though build-two is active');
  assert.equal(retest.deterministic.results[0]?.status, 'passed');
  assert.ok(hits.one >= 2, 'the parent deployment must be revisited by its retest');
  assert.ok(hits.two > 0, 'the latest deployment remains separately exercised');

  const createDraftPromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/update`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '创建并保存待完善用例草稿' }).click();
  const createDraftResponse = await createDraftPromise;
  const createDraftBody = await createDraftResponse.text();
  assert.equal(createDraftResponse.status(), 200, createDraftBody);
  const iterationDraft = JSON.parse(createDraftBody).cases.find(item => item.caseOrigin === 'iteration-impact-draft');
  assert.ok(iterationDraft, 'the iteration draft is persisted with explicit provenance');
  assert.equal(iterationDraft.selectedForRegression, false);
  assert.equal(iterationDraft.expected, '');
  assert.deepEqual(iterationDraft.steps, []);
  assert.match(iterationDraft.source, /build-three/u);

  const analyzeAgain = await fetch(`${baseUrl}/api/document-projects/${projectId}/impact-reviews`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'analyze', siteVersionId: versionTwo.id }),
  });
  assert.equal(analyzeAgain.status, 201);
  const rejectedCandidate = await analyzeAgain.json();
  const rejectResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/impact-reviews`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review', analysisId: rejectedCandidate.analysis.id, decision: 'reject', notes: 'Reviewed; this wording does not change expected behavior.' }),
  });
  assert.equal(rejectResponse.status, 200);
  const rejectedBody = await rejectResponse.json();
  assert.equal(rejectedBody.analysis.status, 'rejected');
  assert.deepEqual(rejectedBody.analysis.selectedCaseIds, []);

  const staleScanResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/impact-reviews`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'analyze', siteVersionId: versionTwo.id }),
  });
  assert.equal(staleScanResponse.status, 201);
  const staleScan = await staleScanResponse.json();
  const changedCases = [{ ...project.cases[0], title: 'Stable landing page remains visible after local edit' }];
  const saveChangedCases = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: changedCases }),
  });
  assert.equal(saveChangedCases.status, 200);
  const staleReview = await fetch(`${baseUrl}/api/document-projects/${projectId}/impact-reviews`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review', analysisId: staleScan.analysis.id, decision: 'accept', selectedCaseIds: ['stable-landing'] }),
  });
  assert.equal(staleReview.status, 409, 'a review cannot approve recommendations against cases changed since analysis');

  const historicalRun = await fetch(`${baseUrl}/api/document-runs/${runOne.id}`).then(response => response.json());
  assert.equal(historicalRun.caseSnapshotVersion, 1);
  assert.equal(historicalRun.caseSnapshots.find(item => item.id === 'stable-landing').title, project.cases[0].title);
  assert.equal(historicalRun.executionCaseSnapshots.find(item => item.id === 'stable-landing').steps.find(step => step.action === 'fillByLabel').value, 'updated synthetic input');
  const historicalPackageResponse = await fetch(`${baseUrl}/api/document-runs/${runOne.id}/package`);
  assert.equal(historicalPackageResponse.status, 200);
  const historicalPackage = unzipSync(new Uint8Array(await historicalPackageResponse.arrayBuffer()));
  const historicalCases = JSON.parse(strFromU8(historicalPackage['cases.json']));
  assert.equal(historicalCases.caseSnapshotSource, 'run-snapshot');
  assert.equal(historicalCases.cases[0].title, project.cases[0].title, 'editing the current project later does not rewrite the saved run package');

  const missingLocatorCase = [{ ...changedCases[0], steps: [{ action: 'fillByLabel', label: 'Missing marker', value: 'synthetic probe only' }] }];
  const saveMissingLocator = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: missingLocatorCase }),
  });
  assert.equal(saveMissingLocator.status, 200, await saveMissingLocator.text());
  const approveMissingLocator = await fetch(`${baseUrl}/api/document-projects/${projectId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Approved locator probe fixture; it will only inspect the current page.' }),
  });
  assert.equal(approveMissingLocator.status, 200, await approveMissingLocator.text());
  const hitsBeforeMissingProbe = hits.one;
  const missingProbeResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/probe-step`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'stable-landing', stepIndex: 0, siteVersionId: versionOne.id }),
  });
  assert.equal(missingProbeResponse.status, 200);
  const missingProbe = await missingProbeResponse.json();
  assert.equal(missingProbe.status, 'not-found', JSON.stringify(missingProbe));
  assert.equal(missingProbe.matchCount, 0);
  assert.match(missingProbe.detail, /没有可见匹配控件/u);
  assert.equal(hits.one, hitsBeforeMissingProbe, 'a failed locator probe does not reload, navigate, or submit');
});
