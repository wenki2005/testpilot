import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('document workflow MCP scopes selection without losing case data and exposes step drafting safely', { timeout: 45_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-mcp-authoring', String(Date.now()));
  const projectId = 'e21d30c3-4f1d-42a4-80ab-05a617fd723c';
  const cases = [
    { id: 'case-alpha', title: 'Alpha remains in scope', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Alpha visible', steps: [{ action: 'assertVisible', text: 'Alpha visible' }], coverageGap: 'Backend state not verified' },
    { id: 'case-beta', title: 'Beta can be excluded', source: 'fixture.md:2', requirementRefs: ['fixture.md:2'], priority: 'P2', category: 'navigation', confidence: 'medium', coverageAreas: ['navigation'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Beta visible', steps: [{ action: 'assertVisible', text: 'Beta visible' }] },
  ];
  const project = { id: projectId, name: 'MCP selection fixture', fileName: 'fixture.md', sourceFiles: ['fixture.md'], caseMode: 'existing', format: 'markdown', targetUrl: 'http://127.0.0.1:9/no-target-requests', sourceText: 'MCP-only fixture; execution is intentionally not started.', cases, reviewStatus: 'approved', reviewNotes: 'Approved before scoped selection.', confirmationRequired: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const environment = { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '', TESTPILOT_BASE_URL: base };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = ''; let mcpLog = '';
  demo.stdout.on('data', chunk => { demoLog += chunk.toString(); }); demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  mcp.stderr.on('data', chunk => { mcpLog += chunk.toString(); });
  const rpc = createJsonRpcClient(mcp);
  t.after(async () => {
    if (mcp.exitCode === null) { const exited = once(mcp, 'exit'); mcp.kill(); await exited.catch(() => undefined); }
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); }
    demo.closeAllConnections?.();
  });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }
  const safeCase = { id: 'case-1', title: 'Safe read-only page fixture', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Ready visible', steps: [{ action: 'assertVisible', text: 'Ready visible' }] };
  for (const flag of ['allowNetwork', 'allowMutations', 'allowConcurrency']) {
    const id = `api-review-${flag}`;
    const fixture = { ...project, id, name: `Manual review ${flag}`, cases: [structuredClone(safeCase)], apiContract: { allowNetwork: false, allowMutations: false, allowConcurrency: false, mappings: [] }, reviewStatus: 'approved', confirmationRequired: false };
    await writeFile(resolve(dataDir, 'document-tests', 'projects', `${id}.json`), JSON.stringify(fixture));
    const apiContract = { allowNetwork: false, allowMutations: false, allowConcurrency: false, [flag]: true };
    const response = await fetch(`${base}/api/document-projects/${id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiContract }) });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const updated = JSON.parse(responseText);
    assert.equal(updated.reviewStatus, 'draft', `${flag}=true must force manual review even when confirmationRequired=false`);
  }
  const safeApiId = 'api-review-readonly';
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${safeApiId}.json`), JSON.stringify({ ...project, id: safeApiId, cases: [structuredClone(safeCase)], apiContract: { allowNetwork: false, allowMutations: false, allowConcurrency: false, mappings: [] }, reviewStatus: 'draft', confirmationRequired: false }));
  const readOnlyConfigResponse = await fetch(`${base}/api/document-projects/${safeApiId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiContract: { allowNetwork: false, allowMutations: false, allowConcurrency: false } }) });
  assert.equal(readOnlyConfigResponse.status, 200);
  assert.equal((await readOnlyConfigResponse.json()).reviewStatus, 'approved', 'the existing automatic policy remains available when all elevated API permissions are false');

  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'document-mcp-authoring-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo, mcpLog);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = listed.result.tools;
  assert.ok(tools.some(item => item.name === 'testpilot_generate_web_test_steps'));
  assert.ok(tools.some(item => item.name === 'testpilot_set_web_test_selection'));
  assert.equal(tools.find(item => item.name === 'testpilot_get_web_test').annotations.readOnlyHint, true);
  assert.equal(tools.find(item => item.name === 'testpilot_generate_web_test_steps').annotations.readOnlyHint, false);
  assert.equal(tools.find(item => item.name === 'testpilot_set_web_test_selection').annotations.readOnlyHint, false);

  const selectionTool = await callTool(rpc, 3, 'testpilot_set_web_test_selection', { projectId, caseIds: ['case-beta'], selected: false });
  assert.equal(selectionTool.isError, undefined, selectionTool.content?.[0]?.text);
  const selection = JSON.parse(selectionTool.content[0].text);
  assert.deepEqual(selection.selectedCaseIds, ['case-alpha']);
  assert.deepEqual(selection.excludedCaseIds, ['case-beta']);
  assert.equal(selection.reviewStatus, 'draft', 'selection changes must reset manually reviewed projects to draft');
  assert.match(selection.next, /draft/);
  const afterSelection = await JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), 'utf8'));
  assert.deepEqual(afterSelection.cases.map(item => item.id), ['case-alpha', 'case-beta'], 'scoped selection must preserve stable case IDs');
  assert.deepEqual(afterSelection.cases.map(item => item.steps), cases.map(item => item.steps), 'scoped selection must preserve existing executable steps');
  assert.equal(afterSelection.cases[0].coverageGap, 'Backend state not verified', 'scoped selection must retain metadata');
  assert.equal(afterSelection.cases[1].selectedForRegression, false);

  const noSelection = await callTool(rpc, 4, 'testpilot_set_web_test_selection', { projectId, caseIds: ['case-alpha'], selected: false });
  assert.equal(noSelection.isError, true, 'empty test scopes must be refused');
  assert.match(noSelection.content[0].text, /至少保留一条选中用例/);
  const unknownCase = await callTool(rpc, 5, 'testpilot_set_web_test_selection', { projectId, caseIds: ['does-not-exist'], selected: true });
  assert.equal(unknownCase.isError, true);
  assert.match(unknownCase.content[0].text, /不属于该项目/);
  const afterRejectedPatches = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), 'utf8'));
  assert.deepEqual(afterRejectedPatches.cases.map(item => item.selectedForRegression), [true, false], 'rejected scopes must not mutate the current selection');

  const generate = await callTool(rpc, 6, 'testpilot_generate_web_test_steps', { projectId, caseIds: ['case-alpha'] });
  assert.equal(generate.isError, true, 'step generation requires a configured model and must propagate the server gate');
  assert.match(generate.content[0].text, /需要先配置兼容模型 API/);
  const afterGenerationGate = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), 'utf8'));
  assert.deepEqual(afterGenerationGate.cases.map(item => item.steps), cases.map(item => item.steps), 'a rejected generation request must leave existing steps intact');
  assert.equal(afterGenerationGate.reviewStatus, 'draft');

  const prematureRun = await callTool(rpc, 7, 'testpilot_run_web_dual_validation', { projectId, selectedCaseIds: ['case-alpha'] });
  assert.equal(prematureRun.isError, true, 'a selection edit does not implicitly approve or run');
  assert.match(prematureRun.content[0].text, /审核通过/);
  assert.deepEqual(await (await fetch(`${base}/api/runs`)).json(), [], 'a run rejected before approval must not create a test run');
});

function callTool(rpc, id, name, args) { return rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }).then(message => message.result); }
function createJsonRpcClient(child) {
  let buffer = ''; const pending = new Map();
  child.stdout.on('data', chunk => { buffer += chunk.toString(); for (;;) { const newline = buffer.indexOf('\n'); if (newline < 0) break; const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (!line) continue; const message = JSON.parse(line); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); } } });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP server exited (${code}).`)); pending.clear(); });
  return message => new Promise((resolveResponse, reject) => { const timer = setTimeout(() => { pending.delete(message.id); reject(new Error(`Timed out waiting for MCP response ${message.id}.`)); }, 10_000); pending.set(message.id, { resolve: resolveResponse, reject, timer }); child.stdin.write(`${JSON.stringify(message)}\n`); });
}
async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }

