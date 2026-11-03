import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentPageEvidenceAdapter, createDocumentPageExplorationAdapter, captureCurrentPageEvidence, draftEvidenceBoundUiCheck } from "../src/adapters/document-page-evidence.ts";
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';

test("page evidence reuses the supplied page and returns a bounded frame snapshot", async () => {
  const calls = [];
  const page = {
    frames: () => [
      { evaluate: async () => ({ title: "Sample", route: "/items", headings: ["Items"], controls: [{ tag: "input", name: "名称" }], links: ["返回"], visibleText: ["列表"] }) },
      { evaluate: async () => ({ title: "Sample", route: "/items", headings: ["Items"], controls: [], links: ["返回"], visibleText: ["列表"] }) },
    ],
    waitForTimeout: async ms => calls.push(["wait", ms]),
    locator: () => ({ innerText: async () => "" }),
  };
  const adapter = createDocumentPageEvidenceAdapter({
    acquirePageLease: () => { throw new Error("existing page must not acquire a lease"); },
    launchPersistentTestPage: async () => { throw new Error("existing page must not launch another session"); },
    navigatePersistentPage: async (_page, url) => calls.push(["navigate", url]),
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => `profile/${id}`,
  });
  const evidence = JSON.parse(await adapter.collect({ id: "project-1", targetUrl: "https://example.test/items" }, page));
  assert.deepEqual(calls, [["navigate", "https://example.test/items"], ["wait", 300]]);
  assert.deepEqual(evidence.headings, ["Items"]);
  assert.deepEqual(evidence.controls, [{ tag: "input", name: "名称" }]);
  assert.deepEqual(evidence.links, ["返回"]);
});

test("page evidence refuses to open a session when the shared page lease is occupied", async () => {
  let launched = false;
  const adapter = createDocumentPageEvidenceAdapter({
    acquirePageLease: () => undefined,
    launchPersistentTestPage: async () => { launched = true; throw new Error("must not launch"); },
    navigatePersistentPage: async () => undefined,
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => `profile/${id}`,
  });
  await assert.rejects(adapter.collect({ id: "project-1", targetUrl: "https://example.test" }), /共享浏览器页面/u);
  assert.equal(launched, false);
});

test("page evidence opens the browser selected by the project execution config", async () => {
  const calls = [];
  const page = {
    frames: () => [{ evaluate: async () => ({ title: "Sample", route: "/items", headings: ["Items"], controls: [], links: [], visibleText: ["列表"] }) }],
    waitForTimeout: async () => undefined,
    locator: () => ({ innerText: async () => "列表" }),
  };
  const adapter = createDocumentPageEvidenceAdapter({
    acquirePageLease: () => () => undefined,
    launchPersistentTestPage: async (profileDir, options) => { calls.push([profileDir, options]); return { page }; },
    navigatePersistentPage: async (_page, url) => calls.push(["navigate", url]),
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => `profile/${id}`,
  });
  await adapter.collect({ id: "project-1", targetUrl: "https://example.test/items", executionConfig: { browser: "chromium" } });
  assert.deepEqual(calls, [["profile/project-1", { browser: "chromium" }], ["navigate", "https://example.test/items"]]);
});

test("evidence-bound assertions require unique, source-grounded targets", () => {
  const page = JSON.stringify({ controls: [{ tag: "input", name: "申请人" }, { tag: "input", name: "申请人" }], visibleText: ["保存成功"] });
  assert.equal(draftEvidenceBoundUiCheck({ title: "申请人字段校验", expected: "申请人输入框应显示红色" }, page), undefined);
  assert.deepEqual(draftEvidenceBoundUiCheck({ title: "提示文案", expected: "显示“保存成功”" }, page), [{ action: "assertVisible", text: "保存成功" }]);
});

