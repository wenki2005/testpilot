import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { strFromU8, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('document workflow preserves selected scope in partial report, ZIP and MCP export', { timeout: 180_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-workflow-integration', String(Date.now()));
  const projectId = 'doc-partial-fixture';
  let targetVisits = 0;
  let crossOriginHits = 0;
  let evilPort = 0;
  const evil = createServer((_req, res) => { crossOriginHits++; res.writeHead(204); res.end(); });
  const target = createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/single-field') { res.writeHead(204); res.end(); return; }
    targetVisits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const inputs = req.url === '/single-field' ? "<label>Fixture code<input aria-invalid='true' style='border:2px solid red'></label>" : "<label>Fixture code<input aria-invalid='true' style='border:2px solid red'></label><label>Fixture code<input aria-invalid='true' style='border:2px solid red'></label>";
    const body = `<h1>Session restored</h1><output id='viewport'></output>${inputs}<script>sessionStorage.setItem('testpilot-fixture-session', 'kept');const viewport=document.querySelector('#viewport');const updateViewport=()=>{const y=scrollY;viewport.textContent='viewport='+window.innerWidth+' motion='+(matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'no-preference')+' scroll='+(y>500?'middle':'top')};addEventListener('resize',updateViewport);addEventListener('scroll',updateViewport);updateViewport();</script>`;
    res.end(`<!doctype html><html><head><title>Local QA fixture</title></head><body style='min-height:3000px'>${body}<script>const field=document.querySelector('input');field.addEventListener('blur',()=>{if(field.value==='CALL'){fetch('/write-via-get?secret=do-not-log');fetch('http://127.0.0.1:${evilPort}/oauth/token').catch(()=>{})}});</script></body></html>`);
  });
  let visualMode = 'pass';
  let emptyStepDraft = false;
  let summaryFailure = false;
  let seenVisualImage = false;
  let sawObservedPageEvidence = false;
  let modelRequestCount = 0;
  const model = createServer((req, res) => {
    void (async () => {
      modelRequestCount++;
      let body = '';
      for await (const part of req) body += part;
      const payload = JSON.parse(body);
      const availableToolNames = payload.tools?.map(tool => tool.function?.name) ?? [];
      const toolName = availableToolNames.find(name => ['testpilot_computer_capability_probe', 'submit_browser_steps'].includes(name)) ?? availableToolNames[0];
      let message;
      let statusCode = 200;
      if (!toolName && summaryFailure) { statusCode = 503; message = { error: { message: 'Local fixture intentionally rejects report summaries.' } }; }
      else if (!toolName) message = { role: 'assistant', content: 'Fixture summary based only on the run evidence.' };
      else if (toolName === 'testpilot_computer_capability_probe') {
        message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name: toolName, arguments: JSON.stringify({ canReadScreenshot: true }) } }] };
      } else if (toolName === 'submit_browser_steps') {
        const content = payload.messages.at(-1)?.content ?? '';
        const promptText = Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : String(content);
        sawObservedPageEvidence ||= promptText.includes('Observed page evidence') && promptText.includes('"name":"Fixture code"');
        const duplicateField = (promptText.match(/"name":"Fixture code"/gu) ?? []).length > 1;
        const usesSecondField = /第二个\s*Fixture code/iu.test(promptText) || duplicateField;
        message = { role: 'assistant', tool_calls: [{ id: 'draft-steps', type: 'function', function: { name: toolName, arguments: JSON.stringify({ steps: emptyStepDraft ? [] : [{ action: 'assertFieldInvalid', label: 'Fixture code', ...(usesSecondField ? { rowIndex: 1 } : {}) }] }) } }] };
      } else if (visualMode === 'pass' || visualMode === 'pass-no-id' || visualMode === 'pass-long-evidence') {
        const userContent = payload.messages.at(-1)?.content ?? [];
        seenVisualImage ||= Array.isArray(userContent) && userContent.some(part => part.type === 'image_url');
        const text = Array.isArray(userContent) ? userContent.filter(part => part.type === 'text').map(part => part.text).join('\n') : String(userContent);
        const caseId = text.match(/Case ID: ([^\.\s]+)/)?.[1];
        const result = { action: 'record_case_result', ...(visualMode === 'pass-no-id' ? {} : { case_id: caseId }), status: 'passed', evidence: visualMode === 'pass-long-evidence' ? '截图中显示 Session restored。'.repeat(40) : '截图中显示 Session restored。' };
        message = { role: 'assistant', tool_calls: [{ id: 'visual-result', type: 'function', function: { name: toolName, arguments: JSON.stringify(result) } }] };
      } else message = { role: 'assistant', content: 'The visual lane is intentionally unavailable in this fixture.' };
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'fixture-response', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    })().catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  for (const server of [target, model, evil]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  evilPort = evil.address().port;
  const demoPort = await reservePort();
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  const project = {
    id: projectId,
    name: 'Partial export fixture',
    fileName: 'fixture.md',
    sourceFiles: ['fixture.md'],
    caseMode: 'existing',
    format: 'markdown',
    targetUrl,
    sourceText: 'Read-only local fixture; no authentication or side effects.',
    cases: [
      { id: 'case-selected', title: 'Invalid code does not call an API', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P0', category: 'functional', confidence: 'medium', coverageAreas: ['functional'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: '非法编码边框为红色，且不得调用接口', steps: [{ action: 'setViewport', width: 390, height: 844 }, { action: 'assertText', text: 'viewport=390' }, { action: 'setReducedMotion', value: true }, { action: 'assertExactVisible', text: 'Session restored' }, { action: 'scrollToRatio', ratio: 0.5 }, { action: 'assertText', text: 'scroll=middle' }, { action: 'startFetchOrXhrCapture' }, { action: 'fillByLabel', label: 'Fixture code', value: 'ABC' }, { action: 'blurByLabel', label: 'Fixture code' }, { action: 'assertFieldInvalid', label: 'Fixture code' }, { action: 'assertNoFetchOrXhr', quietMs: 300 }] },
      { id: 'case-excluded', title: 'Session survives and invalid field state is readable', source: 'fixture.md:2', requirementRefs: ['fixture.md:2'], priority: 'P2', category: 'authentication', confidence: 'high', coverageAreas: ['authentication'], selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Session restored and both repeated fixture code fields remain invalid', steps: [{ action: 'assertExactVisible', text: 'Session restored' }, { action: 'assertFieldInvalid', label: 'Fixture code' }, { action: 'assertFieldInvalid', label: 'Fixture code', rowIndex: 1 }, { action: 'blurByLabel', label: 'Fixture code', rowIndex: 1 }] },
    ],
    reviewStatus: 'approved',
    reviewNotes: 'Local integration fixture.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  const environment = {
    ...process.env,
    PORT: String(demoPort),
    TESTPILOT_DATA_DIR: dataDir,
    TESTPILOT_API_KEY: 'local-fixture-key',
    OPENAI_API_KEY: '',
    TESTPILOT_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
    TESTPILOT_MODEL: 'local-vision-fixture',
    TESTPILOT_BROWSER_CDP_ENDPOINT: '',
    TESTPILOT_BROWSER_HEADLESS: '1',
    TESTPILOT_BROWSER_CHANNEL: '',
    TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
  };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = '';
  demo.stdout.on('data', chunk => { demoLog += chunk.toString(); });
  demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  let mcp;
  t.after(async () => {
    if (mcp && mcp.exitCode === null) { mcp.kill(); await once(mcp, 'exit').catch(() => undefined); }
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; }
    for (const server of [target, model, evil]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });

  for (let i = 0; i < 120; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${demoBase}/api/health`)).ok) break; } catch {}
    if (i === 119) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }
  const isolatedBrowserStatus = await fetch(`${demoBase}/api/browser/status`);
  assert.equal(isolatedBrowserStatus.status, 200);
  const isolatedBrowser = await isolatedBrowserStatus.json();
  assert.equal(isolatedBrowser.mode, 'isolated');
  assert.equal(isolatedBrowser.configured, false);
  const missingScopeResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missingScopeResponse.status, 400, 'the server must refuse a run without an explicit case scope');
  const excludedScopeResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedCaseIds: ['case-excluded'] }) });
  assert.equal(excludedScopeResponse.status, 422, 'the server must refuse a deselected case instead of substituting another scope');
  const modelCallsBeforeRegression = modelRequestCount;
  const regressionResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedCaseIds: ['case-selected'] }) });
  const regressionText = await regressionResponse.text();
  assert.equal(regressionResponse.status, 201, regressionText);
  const regressionRun = JSON.parse(regressionText);
  assert.equal(regressionRun.runMode, 'regression');
  assert.equal(regressionRun.overall, 'passed');
  assert.equal(regressionRun.deterministic.results[0]?.status, 'passed');
  assert.equal(regressionRun.ai.status, 'not-applicable');
  assert.equal(modelRequestCount, modelCallsBeforeRegression, 'the normal regression path must not call a model');
  assert.match(regressionRun.report, /常规回归（确定性执行，不调用模型）/);

  const runResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-selected'] }) });
  const runText = await runResponse.text();
  assert.equal(runResponse.status, 201, runText);
  const run = JSON.parse(runText);
  assert.deepEqual(run.caseScope.selectedCaseIds, ['case-selected']);
  assert.deepEqual(run.caseScope.excludedCaseIds, ['case-excluded']);
  assert.deepEqual(run.coverageSummary.projectAreas, ['authentication', 'functional']);
  assert.deepEqual(run.coverageSummary.selectedAreas, ['functional']);
  assert.deepEqual(run.coverageSummary.notCoveredThisRun, ['authentication']);
  assert.equal(run.finalReady, false, 'the selected deterministic and visual lanes disagree, so the run must remain unresolved');
  assert.equal(run.overall, 'unresolved', JSON.stringify({ deterministic: run.deterministic, ai: run.ai }));
  assert.equal(run.deterministic.status, 'passed');
  assert.equal(run.ai.status, 'failed');
  assert.equal(run.comparisons[0].resolution, 'mismatch');
  assert.equal(run.reportReady, true);
  assert.equal(run.packageReady, true);

  const reportResponse = await fetch(`${demoBase}/api/document-runs/${run.id}/report`);
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.text();
  assert.match(report, /选中 1\/2 条用例/);
  assert.match(report, /本轮未选.*case-excluded/);
  assert.match(report, /功能流程；置信度 medium；覆盖 功能流程/);
  assert.match(report, /本轮为未完成运行/);
  assert.match(report, /已识别但本轮未覆盖领域：身份认证/);

  const packageResponse = await fetch(`${demoBase}/api/document-runs/${run.id}/package`);
  assert.equal(packageResponse.status, 200);
  const packageBytes = new Uint8Array(await packageResponse.arrayBuffer());
  const packagePath = resolve(dataDir, 'document-tests', 'runs', run.id, 'testpilot-package.zip');
  await unlink(packagePath);
  const missingPackage = await fetch(`${demoBase}/api/document-runs/${run.id}/package`);
  assert.equal(missingPackage.status, 404);
  assert.match((await missingPackage.json()).error, /ZIP 文件缺失或不可读取/);
  await writeFile(packagePath, packageBytes);
  const archive = unzipSync(packageBytes);
  const cases = JSON.parse(strFromU8(archive['cases.json']));
  assert.deepEqual(cases.cases.map(item => item.id), ['case-selected', 'case-excluded']);
  assert.deepEqual(cases.selectedCaseIds, ['case-selected']);
  assert.equal(cases.totalCases, 2);
  assert.equal(cases.cases[0].category, 'functional');
  assert.equal(cases.cases[0].confidence, 'medium');
  assert.deepEqual(cases.cases[0].coverageAreas, ['functional']);
  assert.deepEqual(cases.excludedCaseIds, ['case-excluded']);
  assert.match(strFromU8(archive['run.json']), /"overall": "unresolved"/);
  assert.match(strFromU8(archive['README.md']), /脚本只包含本轮选中的用例/);
  assert.match(strFromU8(archive['run.mjs']), /clickExactText/);
  assert.match(strFromU8(archive['run.mjs']), /assertNoFetchOrXhr/);
  assert.match(strFromU8(archive['run.mjs']), /suite\.cases\.filter\(c=>!Array\.isArray\(suite\.selectedCaseIds\)/);
  assert.match(strFromU8(archive['run.mjs']), /Unexpected fetch\/XHR count/);
  assert.match(strFromU8(archive['run.mjs']), /req\.resourceType\(\)/, 'the exported runner must inspect resource type when applying the cross-origin policy');
  assert.match(strFromU8(archive['run.mjs']), /passiveAssetTypes\s*=\s*\[\s*"stylesheet",\s*"script",\s*"image",\s*"font",\s*"media"\s*\]/, 'the ZIP embeds the same passive asset policy as the online runner');
  assert.match(run.deterministic.results[0]?.detail ?? '', /检查通过/);
  assert.match(run.ai.results[0]?.detail ?? '', /文本未出现：scroll=middle/);
  const standaloneRunnerPath = resolve(dataDir, 'run.mjs');
  await writeFile(standaloneRunnerPath, archive['run.mjs']);
  await writeFile(resolve(dataDir, 'cases.json'), archive['cases.json']);
  const standaloneRunner = spawn(process.execPath, [standaloneRunnerPath], { cwd: dataDir, env: { ...process.env, TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let standaloneLog = '';
  standaloneRunner.stdout.on('data', chunk => { standaloneLog += chunk.toString(); });
  standaloneRunner.stderr.on('data', chunk => { standaloneLog += chunk.toString(); });
  const [standaloneCode] = await once(standaloneRunner, 'exit');
  assert.equal(standaloneCode, 0, standaloneLog);
  const standaloneReport = JSON.parse(await readFile(resolve(dataDir, 'report.json'), 'utf8'));
  assert.equal(standaloneReport[0]?.status, 'passed', 'the exported script must execute the network assertion without the AI service');
  const requestCases = { ...cases, cases: cases.cases.map(item => ({ ...item, steps: item.steps.map(step => step.action === 'fillByLabel' ? { ...step, value: 'CALL' } : step) })) };
  await writeFile(resolve(dataDir, 'cases.json'), JSON.stringify(requestCases));
  const requestRunner = spawn(process.execPath, [standaloneRunnerPath], { cwd: dataDir, env: { ...process.env, TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let requestRunnerLog = '';
  requestRunner.stdout.on('data', chunk => { requestRunnerLog += chunk.toString(); });
  requestRunner.stderr.on('data', chunk => { requestRunnerLog += chunk.toString(); });
  const [requestRunnerCode] = await once(requestRunner, 'exit');
  assert.equal(requestRunnerCode, 1, requestRunnerLog);
  const requestReport = JSON.parse(await readFile(resolve(dataDir, 'report.json'), 'utf8'));
  assert.equal(requestReport[0]?.status, 'failed', `${requestRunnerLog}\n${JSON.stringify(requestReport)}`);
  assert.match(requestReport[0]?.detail ?? '', /Unexpected fetch\/XHR count: 2/);
  assert.doesNotMatch(requestReport[0]?.detail ?? '', /write-via-get|do-not-log|secret/);
  assert.equal(crossOriginHits, 0, 'the extracted ZIP runner must abort a third-party oauth-shaped fetch instead of sending it');

  mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: { ...environment, TESTPILOT_BASE_URL: demoBase }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const rpc = createJsonRpcClient(mcp);
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'document-workflow-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const exported = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'testpilot_export_web_run', arguments: { runId: run.id } } });
  assert.equal(exported.result?.isError, undefined);
  const content = exported.result?.content ?? [];
  assert.ok(content.some(item => item.type === 'text' && /部分运行报告/.test(item.text)));
  const resource = content.find(item => item.type === 'resource' && item.resource?.uri === `testpilot://runs/${run.id}/package.zip`);
  assert.ok(resource, 'MCP export must return the reusable package as a resource');
  const mcpArchive = unzipSync(Buffer.from(resource.resource.blob, 'base64'));
  assert.deepEqual(JSON.parse(strFromU8(mcpArchive['cases.json'])).cases.map(item => item.id), ['case-selected', 'case-excluded']);
  assert.deepEqual(JSON.parse(strFromU8(mcpArchive['cases.json'])).selectedCaseIds, ['case-selected']);

  visualMode = 'pass';
  const updatedCases = project.cases.map(item => ({ ...item, selectedForRegression: item.id === 'case-excluded' }));
  const update = await fetch(`${demoBase}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: updatedCases }) });
  assert.equal(update.status, 200);
  const review = await fetch(`${demoBase}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Verify live session survives sequential runs.' }) });
  assert.equal(review.status, 200);
  const secondRunResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-excluded'] }) });
  const secondRunText = await secondRunResponse.text();
  assert.equal(secondRunResponse.status, 201, secondRunText);
  const secondRun = JSON.parse(secondRunText);
  assert.equal(secondRun.deterministic.results[0]?.status, 'passed', 'the same project page must retain sessionStorage across runs');
  assert.equal(secondRun.ai.results[0]?.status, 'passed');
  assert.equal(secondRun.finalReady, true);
  assert.equal(seenVisualImage, true, 'the Computer Use call must carry the current page screenshot');
  const secondPackageResponse = await fetch(`${demoBase}/api/document-runs/${secondRun.id}/package`);
  assert.equal(secondPackageResponse.status, 200);
  const secondArchive = unzipSync(new Uint8Array(await secondPackageResponse.arrayBuffer()));
  const secondCases = JSON.parse(strFromU8(secondArchive['cases.json']));
  assert.deepEqual(secondCases.selectedCaseIds, ['case-excluded']);
  const secondSelectedCase = secondCases.cases.find(item => item.id === 'case-excluded');
  assert.ok(secondSelectedCase.steps.some(step => step.action === 'assertFieldInvalid'));
  assert.equal(secondSelectedCase.steps.find(step => step.action === 'assertFieldInvalid' && step.rowIndex === 1)?.rowIndex, 1);
  assert.match(strFromU8(secondArchive['run.mjs']), /assertFieldInvalid/);
  assert.match(strFromU8(secondArchive['run.mjs']), /field\(page,s\.label,s\.rowIndex\)/);
  assert.match(strFromU8(secondArchive['run.mjs']), /blurByLabel/);

  visualMode = 'pass-no-id';
  const omittedIdRunResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-excluded'] }) });
  const omittedIdRunText = await omittedIdRunResponse.text();
  assert.equal(omittedIdRunResponse.status, 201, omittedIdRunText);
  const omittedIdRun = JSON.parse(omittedIdRunText);
  assert.equal(omittedIdRun.ai.results[0]?.status, 'passed', 'the server attributes an omitted optional case_id to the currently executing case');
  assert.equal(omittedIdRun.finalReady, true);

  visualMode = 'pass-long-evidence';
  const longEvidenceResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-excluded'] }) });
  const longEvidenceText = await longEvidenceResponse.text();
  assert.equal(longEvidenceResponse.status, 201, longEvidenceText);
  const longEvidenceRun = JSON.parse(longEvidenceText);
  assert.equal(longEvidenceRun.ai.results[0]?.status, 'passed', 'long but bounded visual evidence is retained with a server-side cap');
  assert.ok(longEvidenceRun.ai.results[0]?.detail.length <= 760);
  assert.match(longEvidenceRun.ai.results[0]?.detail ?? '', /\[截断\]/);

  visualMode = 'pass';
  summaryFailure = true;
  const thirdRunResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-excluded'] }) });
  const thirdRunText = await thirdRunResponse.text();
  assert.equal(thirdRunResponse.status, 201, thirdRunText);
  const thirdRun = JSON.parse(thirdRunText);
  assert.equal(thirdRun.finalReady, true, 'report writer failure must not undo aligned test outcomes');
  assert.equal(thirdRun.reportReady, true);
  assert.equal(thirdRun.packageReady, true);
  assert.match(thirdRun.report, /AI 摘要未能生成/);
  assert.match(thirdRun.report, /逐用例报告由 TestPilot 根据执行记录生成/);

  // The model deliberately claims a pass even though the page only says “Session restored”.
  // The server must reject that false positive using the reviewed exact-text assertion.
  const falsePassCases = project.cases.map(item => item.id === 'case-excluded'
    ? { ...item, selectedForRegression: true, expected: 'Session completely restored', steps: [{ action: 'assertExactVisible', text: 'Session completely restored' }] }
    : { ...item, selectedForRegression: false });
  const falsePassUpdate = await fetch(`${demoBase}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: falsePassCases }) });
  assert.equal(falsePassUpdate.status, 200);
  const falsePassReview = await fetch(`${demoBase}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Fixture for server-side exact assertion verification.' }) });
  assert.equal(falsePassReview.status, 200);
  const falsePassResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-excluded'] }) });
  const falsePassText = await falsePassResponse.text();
  assert.equal(falsePassResponse.status, 201, falsePassText);
  const falsePassRun = JSON.parse(falsePassText);
  assert.equal(falsePassRun.ai.results[0]?.status, 'failed', 'server-side exact assertion must override a model-reported pass');
  assert.match(falsePassRun.ai.results[0]?.detail ?? '', /Session completely restored/);
  assert.equal(falsePassRun.overall, 'failed');
  assert.equal(typeof falsePassRun.caseVersion, 'string');
  const retestResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/retest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentRunId: falsePassRun.id, caseIds: ['case-excluded'], notes: 'Retest the known false-pass fixture without changing its expectation.' }) });
  const retestStartText = await retestResponse.text();
  assert.equal(retestResponse.status, 202, retestStartText);
  const retestStart = JSON.parse(retestStartText);
  let retestRun;
  const retestDeadline = Date.now() + 60_000;
  while (Date.now() < retestDeadline) {
    await delay(200);
    const progressResponse = await fetch(`${demoBase}/api/document-runs/${retestStart.runId}/progress`);
    if (!progressResponse.ok) continue;
    const progress = await progressResponse.json();
    if (progress.status === 'failed') throw new Error(`Retest failed to finish: ${progress.lastError}`);
    if (progress.status === 'completed') { retestRun = progress.run; break; }
  }
  assert.ok(retestRun, 'the async targeted retest must complete in the local fixture window');
  assert.equal(retestRun.parentRunId, falsePassRun.id);
  assert.deepEqual(retestRun.retestSelection, ['case-excluded']);
  assert.deepEqual(retestRun.caseScope.selectedCaseIds, ['case-excluded']);
  assert.equal(retestRun.retestNotes, 'Retest the known false-pass fixture without changing its expectation.');
  assert.match(retestRun.retestScopeNote, /原直接目标 1 条，原关联影响 0 条/u);
  assert.match(retestRun.report, /父运行范围说明：.*原直接目标 1 条/u);
  assert.equal(retestRun.deterministic.status, 'failed', 'the unchanged known defect must remain a failure in a parent-linked retest');
  assert.match(retestRun.report, /父运行：/);
  assert.match(retestRun.report, /重测说明：Retest the known false-pass fixture/);
  const retestPackage = await fetch(`${demoBase}/api/document-runs/${retestRun.id}/package`);
  assert.equal(retestPackage.status, 200);
  const retestArchive = unzipSync(new Uint8Array(await retestPackage.arrayBuffer()));
  const packagedRetestRun = JSON.parse(strFromU8(retestArchive['run.json']));
  assert.equal(packagedRetestRun.parentRunId, falsePassRun.id);
  assert.deepEqual(packagedRetestRun.retestSelection, ['case-excluded']);
  assert.equal(packagedRetestRun.retestNotes, 'Retest the known false-pass fixture without changing its expectation.');
  assert.match(packagedRetestRun.retestScopeNote, /原直接目标 1 条，原关联影响 0 条/u);
  const retestJournalPath = resolve(dataDir, 'document-tests', 'runs', retestRun.id, 'execution.json');
  const retestProjectPath = resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`);
  const interruptedRetest = JSON.parse(await readFile(retestJournalPath, 'utf8'));
  const previousRetestDataDirectory = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = dataDir;
  try {
    const { createDocumentWorkflow, linkDocumentWorkflowRun, startDocumentWorkflowStage, completeDocumentWorkflowStage } = await import('../dist/adapters/document-workflow-record.js');
    const retestRecoveryWorkflow = await createDocumentWorkflow({ projectId, parentRunId: falsePassRun.id, approvalPolicy: 'automatic' });
    await completePreparationStages(retestRecoveryWorkflow.workflowId, { startDocumentWorkflowStage, completeDocumentWorkflowStage });
    await linkDocumentWorkflowRun(retestRecoveryWorkflow.workflowId, { runId: retestRun.id, parentRunId: falsePassRun.id });
    const savedProject = JSON.parse(await readFile(retestProjectPath, 'utf8'));
    savedProject.workflowId = retestRecoveryWorkflow.workflowId;
    await writeFile(retestProjectPath, JSON.stringify(savedProject));
    interruptedRetest.workflowId = retestRecoveryWorkflow.workflowId;
  } finally {
    if (previousRetestDataDirectory === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = previousRetestDataDirectory;
  }
  interruptedRetest.status = 'running'; interruptedRetest.stage = 'computer-use'; interruptedRetest.currentCase = { lane: 'computer-use', id: 'case-excluded', title: 'Known false-pass fixture' };
  await writeFile(retestJournalPath, JSON.stringify(interruptedRetest));
  await unlink(resolve(dataDir, 'document-tests', 'runs', retestRun.id, 'run.json'));
  const retestRecoveryResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/recovery`);
  const retestRecovery = await retestRecoveryResponse.json();
  assert.equal(retestRecovery.canResume, true);
  assert.equal(retestRecovery.runId, retestRun.id);
  const resumedRetestResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: retestRun.id }) });
  const resumedRetestText = await resumedRetestResponse.text();
  assert.equal(resumedRetestResponse.status, 201, resumedRetestText);
  const resumedRetest = JSON.parse(resumedRetestText);
  assert.equal(resumedRetest.parentRunId, falsePassRun.id);
  assert.deepEqual(resumedRetest.retestSelection, ['case-excluded']);
  assert.deepEqual(resumedRetest.caseScope.selectedCaseIds, ['case-excluded'], 'resume must retain the original targeted scope rather than expanding to all selected project cases');
  assert.equal(resumedRetest.recovery.replayedFromBeginning, false);
  const restoreCases = project.cases.map(item => ({ ...item, selectedForRegression: item.id === 'case-excluded' }));
  const restoreUpdate = await fetch(`${demoBase}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: restoreCases }) });
  assert.equal(restoreUpdate.status, 200);
  const restoreReview = await fetch(`${demoBase}/api/document-projects/${projectId}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: 'Restore project snapshot for recovery fixture.' }) });
  assert.equal(restoreReview.status, 200);

  const fallbackReport = await fetch(`${demoBase}/api/document-runs/${thirdRun.id}/report`);
  assert.equal(fallbackReport.status, 200);
  assert.match(await fallbackReport.text(), /AI 摘要未能生成.*HTTP 503/);
  const fallbackPackage = await fetch(`${demoBase}/api/document-runs/${thirdRun.id}/package`);
  assert.equal(fallbackPackage.status, 200);
  const fallbackArchive = unzipSync(new Uint8Array(await fallbackPackage.arrayBuffer()));
  assert.ok(fallbackArchive['run.mjs']);
  assert.ok(fallbackArchive['report.md']);
  assert.match(strFromU8(fallbackArchive['run.json']), /"finalReady": true/);
  const journalPath = resolve(dataDir, 'document-tests', 'runs', thirdRun.id, 'execution.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(journal.status, 'completed');
  // Model a real service crash: a newly persisted workflow is linked to the
  // interrupted run, rather than mutating the completed workflow record.
  const priorDataDirectory = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = dataDir;
  let recoveryWorkflow;
  try {
    const { createDocumentWorkflow, linkDocumentWorkflowRun, startDocumentWorkflowStage, completeDocumentWorkflowStage } = await import('../dist/adapters/document-workflow-record.js');
    recoveryWorkflow = await createDocumentWorkflow({ projectId, approvalPolicy: 'automatic' });
    await completePreparationStages(recoveryWorkflow.workflowId, { startDocumentWorkflowStage, completeDocumentWorkflowStage });
    await linkDocumentWorkflowRun(recoveryWorkflow.workflowId, { runId: thirdRun.id });
  } finally {
    if (priorDataDirectory === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = priorDataDirectory;
  }
  const projectPath = resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`);
  const recoveryProject = JSON.parse(await readFile(projectPath, 'utf8'));
  recoveryProject.workflowId = recoveryWorkflow.workflowId;
  await writeFile(projectPath, JSON.stringify(recoveryProject));
  journal.workflowId = recoveryWorkflow.workflowId;
  journal.status = 'running'; journal.stage = 'computer-use'; await writeFile(journalPath, JSON.stringify(journal));
  await unlink(resolve(dataDir, 'document-tests', 'runs', thirdRun.id, 'run.json'));
  const recoveryResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/recovery`);
  assert.equal(recoveryResponse.status, 200);
  const recovery = await recoveryResponse.json();
  assert.equal(recovery.runId, thirdRun.id);
  assert.equal(recovery.canResume, true);
  const resumedResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: recovery.runId }) });
  const resumedText = await resumedResponse.text();
  assert.equal(resumedResponse.status, 201, resumedText);
  const resumed = JSON.parse(resumedText);
  assert.equal(resumed.id, thirdRun.id, 'recovery must preserve the interrupted run identity');
  const completedJournal = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(completedJournal.status, 'completed');
  assert.equal(completedJournal.resumeCount, 1);
  completedJournal.status = 'running'; await writeFile(journalPath, JSON.stringify(completedJournal));
  await unlink(resolve(dataDir, 'document-tests', 'runs', thirdRun.id, 'run.json'));
  recoveryProject.targetUrl = `${targetUrl}changed-baseline/`;
  await writeFile(projectPath, JSON.stringify(recoveryProject));
  const staleRecoveryResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/recovery`);
  const staleRecovery = await staleRecoveryResponse.json();
  assert.equal(staleRecovery.canResume, false, 'changed project targets must invalidate recovery');
  const staleResumeResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: thirdRun.id }) });
  assert.equal(staleResumeResponse.status, 409);
  assert.ok(targetVisits > 3, 'the same managed project page is reloaded to establish independent case and lane baselines');
  const visitsBeforeAutomaticRepair = targetVisits;

  const repairCase = { ...project.cases[0], id: 'case-3', title: 'Invalid code must not call API', expected: '非法编码不得调用接口', steps: [{ action: 'fillByLabel', label: 'Fixture code', value: 'ABC' }, { action: 'blurByLabel', label: 'Fixture code' }, { action: 'assertFieldInvalid', label: 'Fixture code' }] };
  const repairUpdate = await fetch(`${demoBase}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: [...project.cases, repairCase] }) });
  assert.equal(repairUpdate.status, 200);
  const repairResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/generate-steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: [repairCase.id] }) });
  const repairText = await repairResponse.text();
  assert.equal(repairResponse.status, 200, repairText);
  const repair = JSON.parse(repairText);
  assert.deepEqual(repair.generatedCaseIds, [repairCase.id], 'the workbench repairs the known missing assertion without asking the model to invent selectors');
  const projectsAfterRepair = await (await fetch(`${demoBase}/api/document-projects`)).json();
  const repairedProject = projectsAfterRepair.find(item => item.id === projectId);
  const repairedCase = repairedProject.cases.find(item => item.id === repairCase.id);
  assert.deepEqual(repairedCase.steps.map(step => step.action), ['startFetchOrXhrCapture', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertNoFetchOrXhr']);
  assert.match(repairedCase.coverageGap, /仅验证操作后的限定观察窗内未出现 fetch\/XHR/);
  assert.equal(repairedProject.reviewStatus, 'approved', 'reduced-confirmation mode approves only the safe repaired steps and preserves their partial-coverage warning');

  const autoRepairProject = { ...project, id: 'auto-repair-project', targetUrl, name: 'Auto repair fixture', confirmationRequired: false, reviewStatus: 'approved', reviewNotes: 'User selected reduced confirmation.', cases: [{ ...repairCase, id: 'case-1', selectedForRegression: true, coverageGap: undefined, steps: [{ action: 'fillByLabel', label: 'Fixture code', value: 'ABC' }, { action: 'blurByLabel', label: 'Fixture code' }, { action: 'assertFieldInvalid', label: 'Fixture code' }] }] };
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${autoRepairProject.id}.json`), JSON.stringify(autoRepairProject));
  const autoRepairRunResponse = await fetch(`${demoBase}/api/document-projects/${autoRepairProject.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-1'] }) });
  const autoRepairRunText = await autoRepairRunResponse.text();
  assert.equal(autoRepairRunResponse.status, 201, autoRepairRunText);
  const autoRepairRun = JSON.parse(autoRepairRunText);
  assert.equal(autoRepairRun.deterministic.results[0]?.status, 'blocked', 'the repaired check executes, while its bounded fetch/XHR claim remains explicitly partial');
  assert.match(autoRepairRun.deterministic.results[0]?.detail ?? '', /仅验证操作后的限定观察窗内未出现 fetch\/XHR/);
  const autoRepairedProject = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${autoRepairProject.id}.json`), 'utf8'));
  assert.deepEqual(autoRepairedProject.cases[0].steps.map(step => step.action), ['startFetchOrXhrCapture', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertNoFetchOrXhr']);
  assert.equal(autoRepairedProject.reviewStatus, 'approved', 'reduced-confirmation mode repairs deterministically and continues without another generate-steps click');
  assert.ok(targetVisits > visitsBeforeAutomaticRepair, 'the approved case run reloads the shared project page to establish a clean case baseline');
  const visitsAfterAutomaticRepair = targetVisits;

  const reviewRequiredProject = { ...project, id: 'review-required-repair-project', targetUrl, name: 'Review required repair fixture', confirmationRequired: true, reviewStatus: 'approved', cases: [{ ...repairCase, id: 'case-1', selectedForRegression: true, coverageGap: undefined, steps: [{ action: 'fillByLabel', label: 'Fixture code', value: 'ABC' }, { action: 'blurByLabel', label: 'Fixture code' }, { action: 'assertFieldInvalid', label: 'Fixture code' }] }] };
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${reviewRequiredProject.id}.json`), JSON.stringify(reviewRequiredProject));
  const reviewRequiredResponse = await fetch(`${demoBase}/api/document-projects/${reviewRequiredProject.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-1'] }) });
  const reviewRequiredBody = await reviewRequiredResponse.json();
  assert.equal(reviewRequiredResponse.status, 409, 'confirmation mode stops after preparing the repair for review');
  assert.deepEqual(reviewRequiredBody.repairedCaseIds, ['case-1']);
  assert.equal(reviewRequiredBody.project.reviewStatus, 'draft');
  assert.deepEqual(reviewRequiredBody.project.cases[0].steps.map(step => step.action), ['startFetchOrXhrCapture', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'assertNoFetchOrXhr']);
  assert.equal(targetVisits, visitsAfterAutomaticRepair, 'review-required repair does not start a browser run before approval');

  const noSessionProject = { ...project, id: 'no-session-evidence-project', targetUrl: `${targetUrl}single-field`, name: 'Persistent session restoration authoring fixture', confirmationRequired: true, reviewStatus: 'draft', cases: [{ ...repairCase, id: 'case-ui-invalid', title: 'Observed fixture field validation', source: 'fixture.md:1 Fixture code 字段边框变红', requirementRefs: ['fixture.md:1 Fixture code 字段边框变红'], expected: 'Fixture code 字段边框变红', steps: [], coverageGap: undefined, sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true }] };
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${noSessionProject.id}.json`), JSON.stringify(noSessionProject));
  const noSessionResponse = await fetch(`${demoBase}/api/document-projects/${noSessionProject.id}/generate-steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['case-ui-invalid'] }) });
  const noSessionDraft = await noSessionResponse.json();
  assert.deepEqual(noSessionDraft.generatedCaseIds, ['case-ui-invalid'], 'step authoring restores one persistent project session and creates a runnable, evidence-grounded draft');
  const restoredProject = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${noSessionProject.id}.json`), 'utf8'));
  assert.deepEqual(restoredProject.cases[0].steps, [{ action: 'assertFieldInvalid', label: 'Fixture code' }]);
  assert.ok(targetVisits > visitsBeforeAutomaticRepair, 'authoring restores the project session and opens the target page');

  const evidenceProject = { ...project, id: projectId, targetUrl, name: 'Page evidence authoring fixture', confirmationRequired: true, reviewStatus: 'draft', cases: [{ ...repairCase, id: 'case-ui-invalid', title: 'Observed second fixture field validation', source: 'fixture.md:1 第二个 Fixture code 字段边框变红', requirementRefs: ['fixture.md:1 第二个 Fixture code 字段边框变红'], expected: '第二个 Fixture code 字段边框变红', steps: [], coverageGap: undefined, sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true }] };
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${evidenceProject.id}.json`), JSON.stringify(evidenceProject));
  const evidenceDraftResponse = await fetch(`${demoBase}/api/document-projects/${evidenceProject.id}/generate-steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['case-ui-invalid'] }) });
  const evidenceDraftText = await evidenceDraftResponse.text();
  assert.equal(evidenceDraftResponse.status, 200, evidenceDraftText);
  const evidenceDraft = JSON.parse(evidenceDraftText);
  assert.deepEqual(evidenceDraft.generatedCaseIds, ['case-ui-invalid'], JSON.stringify({ warning: evidenceDraft.warning, demoLog }));
  const savedEvidenceProject = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${evidenceProject.id}.json`), 'utf8'));
  assert.deepEqual(savedEvidenceProject.cases[0].steps, [{ action: 'assertFieldInvalid', label: 'Fixture code', rowIndex: 1 }]);
  assert.ok(targetVisits <= visitsAfterAutomaticRepair + 1, 'authoring inspects the existing project page with at most one target navigation');

  const emptyDraftProject = { ...evidenceProject, cases: [{ ...evidenceProject.cases[0], id: 'case-empty-draft', title: 'Visible customer search result', expected: '搜索结果显示客户名称供选择', steps: [] }] };
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${emptyDraftProject.id}.json`), JSON.stringify(emptyDraftProject));
  emptyStepDraft = true;
  const emptyDraftResponse = await fetch(`${demoBase}/api/document-projects/${emptyDraftProject.id}/cases/case-empty-draft/generate-steps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const emptyDraftBody = await emptyDraftResponse.json();
  assert.equal(emptyDraftResponse.status, 422, 'an empty AI draft is rejected instead of being saved as generated steps');
  assert.match(emptyDraftBody.error, /没有生成可执行的验收断言|AI 没有生成可执行步骤/);
  const savedEmptyDraftProject = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${emptyDraftProject.id}.json`), 'utf8'));
  assert.deepEqual(savedEmptyDraftProject.cases[0].steps, [], 'the original empty case remains intact after a bad model response');
  emptyStepDraft = false;

});

function createJsonRpcClient(child) {
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
    }
  });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP server exited (${code}).`)); pending.clear(); });
  return message => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => { pending.delete(message.id); reject(new Error(`Timed out waiting for MCP response ${message.id}.`)); }, 10_000);
    pending.set(message.id, { resolve: resolveResponse, reject, timer });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

async function completePreparationStages(workflowId, { startDocumentWorkflowStage, completeDocumentWorkflowStage }) {
  for (const [stageId, specialist] of [
    ['generate-cases', 'case-generator'],
    ['review-cases', 'case-reviewer'],
    ['author-steps', 'step-author'],
    ['human-approval', 'human-review-gate'],
  ]) {
    const started = await startDocumentWorkflowStage(workflowId, { stageId, specialist, input: { fixture: stageId } });
    if (started.stage.status === 'running') await completeDocumentWorkflowStage(workflowId, stageId, started.stage.attempt, [`fixture:${stageId}`]);
  }
}
