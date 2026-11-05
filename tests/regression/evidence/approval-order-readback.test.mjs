import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{approvedChainKind,approvedChainGap}from'../../../dist/adapters/regression/evidence/approval-order-readback.js';
import{connectedEvidenceKind}from'../../../dist/adapters/regression/evidence/connected-evidence-contract.js';
import{chromium}from'playwright';import{verifyApprovedChainEvidence}from'../../../dist/adapters/regression/evidence/approval-order-readback.js';
test('approved event review is bound to fourteen immutable source/expected pairs',()=>{
 const cases=JSON.parse(readFileSync(new URL('../../fixtures/dify-approved-chain-cases.json',import.meta.url))),ids=[7,62,63,64,66,67,68,69,70,72,86,122,124,126];
 for(const id of ids){const c=cases.find(c=>c.id==='xmind-'+id),before=structuredClone(c);assert.ok(approvedChainKind(c),c.id);assert.equal(connectedEvidenceKind(c),approvedChainKind(c));assert.equal(approvedChainKind({...c,source:'unrelated'}),undefined);assert.equal(approvedChainKind({...c,expected:c.expected+' altered'}),undefined);assert.deepEqual(c,before);}
 assert.equal(cases.filter(c=>approvedChainKind(c)).length,ids.length);
});
test('delayed order response and render are awaited; two owned orders and GET-only evidence stay blocked for missing downstream event',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();const methods=[],dbReads=[],ids=['202611040066','202611040067'],base='https://testapi.yibentushu.com/supply-api/';
 await page.addInitScript(()=>localStorage.setItem('sample-apply-token','synthetic-token'));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());methods.push(route.request().method());if(u.origin==='https://testapi.yibentushu.com'){
  let b={code:200};if(u.pathname.endsWith('/getInfo'))b.user={userId:7};else if(u.pathname.endsWith('/myList')){b.total=2;b.rows=ids.map(id=>({orderId:'0005BM'+id}));}else if(u.pathname.includes('/order/detail/')){await new Promise(r=>setTimeout(r,180));const id=u.pathname.split('/').at(-1);b.data={orderId:id,applyNo:id.slice(-12),createTime:new Date().toISOString(),logisticsNo:null,traceList:[],goodsList:[{goodsSn:'B1',buyNum:3,unitPrice:22.8}]};}else{const id=u.pathname.split('/').at(-1);b.data={applyNo:id,examineStatus:1,lockStatus:1};}
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
 }return route.fulfill({contentType:'text/html;charset=utf-8',body:`<main class="pc-page-logistics-detail"></main><script>if(location.hash.startsWith('#/logistics-detail/'))fetch('${base}h5/dept/book/order/detail/'+location.hash.split('/').at(-1)).then(r=>r.json()).then(b=>setTimeout(()=>document.querySelector('main').textContent=b.data.orderId,180));</script>`});});
 const db={snapshot:async(no,uid)=>{dbReads.push([no,uid]);return{order_id:'0005BM'+no,examine_status:1,lock_status:1};},goods:async()=>[{product_id:'B1',qty:3,price:22.8}]};
 const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';await page.goto(target);const result={status:'passed',detail:''};await verifyApprovedChainEvidence(page,'approved-stock-readback',result,target,db);assert.equal(result.status,'blocked');assert.match(result.detail,/复用2笔本人真实已审批/);assert.equal(dbReads.length,2);assert.ok(dbReads.every(([,uid])=>uid==='7'));assert.ok(methods.every(m=>m==='GET'));
});
test('missing event evidence remains specific blocked detail, never a no-order claim',()=>{
 const observation={count:2,tracking:0,trace:0,youngestHours:2};
 for(const k of ['approved-stock-readback','approved-outbound-readback','approved-tracking-readback','approved-hidden-outbound','approved-no-wms','approved-timeout','approved-priority','approved-sync','approved-teacher-tracking']){const d=approvedChainGap(k,observation);assert.match(d,/真实已审批/);assert.match(d,/原预期保留阻塞/);assert.match(d,/不再归为本人无申请或无订单/);}
 assert.match(approvedChainGap('approved-stock-readback',observation),/前缀不替代/);
 assert.match(approvedChainGap('approved-sync',observation),/浏览器重查.*不能证明/);
 assert.match(approvedChainGap('approved-timeout',observation),/2.0小时/);
});
