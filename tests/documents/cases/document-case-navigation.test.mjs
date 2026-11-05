import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentCaseNavigationAdapter} from '../../../src/adapters/ai/document-case-navigation.ts';
import {createDocumentWebsiteMapService} from '../../../src/application/projects/document-website-map-service.ts';
import {summarizeWebsiteMapVerification} from '../../../src/domain/documents/projects/website-map.ts';
import {sha256Hex} from '../../../src/domain/shared/sha256.ts';

const snapshot=(route,headings,visibleText=[])=>({evidenceId:route,capturedAt:'2026-11-03T00:00:00Z',route,title:'fixture',headings,visibleText,controls:[],targets:[]});
const page=(id,route,headings,text=[])=>({id,snapshot:snapshot(route,[...headings,'申请明细'],text),path:[],pathLabels:['申请明细']});
const check={id:'case-fixture',title:'申请明细回显',source:'员工端-申请表单明细展示页',expected:'商品和总额展示',preconditions:[],testData:[]};
const pages=[page('one','/detail/202611020158',['小额样书申请'],['申请编号202611020158','商品和总额']),page('two','/detail/202611030001',['小额样书申请'],['申请编号202611030001','商品和总额'])];

test('semantic page selection requires exact evidence from both the actual case and observed page',async()=>{
  let options;
  const adapter=createDocumentCaseNavigationAdapter({complete:async(_messages,opts)=>{options=opts;return {content:JSON.stringify({pageId:'two',reason:'已发现的申请明细包含商品和总额',caseQuote:'申请明细回显',pageQuote:'商品和总额'})};}});
  assert.equal((await adapter.select({check,pages})).pageId,'two');assert.equal(options.thinking.type,'disabled');
  for(const change of [{pageId:'invented'},{caseQuote:'not in case'},{pageQuote:'not on page'}]) {
    const invalid=createDocumentCaseNavigationAdapter({complete:async()=>({content:JSON.stringify({pageId:'two',reason:'reason',caseQuote:'申请明细回显',pageQuote:'商品和总额',...change})})});
    await assert.rejects(invalid.select({check,pages}),/逐字依据/u);
  }
  const absent=createDocumentCaseNavigationAdapter({complete:async()=>({content:JSON.stringify({pageId:null,reason:'订单为空，没有已观察到的订单详情。'})})});
  assert.equal((await absent.select({check,pages})).pageId,null);
});

test('one malformed model JSON gets a bounded correction before any page action',async()=>{
  let calls=0;
  const adapter=createDocumentCaseNavigationAdapter({complete:async messages=>{calls++;if(calls===1)return {content:'{"pageId":"two",}'};assert.match(messages.at(-1).content,/No page was navigated/u);return {content:JSON.stringify({pageId:'two',reason:'当前真实页面匹配',caseQuote:'申请明细回显',pageQuote:'商品和总额'})};}});
  assert.equal((await adapter.select({check,pages})).pageId,'two');assert.equal(calls,2);
  calls=0;const invalid=createDocumentCaseNavigationAdapter({complete:async()=>{calls++;return {content:'{broken'};}});
  await assert.rejects(invalid.select({check,pages}));assert.equal(calls,2);
});

test('evidence identifiers resolve to the exact supplied source text and unknown identifiers are rejected',async()=>{
  const select=refs=>createDocumentCaseNavigationAdapter({complete:async messages=>{
    const payload=JSON.parse(messages[1].content);assert.equal(payload.caseEvidence[0].id,'case-title');
    return {content:JSON.stringify({pageId:'two',reason:'申请明细页面匹配',caseEvidenceId:'case-title',pageEvidenceId:'path-0',...refs})};
  }});
  const value=await select({}).select({check,pages});assert.equal(value.caseQuote,check.title);assert.equal(value.pageQuote,'申请明细');
  await assert.rejects(select({pageEvidenceId:'invented'}).select({check,pages}),/逐字依据/u);
});

function fixture(selection=async()=>({pageId:'two',reason:'选择当前已有明细',caseQuote:'申请明细回显',pageQuote:'商品和总额'})) {
  let map={id:'map',projectId:'p',profileKey:'p',targetUrl:'https://example.test/',createdAt:'2026-11-03T00:00:00Z',updatedAt:'2026-11-03T00:00:00Z',state:'completed',pages:structuredClone(pages),edges:[],operations:0,notices:[]};
  let calls=0;
  const project={id:'p',targetUrl:map.targetUrl,cases:[check]};
  const deps={getProject:async()=>project,exploration:{open:async()=>({navigationSnapshot:async()=>map.pages[1].snapshot,activateNavigation:async()=>map.pages[1].snapshot,close:async()=>{}})},decisions:{},repository:{latest:async()=>structuredClone(map),save:async next=>{map=structuredClone(next);}},createId:()=>'',now:()=> '2026-11-03T01:00:00Z',caseNavigation:{select:async input=>{calls++;return selection(input);}}};
  return {service:createDocumentWebsiteMapService(deps),project,getMap:()=>map,getCalls:()=>calls,deps};
}

test('duplicate detail headings use a traceable model selection, cache it, and verify the saved path',async()=>{
  const f=fixture();const original=JSON.stringify(f.project.cases);
  const first=await f.service.evidenceForCase(f.project,check);assert.equal(first.pageId,'two');
  assert.equal((await f.service.evidenceForCase(f.project,check)).pageId,'two');assert.equal(f.getCalls(),1);
  assert.equal(f.getMap().caseBindings[0].caseId,'case-fixture');
  assert.equal((await f.service.resolveCase('p','case-fixture')).status,'verified');
  assert.equal(JSON.stringify(f.project.cases),original,'navigation selection does not alter case expectations or readiness');
  assert.equal((await f.service.latest('p')).runtimeVerification.verified,1);
});

