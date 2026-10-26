import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const { navigatePersistentPage } = await import('../dist/adapters/browser-runtime.js');
const { isLoginPage } = await import('../dist/adapters/login-handoff.js');

test('persistent hash-route changes reuse the same document and authenticated session state', { timeout: 30_000 }, async t => {
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/') requests++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url?.startsWith('/login')
      ? '<!doctype html><title>Sign in</title><h1>扫描二维码登录</h1>'
      : '<!doctype html><title>Persistent session fixture</title><h1>企业微信管理入口</h1><main id="route"></main><script>sessionStorage.setItem("session-marker", "authenticated"); window.documentMarker = crypto.randomUUID(); const render=()=>document.querySelector("#route").textContent=location.hash; addEventListener("hashchange",render); render();</script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage();
  t.after(async () => { await browser.close().catch(() => undefined); server.closeAllConnections(); await new Promise(done => server.close(done)); });

  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/#/home`, { waitUntil: 'domcontentloaded' });
  assert.equal(await isLoginPage(page), false, 'mentioning the WeCom brand on a signed-in app must not trigger a QR handoff');
  const marker = await page.evaluate(() => window.documentMarker);
  assert.equal(requests, 1);

  assert.equal(await navigatePersistentPage(page, `${origin}/#/profile`), 'hash-route');
  await page.getByText('#/profile').waitFor();
  assert.equal(await page.evaluate(() => window.documentMarker), marker, 'the original document instance must remain alive');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('session-marker')), 'authenticated');
  assert.equal(requests, 1, 'hash route switching must not request/reload the target document');

  assert.equal(await navigatePersistentPage(page, `${origin}/#/profile`), 'reused');
  assert.equal(requests, 1, 'an already-correct route is not revisited');

  await navigatePersistentPage(page, `${origin}/login`);
  assert.equal(await isLoginPage(page), true, 'a visible QR sign-in prompt must still be detected');
});
