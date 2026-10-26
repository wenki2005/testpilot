import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadProjectProfile } from '../dist/storage/suite-loader.js';
import { prepareProfile } from '../dist/adapters/project-profile-adapter.js';

const root = resolve(import.meta.dirname, '..');

test('Demo Hub registered profile tests SQLite migration and backup isolation through the workbench', { timeout: 30000 }, async t => {
  const profile = await loadProjectProfile(resolve(root, 'examples', 'profiles', 'demo-hub.json'));
  const prepared = await prepareProfile(profile);
  try {
    await assert.doesNotReject(access(resolve(prepared.projectRoot, 'app.py')));
    for (const excluded of ['.venv', 'data', 'artifacts', 'cloudbase', 'deploy', 'releases']) {
      await assert.rejects(access(resolve(prepared.projectRoot, excluded)));
    }
  } finally {
    await prepared.close();
  }
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  const dataDir = resolve(root, 'artifacts', 'integration', `demo-hub-${Date.now()}`);
  await mkdir(dataDir, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/demo/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk.toString(); });
  child.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    }
  });

  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`TestPilot server exited: ${log}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    await delay(50);
    if (i === 99) throw new Error(`TestPilot server did not start: ${log}`);
  }
  const profileResponse = await fetch(`${base}/api/project-profiles`);
  assert.equal(profileResponse.status, 200);
  const profiles = await profileResponse.json();
  assert.ok(profiles.some(profile => profile.id === 'demo-hub'));
  const start = await fetch(`${base}/api/project-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'demo-hub' }),
  });
  assert.equal(start.status, 202);
  const created = await start.json();
  let result;
  for (let i = 0; i < 200; i++) {
    const response = await fetch(`${base}/api/project-runs/${created.id}`);
    result = await response.json();
    if (!['queued', 'running'].includes(result.status)) break;
    await delay(50);
  }
  assert.equal(result.status, 'passed', result.summary);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].actualExitCode, 0);
  const output = result.results[0].evidence.map(item => item.content).join('\n');
  assert.match(output, /test_old_database_migration_preserves_records.*ok/s);
  assert.match(output, /test_backup_verify_restore_and_tamper_rejection.*ok/s);
  assert.match(output, /Ran 11 tests/);
});
