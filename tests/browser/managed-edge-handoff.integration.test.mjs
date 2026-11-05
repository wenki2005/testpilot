import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createDocumentPageExplorationAdapter } from '../../src/adapters/documents/evidence/page-evidence.ts';
import { disconnectPersistentTestPage, launchPersistentTestPage, promotePersistentTestPage } from '../../src/adapters/browser/browser-runtime.ts';
import { resolveModelSettings } from '../../src/adapters/ai/model-settings.ts';

test('managed Edge sessionStorage handoff promotes and reuses the owned target', { timeout: 60_000 }, async t => {
  if (process.env.TESTPILOT_BROWSER_CDP_ENDPOINT?.trim() || resolveModelSettings().browserCdpEndpoint) {
    t.skip('refusing to use a configured external CDP endpoint'); return;
  }
  if (process.platform !== 'win32') { t.skip('managed Edge is Windows-specific'); return; }
  const rootParent = path.resolve(process.env.TESTPILOT_TEST_RUN_DIR || path.join('test-artifacts', 'runs'));
  await mkdir(rootParent, { recursive: true });
  const root = await mkdtemp(path.join(rootParent, 'managed-edge-handoff-'));
  const profile = path.join(root, 'document-tests', 'browser-profiles', 'synthetic-edge');
  const previousHeadless = process.env.TESTPILOT_BROWSER_HEADLESS;
  process.env.TESTPILOT_BROWSER_HEADLESS = '1';
  const server = createServer((_req, res) => res.end('<h1>Synthetic local app</h1>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let started = false;
  try {
    try { await launchPersistentTestPage(profile, { browser: 'edge' }); started = true; }
    catch (error) {
      if (/executable|browser|launch|msedge/i.test(String(error))) { t.skip(`managed Edge executable unavailable: ${error.message}`); return; }
      throw error;
    }
    const persistent = (await launchPersistentTestPage(profile, { browser: 'edge' })).page;
    await persistent.goto(`${origin}/seed`);
    await persistent.evaluate(() => sessionStorage.setItem('synthetic-handoff', 'fixture-value'));
    const initialCdp = await persistent.context().newCDPSession(persistent);
    const { targetInfo: initialTarget } = await initialCdp.send('Target.getTargetInfo');
    await initialCdp.detach();
    const adapter = createDocumentPageExplorationAdapter({
      acquirePageLease: () => () => {}, launchPersistentTestPage: async () => launchPersistentTestPage(profile, { browser: 'edge' }),
      promotePersistentTestPage: async (_dir, page) => promotePersistentTestPage(profile, page, { browser: 'edge' }),
      navigatePersistentPage: async (page, url) => page.goto(url), isLoginPage: async () => false,
      unsupportedClientGateMessage: () => undefined, profileDirectory: () => profile,
    });
    const handoff = await adapter.open({ id: 'synthetic-edge', targetUrl: `${origin}/app` });
    const exploration = persistent.context().pages().find(page => page !== persistent && !page.isClosed());
    assert.ok(exploration);
    assert.equal(await exploration.evaluate(() => sessionStorage.getItem('synthetic-handoff')), 'fixture-value');
    await handoff.promoteSession(); await handoff.close();
    const promoted = (await launchPersistentTestPage(profile, { browser: 'edge' })).page;
    const promotedCdp = await promoted.context().newCDPSession(promoted);
    const { targetInfo: promotedTarget } = await promotedCdp.send('Target.getTargetInfo');
    await promotedCdp.detach();
    assert.equal(persistent.isClosed(), true);
    assert.equal(await promoted.evaluate(() => sessionStorage.getItem('synthetic-handoff')), 'fixture-value');
    const saved = JSON.parse(await readFile(path.join(root, 'document-tests', 'browser-sessions', 'synthetic-edge.json'), 'utf8'));
    assert.ok(saved.targetId, 'promoted Edge target identity is persisted');
    assert.notEqual(saved.targetId, initialTarget.targetId, 'promotion persists the new Edge target identity');
    assert.equal(saved.targetId, promotedTarget.targetId, 'saved Edge identity matches the promoted live page');
    assert.equal(promoted.context().pages().filter(page => !page.isClosed()).length, 1, 'managed context retains one live project page');
    await promoted.goto(`${origin}/app`);
    assert.equal(await promoted.locator('h1').innerText(), 'Synthetic local app');
    assert.equal(await promoted.evaluate(() => sessionStorage.getItem('synthetic-handoff')), 'fixture-value');
    const reopened = (await launchPersistentTestPage(profile, { browser: 'edge' })).page;
    const reopenedCdp = await reopened.context().newCDPSession(reopened);
    const { targetInfo: reopenedTarget } = await reopenedCdp.send('Target.getTargetInfo');
    await reopenedCdp.detach();
    assert.equal(reopenedTarget.targetId, saved.targetId, 'runtime map returns the promoted target identity');
  } finally {
    let ownedSession;
    try { ownedSession = JSON.parse(await readFile(path.join(root, 'document-tests', 'browser-sessions', 'synthetic-edge.json'), 'utf8')); } catch {}
    if (started) await disconnectPersistentTestPage(profile, { browser: 'edge' }).catch(() => {});
    if (ownedSession?.pid && ownedSession?.cdpEndpoint?.startsWith('http://127.0.0.1:')) {
      const ownedEdge = await chromium.connectOverCDP(ownedSession.cdpEndpoint).catch(() => undefined);
      if (ownedEdge) {
        const browserSession = await ownedEdge.newBrowserCDPSession().catch(() => undefined);
        if (browserSession) {
          await browserSession.send('Browser.close').catch(() => {});
          await browserSession.detach().catch(() => {});
        }
        await ownedEdge.close().catch(() => {});
      }
    }
    await new Promise(resolve => server.close(resolve));
    t.diagnostic(`Retained isolated Edge profile at ${root}`);
    if (previousHeadless === undefined) delete process.env.TESTPILOT_BROWSER_HEADLESS;
    else process.env.TESTPILOT_BROWSER_HEADLESS = previousHeadless;
  }
});