test('current page evidence is read-only, origin-bound, bounded, and marks pixels uninspected', async () => {
  const calls = [];
  const page = { isClosed: () => false, url: () => 'https://example.test/items?q=ok', title: async () => 'Items', locator: selector => ({ innerText: async options => { calls.push([selector, options]); return '列表已打开\n验证码: 123456\npassword=private\n' + '可见'.repeat(8000); } }) };
  const evidence = await captureCurrentPageEvidence(page, 'https://example.test/home');
  assert.deepEqual(calls, [['body', { timeout: 2000 }]]);
  assert.match(evidence.evidenceId, /^[0-9a-f-]{36}$/u);
  assert.equal(evidence.origin, 'https://example.test');
  assert.equal(evidence.imagePixelsInspected, false);
  assert.ok(evidence.visibleText.length <= 12_000);
  assert.doesNotMatch(evidence.visibleText, /123456|private/u);
});

test('current page evidence blocks closed pages and cross-origin pages without navigation', async () => {
  const page = { isClosed: () => false, url: () => 'https://other.test/', title: async () => '', locator: () => { throw new Error('must not read'); } };
  await assert.rejects(captureCurrentPageEvidence(page, 'https://example.test/'), /origin 不一致/u);
  await assert.rejects(captureCurrentPageEvidence({ ...page, isClosed: () => true }, 'https://example.test/'), /已关闭/u);
});

