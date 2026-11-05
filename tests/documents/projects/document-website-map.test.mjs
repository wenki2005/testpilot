import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createDocumentPageExplorationAdapter } from '../../../src/adapters/documents/evidence/page-evidence.ts';
import { createDocumentWebsiteMapService } from '../../../src/application/projects/document-website-map-service.ts';
import { safeDiscoveryRoute, isDiscoveryNavigationLabel } from '../../../src/domain/documents/projects/website-map.ts';

test('navigation scope allows observed detail queries and rejects credentials, off-origin and effectful routes', () => {
  const base = 'https://example.test/app/#/home';
  assert.equal(safeDiscoveryRoute('/app/#/detail/123?r=true', base), '/app/#/detail/123?r=true');
  for (const route of ['https://other.test/', '//other.test/', '/app/#/detail?token=secret', '/app/?password=a', '/app/#/delete/1', 'javascript:alert(1)']) assert.equal(safeDiscoveryRoute(route, base), undefined, route);
  assert.equal(isDiscoveryNavigationLabel('历史申请记录'), true);
  for (const label of ['提交申请', '确认查看', '删除订单', '订单导出', '重新锁单', '查看并发送']) assert.equal(isDiscoveryNavigationLabel(label), false, label);
});

test('product explores observed SPA menus, detail, and return paths without writes; stale indexes rejected', { timeout: 60000 }, async t => {
  let writes = 0; let released = 0;
  const server = createServer((req, res) => {
    if (req.method === 'POST') writes++;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/empty') { res.end('<title>Shell only</title>'); return; }
    res.end(`<style>li,div.nav{cursor:pointer}</style><script>
      function render(){const r=location.hash; document.body.innerHTML='<nav><li data-go="home">首页</li><li data-go="list">历史申请记录</li></nav>'+(r==='#list'?'<h1>历史申请记录</h1><div class="nav" data-go="detail/42?r=true">查看详情</div>':r.includes('detail')?'<h1>申请详情</h1><button data-go="list">返回列表</button>':'<h1>小额样书申请</h1><button id="submit">提交申请</button>');}
      document.onclick=e=>{const go=e.target.closest('[data-go]');if(go)location.hash=go.dataset.go;if(e.target.id==='submit')fetch('/write',{method:'POST'});};
      onhashchange=render;onload=render;
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/#/home`;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext(); const persistent = await context.newPage(); await persistent.goto(url);
  const exploration = createDocumentPageExplorationAdapter({ acquirePageLease: () => () => released++, launchPersistentTestPage: async () => ({ page: persistent }), promotePersistentTestPage: async () => {}, navigatePersistentPage: (page, url) => page.goto(url), isLoginPage: async () => false, unsupportedClientGateMessage: () => undefined, profileDirectory: id => id });
  const session = await exploration.open({ id: 'local', targetUrl: url });
  const first = await session.navigationSnapshot();
  assert.ok(first.targets.some(t => t.label === '历史申请记录')); assert.ok(!first.targets.some(t => t.label === '提交申请'));
  const list = await session.activateNavigation(first.evidenceId, first.targets.findIndex(t => t.label === '历史申请记录'));
  assert.match(list.route, /#list$/u);
  await assert.rejects(session.activateNavigation(first.evidenceId, 0), /过期/u);
  const detail = await session.activateNavigation(list.evidenceId, list.targets.findIndex(t => t.label === '查看详情'));
  assert.match(detail.route, /detail\/42\?r=true$/u);
  const back = await session.activateNavigation(detail.evidenceId, detail.targets.findIndex(t => t.label === '返回列表'));
  assert.match(back.route, /#list$/u);
  await session.close(); assert.equal(released, 1); assert.equal(writes, 0); assert.match(persistent.url(), /#\/home$/u);
  const empty = await exploration.open({ id: 'local-empty', targetUrl: new URL('/empty', url).href });
  await assert.rejects(empty.navigationSnapshot(), /空白页面/u);
  await empty.close();
  // Test actual traversal and persisted graph using product session, deterministic index decisions for reproducibility.
  let saved;
  const repository = { save: async map => { saved = structuredClone(map); }, get: async () => saved, latest: async () => saved };
  const project = { id: 'local', targetUrl: url };
  let choices = 0;
  const service = createDocumentWebsiteMapService({ getProject: async () => project, exploration, decisions: { decide: async () => ++choices % 2 ? ({ decision: 'follow-link', index: 0 }) : ({ decision: 'stop', reason: 'Model incorrectly thinks the site is covered' }) }, repository, createId: randomUUID, now: () => new Date().toISOString() });
  await service.start('local');
  for (let i = 0; i < 800 && saved.state === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(saved.state, 'completed', JSON.stringify(saved.notices));
  assert.ok(saved.decisionTrace.some(d => d.decision === 'stop'), 'a premature model stop does not discard observed safe branches');
  assert.equal(new Set(saved.pages.map(p => p.snapshot.headings.join('|'))).size, 3, 'all three functional pages discovered, including a home-route alias');
  assert.ok(saved.pages.find(p => p.snapshot.route.includes('detail')).path.length >= 2);
  assert.equal(writes, 0);
  const detailPage = saved.pages.find(p => p.snapshot.route.includes('detail'));
  const replay = await service.verifyPage('local', detailPage.id);
  assert.equal(replay.status, 'verified'); assert.equal(replay.snapshot.route, detailPage.snapshot.route);
  assert.equal(saved.verifications.at(-1).pageId, detailPage.id);
  const found = await service.evidenceForCase(project, { source: '历史申请记录', title: '空状态' });
  assert.match(found.route, /#list$/u);
  assert.equal(await service.evidenceForCase({ ...project, targetUrl: url + 'changed' }, { source: '历史申请记录', title: '空状态' }), undefined);
});

test('exploration can load explicitly approved read APIs while POST and off-origin navigation remain blocked', { timeout: 15000 }, async t => {
  let reads = 0; let writes = 0;
  const api = createServer((req, res) => { if (req.method === 'POST') writes++; else reads++; res.setHeader('access-control-allow-origin', '*'); res.end('业务列表'); });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => api.close(resolve)));
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<title>Bootstrap</title><script>fetch('${apiOrigin}/list').then(r=>r.text()).then(text=>document.body.innerHTML='<h1>'+text+'</h1>');fetch('${apiOrigin}/list',{method:'POST'}).catch(()=>{});</script><body></body>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close()); const context = await browser.newContext(); const page = await context.newPage();
  const adapter = createDocumentPageExplorationAdapter({ acquirePageLease: () => () => {}, launchPersistentTestPage: async () => ({ page }), promotePersistentTestPage: async () => {}, navigatePersistentPage: (page, url) => page.goto(url), isLoginPage: async () => false, unsupportedClientGateMessage: () => undefined, profileDirectory: id => id,
    allowReadRequest: (method, url, type) => /^(GET|HEAD)$/u.test(method) && (new URL(url).origin === origin || url === apiOrigin + '/list' && type === 'fetch'),
  });
  const session = await adapter.open({ id: 'read-api', targetUrl: origin });
  const snapshot = await session.navigationSnapshot(); assert.ok(snapshot.headings.includes('业务列表')); assert.equal(reads, 1); assert.equal(writes, 0); await session.close();
});

test('interrupted and blocked exploration retains evidence and releases the session', async () => {
  let saved; let closed = false;
  const repository = { save: async map => { saved = structuredClone(map); }, get: async () => saved, latest: async () => saved };
  const snapshot = { evidenceId: randomUUID(), route: '/home', title: 'Home', headings: ['Home'], visibleText: ['Home'], controls: [], targets: [{ label: '历史申请记录', kind: 'control', occurrence: 0 }] };
  const service = createDocumentWebsiteMapService({ getProject: async () => ({ id: 'p', targetUrl: 'https://example.test/' }), repository,
    exploration: { open: async () => ({ navigationSnapshot: async () => snapshot, activateNavigation: async () => { throw Error('登录过期'); }, resetNavigation: async () => snapshot, close: async () => { closed = true; } }) },
    decisions: { decide: async () => ({ decision: 'follow-link', index: 0 }) }, createId: randomUUID, now: () => new Date().toISOString() });
  await service.start('p');
  for (let i = 0; i < 20 && saved.state === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(saved.state, 'partial'); assert.equal(saved.pages.length, 1); assert.equal(saved.edges[0].status, 'blocked'); assert.equal(closed, true);
});

test('late-loaded navigation entries are refreshed by identity rather than replaying a stale model index',async()=>{
  let saved,route='/home',loaded=false;
  const chosen=[];
  const target=label=>({label,kind:'control',occurrence:0});
  const capture=()=>({evidenceId:randomUUID(),route,title:'fixture',headings:[route],visibleText:[route],controls:[],targets:route==='/home'?(loaded?[target('订单物流'),target('历史申请记录')]:[target('历史申请记录')]):[]});
  const service=createDocumentWebsiteMapService({getProject:async()=>({id:'p',targetUrl:'https://example.test/'}),repository:{save:async map=>{saved=structuredClone(map);},latest:async()=>saved},
    exploration:{open:async()=>({navigationSnapshot:async()=>capture(),activateNavigation:async(_id,index)=>{const entry=capture().targets[index];chosen.push(entry.label);route=entry.label==='历史申请记录'?'/history':'/orders';return capture();},restoreNavigation:async()=>{route='/home';return capture();},resetNavigation:async()=>{route='/home';return capture();},close:async()=>{}})},
    decisions:{decide:async()=>{loaded=true;return {decision:'follow-link',index:0};}},createId:randomUUID,now:()=>new Date().toISOString()});
  await service.start('p');for(let i=0;i<50&&saved.state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(saved.state,'completed',JSON.stringify(saved.notices));assert.deepEqual(chosen,['历史申请记录','订单物流']);assert.equal(saved.pages.length,3);
});
