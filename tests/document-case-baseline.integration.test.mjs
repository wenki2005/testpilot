import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const { resetPersistentCaseBaseline } = await import('../dist/adapters/browser-runtime.js');

test('each case gets a fresh document baseline in the same authenticated browser tab', { timeout: 30_000 }, async t => {
  let documentLoads = 0;
  const server = createServer((req, res) => {
    if (req.headers.accept?.includes('text/html')) documentLoads++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="min-height:4000px">
      <main id="state"></main>
      <label>Search<input id="search"></label>
      <script>
        window.documentInstance = crypto.randomUUID();
        if (!sessionStorage.getItem('auth')) sessionStorage.setItem('auth', 'already-authenticated');
        if (sessionStorage.getItem('restore-scroll') === 'yes') setTimeout(() => window.scrollTo(0, 1800), 80);
        const render = () => document.querySelector('#state').textContent = location.hash + ':' + sessionStorage.getItem('auth');
        addEventListener('hashchange', render); render();
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => {
    await browser.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  });

  const url = `http://127.0.0.1:${server.address().port}/#/home`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const originalPage = page;
  const originalContext = page.context();
  const firstDocument = await page.evaluate(() => window.documentInstance);
  await page.locator('#search').fill('case 1 state');
  await page.evaluate(() => { sessionStorage.setItem('restore-scroll', 'yes'); window.scrollTo(0, 1400); });
  await page.evaluate(() => { document.querySelector('#state').textContent = 'dirty transient app state'; });

  await resetPersistentCaseBaseline(page, url);

  assert.equal(page, originalPage, 'the managed Page object must be reused');
  assert.equal(page.context(), originalContext, 'the authenticated BrowserContext must be reused');
  assert.equal(await page.locator('#search').inputValue(), '', 'form values from the previous case must not leak');
  assert.notEqual(await page.evaluate(() => window.documentInstance), firstDocument, 'the SPA document instance must be recreated');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('auth')), 'already-authenticated', 'sessionStorage auth must survive baseline reset');
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'late application/browser scroll restoration from the previous case must not leak into the fresh baseline');
  assert.equal(await page.locator('#state').textContent(), '#/home:already-authenticated');
  assert.equal(documentLoads, 2, 'one same-tab reload should establish the second clean baseline');
});
