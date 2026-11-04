import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {reviewDifyDevice,verifyDifyDeviceResult,waitForDifyDeviceBaseline} from '../dist/adapters/dify-device-scenarios.js';
import {isSafeReadOnlyBrowserCase} from '../dist/adapters/document-test-workflow.js';
import {missingDirectAssertion} from '../dist/adapters/document-case-quality.js';
import {needsDifyReadback,isDifyRecordIndependent} from '../dist/adapters/dify-readonly-scenarios.js';

const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const api='https://testapi.yibentushu.com/supply-api/';
const profile={id:'profile',title:'认证信息',expected:'关联企微认证信息正确展示',source:'员工端-我的页面 › 展示头像、用户名、手机号',steps:[],preconditions:[]};
const layout={id:'layout',title:'两端布局',expected:'PC与H5共用代码，通过响应式布局区分展示（识别PC/移动端切换布局），内容与交互与移动端一致',source:'PC端适配 › 样书申请页/历史记录页/订单物流页',steps:[],preconditions:[]};
const evidence=JSON.stringify({controls:[{placeholder:'请输入收件人姓名'}]});

test('device plans require exact source/expectation and the known target, keep original cases, and require local readback',()=>{
 for(const c of [profile,layout]){
  const before=structuredClone(c),plan=reviewDifyDevice(c,evidence,target);assert.ok(plan);
  assert.equal(isSafeReadOnlyBrowserCase({...c,steps:plan.steps}),true);
  assert.equal(missingDirectAssertion({...c,steps:plan.steps}),undefined);
  assert.equal(needsDifyReadback(c),true);assert.equal(isDifyRecordIndependent(c),true);assert.deepEqual(c,before);
  assert.equal(reviewDifyDevice(c,evidence,'https://other.example/'),undefined);
  assert.equal(reviewDifyDevice({...c,source:'其他模块'},evidence,target),undefined);
  assert.equal(reviewDifyDevice({...c,preconditions:['必须已有本人审批记录']},evidence,target),undefined);
  assert.equal(reviewDifyDevice(c,'{}',target),undefined);
 }
});

test('Dify cross-device readiness waits for delayed PC field rendering without replacing the original assertion',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.route('https://cdn.yibentushu.com/test-sample-apply/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><main class="pc-page-home"></main><script>setTimeout(()=>document.querySelector("main").innerHTML="费用划归客户 收件人",700)</script>'}));
 try{
  await page.goto(target,{waitUntil:'domcontentloaded'});
  await waitForDifyDeviceBaseline(page,layout,target,3000);
  assert.match(await page.locator('body').innerText(),/费用划归客户/);
  assert.match(await page.locator('body').innerText(),/收件人/);
  await assert.doesNotReject(()=>waitForDifyDeviceBaseline(page,profile,target,1));
  await assert.doesNotReject(()=>waitForDifyDeviceBaseline(page,{...layout,id:'other'},'https://other.example/',1));
 }finally{await browser.close();}
});

// Isolated tool fixture, never a real department-system business result.
function fixture(){return `<!doctype html><meta charset="utf-8"><script type="module" src="/fixture-entry.js"></script><script>
const mobile=navigator.userAgent.includes(' Mobile'),route=location.hash.slice(1);
const api=${JSON.stringify(api)};
if(route==='/my'){
 document.write('<main class="page-my"><section class="user-info"><span class="name">PRIVATE_NAME</span><span class="phone"></span><div class="avatar"><img alt="default"></div></section></main>');fetch(api+'getInfo');
}else if(route==='/home'){
 document.write('<main class="'+(mobile?'page-home':'pc-page-home')+'">费用划归客户 发货方式 备注 收件人 手机号码 所在地区 详细地址<input placeholder="如有特殊要求请填写备注信息"><input placeholder="'+(mobile?'请输入收件人':'请输入收件人姓名')+'"></main>');fetch(api+'getInfo');
}else if(route==='/apply'){
 document.write('<main>暂无申请记录</main>');fetch(api+'dept/book/apply/myList');
}else if(route==='/logistics'){
 document.write('<main>'+(mobile?'暂无订单记录':'暂无订单物流记录')+'<input placeholder="搜索订单号/书籍"></main>');
 fetch(api+'h5/dept/book/order/myList');document.querySelector('input').onkeydown=e=>{if(e.key==='Enter')fetch(api+'h5/dept/book/order/myList?keyword='+encodeURIComponent(e.target.value))};
}
</script>`;}