test('MCP document run starts with a stable runId and polls running, login-wait, failed and completed states without a browser', { timeout: 20_000 }, async t => {
  const projectId = 'd9a1cdee-20e4-4ee0-9416-32b0472f3331';
  const runId = '4d344bb2-bab3-4a59-91ca-832f16a46991';
  let progressReads = 0;
  let starts = 0;
  let retests = 0;
  const completedRun = { id: runId, projectId, runMode: 'compare', overall: 'unresolved', finalReady: false, comparisons: [], caseScope: { selectedCaseIds: ['case-1'], excludedCaseIds: [], totalCases: 1 } };
  const api = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === `/api/document-projects/${projectId}/start`) {
      starts++;
      let body = ''; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { selectedCaseIds: ['case-1'], runMode: 'compare' });
      res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ runId, projectId, status: 'running', stage: 'starting', progress: { completed: 0, total: 2 }, ...(starts > 1 ? { reusedExistingRun: true } : {}) })); return;
    }
    if (req.method === 'POST' && req.url === `/api/document-projects/${projectId}/retest`) {
      retests++;
      let body = ''; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { parentRunId: runId, caseIds: ['case-1'], notes: 'regression check' });
      res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ runId: '6c7ae770-06d9-442d-b572-73f85312d282', projectId, status: 'running', stage: 'starting', progress: { completed: 0, total: 2 } })); return;
    }
    if (req.method === 'GET' && req.url === `/api/document-runs/${runId}/progress`) {
      progressReads++;
      const status = progressReads === 1 ? { status: 'running', stage: 'awaiting-login', currentCase: { lane: 'deterministic', id: 'case-1', title: 'Sign in and continue' }, progress: { completed: 0, total: 2, counts: {} } } : { status: 'completed', stage: 'completed', progress: { completed: 2, total: 2, counts: { blocked: 2 } }, run: completedRun };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ runId, ...status })); return;
    }
    if (req.method === 'GET' && req.url === '/api/document-runs/6c7ae770-06d9-442d-b572-73f85312d281/progress') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ runId: '6c7ae770-06d9-442d-b572-73f85312d281', status: 'failed', stage: 'failed', progress: { completed: 0, total: 2, counts: {} }, lastError: 'fixture startup error' })); return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
  });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const dataDir = resolve(root, 'artifacts', 'document-mcp-polling', String(Date.now()));
  const mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: { ...process.env, TESTPILOT_BASE_URL: `http://127.0.0.1:${api.address().port}`, TESTPILOT_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let mcpLog = ''; mcp.stderr.on('data', chunk => { mcpLog += chunk.toString(); });
  const rpc = createJsonRpcClient(mcp);
  t.after(async () => { if (mcp.exitCode === null) { const exited = once(mcp, 'exit'); mcp.kill(); await exited.catch(() => undefined); } api.closeAllConnections?.(); if (api.listening) await new Promise(done => api.close(done)); });
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-document-polling-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo, mcpLog);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools.find(item => item.name === 'testpilot_get_web_run_progress').annotations.readOnlyHint, true);
  const retestTool = list.result.tools.find(item => item.name === 'testpilot_retest_web_cases');
  assert.ok(retestTool, 'MCP exposes the same parent-linked retest service');
  assert.equal(retestTool.annotations.readOnlyHint, false);

  const startedResult = await callTool(rpc, 3, 'testpilot_run_web_dual_validation', { projectId, selectedCaseIds: ['case-1'], runMode: 'compare' });
  assert.equal(startedResult.isError, undefined, startedResult.content?.[0]?.text);
  const started = JSON.parse(startedResult.content[0].text);
  assert.equal(started.runId, runId);
  assert.equal(started.status, 'running');
  assert.equal(started.stage, 'starting');
  const duplicateStartResult = await callTool(rpc, 8, 'testpilot_run_web_dual_validation', { projectId, selectedCaseIds: ['case-1'], runMode: 'compare' });
  const duplicateStart = JSON.parse(duplicateStartResult.content[0].text);
  assert.equal(duplicateStart.runId, runId, 'retries return the existing run ID instead of inventing another run');
  assert.equal(duplicateStart.reusedExistingRun, true);
  const waitingResult = await callTool(rpc, 4, 'testpilot_get_web_run_progress', { runId });
  const waiting = JSON.parse(waitingResult.content[0].text);
  assert.equal(waiting.status, 'running');
  assert.equal(waiting.stage, 'awaiting-login', 'login wait remains a pollable run state rather than another start request');
  assert.equal(waiting.currentCase.id, 'case-1');
  const completedResult = await callTool(rpc, 5, 'testpilot_get_web_run_progress', { runId });
  const completed = JSON.parse(completedResult.content[0].text);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.run.caseScope.selectedCaseIds, ['case-1']);
  const afterRestartRead = await callTool(rpc, 6, 'testpilot_get_web_run_progress', { runId });
  assert.equal(JSON.parse(afterRestartRead.content[0].text).status, 'completed', 'progress polling remains idempotent and can be repeated after service restart');
  const failed = await callTool(rpc, 7, 'testpilot_get_web_run_progress', { runId: '6c7ae770-06d9-442d-b572-73f85312d281' });
  const failedState = JSON.parse(failed.content[0].text);
  assert.equal(failedState.status, 'failed');
  assert.equal(failedState.lastError, 'fixture startup error');
  const retestResult = await callTool(rpc, 9, 'testpilot_retest_web_cases', { projectId, parentRunId: runId, caseIds: ['case-1'], notes: 'regression check' });
  assert.equal(retestResult.isError, undefined, retestResult.content?.[0]?.text);
  const retest = JSON.parse(retestResult.content[0].text);
  assert.equal(retest.parentRunId, runId);
  assert.deepEqual(retest.retestSelection, ['case-1']);
  assert.equal(retests, 1);
});

