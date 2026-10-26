import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('project session status is passive and identity notes do not invalidate approved cases', { timeout: 30_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-project-session-'));
  const projectId = 'session-status-fixture';
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(done => portProbe.close(done));
  const projectDir = join(dataDir, 'document-tests', 'projects');
  const project = {
    id: projectId,
    name: 'Session status fixture',
    fileName: 'fixture.md',
    format: 'markdown',
    targetUrl: 'http://127.0.0.1:43123/app',
    sourceText: 'Local session status check.',
    cases: [{
      id: 'fixture-case', title: 'Local locator fixture', source: 'fixture.md:1', requirementRefs: ['fixture.md:1'],
      priority: 'P1', category: 'functional', confidence: 'high', coverageAreas: ['functional'], lifecycleStatus: 'runnable',
      selectedForRegression: true, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '',
      kind: 'visible', expected: 'Fixture marker appears', steps: [{ action: 'fillByLabel', label: 'Fixture marker', value: 'synthetic value' }],
    }],
    reviewStatus: 'approved',
    reviewNotes: 'Approved fixture.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, `${projectId}.json`), JSON.stringify(project));

  const demo = spawn(process.execPath, ['dist/demo/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      TESTPILOT_DATA_DIR: dataDir,
      TESTPILOT_BROWSER_CDP_ENDPOINT: '',
      TESTPILOT_BROWSER_HEADLESS: '1',
      TESTPILOT_BROWSER_CHANNEL: '',
      TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
      TESTPILOT_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  demo.stdout.on('data', chunk => { log += chunk.toString(); });
  demo.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => {
    if (demo.exitCode === null) {
      const exited = once(demo, 'exit');
      demo.kill('SIGTERM');
      await Promise.race([exited, delay(5_000)]);
      if (demo.exitCode === null) {
        const killed = once(demo, 'exit');
        demo.kill('SIGKILL');
        await Promise.race([killed, delay(1_000)]);
      }
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(error => {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) break; } catch {}
    if (attempt === 119) throw new Error(`Demo server did not start: ${log}`);
    await delay(100);
  }

  const statusResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/session-status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.state, 'unavailable');
  assert.equal(status.occupied, false);
  assert.equal(status.manualLoginRequired, null, 'no browser session must not be misreported as a login failure');
  await assert.rejects(stat(join(dataDir, 'document-tests', 'browser-profiles')), error => error.code === 'ENOENT', 'status inspection must not launch or create a browser profile');
  const blockedProbeResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/probe-step`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: 'fixture-case', stepIndex: 0 }),
  });
  assert.equal(blockedProbeResponse.status, 200);
  const blockedProbe = await blockedProbeResponse.json();
  assert.equal(blockedProbe.status, 'blocked');
  assert.match(blockedProbe.detail, /没有启动浏览器/u);
  await assert.rejects(stat(join(dataDir, 'document-tests', 'browser-profiles')), error => error.code === 'ENOENT', 'probe must not launch a browser when the project has no existing session');

  const saveResponse = await fetch(`${baseUrl}/api/document-projects/${projectId}/session-identity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityNote: 'QA 只读审核员' }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.reviewStatus, 'approved');
  assert.equal(saved.sessionIdentityNote, 'QA 只读审核员');
  assert.deepEqual(saved.cases.map(item => item.id), ['fixture-case']);

  const refreshedStatus = await (await fetch(`${baseUrl}/api/document-projects/${projectId}/session-status`)).json();
  assert.equal(refreshedStatus.identityNote, 'QA 只读审核员');
  assert.equal(refreshedStatus.identitySource, 'user-confirmed');

  const rejectedSecret = await fetch(`${baseUrl}/api/document-projects/${projectId}/session-identity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identityNote: 'Bearer abcdefghijklmnop' }),
  });
  assert.equal(rejectedSecret.status, 422, 'identity notes must not become a credential store');
  const persisted = JSON.parse(await readFile(join(projectDir, `${projectId}.json`), 'utf8'));
  assert.equal(persisted.reviewStatus, 'approved');
  assert.equal(persisted.sessionIdentityNote, 'QA 只读审核员');
  assert.deepEqual(persisted.cases.map(item => item.id), ['fixture-case']);
});
