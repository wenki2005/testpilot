import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { strFromU8, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('a document run recovers after a service crash during login handoff and reuses the authenticated Edge tab', { timeout: 180_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-run-crash-recovery', String(Date.now()));
  const projectId = 'crash-recovery-fixture';
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Crash recovery fixture</title><body><h1 id="state"></h1><script>document.querySelector('#state').textContent=sessionStorage.getItem('testpilot-crash-fixture')==='authenticated'?'Session survived restart':'Please sign in';</script></body>`);
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  const modelPort = await reservePort();
  const model = createServer((req, res) => {
    void (async () => {
      let body = ''; for await (const part of req) body += part;
      const payload = JSON.parse(body);
      const toolName = payload.tools?.[0]?.function?.name;
      let message;
      if (toolName === 'testpilot_computer_capability_probe') message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name: toolName, arguments: JSON.stringify({ canReadScreenshot: true }) } }] };
      else if (toolName === 'computer_step') {
        const content = payload.messages.at(-1)?.content ?? [];
        const prompt = Array.isArray(content) ? content.filter(item => item.type === 'text').map(item => item.text).join('\n') : String(content);
        const caseId = prompt.match(/Case ID: ([^\.\s]+)/)?.[1];
        message = { role: 'assistant', tool_calls: [{ id: 'case', type: 'function', function: { name: toolName, arguments: JSON.stringify({ action: 'record_case_result', case_id: caseId, status: 'passed', evidence: '截图显示 Session survived restart。' }) } }] };
      } else message = { role: 'assistant', content: 'Report based on recorded test evidence.' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'crash-fixture', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(String(error)); });
  });
  model.listen(modelPort, '127.0.0.1'); await once(model, 'listening');
  const cdpPort = await reservePort();
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
  const edgeProfile = resolve(dataDir, 'edge-profile');
  const edge = await chromium.launchPersistentContext(edgeProfile, { channel: 'msedge', headless: true, args: ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, '--no-first-run', '--no-default-browser-check'] });
  const demoPort = await reservePort();
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const project = {
    id: projectId, name: 'Crash recovery fixture', fileName: 'fixture.md', format: 'markdown', targetUrl,
    sourceText: 'The test browser session must survive a TestPilot process restart.',
    cases: [{ id: 'session-check', title: 'Browser session remains available', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P0', category: 'authentication', confidence: 'high', coverageAreas: ['authentication'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Session survived restart', steps: [{ action: 'assertVisible', text: 'Session survived restart' }] }],
    reviewStatus: 'approved', reviewNotes: 'Read-only local integration fixture.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));

  const environment = { ...process.env, PORT: String(demoPort), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: 'fixture-key', OPENAI_API_KEY: '', TESTPILOT_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, TESTPILOT_MODEL: 'crash-fixture', TESTPILOT_BROWSER_CDP_ENDPOINT: cdpEndpoint, TESTPILOT_BROWSER_HEADLESS: '1', TESTPILOT_BROWSER_CHANNEL: '' };
  let demo;
  const startDemo = async () => {
    demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let logs = ''; demo.stdout.on('data', chunk => { logs += chunk.toString(); }); demo.stderr.on('data', chunk => { logs += chunk.toString(); });
    for (let i = 0; i < 120; i++) {
      if (demo.exitCode !== null) throw new Error(`TestPilot exited before becoming healthy: ${logs}`);
      try { if ((await fetch(`${demoBase}/api/health`)).ok) return; } catch {}
      await delay(100);
    }
    throw new Error(`TestPilot did not start: ${logs}`);
  };
  t.after(async () => {
    if (demo?.exitCode === null) { const exited = once(demo, 'exit'); demo.kill(); await exited; }
    await edge.close().catch(() => undefined);
    for (const server of [target, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });

  await startDemo();
  const interruptedRequest = fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['session-check'] }) }).catch(() => undefined);
  let handoff;
  for (let i = 0; i < 300; i++) {
    try { const response = await fetch(`${demoBase}/api/document-projects/${projectId}/login`); handoff = await response.json(); if (handoff?.status === 'waiting_for_user') break; } catch {}
    if (demo.exitCode !== null) throw new Error('TestPilot exited before creating the login handoff.');
    await delay(100);
  }
  assert.equal(handoff?.status, 'waiting_for_user', 'the first page should request a user login handoff');
  const loginPage = edge.pages().find(page => page.url().startsWith(targetUrl));
  assert.ok(loginPage, 'the login page must remain in the external Edge session');
  await loginPage.evaluate(() => { sessionStorage.setItem('testpilot-crash-fixture', 'authenticated'); document.querySelector('#state').textContent = 'Session survived restart'; });
  const journalDir = resolve(dataDir, 'document-tests', 'runs');
  const runDirectories = await readdir(journalDir);
  const activeRunId = runDirectories.find(name => name !== '.' && name !== '..');
  assert.ok(activeRunId, 'the running journal should be written before browser actions');
  const journalPath = resolve(journalDir, activeRunId, 'execution.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(journal.status, 'running');
  assert.equal(journal.stage, 'awaiting-login');
  demo.kill('SIGKILL');
  await once(demo, 'exit');
  await interruptedRequest;

  const cdpPagesBeforeRestart = edge.pages();
  assert.ok(cdpPagesBeforeRestart.length >= 1, 'the external Edge session must remain open while TestPilot is stopped');
  await startDemo();
  const browserStatusResponse = await fetch(`${demoBase}/api/browser/status`);
  assert.equal(browserStatusResponse.status, 200);
  const browserStatus = await browserStatusResponse.json();
  assert.equal(browserStatus.mode, 'edge-cdp');
  assert.equal(browserStatus.reachable, true);
  assert.ok(browserStatus.managedTabs >= 1, 'the settings status should show the saved project Edge tab is reusable after restart');
  const recoveryResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/recovery`);
  assert.equal(recoveryResponse.status, 200);
  const recovery = await recoveryResponse.json();
  assert.equal(recovery.runId, activeRunId);
  assert.equal(recovery.canResume, true);
  assert.equal(recovery.stage, 'awaiting-login');
  const resumedResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: activeRunId }) });
  const resumedText = await resumedResponse.text();
  assert.equal(resumedResponse.status, 201, resumedText);
  const resumed = JSON.parse(resumedText);
  assert.equal(resumed.id, activeRunId);
  assert.equal(resumed.deterministic.results[0].status, 'passed');
  assert.equal(resumed.ai.results[0].status, 'passed');
  assert.deepEqual(resumed.recovery, { resumeCount: 1, replayedFromBeginning: false, skippedCompletedCaseIds: [], interruptedRetryCaseIds: [] });
  assert.match(resumed.report, /中断恢复：第 1 次恢复；已跳过已完成用例 无；中断用例仅在副作用风险为 none 时重试：无。未从头无条件重放/);
  const completed = JSON.parse(await readFile(journalPath, 'utf8'));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.resumeCount, 1);
  const packageResponse = await fetch(`${demoBase}/api/document-runs/${activeRunId}/package`);
  assert.equal(packageResponse.status, 200);
  const archive = unzipSync(new Uint8Array(await packageResponse.arrayBuffer()));
  const packedRun = JSON.parse(strFromU8(archive['run.json']));
  assert.deepEqual(packedRun.recovery, { resumeCount: 1, replayedFromBeginning: false, skippedCompletedCaseIds: [], interruptedRetryCaseIds: [] });
  const manifest = JSON.parse(strFromU8(archive['artifacts.json']));
  assert.equal(manifest.projectId, projectId);
  assert.equal(manifest.runId, activeRunId);
  assert.ok(manifest.artifacts.some(item => item.path === 'run.json' && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(edge.pages().some(page => !page.isClosed()), 'the same Edge process and tabs remain alive through service restart');
});

async function reservePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
