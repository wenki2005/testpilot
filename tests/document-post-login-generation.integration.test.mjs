import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('full run observes the already-open target, authors a reusable script, and runs it without another confirmation', { timeout: 120_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-post-login-generation', String(Date.now()));
  const projectId = 'post-login-generation-fixture';
  let targetVisits = 0;
  let authenticated = false;
  let sawObservedPageEvidence = false;
  const modelToolCalls = [];
  const target = createServer((_req, res) => {
    if (_req.url === '/auth-state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ authenticated }));
      return;
    }
    targetVisits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(authenticated
      ? `<!doctype html><html><body><h1>Fixture form</h1><label>Fixture code<input aria-invalid="true" style="border:2px solid red"></label></body></html>`
      : `<!doctype html><html><body><h1>扫码登录</h1><script>setInterval(async()=>{const state=await fetch('/auth-state').then(r=>r.json());if(state.authenticated){document.body.innerHTML='<h1>Fixture form</h1><label>Fixture code<input aria-invalid="true" style="border:2px solid red"></label>';document.title='Fixture form';}},50)</script></body></html>`);
  });
  const model = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const part of req) body += part;
      const payload = JSON.parse(body);
      const toolName = payload.tools?.[0]?.function?.name;
      modelToolCalls.push({ stream: payload.stream, toolName, toolNames: payload.tools?.map(tool => tool.function?.name), toolChoice: payload.tool_choice });
      const messageText = payload.messages.flatMap(message => Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'text').map(part => part.text)
        : [String(message.content ?? '')]).join('\n');
      let message;
      if (toolName === 'testpilot_computer_capability_probe') {
        message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name: toolName, arguments: JSON.stringify({ canReadScreenshot: true }) } }] };
      } else if (toolName === 'submit_browser_steps') {
        sawObservedPageEvidence ||= messageText.includes('Observed page evidence') && messageText.includes('"name":"Fixture code"');
        message = { role: 'assistant', tool_calls: [{ id: 'draft', type: 'function', function: { name: toolName, arguments: JSON.stringify({ steps: [{ action: 'assertFieldInvalid', label: 'Fixture code' }] }) } }] };
      } else if (toolName === 'computer_step') {
        const id = messageText.match(/Case ID: ([^\.\s]+)/)?.[1];
        message = { role: 'assistant', tool_calls: [{ id: 'result', type: 'function', function: { name: toolName, arguments: JSON.stringify({ action: 'record_case_result', case_id: id, status: 'inconclusive', evidence: 'Local integration fixture; this lane only verifies orchestration.' }) } }] };
      } else {
        message = { role: 'assistant', content: 'Integration fixture summary based on recorded evidence.' };
      }
      if (payload.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const chunks = [];
        if (message.tool_calls?.length) {
          const call = message.tool_calls[0];
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] } }] });
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: call.function.arguments } }] } }] });
          chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          chunks.push({ choices: [{ index: 0, delta: { content: message.content ?? '' }, finish_reason: 'stop' }] });
        }
        for (const chunk of chunks) res.write(`data: ${JSON.stringify({ id: 'local-model-fixture', object: 'chat.completion.chunk', model: 'local-post-login-fixture', ...chunk })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'local-model-fixture', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
      }
    })().catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  for (const server of [target, model]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const demoPort = await reservePort();
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  const caseDefaults = {
    source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'],
    selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: '字段边框为红色',
  };
  const project = {
    id: projectId, name: 'Post login step generation fixture', fileName: 'fixture.md', sourceFiles: ['fixture.md'], caseMode: 'both', format: 'markdown', targetUrl,
    sourceText: 'The input has a visible invalid state.', confirmationRequired: false, reviewStatus: 'approved', reviewNotes: 'Reduced confirmation enabled for isolated fixture.',
    cases: [
      { ...caseDefaults, id: 'case-scripted', title: 'Existing script runs first', steps: [
        { action: 'fillByLabel', label: 'Fixture code', value: '{{param:scenarioMarker}}' },
        { action: 'assertValue', label: 'Fixture code', value: '{{param:scenarioMarker}}' },
        { action: 'assertFieldInvalid', label: 'Fixture code' },
      ] },
      { ...caseDefaults, id: 'case-needs-script', title: 'Missing script generated after the target opens', steps: [], coverageGap: '' },
      { ...caseDefaults, id: 'case-unselected', title: 'Excluded case remains untouched', steps: [], coverageGap: '', selectedForRegression: false },
      { ...caseDefaults, id: 'case-outside-scope', title: 'Selected in project but excluded from this run', steps: [{ action: 'assertVisible', text: 'Fixture form' }] },
    ],
    testDataSets: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Synthetic scenario', values: { scenarioMarker: 'generated-run marker' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  const environment = {
    ...process.env, PORT: String(demoPort), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: 'local-fixture-key', OPENAI_API_KEY: '',
    TESTPILOT_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, TESTPILOT_MODEL: 'local-post-login-fixture',
    TESTPILOT_BROWSER_CDP_ENDPOINT: '', TESTPILOT_BROWSER_HEADLESS: '1', TESTPILOT_BROWSER_CHANNEL: '',
    TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
  };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = '';
  demo.stdout.on('data', chunk => { demoLog += chunk.toString(); });
  demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  t.after(async () => {
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; }
    for (const server of [target, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });

  for (let i = 0; i < 120; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${demoBase}/api/health`)).ok) break; } catch {}
    if (i === 119) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }
  const pendingRun = fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-scripted', 'case-needs-script'], testDataSetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
  let loginState;
  for (let i = 0; i < 100; i++) {
    loginState = await (await fetch(`${demoBase}/api/document-projects/${projectId}/login`)).json();
    if (loginState?.status === 'waiting_for_user') break;
    await delay(50);
  }
  assert.equal(loginState?.status, 'waiting_for_user', 'the run should request login in the already-open project page before trying to author empty cases');
  authenticated = true;
  await delay(250);
  const continueResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/login/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(continueResponse.status, 200, await continueResponse.text());
  const response = await pendingRun;
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const run = JSON.parse(responseText);
  assert.deepEqual(run.stepGeneration?.generatedCaseIds, ['case-needs-script'], `generation warning/details: ${JSON.stringify(run.stepGeneration)}; model tool calls: ${JSON.stringify(modelToolCalls)}`);
  assert.deepEqual(run.stepGeneration?.caseResults?.map(item => ({ caseId: item.caseId, status: item.status, stepCount: item.stepCount })), [{ caseId: 'case-needs-script', status: 'generated', stepCount: 1 }]);
  assert.equal(run.stepGeneration?.requiresReview, false);
  assert.equal(run.deterministic.results.find(item => item.id === 'case-needs-script')?.status, 'passed');
  assert.deepEqual(run.caseScope.selectedCaseIds, ['case-scripted', 'case-needs-script']);
  assert.deepEqual(run.deterministic.results.map(item => item.id), ['case-scripted', 'case-needs-script'], 'post-login generation must retain the explicitly selected run scope');
  assert.deepEqual(run.ai.results.map(item => item.id), ['case-scripted', 'case-needs-script'], 'the visual lane must retain the explicitly selected run scope');
  assert.deepEqual(run.parameterValues, { scenarioMarker: 'generated-run marker' });
  assert.equal(run.deterministic.results.find(item => item.id === 'case-scripted')?.status, 'passed', 'reselecting cases after AI step generation must keep the run parameter values');
  assert.equal(sawObservedPageEvidence, true, 'the authoring prompt must include controls observed on the already-open target page');
  assert.equal(modelToolCalls[0]?.stream, true, 'the test endpoint must speak the streaming protocol used by Pi Agent Core');
  const savedProject = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), 'utf8'));
  assert.deepEqual(savedProject.cases.find(item => item.id === 'case-needs-script').steps, [{ action: 'assertFieldInvalid', label: 'Fixture code' }]);
  assert.equal(savedProject.cases.find(item => item.id === 'case-unselected').steps.length, 0, 'automatic authoring must not modify cases excluded from this run');
  assert.equal(savedProject.reviewStatus, 'approved');
  assert.ok(targetVisits >= 5, 'the logged-in page is reloaded for each of two selected cases in both lanes, while the same browser context and sessionStorage keep the authenticated session');
});

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
