import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');

test('a CDP project tab and sessionStorage survive TestPilot service restarts', { timeout: 45_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'browser-session-restart', String(Date.now()));
  const projectId = 'f3e59284-8526-4389-b0a2-c876fdc9e6e3';
  let visits = 0;
  const target = createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    visits++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Session restart fixture</title><h1>CDP session fixture</h1>');
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  const cdpPort = await reservePort();
  const cdpEndpoint = `http://127.0.0.1:${cdpPort}`;
  const profileDir = resolve(dataDir, 'external-edge-profile');
  const externalContext = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: true,
    args: ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`, '--no-first-run', '--no-default-browser-check'],
  });

  t.after(async () => {
    await externalContext.close().catch(() => undefined);
    target.closeAllConnections(); await new Promise(done => target.close(done));
  });

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${cdpEndpoint}/json/version`)).ok) break; } catch {}
    if (i === 99) throw new Error('External Chromium did not expose the loopback CDP endpoint.');
    await delay(100);
  }

  const firstTargetId = await runRuntimeProcess({ dataDir, projectId, targetUrl, cdpEndpoint, phase: 'seed' });
  const secondTargetId = await runRuntimeProcess({ dataDir, projectId, targetUrl, cdpEndpoint, phase: 'verify' });
  assert.equal(secondTargetId, firstTargetId, 'the restarted service should attach to the same DevTools target');
  assert.equal(visits, 2, 'the restarted service should reclaim and navigate the original project tab once');
});

async function runRuntimeProcess({ dataDir, projectId, targetUrl, cdpEndpoint, phase }) {
  const script = `
    import { pathToFileURL } from 'node:url';
    const moduleUrl = pathToFileURL(process.env.TESTPILOT_BROWSER_RUNTIME).href;
    const { launchPersistentTestPage, closePersistentTestPages } = await import(moduleUrl);
    const session = await launchPersistentTestPage(process.env.TESTPILOT_TEST_PROFILE);
    const cdp = await session.context.newCDPSession(session.page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    console.log('TARGET_ID:' + targetInfo.targetId);
    if (process.env.TESTPILOT_PHASE === 'seed') {
      await session.page.goto(process.env.TESTPILOT_TEST_TARGET_URL, { waitUntil: 'domcontentloaded' });
      await session.page.evaluate(() => sessionStorage.setItem('testpilot-restart-fixture', 'still-authenticated'));
    } else {
      const value = await session.page.evaluate(() => sessionStorage.getItem('testpilot-restart-fixture'));
      if (value !== 'still-authenticated') throw new Error('The original project tab sessionStorage was not retained.');
      await session.page.goto(process.env.TESTPILOT_TEST_TARGET_URL, { waitUntil: 'domcontentloaded' });
      if (await session.page.evaluate(() => sessionStorage.getItem('testpilot-restart-fixture')) !== 'still-authenticated') throw new Error('The session marker did not survive target navigation.');
    }
    await closePersistentTestPages();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: {
      ...process.env,
      TESTPILOT_DATA_DIR: dataDir,
      TESTPILOT_BROWSER_CDP_ENDPOINT: cdpEndpoint,
      TESTPILOT_BROWSER_RUNTIME: resolve(root, 'dist', 'adapters', 'browser-runtime.js'),
      TESTPILOT_TEST_PROFILE: resolve(dataDir, 'browser-profiles', projectId),
      TESTPILOT_PROJECT_ID: projectId,
      TESTPILOT_TEST_TARGET_URL: targetUrl,
      TESTPILOT_PHASE: phase,
      OPENAI_API_KEY: '',
      TESTPILOT_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${phase} browser runtime process failed: ${output}`);
  const targetId = output.match(/TARGET_ID:([^\s]+)/)?.[1];
  assert.ok(targetId, `${phase} process did not report the DevTools target ID: ${output}`);
  return targetId;
}

async function reservePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