test('device verifier uses real independent layouts and current responses; missing identity fields block, mismatch fails, original device is restored',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));
 const page=await browser.newPage({viewport:{width:1100,height:720}});let failMobile=false;let identity=0;const requests=[];
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({url:request.url(),method:request.method()});
  if(url.origin==='https://cdn.yibentushu.com')return route.fulfill({contentType:url.pathname==='/fixture-entry.js'?'text/javascript':'text/html',body:url.pathname==='/fixture-entry.js'?'':fixture()});
  if(url.origin==='https://testapi.yibentushu.com'){
   const mobile=request.headers()['user-agent']?.includes(' Mobile');
   const body=url.pathname.endsWith('/getInfo')?{code:200,user:{userId:failMobile&&mobile?'other-account':'same-account',nickName:'PRIVATE_NAME'}}:{code:200,total:0,rows:[]};
   if(url.pathname.endsWith('/getInfo'))identity++;
   return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  }
  return route.abort();
 });
 const screenshots=[];const save=async image=>{assert.equal(image.subarray(1,4).toString(),'PNG');if(page.url().endsWith('#/my')){assert.equal(await page.locator('.user-info').evaluate(el=>getComputedStyle(el).visibility),'visible');assert.match(await page.locator('.user-info .name').evaluate(el=>getComputedStyle(el,'::after').content),/姓名已脱敏/);assert.equal(await page.locator('.avatar img').evaluate(el=>getComputedStyle(el).visibility),'visible');}screenshots.push(image);return 'current-case.png';};
 try{
  await page.goto(target);const before=await page.evaluate(()=>({ua:navigator.userAgent,url:location.href,width:innerWidth,height:innerHeight}));
  const missing={status:'passed',detail:'base',evidence:'old.png'};await verifyDifyDeviceResult(page,profile,missing,target,save);
  assert.equal(missing.status,'blocked');assert.match(missing.detail,/手机号、认证头像/);assert.ok(!missing.detail.includes('PRIVATE_NAME'));assert.equal(missing.evidence,'current-case.png');
  assert.match(missing.detail,/已登录/);assert.match(missing.evidenceNote,/空字段和页面结构保留/);
  assert.deepEqual(await page.evaluate(()=>({ua:navigator.userAgent,url:location.href,width:innerWidth,height:innerHeight})),before);
  const noWriter={status:'passed',detail:'base',evidence:'stale.png'};await verifyDifyDeviceResult(page,profile,noWriter,target,async()=>{throw Error('test disk error');});assert.equal(noWriter.status,'blocked');assert.match(noWriter.detail,/手机号、认证头像/);assert.match(noWriter.detail,/截图未采集/);assert.equal(noWriter.evidence,undefined);
  const good={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,good,target,save);assert.equal(good.status,'passed',good.detail);assert.match(good.detail,/实际独立布局/);assert.match(good.detail,/零条响应/);assert.match(good.detail,/不宣称有记录详情/);
  assert.deepEqual(await page.evaluate(()=>({ua:navigator.userAgent,url:location.href,width:innerWidth,height:innerHeight})),before);
  failMobile=true;const wrong={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,wrong,target,save);assert.equal(wrong.status,'blocked');assert.match(wrong.detail,/账号身份不一致/);assert.ok(!wrong.detail.includes('other-account'));
  assert.deepEqual(await page.evaluate(()=>({ua:navigator.userAgent,url:location.href,width:innerWidth,height:innerHeight})),before);
  const alreadyFailed={status:'failed',detail:'original failure'};const count=identity;await verifyDifyDeviceResult(page,layout,alreadyFailed,target,save);assert.equal(alreadyFailed.status,'failed');assert.equal(identity,count);
  assert.ok(screenshots.length>=2);assert.ok(requests.every(r=>r.method==='GET'));
 }finally{await browser.close();}
});