test('exploration session installs read-only guards before first navigation and restores WebSocket proxying after close', { timeout: 30_000 }, async t => {
  let writes = 0, externalHits = 0, swScriptHits = 0, releases = 0, leases = 0, wsConnections = 0, wsWrites = 0, wsRoutes = 0, wsHandlerCalls = 0;
  const externalServer = createServer((_req, res) => { externalHits++; res.end('external'); });
  await new Promise(resolve => externalServer.listen(0, '127.0.0.1', resolve));
  const externalAddress = externalServer.address(); const externalOrigin = `http://127.0.0.1:${externalAddress.port}`;
  const server = createServer((req, res) => {
    if (req.url === '/write') writes++;
    if (req.url === '/sw.js') { swScriptHits++; res.setHeader('content-type', 'text/javascript'); res.end('self.skipWaiting();'); return; }
    if (req.url === '/') { res.end(`<script>fetch('/write',{method:'POST'}).catch(()=>{});navigator.serviceWorker?.register('/sw.js').catch(()=>{});</script><h1>Home</h1><a href="/customers">Customers</a><a href="${externalOrigin}/">External</a><a href="/customers?token=secret">Secret link</a><a href="/../outside">Traversal</a><button>Submit</button>`); return; }
    if (req.url === '/customers') { res.end('<h1>Customers</h1><a href="/details">Details</a><a href="/">Home</a>'); return; }
    if (req.url === '/details') { res.end('<h1>Customer details</h1>'); return; }
    res.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); const origin = `http://127.0.0.1:${address.port}`;
  const wsServer = new WebSocketServer({ noServer: true });
  wsServer.on('connection', ws => ws.on('message', message => { wsWrites++; ws.send(`ack:${message.toString()}`); }));
  server.on('upgrade', (request, socket, head) => wsServer.handleUpgrade(request, socket, head, ws => { wsConnections++; wsServer.emit('connection', ws, request); }));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await Promise.all([new Promise(resolve => server.close(resolve)),new Promise(resolve => externalServer.close(resolve))]); });
  const context = await browser.newContext();
  const page = await context.newPage();
  const explorationPages = [];
  page.context().on('page', opened => {
    if (opened === page) return;
    explorationPages.push(opened);
    const originalRouteWebSocket = opened.routeWebSocket.bind(opened);
    opened.routeWebSocket = (pattern, handler) => { wsRoutes++; return originalRouteWebSocket(pattern, socket => { wsHandlerCalls++; return handler(socket); }); };
  });
  const adapter = createDocumentPageExplorationAdapter({
    acquirePageLease: () => { leases++; return () => { releases++; }; },
    launchPersistentTestPage: async () => ({ page }),
    navigatePersistentPage: async (target, url) => { await target.goto(url, { waitUntil: 'domcontentloaded' }); },
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => id,
  });
  const session = await adapter.open({ id: 'synthetic-project', targetUrl: `${origin}/` });
  let explorationPage = explorationPages.at(-1);
  assert.ok(explorationPage);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(writes, 0, 'the first page script must already be behind the POST guard');
  assert.equal(swScriptHits, 0, 'page bootstrap blocks Service Worker registration before its script request can escape the guard');
  const first = JSON.parse(await session.capture());
  assert.equal(leases, 1);
  assert.equal(first.route, '/');
  assert.deepEqual(first.links.map(item => item.href), ['/customers']);
  assert.equal(first.headings[0], 'Home');
  await assert.rejects(session.followLink('stale-evidence', 0), /过期/u);
  const second = JSON.parse(await session.followLink(first.evidenceId, 0));
  assert.equal(second.route, '/customers');
  assert.equal(second.headings[0], 'Customers');
  await assert.rejects(session.followLink(second.evidenceId, 99), /索引越界/u);
  const details = JSON.parse(await session.followLink(second.evidenceId, 0));
  assert.equal(details.route, '/details');
  await assert.rejects(session.followLink(second.evidenceId, 0), /过期/u);
  await assert.rejects(session.followLink(details.evidenceId, 0), /索引越界/u);
  await explorationPage.evaluate(async () => { try { await fetch('/write', { method: 'POST' }); } catch {} });
  assert.equal(writes, 0, 'network layer must block POST even from page JavaScript');
  await explorationPage.evaluate(async url => { try { await fetch(url); } catch {} }, `${externalOrigin}/`);
  assert.equal(externalHits, 0, 'network layer must block cross-origin GET requests');
  await explorationPage.evaluate(url => new Promise(resolve => { const socket = new WebSocket(url); socket.onclose = resolve; socket.onerror = resolve; setTimeout(resolve, 250); }), `ws://127.0.0.1:${address.port}/socket`);
  assert.equal(wsConnections, 0, 'active exploration must block WebSocket upgrades');
  await session.close(); await session.close();
  assert.equal(releases, 1);
  assert.equal(explorationPage.isClosed(), true, 'the routed exploration page is discarded so its non-removable WS route cannot affect later runs');
  const firstExplorationPage = explorationPage;
  assert.equal(wsConnections, 0, 'active exploration WebSockets were never opened to the target server');
  assert.equal(wsWrites, 0, 'active exploration WebSocket writes never reach the server');
  await page.goto(`${origin}/details`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(async () => (await fetch('/write', { method: 'POST' })).ok), true, 'close removes only the exploration route guard');
  assert.equal(writes, 1, 'the unrelated persistent page can perform its regular operation');
  const retry = await adapter.open({ id: 'synthetic-project', targetUrl: `${origin}/` });
  explorationPage = explorationPages.at(-1);
  assert.notEqual(explorationPage, firstExplorationPage, 'a retry receives a fresh Page with no inherited route or socket state');
  assert.equal(wsRoutes, 2, 'one WebSocket route is installed per disposable exploration page, with no route accumulation on the reusable page');
  await explorationPage.evaluate(url => new Promise(resolve => { const socket = new WebSocket(url); socket.onclose = resolve; socket.onerror = resolve; setTimeout(resolve, 250); }), `ws://127.0.0.1:${address.port}/socket`);
  assert.equal(wsConnections, 0, 'WebSockets remain blocked for the full active retry lease');
  await retry.close();
  const wsReply = await page.evaluate(url => new Promise(resolve => {
    const socket = new WebSocket(url);
    socket.onopen = () => socket.send('regular-operation');
    socket.onmessage = event => { resolve(event.data); socket.close(); };
    socket.onerror = () => resolve('error');
    setTimeout(() => resolve('timeout'), 1_000);
  }), `ws://127.0.0.1:${address.port}/socket`);
  assert.equal(wsReply, 'ack:regular-operation', `the next regular page operation transparently supports WebSocket traffic (connections=${wsConnections}, writes=${wsWrites}, handlerCalls=${wsHandlerCalls})`);
  assert.equal(wsConnections, 1);
  assert.equal(wsWrites, 1, 'only the post-exploration regular operation reaches the server');
  const dynamicPage = await browser.newPage();
  let dynamicActive = true;
  await dynamicPage.routeWebSocket('**/*', socket => {
    if (dynamicActive) { socket.onMessage(() => undefined); return; }
    socket.connectToServer();
  });
  await dynamicPage.goto(`${origin}/details`);
  await dynamicPage.evaluate(url => new Promise(resolve => { const socket = new WebSocket(url); socket.onopen = () => socket.send('blocked'); socket.onerror = resolve; setTimeout(resolve, 250); }), `ws://127.0.0.1:${address.port}/socket`);
  assert.equal(wsWrites, 1, 'standalone dynamic route also blocks messages while active');
  dynamicActive = false;
  const dynamicReply = await dynamicPage.evaluate(url => new Promise(resolve => { const socket = new WebSocket(url); socket.onopen = () => socket.send('after-toggle'); socket.onmessage = event => { resolve(event.data); socket.close(); }; socket.onerror = () => resolve('error'); setTimeout(() => resolve('timeout'), 1_000); }), `ws://127.0.0.1:${address.port}/socket`);
  assert.equal(dynamicReply, 'ack:after-toggle', 'Playwright supports dynamically switching one pre-navigation WS route to proxy mode');
  await new Promise(resolve => wsServer.close(resolve));
});

