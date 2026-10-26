import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('empty deterministic steps get a page-grounded fallback when no model API is configured', { timeout: 60_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-no-model-step-fallback', String(Date.now()));
  const projectId = 'no-model-page-grounded-fallback';
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>Fixture form</h1><p>提示：本期申请请联系运营。</p><label>Fixture code<input aria-invalid="true" style="border:2px solid red"></label></body></html>');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const demoPort = await reservePort();
  const demoBase = `http://127.0.0.1:${demoPort}`;
  const project = {
    id: projectId, name: 'No model fallback', fileName: 'fixture.md', caseMode: 'both', format: 'markdown',
    targetUrl: `http://127.0.0.1:${target.address().port}/`, sourceText: 'A visibly invalid field is shown.',
    confirmationRequired: false, reviewStatus: 'approved', reviewNotes: 'Reduced confirmation on local fixture.',
    cases: [
      { id: 'case-empty', title: 'Required field is visibly invalid', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'], priority: 'P1', category: 'input-validation', confidence: 'high', coverageAreas: ['input-validation'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: 'Fixture code field border is red/invalid', steps: [] },
      { id: 'case-visible-copy', title: 'Shows the agreed notice', source: 'fixture.md:2', requirementRefs: ['fixture.md:2'], priority: 'P2', category: 'functional', confidence: 'high', coverageAreas: ['functional'], selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: '提示文案显示「本期申请请联系运营」', steps: [] },
    ],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(resolve(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), JSON.stringify(project));
  const environment = {
    ...process.env, PORT: String(demoPort), TESTPILOT_DATA_DIR: dataDir,
    TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BASE_URL: 'http://127.0.0.1:1/v1',
    TESTPILOT_BROWSER_CDP_ENDPOINT: '', TESTPILOT_BROWSER_HEADLESS: '1', TESTPILOT_BROWSER_CHANNEL: '',
    TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
  };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = '';
  demo.stdout.on('data', chunk => { demoLog += chunk.toString(); });
  demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  t.after(async () => {
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; }
    target.closeAllConnections();
    await new Promise(done => target.close(done));
  });
  for (let i = 0; i < 120; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${demoBase}/api/health`)).ok) break; } catch {}
    if (i === 119) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }
  const response = await fetch(`${demoBase}/api/document-projects/${projectId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['case-empty', 'case-visible-copy'] }) });
  const bodyText = await response.text();
  assert.equal(response.status, 201, bodyText);
  const run = JSON.parse(bodyText);
  assert.deepEqual(run.stepGeneration?.generatedCaseIds, ['case-empty', 'case-visible-copy']);
  assert.equal(run.deterministic.results.find(result => result.id === 'case-empty')?.status, 'passed');
  assert.equal(run.ai.results.find(result => result.id === 'case-empty')?.status, 'blocked', 'visual lane remains independently blocked without a vision model');
  assert.equal(run.deterministic.results.find(result => result.id === 'case-visible-copy')?.status, 'passed', 'an exact expected message observed in the page evidence becomes a reusable assertion');
  const saved = JSON.parse(await readFile(resolve(dataDir, 'document-tests', 'projects', `${projectId}.json`), 'utf8'));
  assert.deepEqual(saved.cases[0].steps, [{ action: 'assertFieldInvalid', label: 'Fixture code' }]);
  assert.deepEqual(saved.cases[1].steps, [{ action: 'assertVisible', text: '本期申请请联系运营' }]);
});

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