// Isolated tool fixture with records; never a real department-system business result.
function recordsFixture(applyRows,orderRows){return `<!doctype html><meta charset="utf-8"><script type="module" src="/fixture-entry.js"></script><script>
const mobile=navigator.userAgent.includes(' Mobile'),route=location.hash.slice(1),api=${JSON.stringify(api)};
const applyRows=${JSON.stringify(applyRows)},orderRows=${JSON.stringify(orderRows)};
if(route==='/home'){
 document.write('<main class="'+(mobile?'page-home':'pc-page-home')+'">费用划归客户 发货方式 备注 收件人 手机号码 所在地区 详细地址<input placeholder="如有特殊要求请填写备注信息"><input placeholder="'+(mobile?'请输入收件人':'请输入收件人姓名')+'"></main>');fetch(api+'getInfo');
}else if(route==='/apply'){
 const body=applyRows.length?'<ul>'+applyRows.map(row=>'<li>'+row.applyNo+' '+row.text+'</li>').join('')+'</ul>':'暂无申请记录';
 document.write('<main>'+body+'</main>');fetch(api+'dept/book/apply/myList');
}else if(route==='/logistics'){
 const body=orderRows.length?'<ul>'+orderRows.map(row=>'<li>'+row.orderId+'</li>').join('')+'</ul>':(mobile?'暂无订单记录':'暂无订单物流记录');
 document.write('<main>'+body+'<input placeholder="搜索订单号/书籍"></main>');
 fetch(api+'h5/dept/book/order/myList');document.querySelector('input').onkeydown=e=>{if(e.key==='Enter')fetch(api+'h5/dept/book/order/myList?keyword='+encodeURIComponent(e.target.value))};
}
</script>`;}

const consistent={pc:{apply:[{applyNo:'202611010001',examineStatus:0,bookUsage:1,text:'待审批'},{applyNo:'202611010002',examineStatus:1,bookUsage:2,text:'已通过'}],orders:[{orderId:'OD20261101001'}],matched:['OD20261101001']},h5:null};
consistent.h5={apply:consistent.pc.apply.map(row=>({...row})),orders:consistent.pc.orders.map(row=>({...row})),matched:consistent.pc.matched.slice()};

test('cross-device verifier compares real records on both ends; inconsistent lists fail and the original expectation stays',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));
 const page=await browser.newPage({viewport:{width:1100,height:720}});let current=consistent;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),mobile=request.headers()['user-agent']?.includes(' Mobile');
  if(url.origin==='https://cdn.yibentushu.com'){const side=mobile?current.h5:current.pc;return route.fulfill({contentType:url.pathname==='/fixture-entry.js'?'text/javascript':'text/html',body:url.pathname==='/fixture-entry.js'?'':recordsFixture(side.apply,side.orders)});}
  if(url.origin==='https://testapi.yibentushu.com'){
   const side=mobile?current.h5:current.pc,headers={'access-control-allow-origin':'*'};
   if(url.pathname.endsWith('/getInfo'))return route.fulfill({contentType:'application/json',headers,body:JSON.stringify({code:200,user:{userId:'same-account',nickName:'PRIVATE_NAME'}})});
   if(url.pathname.endsWith('/apply/myList'))return route.fulfill({contentType:'application/json',headers,body:JSON.stringify({code:200,total:side.apply.length,rows:side.apply})});
   if(url.pathname.endsWith('/order/myList')){const keyword=url.searchParams.get('keyword'),rows=keyword?side.matched.map(no=>({orderId:no})):side.orders;return route.fulfill({contentType:'application/json',headers,body:JSON.stringify({code:200,total:rows.length,rows})});}
  }
  return route.abort();
 });
 const save=async image=>{assert.equal(image.subarray(1,4).toString(),'PNG');return 'current-case.png';};
 try{
  const passed={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,passed,target,save);
  assert.equal(passed.status,'passed',passed.detail);assert.match(passed.detail,/本人申请记录 2 条/);assert.match(passed.detail,/本人订单记录 1 条/);assert.match(passed.detail,/订单核验当前页/);assert.equal(passed.evidence,'current-case.png');
  current={pc:consistent.pc,h5:{apply:[{applyNo:'202611010003',examineStatus:0,bookUsage:1,text:'待审批'},{applyNo:'202611010004',examineStatus:1,bookUsage:2,text:'已通过'}],orders:consistent.h5.orders,matched:consistent.h5.matched}};
  const different={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,different,target,save);assert.equal(different.status,'failed');assert.match(different.detail,/申请编号集合不一致/);
  current={pc:consistent.pc,h5:{apply:[],orders:[],matched:[]}};
  const emptyH5={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,emptyH5,target,save);assert.equal(emptyH5.status,'failed');assert.match(emptyH5.detail,/总数或空态不一致/);
  current={pc:consistent.pc,h5:{...consistent.h5,matched:['OD20261101001','OD20261101999']}};
  const keyword={status:'passed',detail:'base'};await verifyDifyDeviceResult(page,layout,keyword,target,save);assert.equal(keyword.status,'failed');assert.match(keyword.detail,/命中的结果集合不一致/);
  assert.ok(passed.detail.indexOf('PRIVATE_NAME')<0&&different.detail.indexOf('PRIVATE_NAME')<0);
 }finally{await browser.close();}
});