test('cross-origin login redirect is blocked and refreshed manual-auth retry clones storage into a guarded page', { timeout: 30_000 }, async t => {
  let loginPosts = 0, authHits = 0, authServiceWorkerScriptHits = 0, authenticated = false;
  const authServer = createServer((req, res) => {
    authHits++;
    if (req.method === 'POST') loginPosts++;
    if (req.url === '/sw.js') {
      authServiceWorkerScriptHits++;
      res.setHeader('content-type', 'text/javascript');
      res.end("self.skipWaiting();self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/sw-check')event.respondWith(new Response('handled-by-worker'))})");
      return;
    }
    if (req.url === '/sw-check') { res.end('network'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<form id="login"><input aria-label="User"><button>Sign in</button></form>');
  });
  await new Promise(resolve => authServer.listen(0, '127.0.0.1', resolve));
  const authAddress = authServer.address(); const authOrigin = 'http://127.0.0.1:' + authAddress.port;
  const targetServer = createServer((_req, res) => { if (authenticated) { res.end('<h1>Home</h1>'); return; } res.writeHead(302, { location: authOrigin + '/login' }); res.end(); });
  await new Promise(resolve => targetServer.listen(0, '127.0.0.1', resolve));
  const targetAddress = targetServer.address(); const targetOrigin = 'http://127.0.0.1:' + targetAddress.port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let promotedPage;
  let explorationPage;
  page.context().on('page', opened => { if (opened !== page) explorationPage = opened; });
  t.after(async () => {
    await browser.close();
    await Promise.all([new Promise(resolve => authServer.close(resolve)), new Promise(resolve => targetServer.close(resolve))]);
  });
  const adapter = createDocumentPageExplorationAdapter({
    acquirePageLease: () => () => undefined,
    launchPersistentTestPage: async () => ({ page }),
    promotePersistentTestPage: async (_profile, pageToPromote) => { promotedPage = pageToPromote; },
    navigatePersistentPage: async (target, url) => { await target.goto(url, { waitUntil: 'domcontentloaded' }); },
    isLoginPage: async current => new URL(current.url()).pathname === '/login',
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => id,
  });

  await assert.rejects(adapter.open({ id: 'synthetic-login-project', targetUrl: targetOrigin }), /刷新该专用页/u);
  assert.equal(authHits, 0, 'the first off-origin auth request is blocked by the guard');
  assert.ok(explorationPage, 'a dedicated page in the same browser context is retained for manual authentication');
  assert.equal(new URL(explorationPage.url()).origin, targetOrigin, 'the blocked target remains available in the same browser window for manual retry');
  await explorationPage.evaluate(() => sessionStorage.setItem('synthetic-auth-marker', 'manual-auth-fixture'));
  assert.equal(await explorationPage.evaluate(() => navigator.serviceWorker === undefined), true, 'read-only exploration hides Service Worker APIs in the current document');
  await explorationPage.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(new URL(explorationPage.url()).origin, authOrigin, 'refresh lets the user follow the login redirect after guards are removed');
  assert.equal(await explorationPage.evaluate(() => navigator.serviceWorker !== undefined && !('__testpilotServiceWorkerRegistrationBlocked' in window)), true, 'the refreshed handoff document restores the native Service Worker API');
  assert.equal(await explorationPage.locator('#login').isVisible(), true);
  const serviceWorkerResult = await explorationPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    const body = await (await fetch('/sw-check')).text();
    await registration.unregister();
    return body;
  });
  assert.equal(serviceWorkerResult, 'handled-by-worker', 'manual handoff resets page-scoped Network.setBypassServiceWorker');
  assert.equal(authServiceWorkerScriptHits, 1);
  assert.equal(await explorationPage.evaluate(async () => (await fetch('/login', { method: 'POST' })).ok), true, 'the user can complete a login interaction after TestPilot reports the handoff');
  assert.equal(loginPosts, 1);
  authenticated = true;
  await explorationPage.goto(targetOrigin + '/', { waitUntil: 'domcontentloaded' });
  const handoffPage = explorationPage;
  const retry = await adapter.open({ id: 'synthetic-login-project', targetUrl: targetOrigin });
  assert.equal(handoffPage.isClosed(), true, 'the authenticated handoff tab is discarded only after a fresh guarded child exists');
  const retryPage = explorationPage;
  assert.notEqual(retryPage, handoffPage);
  assert.equal(await retryPage.evaluate(() => window.opener === null), true, 'the authentication retry child cannot reach the handoff page');
  assert.equal(await retryPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'manual-auth-fixture', 'manual-auth sessionStorage is copied by the browser on same-origin retry');
  assert.equal((await retry.capture()).includes('Home'), true);
  await retry.promoteSession();
  await retry.close();
  assert.ok(promotedPage && !promotedPage.isClosed());
  assert.equal(await promotedPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'manual-auth-fixture');
});

