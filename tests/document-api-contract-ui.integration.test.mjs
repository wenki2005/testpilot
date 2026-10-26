import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('document project UI links only an approved API suite and saves explicit mappings with network disabled by default', { timeout: 60_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-api-contract-ui', String(Date.now()));
  const projectId = 'doc-api-ui-fixture';
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const project = {
    id: projectId, name: 'Document API mapping fixture', fileName: 'fixture.md', caseMode: 'existing', format: 'markdown',
    targetUrl: 'http://127.0.0.1:1/', sourceText: 'Local UI fixture.', confirmationRequired: false,
    cases: [
      { id: 'doc-health', title: 'Order list', source: 'requirements.md:1', modulePath: ['申请流程', '权限控制'], requirementRefs: ['sample requirement'], priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Ready', steps: [{ action: 'assertVisible', text: 'Ready' }] },
      { id: 'doc-denied-export', title: 'Export is denied', source: 'requirements.md:2', modulePath: ['申请流程', '权限控制', '导出'], requirementRefs: ['sample requirement'], priority: 'P1', category: 'authorization', confidence: 'high', coverageAreas: ['authorization'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Forbidden', steps: [{ action: 'assertVisible', text: 'Forbidden' }] },
      { id: 'doc-login', title: 'Login entry is visible', source: 'requirements.md:3', modulePath: ['申请流程', '登录'], requirementRefs: ['sample requirement'], priority: 'P2', category: 'authentication', confidence: 'high', coverageAreas: ['authentication'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Login', steps: [{ action: 'assertVisible', text: 'Login' }] },
    ],
    reviewStatus: 'draft', reviewNotes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); }); demo.stderr.on('data', chunk => { log += chunk.toString(); });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (demo.exitCode === null) { const exited = new Promise(resolveExit => demo.once('exit', resolveExit)); demo.kill('SIGTERM'); await exited; }
  });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }
  const suite = { version: 1, name: 'Approved health suite', description: 'Read-only test fixture.', baseUrl: 'http://127.0.0.1:1/', cases: [
    { id: 'get-health', title: 'GET health', source: 'fixture', requirementRefs: [], priority: 'P1', request: { method: 'GET', path: '/health' }, expect: { status: 200 } },
    { id: 'get-ready', title: 'GET readiness', source: 'fixture', requirementRefs: [], priority: 'P2', request: { method: 'GET', path: '/ready' }, expect: { status: 200 } },
    { id: 'get-orders', title: 'GET order lookup', source: 'fixture', requirementRefs: [], priority: 'P2', request: { method: 'GET', path: '/orders' }, expect: { status: 200 } },
  ] };
  const candidateResponse = await fetch(`${baseUrl}/api/api-suites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(suite) });
  assert.equal(candidateResponse.status, 201);
  const candidate = await candidateResponse.json();
  const approved = await fetch(`${baseUrl}/api/api-suites/${candidate.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'UI mapping fixture.' }) });
  assert.equal(approved.status, 200);

  const allDisabled = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiContract: { suiteId: candidate.id, mappings: [], allowNetwork: false, allowMutations: false, allowConcurrency: false } }) });
  assert.equal((await allDisabled.json()).reviewStatus, 'approved', 'reduced-confirmation mode may retain the approved read-only default');
  for (const enabled of ['allowNetwork', 'allowMutations', 'allowConcurrency']) {
    const reapproved = await fetch(`${baseUrl}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: `Review before enabling ${enabled}.` }) });
    assert.equal(reapproved.status, 200);
    const apiContract = { suiteId: candidate.id, mappings: [], allowNetwork: false, allowMutations: false, allowConcurrency: false, [enabled]: true };
    const update = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiContract }) });
    assert.equal((await update.json()).reviewStatus, 'draft', `${enabled} must require a fresh manual project review even when reduced-confirmation mode is enabled`);
  }
  const resetPermissions = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiContract: { mappings: [], allowNetwork: false, allowMutations: false, allowConcurrency: false } }) });
  assert.equal((await resetPermissions.json()).reviewStatus, 'approved');
  const finalReview = await fetch(`${baseUrl}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Reviewed API authorization and mappings.' }) });
  assert.equal(finalReview.status, 200);

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?documentProject=${projectId}`, { waitUntil: 'networkidle' });
  const modulePicker = page.locator('.doc-module-picker');
  await modulePicker.locator('summary').click();
  const moduleOptions = modulePicker.locator('.doc-module-picker-list label');
  let permissionModule;
  for (let index = 0; index < await moduleOptions.count(); index++) {
    const option = moduleOptions.nth(index);
    if ((await option.locator('small').textContent())?.trim() === '申请流程 / 权限控制') { permissionModule = option; break; }
  }
  assert.ok(permissionModule, 'XMind-style module hierarchy should be available for scope selection');
  await permissionModule.locator('input').check();
  await modulePicker.getByRole('button', { name: '应用模块范围（1）' }).click();
  const moduleSavePromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/update`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const moduleSave = await moduleSavePromise;
  assert.equal(moduleSave.status(), 200);
  const moduleSavePayload = moduleSave.request().postDataJSON();
  assert.deepEqual(moduleSavePayload.cases.map(item => [item.id, item.selectedForRegression]), [
    ['doc-health', true], ['doc-denied-export', true], ['doc-login', false],
  ], 'selecting a parent module should include its descendants and exclude sibling modules');
  const moduleSavedProject = await moduleSave.json();
  assert.deepEqual(moduleSavedProject.cases.map(item => item.modulePath), [
    ['申请流程', '权限控制'], ['申请流程', '权限控制', '导出'], ['申请流程', '登录'],
  ], 'editable module paths should survive project persistence');
  const apiPanel = page.locator('.doc-api-contract');
  await apiPanel.waitFor();
  assert.match(await apiPanel.textContent(), /映射候选.*不会自动勾选|不会自动勾选.*映射候选/);
  await apiPanel.locator('summary').click();
  const suitePicker = apiPanel.getByLabel('已审核 API suite');
  await suitePicker.selectOption(candidate.id);
  await apiPanel.getByText('GET /health', { exact: false }).first().waitFor();
  const mapOptions = apiPanel.locator('.doc-api-case-option');
  assert.equal(await mapOptions.count(), 9, 'API mapping choices should exist for each of the three document cases');
  assert.equal(await mapOptions.locator('input:checked').count(), 0, 'selecting a suite must not invent mappings');
  assert.equal(await apiPanel.locator('.doc-api-case-option.mapping-candidate').count(), 1, 'the shared order token should be surfaced as a candidate');
  assert.match(await apiPanel.locator('.doc-api-case-option.mapping-candidate').textContent(), /get-orders.*映射候选.*GET \/orders/s);
  const authorizations = apiPanel.locator('.doc-api-authorizations input[type="checkbox"]');
  assert.equal(await authorizations.count(), 3);
  assert.equal(await authorizations.locator(':checked').count(), 0, 'network, mutation and concurrency permissions start disabled');
  const networkCheckbox = apiPanel.getByLabel('允许访问非本机 API 目标');
  assert.equal(await networkCheckbox.isChecked(), false, 'network access starts disabled');
  const mutationCheckbox = apiPanel.getByLabel(/允许执行已审核 suite 声明的 POST/);
  const concurrencyCheckbox = apiPanel.getByLabel('允许执行已审核 suite 声明的并发请求');
  await mutationCheckbox.check();
  await concurrencyCheckbox.check();
  const healthMapping = apiPanel.locator('.doc-api-mapping').filter({ hasText: 'doc-health · Order list' });
  await healthMapping.locator('.doc-api-case-option').filter({ hasText: 'get-health' }).getByRole('checkbox').check();
  const updateResponsePromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/update`) && response.request().method() === 'POST');
  await apiPanel.getByRole('button', { name: '保存 API 映射与安全选项' }).click();
  const updateResponse = await updateResponsePromise;
  assert.equal(updateResponse.status(), 200);
  const updatePayload = updateResponse.request().postDataJSON();
  assert.deepEqual(updatePayload.apiContract, { suiteId: candidate.id, mappings: [{ documentCaseId: 'doc-health', apiCaseIds: ['get-health'] }], allowNetwork: false, allowMutations: true, allowConcurrency: true });
  const savedProject = await updateResponse.json();
  assert.deepEqual(savedProject.apiContract, updatePayload.apiContract);
  assert.equal(savedProject.reviewStatus, 'draft', 'changing an execution authorization returns the document project to review');
  assert.match(await page.locator('.doc-notice').filter({ hasText: 'API 映射草稿已保存' }).textContent(), /已保存/);

  const loginCase = page.locator('.doc-case').filter({ has: page.getByLabel('用例状态 doc-login') });
  const lifecycle = page.getByLabel('用例状态 doc-login');
  const runCheckbox = loginCase.locator('.doc-case-select input');
  await lifecycle.selectOption('draft');
  assert.equal(await runCheckbox.isDisabled(), true, 'draft cases cannot be included in the run scope');
  assert.equal(await runCheckbox.isChecked(), false, 'moving a case to draft clears its run selection');
  await lifecycle.selectOption('runnable');
  assert.equal(await runCheckbox.isDisabled(), false, 'runnable cases may be selected explicitly');
  assert.equal(await runCheckbox.isChecked(), false, 'promoting a draft does not silently expand this run scope');
  await runCheckbox.check();
  assert.equal(await runCheckbox.isChecked(), true);
  await lifecycle.selectOption('disabled');
  assert.equal(await runCheckbox.isDisabled(), true, 'disabled cases are not selectable');
  assert.equal(await runCheckbox.isChecked(), false, 'disabling a case removes it from the run scope');
  const lifecycleSavePromise = page.waitForResponse(response => response.url().endsWith(`/api/document-projects/${projectId}/update`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const lifecycleSave = await lifecycleSavePromise;
  assert.equal(lifecycleSave.status(), 200);
  const lifecycleSavedCase = lifecycleSave.request().postDataJSON().cases.find(item => item.id === 'doc-login');
  assert.deepEqual([lifecycleSavedCase.lifecycleStatus, lifecycleSavedCase.selectedForRegression], ['disabled', false]);
  const directSelection = await fetch(`${baseUrl}/api/document-projects/${projectId}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['doc-login'], selected: true }) });
  assert.equal(directSelection.status, 422, 'the server must reject requests that try to select a disabled case');
  assert.match((await directSelection.json()).error, /草稿或停用用例不能加入回归范围/u);
  const persistedDisabledProject = (await fetch(`${baseUrl}/api/document-projects`).then(response => response.json())).find(item => item.id === projectId);
  assert.deepEqual([persistedDisabledProject.cases.find(item => item.id === 'doc-login').lifecycleStatus, persistedDisabledProject.cases.find(item => item.id === 'doc-login').selectedForRegression], ['disabled', false]);
});

async function reservePort() {
  const { createServer } = await import('node:http');
  const server = createServer(); server.listen(0, '127.0.0.1');
  await new Promise(resolveListen => server.once('listening', resolveListen));
  const port = server.address().port; await new Promise(resolveClose => server.close(resolveClose)); return port;
}