test('MCP generation and handoff call the shared case-generator HTTP workflow with complete artifacts', { timeout: 20_000 }, async t => {
  const generationArtifact = {
    schemaVersion: 1,
    requirements: [{ id: 'REQ-1', text: 'The landing page shows Ready', sourceRefs: ['brief.md:1'] }],
    cases: [{ id: 'AI-001', title: 'Show ready state', sourceRefs: ['brief.md:1'], actions: ['Open the landing page', 'Verify the exact Ready heading is visible'], expected: 'The Ready heading is visible' }],
    sources: [{ kind: 'requirements', label: 'brief.md', reference: 'requirements' }],
    quality: { score: 90 },
  };
  const calls = [];
  const api = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
    if (req.method === 'POST' && req.url === '/api/case-generator/generate') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...generationArtifact, generationArtifact, research: { count: 0, uploadedReferenceCount: 1, notice: 'fixture' }, generationOnly: true })); return;
    }
    if (req.method === 'POST' && req.url === '/api/case-generator/execute-draft') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ projectId: '8c4bca8a-7a95-4b44-8bde-16c24fb72b1e', workflowId: '5b57e6ce-e71e-4513-8a9e-c7cbaae1f423', projectName: 'MCP generated draft', caseCount: 1, selectedForReview: 1, reviewStatus: 'draft' })); return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
  });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const dataDir = resolve(root, 'artifacts', 'document-mcp-generation', String(Date.now()));
  const mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: { ...process.env, TESTPILOT_BASE_URL: `http://127.0.0.1:${api.address().port}`, TESTPILOT_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let mcpLog = ''; mcp.stderr.on('data', chunk => { mcpLog += chunk.toString(); });
  const rpc = createJsonRpcClient(mcp);
  t.after(async () => { if (mcp.exitCode === null) { const exited = once(mcp, 'exit'); mcp.kill(); await exited.catch(() => undefined); } api.closeAllConnections?.(); if (api.listening) await new Promise(done => api.close(done)); });
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-case-generation-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo, mcpLog);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const generateTool = listed.result.tools.find(item => item.name === 'testpilot_generate_web_case_drafts');
  const handoffTool = listed.result.tools.find(item => item.name === 'testpilot_handoff_generated_web_cases');
  assert.ok(generateTool);
  assert.ok(handoffTool);
  assert.match(generateTool.description, /held-out-benchmark.*不会传给生成模型/);
  assert.equal(generateTool.annotations.readOnlyHint, false);
  assert.equal(handoffTool.annotations.readOnlyHint, false);

  const generationInput = {
    requirementsText: 'The landing page shows Ready.',
    websiteUrl: 'http://127.0.0.1:43210/',
    files: [{ fileName: 'baseline.xmind', bytesBase64: 'eG1pbmQ=', role: 'held-out-benchmark' }],
    maxCases: 12,
    searchExamples: false,
  };
  const generated = await callTool(rpc, 3, 'testpilot_generate_web_case_drafts', generationInput);
  assert.equal(generated.isError, undefined, generated.content?.[0]?.text);
  const generatedPayload = JSON.parse(generated.content[0].text);
  assert.deepEqual(generatedPayload.generationArtifact, generationArtifact);
  assert.deepEqual(calls[0], { method: 'POST', url: '/api/case-generator/generate', body: generationInput });

  const targetUrl = 'http://127.0.0.1:43210/';
  const handoff = await callTool(rpc, 4, 'testpilot_handoff_generated_web_cases', { targetUrl, generationArtifact: generatedPayload.generationArtifact, projectName: 'MCP generated draft' });
  assert.equal(handoff.isError, undefined, handoff.content?.[0]?.text);
  const handoffPayload = JSON.parse(handoff.content[0].text);
  assert.equal(handoffPayload.projectId, '8c4bca8a-7a95-4b44-8bde-16c24fb72b1e');
  assert.equal(handoffPayload.workflowId, '5b57e6ce-e71e-4513-8a9e-c7cbaae1f423');
  assert.deepEqual(calls[1], { method: 'POST', url: '/api/case-generator/execute-draft', body: { generation: generationArtifact, targetUrl, name: 'MCP generated draft' } });

  const invalidEmpty = await callTool(rpc, 5, 'testpilot_generate_web_case_drafts', {});
  assert.equal(invalidEmpty.isError, true, 'MCP rejects empty generation requests before contacting the shared service');
  assert.match(invalidEmpty.content[0].text, /至少提供需求文字/);
  const unsafeTarget = await callTool(rpc, 6, 'testpilot_handoff_generated_web_cases', { targetUrl: 'ftp://example.test/', generationArtifact, projectName: 'Invalid target' });
  assert.equal(unsafeTarget.isError, true, 'MCP refuses non-HTTP execution targets at the tool schema boundary');
  assert.equal(calls.length, 2);
});