test('exploration fails closed when a target-origin Service Worker is already registered', { timeout: 30_000 }, async t => {
  let targetRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end("self.skipWaiting();self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));");
      return;
    }
    if (req.url === '/seed') { res.end('<h1>seed</h1>'); return; }
    if (req.url === '/target') targetRequests++;
    res.end('<h1>target</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  await page.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.length > 0)), true);
  const adapter = createDocumentPageExplorationAdapter({
    acquirePageLease: () => () => {},
    launchPersistentTestPage: async () => ({ page }),
    promotePersistentTestPage: async () => {},
    navigatePersistentPage: async (target, url) => { await target.goto(url, { waitUntil: 'domcontentloaded' }); },
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => id,
  });
  await assert.rejects(adapter.open({ id: 'synthetic-sw-project', targetUrl: `${origin}/target` }), /Service Worker/u);
  assert.equal(targetRequests, 0, 'the target is not requested after an uncontrolled origin worker is discovered');
  assert.equal(context.pages().length, 1, 'the browser page is left available for the user after the fail-closed result');
});

test('exploration does not depend on a site popup that closes or disowns its browser target', { timeout:30000 }, async t => {
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<h1>申请首页</h1>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext(),persistent=await context.newPage(),url=`http://127.0.0.1:${server.address().port}/`;
  await persistent.goto(url);await persistent.evaluate(()=>{sessionStorage.setItem('fixture-auth','local-only');window.open=()=>{throw Error('Simulated destroyed popup target');};});
  const adapter=createDocumentPageExplorationAdapter({acquirePageLease:()=>()=>{},launchPersistentTestPage:async()=>({page:persistent}),promotePersistentTestPage:async()=>{},navigatePersistentPage:(page,target)=>page.goto(target),isLoginPage:async()=>false,unsupportedClientGateMessage:()=>undefined,profileDirectory:id=>id});
  for(let index=0;index<3;index++) {
    const session=await adapter.open({id:'popup-independent',targetUrl:url});
    assert.deepEqual((await session.navigationSnapshot()).headings,['申请首页']);
    const exploration=context.pages().find(page=>page!==persistent);
    assert.equal(await exploration.evaluate(()=>sessionStorage.getItem('fixture-auth')),'local-only');
    await session.close();assert.equal(persistent.isClosed(),false);assert.equal(context.pages().length,1);
  }
});

