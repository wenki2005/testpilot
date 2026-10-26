import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('the default managed Edge session and login storage survive a TestPilot process restart', { timeout: 90_000 }, async t => {
  if (process.platform !== 'win32') { t.skip('the default managed Edge launcher is Windows-specific'); return; }
  const dataDir = resolve(root, 'artifacts', 'managed-browser-session-restart', String(Date.now()));
  const projectId = 'managed-edge-restart-fixture';
  const profileDir = resolve(dataDir, 'document-tests', 'browser-profiles', projectId);
  const sessionFile = resolve(dataDir, 'document-tests', 'browser-sessions', `${projectId}.json`);
  let visits = 0;
  const target = createServer((req, res) => {
    if (req.url === '/') visits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Managed Edge restart fixture</title><h1>Session fixture</h1>');
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  await mkdir(resolve(dataDir, 'document-tests', 'browser-profiles'), { recursive: true });
  const environment = {
    ...process.env,
    TESTPILOT_DATA_DIR: dataDir,
    TESTPILOT_BROWSER_CDP_ENDPOINT: '',
    TESTPILOT_BROWSER_HEADLESS: '1',
    TESTPILOT_BROWSER_CHANNEL: '',
    TESTPILOT_TEST_PROFILE: profileDir,
    TESTPILOT_TEST_PROJECT: projectId,
    TESTPILOT_TEST_TARGET_URL: targetUrl,
    TESTPILOT_BROWSER_RUNTIME: resolve(root, 'dist', 'adapters', 'browser-runtime.js'),
  };
  t.after(async () => {
    try {
      const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
      if (Number.isInteger(saved.pid)) spawnSync('taskkill', ['/PID', String(saved.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch { /* no managed browser was left running */ }
    target.closeAllConnections(); await new Promise(done => target.close(done));
  });

  const seed = await runRuntimeProcess(environment, 'seed');
  const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
  assert.equal(saved.version, 2);
  assert.ok(saved.cdpEndpoint?.startsWith('http://127.0.0.1:'), 'the session mapping should store only a loopback endpoint');
  assert.equal(seed.targetId, saved.targetId);

  const resumed = await runRuntimeProcess(environment, 'resume');
  assert.equal(resumed.targetId, seed.targetId, 'the restarted service must reclaim the same Edge tab');
  assert.equal(resumed.marker, 'still-authenticated', 'sessionStorage must remain available after the service process exits');
  assert.equal(resumed.managedTabs, 1, 'browser settings must report the internally managed persistent Edge tab');
  assert.equal(visits, 1, 'reconnecting to the saved tab must not navigate or reload the target');
});

async function runRuntimeProcess(environment, phase) {
  const script = `
    import { pathToFileURL } from 'node:url';
    const runtimeUrl = pathToFileURL(process.env.TESTPILOT_BROWSER_RUNTIME).href;
    const { launchPersistentTestPage, getExistingPersistentTestPage, closePersistentTestPages, getBrowserRuntimeStatus } = await import(runtimeUrl);
    let session;
    if (process.env.TESTPILOT_PHASE === 'seed') {
      session = await launchPersistentTestPage(process.env.TESTPILOT_TEST_PROFILE);
      await session.page.goto(process.env.TESTPILOT_TEST_TARGET_URL, { waitUntil: 'domcontentloaded' });
      await session.page.evaluate(() => sessionStorage.setItem('managed-edge-fixture', 'still-authenticated'));
    } else {
      session = await getExistingPersistentTestPage(process.env.TESTPILOT_TEST_PROFILE);
      if (!session) throw new Error('The restarted service did not reconnect to the existing managed Edge tab.');
    }
    const marker = await session.page.evaluate(() => sessionStorage.getItem('managed-edge-fixture'));
    const cdp = await session.context.newCDPSession(session.page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    const browserStatus = await getBrowserRuntimeStatus();
    console.log('STATE:' + JSON.stringify({ targetId: targetInfo.targetId, marker, managedTabs: browserStatus.managedTabs }));
    await closePersistentTestPages();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...environment, TESTPILOT_PHASE: phase },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${phase} runtime process failed: ${output}`);
  const stateLine = output.split(/\r?\n/u).find(line => line.startsWith('STATE:'));
  assert.ok(stateLine, `${phase} runtime did not report browser state: ${output}`);
  return JSON.parse(stateLine.slice('STATE:'.length));
}
