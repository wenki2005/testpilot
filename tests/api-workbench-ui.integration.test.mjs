import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');

test('main workbench creates and automatically executes an approved read-only API suite', { timeout: 60_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'api-workbench-ui', String(Date.now()));
  let targetHits = 0;
  const target = createServer((req, res) => {
    if (req.url !== '/v1/health') { res.writeHead(404); res.end(); return; }
    targetHits++;
    if (targetHits === 1) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'temporary fixture outage' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', ready: true }));
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetBase = `http://127.0.0.1:${target.address().port}/v1/`;
  const model = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer local-ui-key');
    const request = JSON.parse(body);
    assert.equal(request.response_format.type, 'json_object');
    const suite = { version: 1, name: 'Workbench health checks', description: 'Generated from supplied local API contract.', baseUrl: targetBase, cases: [{ id: 'health-ready', title: 'Health endpoint reports ready', source: 'OpenAPI: GET /health', requirementRefs: ['API contract › health'], priority: 'P1', request: { method: 'GET', path: '/health' }, expect: { status: 200, json: { status: 'ok', ready: true } } }] };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(suite) } }] }));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const port = await reservePort(); const baseUrl = `http://127.0.0.1:${port}`;
  const environment = { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: 'local-ui-key', OPENAI_API_KEY: '', TESTPILOT_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, TESTPILOT_MODEL: 'local-ui-fixture', TESTPILOT_DISABLE_PUBLIC_SEARCH: '1', TESTPILOT_BROWSER_CDP_ENDPOINT: '' };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; demo.stdout.on('data', chunk => { log += chunk.toString(); }); demo.stderr.on('data', chunk => { log += chunk.toString(); });
  let browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); }
    for (const server of [target, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'API 服务' }).click();
  await page.getByLabel('API Base URL').fill(targetBase);
  await page.getByLabel('OpenAPI 契约').fill('openapi: 3.1.0\ninfo: { title: UI Fixture API, version: 1.0.0 }\npaths:\n  /health:\n    get:\n      responses:\n        "200":\n          description: service is healthy\n  /version:\n    get:\n      responses:\n        "200":\n          description: version information');
  await page.getByLabel('你希望重点检查什么？').fill('确认服务健康接口返回 ready 状态。');
  const autoRunResponsePromise = page.waitForResponse(response => response.url().includes('/auto-run') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '开始测试' }).click();
  const autoRunResponse = await autoRunResponsePromise;
  assert.equal(autoRunResponse.status(), 201);
  const autoRunPayload = await autoRunResponse.json();
  assert.match(autoRunPayload.run.scope.join('\n'), /OpenAPI operation trace coverage: 1\/2/);
  assert.match(autoRunPayload.run.scope.join('\n'), /boundary checks 0\/0 matched to case requests/);
  const apiReport = await fetch(`${baseUrl}/api/api-runs/${autoRunPayload.run.runId}/report`);
  const apiReportText = await apiReport.text();
  assert.match(apiReportText, /OpenAPI operation trace coverage: 1\/2/);
  assert.match(apiReportText, /boundary checks 0\/0 matched to case requests/);
  assert.match(apiReportText, /OpenAPI design targets vs observed run/);
  assert.match(apiReportText, /mismatch/);
  assert.deepEqual(autoRunPayload.run.apiDesignAssessment.checks.map(check => [check.category, check.operationKey, check.status, check.observedStatuses]), [['success', 'GET /health', 'mismatch', [503]], ['success', 'GET /version', 'not-authored', []]]);
  const findingsUrl = `${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/findings`;
  const firstFindings = await (await fetch(findingsUrl)).json();
  const firstRunIssues = firstFindings.findings.filter(item => item.state === 'open' && item.caseId === 'health-ready');
  assert.ok(firstRunIssues.length >= 1, 'the first failed run should create a persistent finding');
  assert.ok(firstRunIssues.every(item => item.lastRunId === autoRunPayload.run.runId));
  const firstFindingIds = firstRunIssues.map(item => item.findingId).sort();
  const diagnosisUrl = `${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/findings/${firstRunIssues[0].findingId}/diagnosis`;
  const diagnosis = await (await fetch(diagnosisUrl)).json();
  assert.equal(diagnosis.classification, 'assertion-failure');
  assert.equal(diagnosis.source, 'deterministic-evidence');
  assert.equal(diagnosis.evidence.runId, autoRunPayload.run.runId);
  assert.equal(diagnosis.evidence.caseId, 'health-ready');
  assert.equal(diagnosis.recommendation.canRun, true);
  assert.equal(diagnosis.recommendation.parentRunId, autoRunPayload.run.runId);
  const designGap = firstFindings.findings.find(item => item.state === 'open' && item.kind === 'design-gap' && item.operationKey === 'GET /version');
  assert.ok(designGap, 'an uncovered OpenAPI operation should remain a design-gap finding');
  const gapDiagnosis = await (await fetch(`${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/findings/${designGap.findingId}/diagnosis`)).json();
  assert.equal(gapDiagnosis.classification, 'suite-design-gap');
  assert.equal(gapDiagnosis.recommendation.action, 'author-or-review-case');
  assert.equal(gapDiagnosis.recommendation.canRun, false, 'a design gap cannot be offered as a rerun');
  await page.getByRole('heading', { name: 'API 测试会话' }).waitFor();
  await page.getByText('只读 API 测试已自动审核并运行。').waitFor({ timeout: 15_000 });
  await page.locator('.api-case-card').filter({ hasText: 'Health endpoint reports ready' }).waitFor();
  await page.getByText(/OpenAPI 操作追溯：1\/2/).waitFor();
  await page.getByText('设计目标与实际响应').click();
  await page.getByText('成功响应', { exact: true }).first().waitFor();
  await page.locator('.api-design-check').filter({ hasText: 'GET /health' }).getByText('实际 HTTP 503', { exact: true }).waitFor();
  const resultCard = page.locator('.api-result').filter({ hasText: 'Health endpoint reports ready' });
  await resultCard.waitFor();
  const resultText = await resultCard.textContent();
  assert.match(resultText, /API contract › health/);
  assert.match(resultText, /来源 OpenAPI: GET \/health/);
  assert.match(resultText, /预期/);
  assert.match(resultText, /HTTP 503/);
  await resultCard.getByText(/查看请求与响应证据/).click();
  await resultCard.getByText(/body=/).waitFor();
  await page.getByRole('link', { name: '下载可复用 ZIP' }).waitFor();
  assert.equal(targetHits, 1, 'the approved read-only API case should reach only its supplied local target');
  assert.equal(await page.getByText('已审核 · v1').count(), 1);
  const historyIssue = page.locator('.api-finding-list > article').first();
  await historyIssue.waitFor();
  await historyIssue.getByRole('button', { name: '查看证据诊断建议' }).click();
  await historyIssue.getByText(/证据诊断 · 断言失败/).waitFor();
  assert.match(await historyIssue.textContent(), /基于确定性证据规则生成，未调用模型或修改用例/);
  const targetedRerunResponse = page.waitForResponse(response => response.url().includes(`/api/api-suites/${autoRunPayload.candidate.id}/run`) && response.request().method() === 'POST');
  await historyIssue.getByRole('button', { name: '仅重测此失败用例' }).click();
  const targetedRerun = await (await targetedRerunResponse).json();
  assert.equal(targetedRerun.status, 'passed');
  assert.deepEqual(targetedRerun.apiRerun, { parentRunId: autoRunPayload.run.runId, caseIds: ['health-ready'] });
  assert.match(targetedRerun.scope.join('\n'), /Executed API cases: 1\/1 \(selected health-ready\)/);
  assert.equal(targetHits, 2, 'the targeted rerun sends only the selected approved case');
  await page.getByText('已完成定向重测：passed').waitFor();
  const rerunComparison = page.locator('.api-rerun-comparison');
  await rerunComparison.waitFor();
  assert.match(await rerunComparison.textContent(), /失败 → 通过/);
  assert.match(await rerunComparison.textContent(), /HTTP 503 → HTTP 200/);
  const originalRun = await (await fetch(`${baseUrl}/api/api-runs/${autoRunPayload.run.runId}`)).json();
  assert.equal(originalRun.status, 'failed', 'the parent run remains an immutable, separately queryable record');
  assert.ok(originalRun.apiFindingUpdates.some(item => item.state === 'open'), 'the parent run preserves its original open-finding evidence');
  const resolvedFindings = await (await fetch(findingsUrl)).json();
  const resolvedRunIssues = resolvedFindings.findings.filter(item => firstFindingIds.includes(item.findingId));
  assert.deepEqual(resolvedRunIssues.map(item => item.findingId).sort(), firstFindingIds, 'the rerun must update stable finding identities');
  assert.ok(resolvedRunIssues.every(item => item.state === 'resolved' && item.resolvedByRunId === targetedRerun.runId));
  assert.ok(targetedRerun.apiFindingUpdates.some(item => item.state === 'resolved'));
  assert.ok(resolvedRunIssues.every(item => item.history.some(event => event.runId === autoRunPayload.run.runId && event.state === 'open') && item.history.some(event => event.runId === targetedRerun.runId && event.state === 'resolved')));
  const resolvedDiagnosis = await (await fetch(`${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/findings/${firstFindingIds[0]}/diagnosis`)).json();
  assert.equal(resolvedDiagnosis.classification, 'resolved');
  assert.equal(resolvedDiagnosis.recommendation.canRun, false);
  const packagedRun = await (await fetch(`${baseUrl}/api/api-runs/${targetedRerun.runId}/package`)).arrayBuffer();
  const { unzipSync, strFromU8 } = await import('fflate');
  const archive = unzipSync(new Uint8Array(packagedRun));
  assert.ok(archive['findings.json'], 'the reusable package includes the current persistent findings snapshot');
  assert.equal(JSON.parse(strFromU8(archive['run.json'])).runId, targetedRerun.runId);
  const invalidRerun = await fetch(`${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['health-ready'], rerunOf: targetedRerun.runId }) });
  assert.equal(invalidRerun.status, 409, 'a passing case cannot be laundered into a targeted failure rerun');
  const unknownCaseRerun = await fetch(`${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['unapproved-case'], rerunOf: autoRunPayload.run.runId }) });
  assert.equal(unknownCaseRerun.status, 409, 'targeted reruns cannot execute cases outside the approved suite');
  const retargetedRerun = await fetch(`${baseUrl}/api/api-suites/${autoRunPayload.candidate.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['health-ready'], rerunOf: autoRunPayload.run.runId, baseUrl: 'https://example.invalid/', allowNetwork: true }) });
  assert.equal(retargetedRerun.status, 409, 'a targeted rerun cannot move an approved case to another host');
  assert.equal(targetHits, 2, 'invalid reruns must not reach the target');

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: 'API 测试套件' }).click();
  await page.getByRole('heading', { name: 'API 测试套件' }).waitFor();
  await page.getByRole('button', { name: /Workbench health checks/ }).waitFor();
  await page.getByRole('button', { name: /Workbench health checks/ }).click();
  await page.getByRole('heading', { name: 'API 测试会话' }).waitFor();
  await page.locator('.api-case-card').filter({ hasText: 'Health endpoint reports ready' }).waitFor();
  assert.equal(targetHits, 2, 'reopening a persisted suite must not silently run it again');

  const generated = await fetch(`${baseUrl}/api/api-suites/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: targetBase, contextText: 'Check health.', apiSpecification: 'openapi: 3.1.0\ninfo: { title: UI Fixture API, version: 1.0.0 }\npaths:\n  /health:\n    get:\n      responses:\n        "200": { description: healthy }\n  /version:\n    get:\n      responses:\n        "200": { description: version }' }) });
  assert.equal(generated.status, 201);
  const candidate = await generated.json();
  assert.deepEqual(candidate.suite.openApiCoverage.operationKeys, ['GET /health', 'GET /version']);
  assert.deepEqual(candidate.suite.openApiCoverage.coveredOperationKeys, ['GET /health']);
  assert.deepEqual(candidate.suite.openApiCoverage.scenarios.success.coveredOperationKeys, ['GET /health']);
  const changedSuite = { ...candidate.suite, openApiCoverage: { operationKeys: ['GET /forged'], coveredOperationKeys: ['GET /forged'], uncoveredOperationKeys: [] }, cases: candidate.suite.cases.map(item => ({ ...item, source: 'Requirement: service is healthy' })) };
  const revised = await fetch(`${baseUrl}/api/api-suites/${candidate.id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suite: changedSuite }) });
  assert.equal(revised.status, 200);
  const current = await (await fetch(`${baseUrl}/api/api-suites/${candidate.id}`)).json();
  assert.deepEqual(current.suite.openApiCoverage.operationKeys, ['GET /health', 'GET /version']);
  assert.deepEqual(current.suite.openApiCoverage.coveredOperationKeys, [], 'edited cases no longer cite the contract operations');
  assert.deepEqual(current.suite.openApiCoverage.uncoveredOperationKeys, ['GET /health', 'GET /version']);
  assert.deepEqual(current.suite.openApiCoverage.operationFacts.map(item => item.key), ['GET /health', 'GET /version'], 'user edits cannot replace the saved contract baseline');
  assert.deepEqual(current.suite.openApiCoverage.scenarios.success.uncoveredOperationKeys, ['GET /health', 'GET /version']);
});

async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