test('an in-flight route already settled during page close cannot reject out of the exploration event handler', {timeout:30000},async t=>{
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<h1>Fixture</h1>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext(),page=await context.newPage(),url=`http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);const handlers=[];
  context.on('page',child=>{const route=child.route.bind(child);child.route=async(pattern,handler)=>{handlers.push(handler);return route(pattern,handler);};});
  const adapter=createDocumentPageExplorationAdapter({acquirePageLease:()=>()=>{},launchPersistentTestPage:async()=>({page}),promotePersistentTestPage:async()=>{},navigatePersistentPage:(p,target)=>p.goto(target),isLoginPage:async()=>false,unsupportedClientGateMessage:()=>undefined,profileDirectory:id=>id});
  const session=await adapter.open({id:'route-close-race',targetUrl:url});
  assert.ok(handlers.length>=2,'both the inert bridge and active exploration use guarded HTTP handlers');
  const route={request:()=>({url:()=>url,method:()=> 'GET',resourceType:()=> 'document',isNavigationRequest:()=>false}),fetch:async()=>{throw Error('Target page has been closed');},abort:async()=>{throw Error('Route is already handled!');}};
  for(const handler of handlers)await assert.doesNotReject(()=>handler(route));
  await session.close();assert.equal(page.isClosed(),false);
});

test('browser-internal bridge transfers sessionStorage and promotes a clean route-free page', { timeout: 30_000 }, async t => {
  let writes = 0, wsConnections = 0, wsWrites = 0;
  const server = createServer((req, res) => {
    if (req.url === '/write') writes++;
    if (req.url === '/seed') { res.end('<h1>Seed</h1>'); return; }
    res.end(`<script>fetch('/write',{method:'POST'}).catch(()=>{});try{const s=new WebSocket('ws://127.0.0.1:${server.address()?.port}/socket');s.onopen=()=>s.send('exploration-write');s.onmessage=()=>s.close()}catch{}</script><h1>Exploration home</h1>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); const origin = `http://127.0.0.1:${address.port}`;
  const wsServer = new WebSocketServer({ noServer: true });
  wsServer.on('connection', ws => ws.on('message', message => { wsWrites++; ws.send(`ack:${message.toString()}`); }));
  server.on('upgrade', (request, socket, head) => wsServer.handleUpgrade(request, socket, head, ws => { wsConnections++; wsServer.emit('connection', ws, request); }));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const persistentPage = await context.newPage();
  await persistentPage.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await persistentPage.evaluate(() => sessionStorage.setItem('synthetic-auth-marker', 'fixture-only-value'));
  const opened = [];
  context.on('page', page => { if (page !== persistentPage) opened.push(page); });
  let currentPersistentPage = persistentPage;
  let promotedPage;
  const adapter = createDocumentPageExplorationAdapter({
    acquirePageLease: () => () => {},
    launchPersistentTestPage: async () => ({ page: currentPersistentPage }),
    promotePersistentTestPage: async (_profile, pageToPromote) => {
      const oldPage = currentPersistentPage;
      currentPersistentPage = promotedPage = pageToPromote;
      if (oldPage !== pageToPromote && !oldPage.isClosed()) await oldPage.close({ runBeforeUnload: false });
    },
    navigatePersistentPage: async (page, url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); },
    isLoginPage: async () => false,
    unsupportedClientGateMessage: () => undefined,
    profileDirectory: id => id,
  });
  t.after(async () => { await browser.close(); await new Promise(resolve => wsServer.close(resolve)); await new Promise(resolve => server.close(resolve)); });

  const session = await adapter.open({ id: 'synthetic-storage-project', targetUrl: `${origin}/explore` });
  const explorationPage = opened.at(-1);
  assert.ok(explorationPage);
  assert.equal(persistentPage.url(), `${origin}/seed`, 'the existing project page is not navigated or changed');
  assert.equal(await explorationPage.evaluate(() => window.opener === null), true, 'the isolated exploration page cannot access the persistent opener');
  assert.equal(await explorationPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'fixture-only-value', 'the browser-internal bridge clones same-origin sessionStorage');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(writes, 0, 'the exploration document first request is guarded against POST');
  assert.equal(wsConnections, 0, 'the exploration document WebSocket is blocked before it reaches the server');
  await session.capture();
  assert.equal(await persistentPage.evaluate(() => location.pathname), '/seed', 'the existing persistent page stays at its original route during exploration');
  await session.promoteSession();
  await session.close();
  assert.equal(explorationPage.isClosed(), true, 'the guarded route-bearing page is discarded');
  assert.ok(promotedPage && !promotedPage.isClosed());
  assert.equal(new URL(promotedPage.url()).origin, origin);
  assert.match(new URL(promotedPage.url()).pathname, /^\/.testpilot-session-bridge-[0-9a-f-]{36}$/u, 'promoted page uses a random inert path so normal target navigation will not be mistaken for a reused document');
  assert.equal(await promotedPage.locator('body').innerText(), '', 'the promoted bridge contains no target application scripts or controls');
  assert.equal(await promotedPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'fixture-only-value', 'the promoted un-routed page retains the browser-internal session copy');
  assert.equal(wsConnections, 0, 'exploration WebSocket traffic never reaches the server');
  await promotedPage.goto(`${origin}/explore`, { waitUntil: 'domcontentloaded' });
  assert.equal(await promotedPage.locator('h1').innerText(), 'Exploration home', 'normal navigation to the original target URL loads the application instead of reusing the inert bridge');
  assert.equal(await promotedPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'fixture-only-value', 'normal target navigation keeps the promoted sessionStorage');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(wsConnections, 1, 'the promoted page has no exploration WS route and normal application WebSocket traffic reaches the server');
  assert.equal(wsWrites, 1);
  assert.equal(persistentPage.isClosed(), true, 'the old managed page is retired after successful promotion');
  assert.equal(writes, 1, 'only the later normal app navigation performs its synthetic POST');

  for (let attempt = 0; attempt < 3; attempt++) {
    const stalePage = currentPersistentPage;
    const repeated = await adapter.open({ id: 'synthetic-storage-project', targetUrl: `${origin}/explore` });
    const repeatedExploration = opened.at(-1);
    assert.equal(await repeatedExploration.evaluate(() => window.opener === null), true);
    assert.equal(await repeatedExploration.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'fixture-only-value');
    await repeated.capture();
    await repeated.promoteSession();
    await repeated.close();
    assert.equal(stalePage.isClosed(), true, 'repeated bridge promotion retires the previous persistent tab');
    assert.equal(await currentPersistentPage.evaluate(() => sessionStorage.getItem('synthetic-auth-marker')), 'fixture-only-value');
  }
});
