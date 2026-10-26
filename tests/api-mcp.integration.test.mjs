import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { strFromU8, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('API MCP workflow enforces approval and exports a reusable suite package', { timeout: 45_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'api-mcp-integration', String(Date.now()));
  let targetHits = 0;
  let unstableHits = 0;
  const target = createServer((req, res) => {
    if (req.url === '/health') { targetHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, service: 'fixture' })); return; }
    if (req.url === '/unstable') { unstableHits++; res.writeHead(unstableHits === 1 ? 503 : 200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: unstableHits > 1, service: 'fixture' })); return; }
    res.writeHead(404); res.end();
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const port = await reservePort();
  const demoBase = `http://127.0.0.1:${port}`;
  const environment = { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '' };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); }); demo.stderr.on('data', chunk => { log += chunk.toString(); });
  const mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: { ...environment, TESTPILOT_BASE_URL: demoBase }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const rpc = createJsonRpcClient(mcp);
  t.after(async () => {
    if (mcp.exitCode === null) { const exited = once(mcp, 'exit'); mcp.kill(); await exited.catch(() => undefined); }
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); }
    for (const server of [target, demo]) { server.closeAllConnections?.(); if (server.listening) await new Promise(done => server.close(done)); }
  });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${demoBase}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'api-mcp-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const suite = { version: 1, name: 'Local health API', baseUrl: `http://127.0.0.1:${target.address().port}/`, openApiCoverage: { operationKeys: ['GET /health', 'GET /version'], coveredOperationKeys: ['GET /health'], uncoveredOperationKeys: ['GET /version'] }, cases: [{ id: 'health', title: 'Health returns ok', source: 'OpenAPI: GET /health', requirementRefs: ['health response'], request: { method: 'GET', path: '/health' }, expect: { status: 200, json: { ok: true, service: 'fixture' } } }] };
  const prepared = await callTool(rpc, 2, 'testpilot_prepare_api_test', { suiteJson: JSON.stringify(suite) });
  assert.equal(prepared.isError, undefined);
  const draft = JSON.parse(prepared.content[0].text);
  assert.equal(draft.status, 'draft');
  const persistedDraft = await (await fetch(`${demoBase}/api/api-suites/${draft.suiteId}`)).json();
  assert.equal(persistedDraft.suite.openApiCoverage, undefined, 'manually supplied coverage metadata must not be trusted');
  const beforeApproval = await callTool(rpc, 3, 'testpilot_run_approved_api_test', { suiteId: draft.suiteId });
  assert.equal(beforeApproval.isError, true, 'unapproved test must be rejected by server');
  assert.match(beforeApproval.content[0].text, /审核通过/);
  const revisedSuite = { ...suite, description: 'Human-reviewed revision.', openApiCoverage: { operationKeys: ['GET /forged'], coveredOperationKeys: ['GET /forged'], uncoveredOperationKeys: [] }, cases: [{ ...suite.cases[0], source: 'Requirement: service responds with health data' }] };
  const revised = await callTool(rpc, 4, 'testpilot_update_api_test', { suiteId: draft.suiteId, suiteJson: JSON.stringify(revisedSuite) });
  assert.equal(revised.isError, undefined);
  const revision = JSON.parse(revised.content[0].text);
  assert.equal(revision.revision, 2);
  assert.notEqual(revision.digest, draft.digest);
  const revisedCandidate = await (await fetch(`${demoBase}/api/api-suites/${draft.suiteId}`)).json();
  assert.equal(revisedCandidate.suite.openApiCoverage, undefined, 'untrusted coverage must not become trusted during an edit');
  const review = await callTool(rpc, 5, 'testpilot_review_api_test', { suiteId: draft.suiteId, decision: 'approve', notes: 'Local integration fixture; read-only target.' });
  assert.equal(review.isError, undefined);
  const immutable = await callTool(rpc, 6, 'testpilot_update_api_test', { suiteId: draft.suiteId, suiteJson: JSON.stringify(suite) });
  assert.equal(immutable.isError, true, 'approved suite versions cannot be revised in place');
  const runResult = await callTool(rpc, 7, 'testpilot_run_approved_api_test', { suiteId: draft.suiteId });
  assert.equal(runResult.isError, undefined, runResult.content?.[0]?.text);
  const summary = JSON.parse(runResult.content[0].text);
  assert.equal(summary.status, 'passed');
  assert.deepEqual(summary.counts, { passed: 1, failed: 0, blocked: 0, error: 0 });

  const detail = await callTool(rpc, 8, 'testpilot_get_api_run', { runId: summary.runId });
  assert.equal(detail.isError, undefined);
  assert.match(detail.content[0].text, /Approved API suite/);
  const exported = await callTool(rpc, 9, 'testpilot_export_api_run', { runId: summary.runId });
  assert.equal(exported.isError, undefined);
  const resource = exported.content.find(item => item.type === 'resource' && item.resource.uri === `testpilot://api-runs/${summary.runId}/package.zip`);
  assert.ok(resource);
  const archive = unzipSync(Buffer.from(resource.resource.blob, 'base64'));
  assert.equal(JSON.parse(strFromU8(archive['suite.json'])).name, suite.name);
  assert.match(strFromU8(archive['README.md']), /npm run start -- run-api --suite suite\.json/);
  assert.match(strFromU8(archive['report.md']), /PASSED/);
  assert.equal(JSON.parse(strFromU8(archive['run.json'])).runId, summary.runId);

  const diagnosticSuite = { version: 1, name: 'Evidence diagnosis fixture', baseUrl: suite.baseUrl, cases: [{ id: 'unstable', title: 'Unstable endpoint recovers', source: 'OpenAPI: GET /unstable', request: { method: 'GET', path: '/unstable' }, expect: { status: 200, json: { ok: true } } }] };
  const diagnosticPrepared = await callTool(rpc, 10, 'testpilot_prepare_api_test', { suiteJson: JSON.stringify(diagnosticSuite) });
  assert.equal(diagnosticPrepared.isError, undefined);
  const diagnosticDraft = JSON.parse(diagnosticPrepared.content[0].text);
  await callTool(rpc, 11, 'testpilot_review_api_test', { suiteId: diagnosticDraft.suiteId, decision: 'approve', notes: 'Local recovery fixture.' });
  const failedRunTool = await callTool(rpc, 12, 'testpilot_run_approved_api_test', { suiteId: diagnosticDraft.suiteId });
  assert.equal(failedRunTool.isError, undefined);
  const failedRun = JSON.parse(failedRunTool.content[0].text);
  assert.equal(failedRun.status, 'failed');
  const findings = await (await fetch(`${demoBase}/api/api-suites/${diagnosticDraft.suiteId}/findings`)).json();
  const finding = findings.findings.find(item => item.state === 'open' && item.caseId === 'unstable');
  assert.ok(finding);
  const diagnosisTool = await callTool(rpc, 13, 'testpilot_diagnose_api_finding', { suiteId: diagnosticDraft.suiteId, findingId: finding.findingId });
  assert.equal(diagnosisTool.isError, undefined);
  const diagnosis = JSON.parse(diagnosisTool.content[0].text);
  assert.equal(diagnosis.source, 'deterministic-evidence');
  assert.equal(diagnosis.classification, 'assertion-failure');
  assert.equal(diagnosis.recommendation.canRun, true);
  assert.equal(diagnosis.recommendation.parentRunId, failedRun.runId);
  assert.equal(unstableHits, 1, 'diagnosis through MCP is read-only and does not rerun the target');

  const autoCandidateResponse = await fetch(`${demoBase}/api/api-suites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...suite, name: 'Auto-run read-only health' }) });
  assert.equal(autoCandidateResponse.status, 201);
  const autoCandidate = await autoCandidateResponse.json();
  const refusedDirectAutoRun = await fetch(`${demoBase}/api/api-suites/${autoCandidate.id}/auto-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refusedDirectAutoRun.status, 409, 'hand-authored/MCP drafts cannot use the workbench-only auto-run path');
  assert.match((await refusedDirectAutoRun.json()).error, /工作台自动运行策略|显式审核/);
  assert.equal(targetHits, 1, 'a direct draft must not contact the target through auto-run');

  const sideEffectSuite = { version: 1, name: 'Manual review required', baseUrl: suite.baseUrl, cases: [], fixtures: { setup: [{ id: 'setup', title: 'Create isolated fixture', request: { method: 'POST', path: '/fixtures/${RUN_ID}', body: { runId: '${RUN_ID}' } }, expect: { status: 201 } }], cleanup: [{ id: 'cleanup', title: 'Remove isolated fixture', request: { method: 'DELETE', path: '/fixtures/${RUN_ID}' }, expect: { status: 204 } }] } };
  const sideEffectCandidateResponse = await fetch(`${demoBase}/api/api-suites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sideEffectSuite) });
  assert.equal(sideEffectCandidateResponse.status, 201);
  const sideEffectCandidate = await sideEffectCandidateResponse.json();
  const refusedAutomaticRun = await fetch(`${demoBase}/api/api-suites/${sideEffectCandidate.id}/auto-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(refusedAutomaticRun.status, 409);
  assert.match((await refusedAutomaticRun.json()).error, /工作台自动运行策略|显式审核/);
  const stillDraft = await (await fetch(`${demoBase}/api/api-suites/${sideEffectCandidate.id}`)).json();
  assert.equal(stillDraft.status, 'draft');
  assert.equal(targetHits, 1, 'the refused write suite must not contact its target');
});

function callTool(rpc, id, name, args) { return rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }).then(message => message.result); }
function createJsonRpcClient(child) {
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf('\n'); if (newline < 0) break;
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (!line) continue;
      const message = JSON.parse(line); const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
    }
  });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP server exited (${code}).`)); pending.clear(); });
  return message => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => { pending.delete(message.id); reject(new Error(`Timed out waiting for MCP response ${message.id}.`)); }, 10_000);
    pending.set(message.id, { resolve: resolveResponse, reject, timer }); child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}
async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
