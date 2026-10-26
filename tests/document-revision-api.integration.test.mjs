import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('project revision API lists, verifies and isolates immutable revision snapshots', { timeout: 35_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-revision-api-'));
  const projectId = 'revision-api-fixture';
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const projectDir = join(dataDir, 'document-tests', 'projects');
  const original = {
    id: projectId, name: 'Revision API fixture', fileName: 'fixture.md', format: 'markdown', targetUrl: 'http://127.0.0.1:43123/',
    sourceText: 'A stable local requirement.', cases: [{
      id: 'case-1', title: 'Landing title is visible', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'],
      priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'], lifecycleStatus: 'runnable',
      selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '',
      kind: 'visible', expected: 'Landing title', steps: [{ action: 'assertExactVisible', text: 'Landing title' }],
    }], reviewStatus: 'approved', reviewNotes: 'Local read-only fixture.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, `${projectId}.json`), JSON.stringify(original));

  const demo = spawn(process.execPath, ['dist/demo/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_BROWSER_CDP_ENDPOINT: '', TESTPILOT_BROWSER_HEADLESS: '1', TESTPILOT_BROWSER_CHANNEL: '', TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0', TESTPILOT_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); });
  demo.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => {
    if (demo.exitCode === null) {
      const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await Promise.race([exited, delay(5_000)]);
      if (demo.exitCode === null) { const killed = once(demo, 'exit'); demo.kill('SIGKILL'); await Promise.race([killed, delay(1_000)]); }
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => { if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error; });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (attempt === 119) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  const historyUrl = `${baseUrl}/api/document-projects/${projectId}/revisions?kind=case&entityId=case-1`;
  const initialResponse = await fetch(historyUrl);
  assert.equal(initialResponse.status, 200);
  const initialHistory = await initialResponse.json();
  assert.equal(initialHistory.total, 1);
  const initialRevision = initialHistory.items[0];
  const initialDetailResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions/${initialRevision.id}`);
  assert.equal(initialDetailResponse.status, 200);
  assert.equal((await initialDetailResponse.json()).snapshot.title, 'Landing title is visible');

  const edited = structuredClone(original.cases);
  edited[0].title = 'Updated landing title';
  edited[0].expected = 'Updated landing title';
  edited[0].steps = [{ action: 'assertExactVisible', text: 'Updated landing title' }];
  const saveResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: edited }) });
  assert.equal(saveResponse.status, 200, await saveResponse.clone().text());

  const updatedHistory = await (await fetch(historyUrl)).json();
  assert.equal(updatedHistory.total, 2);
  assert.equal(updatedHistory.items[0].version, 2);
  assert.equal((await (await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions/${initialRevision.id}`)).json()).snapshot.title, 'Landing title is visible', 'later edits do not mutate old revision data');

  const firstMaterialBytes = Buffer.from('# Updated requirement v1\nThe revised heading stays visible.');
  const firstMaterialResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/materials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'updated-requirements.md', bytesBase64: firstMaterialBytes.toString('base64'), role: 'requirements' }) });
  assert.equal(firstMaterialResponse.status, 200, await firstMaterialResponse.clone().text());
  const firstMaterial = await firstMaterialResponse.json();
  assert.match(firstMaterial.project.sourceText, /revised heading stays visible/u);
  assert.equal(firstMaterial.project.reviewStatus, 'draft', 'updating material requires project review but does not silently revise cases');
  assert.equal(firstMaterial.project.cases[0].title, 'Updated landing title');
  const firstMaterialHistory = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions?kind=materials`)).json();
  const firstMaterialRevision = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions/${firstMaterialHistory.items[0].id}`)).json();
  const firstMaterialPath = join(dataDir, 'document-tests', 'projects', ...firstMaterialRevision.snapshot.sourceMaterials[0].storageKey.split('/'));
  assert.deepEqual(await readFile(firstMaterialPath), firstMaterialBytes);

  const secondMaterialBytes = Buffer.from('# Updated requirement v2\nThe heading remains in place.');
  const replaceResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/materials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'updated-requirements.md', bytesBase64: secondMaterialBytes.toString('base64'), role: 'requirements', replaceMaterialId: firstMaterial.updatedMaterialId }) });
  assert.equal(replaceResponse.status, 200, await replaceResponse.clone().text());
  const secondMaterial = await replaceResponse.json();
  assert.notEqual(secondMaterial.updatedMaterialId, firstMaterial.updatedMaterialId);
  const allMaterialHistory = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions?kind=materials`)).json();
  assert.equal(allMaterialHistory.total, 3);
  const newestMaterialRevision = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/revisions/${allMaterialHistory.items[0].id}`)).json();
  const secondMaterialPath = join(dataDir, 'document-tests', 'projects', ...newestMaterialRevision.snapshot.sourceMaterials[0].storageKey.split('/'));
  assert.deepEqual(await readFile(secondMaterialPath), secondMaterialBytes);
  assert.deepEqual(await readFile(firstMaterialPath), firstMaterialBytes, 'replacing a source document retains the former original file');
  const crossProjectDetail = await fetch(`${baseUrl}/api/document-projects/other-project/revisions/${initialRevision.id}`);
  assert.equal(crossProjectDetail.status, 404);
  assert.equal((await fetch(`${historyUrl}&limit=501`)).status, 400);
});