test('an explicit application ID limits candidates and unavailable records never fall back to a different record',async()=>{
  const f=fixture(async input=>{assert.deepEqual(input.pages.map(p=>p.id),['one']);return {pageId:'one',reason:'指定编号匹配'};});
  assert.equal((await f.service.evidenceForCase(f.project,{...check,testData:['申请编号202611020158']})).pageId,'one');
  assert.equal(await f.service.evidenceForCase(f.project,{...check,testData:['申请编号202699999999']}),undefined);
  assert.equal(f.getCalls(),0,'the explicit record makes the observed heading unique without a model call');assert.match(f.getMap().caseBindings.at(-1).reason,/没有指定申请记录/u);
});

test('explicit missing routes, another account, and model-invented pages never become navigation evidence',async()=>{
  const f=fixture();assert.equal(await f.service.evidenceForCase(f.project,{...check,entryPath:'/missing'}),undefined);assert.equal(f.getCalls(),0);
  assert.equal(await f.service.evidenceForCase({...f.project,activeSessionProfileId:'other',sessionProfiles:[{id:'other'}]},check),undefined);
  const invalid=fixture(async()=>({pageId:'outside',reason:'invented'}));await assert.rejects(invalid.service.evidenceForCase(invalid.project,check),/地图之外/u);
});

test('a unique heading cannot override an explicit application identity',async()=>{
  const f=fixture();const map=f.getMap();map.pages[0].snapshot.headings=['唯一审批详情'];map.pages[1].snapshot.headings=['另一个审批详情'];
  const item={...check,source:'唯一审批详情',testData:['申请编号202611030001']};
  assert.equal((await f.service.evidenceForCase(f.project,item)).pageId,'two');
});

test('application pages and stale cached selections cannot replace an order list or an unavailable order detail',async()=>{
  const f=fixture(async input=>{assert.deepEqual(input.pages.map(p=>p.id),['orders']);return {pageId:'orders',reason:'这是实际订单列表，当前为空。'};});
  f.getMap().pages.push({id:'orders',snapshot:snapshot('/orders',['订单物流'],['暂无订单物流记录']),path:[]});
  const order={...check,id:'order',title:'展示订单列表',source:'requirements › 员工端-订单列表页',expected:'展示订单号',testData:[]};
  const caseDigest=sha256Hex(JSON.stringify([order.title,order.source,order.expected,order.preconditions,order.testData]));
  f.getMap().caseBindings=[{caseId:'order',caseDigest,pageId:'two',reason:'old wrong application page',createdAt:'2026-11-03T00:00:00Z'}];
  assert.equal((await f.service.evidenceForCase(f.project,order)).pageId,'orders');
  const detail={...order,id:'detail',title:'展示对应订单详情',source:'requirements › 员工端-订单列表页'};
  assert.equal(await f.service.evidenceForCase(f.project,detail),undefined);assert.equal(f.getCalls(),1);
  assert.match(f.getMap().caseBindings.at(-1).reason,/不能用其它模块/u);
});

test('an unresolved page selection is retained rather than guessed or treated as a passed case',async()=>{
  const f=fixture(async()=>({pageId:null,reason:'当前订单列表为空，不能验证订单详情。'}));
  const result=await f.service.resolveCase('p','case-fixture');assert.equal(result.status,'unresolved');assert.match(result.reason,/为空/u);
  assert.equal(f.getMap().verifications,undefined);assert.equal(f.project.cases[0].entryPath,undefined);
});

test('current-service verification cannot inherit a historical completed or verified status',()=>{
  const map={pages:[{id:'a'},{id:'b'}],verifications:[{pageId:'a',status:'verified',checkedAt:'2026-11-03T00:00:00Z'},{pageId:'b',status:'verified',checkedAt:'2026-11-03T00:00:00Z'}]};
  const since='2026-11-03T01:00:00Z';assert.equal(summarizeWebsiteMapVerification(map,since).state,'unverified');
  map.verifications.push({pageId:'a',status:'verified',checkedAt:since});assert.equal(summarizeWebsiteMapVerification(map,since).state,'partial');
  map.verifications.push({pageId:'b',status:'verified',checkedAt:since});assert.equal(summarizeWebsiteMapVerification(map,since).state,'ready');
  map.verifications.push({pageId:'a',status:'blocked',checkedAt:since});assert.equal(summarizeWebsiteMapVerification(map,since).state,'blocked');
});

test('concurrent path replay and discovery cannot corrupt the active verification',async()=>{
  const f=fixture();let release;const wait=new Promise(resolve=>{release=resolve;});
  f.deps.exploration.open=async()=>{await wait;return {navigationSnapshot:async()=>pages[1].snapshot,activateNavigation:async()=>pages[1].snapshot,close:async()=>{}};};
  const pending=f.service.verifyPage('p','two');await new Promise(resolve=>setTimeout(resolve,0));
  await assert.rejects(f.service.verifyPage('p','one'),/尚未结束/u);await assert.rejects(f.service.start('p'),/复验中/u);
  release();assert.equal((await pending).status,'verified');assert.equal(f.getMap().verifications.length,1);
});

test('a page cleanup failure is recorded as blocked rather than publishing a reusable verified path',async()=>{
  const f=fixture();f.deps.exploration.open=async()=>({navigationSnapshot:async()=>pages[1].snapshot,activateNavigation:async()=>pages[1].snapshot,close:async()=>{throw Error('cleanup fixture failure');}});
  await assert.rejects(f.service.verifyPage('p','two'),/cleanup fixture failure/u);
  assert.equal(f.getMap().verifications.at(-1).status,'blocked');assert.equal((await f.service.latest('p')).runtimeVerification.state,'blocked');
});
