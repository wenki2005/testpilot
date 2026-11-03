import test from'node:test';
import assert from'node:assert/strict';
import{chromium}from'playwright';
import{connectedEvidenceKind}from'../dist/adapters/dify-connected-contract.js';
import{reviewConnectedEvidence,verifyConnectedEvidence}from'../dist/adapters/dify-connected-scenarios.js';
import{isSafeReadOnlyBrowserCase}from'../dist/adapters/document-test-workflow.js';
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const login={id:'xmind-1',title:'登录字段',expected:'在企微架构内的在职员工：直接授权登录，进入申请表单页，自动带出姓名/所属公司/部门',source:'企微工作台入口 › 身份校验',steps:[],preconditions:[],confidence:'medium'};
const owner={...login,id:'xmind-57',title:'本人明细',expected:'仅申请发起人本人可见并可进入「查看明细」入口',source:'员工端-用书审批详情页 › 查看申请明细'};
test('login and owner scripts are exact-source bound and retain mutating-action guards',()=>{
 const evidence=JSON.stringify({navigation:['历史申请记录'],controls:[{placeholder:'请输入收件人姓名'}]});
 for(const c of[login,owner]){const review=reviewConnectedEvidence(c,evidence,target);assert.ok(review);assert.ok(connectedEvidenceKind(c));assert.equal(isSafeReadOnlyBrowserCase({...c,steps:review.steps,preconditionsConfirmed:true}),true);assert.equal(connectedEvidenceKind({...c,source:'其他系统'}),undefined);assert.equal(isSafeReadOnlyBrowserCase({...c,steps:[{action:'clickExactText',text:'提交申请'}]}),false);}
});
test('logged-in home checks actual automatic fields; missing fields fail and incomplete authorization remains blocked',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let mode='missing';
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://testapi.yibentushu.com')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:200,user:{userId:1,nickName:'合成姓名',dept:{deptName:'合成部门'}}})});return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><main class="pc-page-home"><ul class="header-nav"><li class="active">本人申领</li></ul>${mode==='missing'?'申请表单':'合成姓名 合成部门'}</main><script>fetch('https://testapi.yibentushu.com/supply-api/getInfo')</script>`});});
 for(const[m,status]of[['missing','failed'],['present','blocked']]){mode=m;await page.goto(target);const r={status:'passed',detail:''};await verifyConnectedEvidence(page,login,r,target,async png=>{assert.equal(png.subarray(0,4).toString('hex'),'89504e47');return'current.png';});assert.equal(r.status,status,r.detail);assert.ok(r.evidence);}
});
test('top-level department used by the deployed store establishes a valid field baseline',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let show=false;
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://testapi.yibentushu.com')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:200,deptName:'顶层合成部门',user:{userId:1,nickName:'合成姓名'}})});return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><main class="pc-page-home"><ul class="header-nav"><li class="active">本人申领</li></ul>${show?'合成姓名 顶层合成部门':'未自动带出'}</main><script>fetch('https://testapi.yibentushu.com/supply-api/getInfo')</script>`});});
 for(const present of[false,true]){show=present;await page.goto(target);const r={status:'passed',detail:''};await verifyConnectedEvidence(page,login,r,target,async()=> 'current.png');assert.equal(r.status,present?'blocked':'failed',r.detail);assert.doesNotMatch(r.detail,/未提供完整姓名和部门/);}
});
test('owner uses actual detail entry and DB goods, then rejects non-owner progress and detail; leaks fail',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let mode='normal';const methods=[];
 const db={count:async()=>1,snapshot:async()=>({apply_no:'OWN1'}),goods:async()=>[{product_id:'B1',qty:2,price:10}],nonowner:async()=>'OTHER1',remarks:async()=>({})};
 await page.route('**/*',route=>{const u=new URL(route.request().url());methods.push(route.request().method());if(u.origin==='https://testapi.yibentushu.com'){
  const own=u.pathname.endsWith('OWN1');let b;if(u.pathname.endsWith('getInfo'))b={code:200,user:{userId:1}};else if(u.pathname.endsWith('myList'))b={code:200,total:1,rows:[{applyNo:'OWN1'}]};else if(!own)b=mode==='leak'&&u.pathname.includes('/progress/')?{code:200,data:{applyNo:'OTHER1',timeline:[]}}:{code:500,msg:'只能查看自己的申请单'};else b={code:200,data:{applyNo:'OWN1',goodsList:[{productId:'B1',qty:2,price:10}]}};
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
 }
 return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><script>const api='https://testapi.yibentushu.com/supply-api/';function detail(){fetch(api+'dept/book/apply/detail/OWN1').then(()=>document.body.innerHTML='<main class="pc-page-apply-form-detail">本人明细</main>')};if(location.hash==='#/apply'){fetch(api+'getInfo');fetch(api+'dept/book/apply/myList')}else if(location.hash.startsWith('#/apply-detail/')){const no=location.hash.split('/').at(-1);fetch(api+'dept/book/apply/progress/'+no).then(r=>r.json()).then(b=>{if(b.code!==200){location.hash='/error';document.body.textContent=b.msg}else{document.body.innerHTML='<main class="pc-page-apply-detail"><div class="word-pc-body-title"><a class="more" href="#/apply-form-detail/OWN1">申请明细</a></div></main>';document.querySelector('a').onclick=detail}})}else if(location.hash==='#/apply-form-detail/OTHER1'){fetch(api+'dept/book/apply/detail/OTHER1').then(r=>r.json()).then(b=>{location.hash='/error';document.body.textContent=b.msg})}</script>`});});
 for(const[m,status]of[['normal','passed'],['leak','failed']]){mode=m;await page.goto(target);const r={status:'passed',detail:''};await verifyConnectedEvidence(page,owner,r,target,async()=> 'current.png',db);assert.equal(r.status,status,r.detail);assert.ok(r.evidence);}
 assert.ok(methods.every(m=>m==='GET'));
});
