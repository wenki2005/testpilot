import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('SQLite migration API locks draft content behind approval and returns run artifacts', { timeout: 30_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'sqlite-migration-workflow-integration', String(Date.now()));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); }); demo.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => { if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); } });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  const sourceDir = resolve(root, 'examples', 'migrations', 'demo-hub-sqlite');
  const suite = JSON.parse(await readFile(resolve(sourceDir, 'suite.json'), 'utf8'));
  const files = {};
  for (const file of ['baseline.sql', 'fixtures.sql', 'migrations/001-add-status.sql', 'migrations/002-partial-invalid.sql']) files[file] = await readFile(resolve(sourceDir, file), 'utf8');
  const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const createdResponse = await post('/api/sqlite-migration-suites', { suite, files });
  assert.equal(createdResponse.status, 201);
  const candidate = await createdResponse.json();
  assert.equal(candidate.status, 'draft');
  assert.match(candidate.digest, /^[a-f0-9]{64}$/);

  const draftRun = await post(`/api/sqlite-migration-suites/${candidate.id}/run`, {});
  assert.equal(draftRun.status, 409, 'draft suites must never execute');
  const revised = await post(`/api/sqlite-migration-suites/${candidate.id}/update`, { suite: { ...suite, name: `${suite.name} revised` }, files });
  assert.equal(revised.status, 200);
  const revisedCandidate = await revised.json();
  assert.equal(revisedCandidate.revision, 2);
  assert.notEqual(revisedCandidate.digest, candidate.digest);

  const approved = await post(`/api/sqlite-migration-suites/${candidate.id}/review`, { decision: 'approve', notes: 'Synthetic in-memory fixture.' });
  assert.equal(approved.status, 200);
  const immutableEdit = await post(`/api/sqlite-migration-suites/${candidate.id}/update`, { suite, files });
  assert.equal(immutableEdit.status, 409, 'approved suite versions must be immutable');
  const runResponse = await post(`/api/sqlite-migration-suites/${candidate.id}/run`, {});
  assert.equal(runResponse.status, 201);
  const run = await runResponse.json();
  assert.equal(run.status, 'passed');
  assert.deepEqual(run.results.map(item => item.status), ['passed', 'passed']);
  assert.equal((await fetch(`${base}/api/sqlite-migration-runs/${run.runId}/report`)).status, 200);
  const archive = await fetch(`${base}/api/sqlite-migration-runs/${run.runId}/package`);
  assert.equal(archive.status, 200);
  assert.ok(Number(archive.headers.get('content-length')) > 1000);
});

async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
