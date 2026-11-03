import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {excludedCaseReason}from'../dist/adapters/document-case-scope.js';
import {connectedEvidenceKind}from'../dist/adapters/dify-connected-contract.js';
import {reviewConnectedEvidence,verifyConnectedEvidence}from'../dist/adapters/dify-connected-scenarios.js';
import {isSafeReadOnlyBrowserCase,planCaseExecution}from'../dist/adapters/document-test-workflow.js';
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const recipient={id:'xmind-78',title:'原样回显',expected:'收件人/手机号/所在地区/详细地址、备注按提交内容完整原样回显',source:'员工端-申请表单明细展示页',steps:[],preconditions:[],confidence:'medium'};
const application={...recipient,id:'xmind-73',expected:'申请单自身字段（申请人/用途/收件信息/备注/数量）实时读申请单记录，与提交内容一致'};
const nonowner={...recipient,id:'xmind-59',expected:'越权：非发起人通过URL/申请单号直接访问他人明细，返回无权限且不展示数据',source:'员工端-用书审批详情页'};
test('negative requirements remain active; annotations are excluded; review is source/target/control bound',()=>{
 for(const expected of ['本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）','其他出库单号本期不做筛选项，已去除','不触发物流仓WMS锁定/推送逻辑'])assert.equal(excludedCaseReason({title:expected,expected,source:'本期不做'}),undefined);
 assert.ok(excludedCaseReason({title:'前置',expected:'// 前置：本期均走旺店通快递仓发货',source:'本期不做'}));
 assert.ok(excludedCaseReason({title:'统计看板',expected:'// 本期不做统计看板，待后续需求提出时再实现',source:''}));
 const evidence=JSON.stringify({navigation:['历史申请记录'],controls:[{placeholder:'请输入收件人姓名'}]});
 for(const c of [recipient,application,nonowner]){const original=structuredClone(c),review=reviewConnectedEvidence(c,evidence,target);assert.ok(review);assert.ok(connectedEvidenceKind(c));assert.equal(reviewConnectedEvidence(c,evidence,'https://example.com/'),undefined);assert.equal(reviewConnectedEvidence({...c,source:'其他系统'},evidence,target),undefined);assert.equal(reviewConnectedEvidence(c,'{}',target),undefined);assert.deepEqual(c,original);assert.equal(isSafeReadOnlyBrowserCase({...c,steps:review.steps,preconditionsConfirmed:true}),true);assert.equal(isSafeReadOnlyBrowserCase({...c,steps:[{action:'clickExactText',text:'提交申请'}],preconditionsConfirmed:true}),false);}
 const negative={...recipient,title:'出版社用书',source:'出版社用书 › 本期不做',expected:'本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）',steps:[{action:'assertText',text:'收货信息'}]};assert.equal(planCaseExecution(negative).route,'browser-ui');
});
test('stored fields compare actual page/API/DB; non-owner requires explicit denial and no data; masked fresh PNG',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let mode='normal';const methods=[];let images=0;
 const data={applyNo:'OWN1',applyType:1,bookUsage:1,costClientName:'合成客户',receiverName:'合成收件人',receiverPhone:'13800138000',province:'合成省',city:'合成市',county:'合成区',detailAddress:'合成地址',remark:' 合成备注 ',goodsList:[{productId:'B1',qty:2,price:10}]};
 const stored={apply_no:'OWN1',applicant_user_id:1,applicant_name:'合成姓名',dept_name:'合成部门',apply_type:1,book_usage:1,cost_client_name:data.costClientName,receiver_name:data.receiverName,receiver_phone:data.receiverPhone,province:data.province,city:data.city,county:data.county,detail_address:data.detailAddress,remark:data.remark};
 const db={count:async()=>1,snapshot:async()=>stored,goods:async()=>[{product_id:'B1',qty:2,price:10}],nonowner:async()=>'OTHER1',remarks:async()=>({applications:1,approvals:1,orderReferences:0,matchedOrders:0})};
 await page.route('**/*',async route=>{const u=new URL(route.request().url());methods.push(route.request().method());if(u.origin==='https://testapi.yibentushu.com'){
  let b;if(u.pathname.endsWith('getInfo'))b={code:200,user:{userId:1}};else if(u.pathname.endsWith('myList'))b={code:200,total:1,rows:[{applyNo:'OWN1'}]};else if(u.pathname.endsWith('OTHER1'))b=mode==='leak'?{code:200,data:{applyNo:'OTHER1',goodsList:[]}}:{code:500,msg:mode==='generic'?'系统异常':'只能查看自己的申请单'};else b={code:200,data:{...data,receiverName:mode==='api-mismatch'?'错误值':data.receiverName}};
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
 }
 if(u.origin==='https://cdn.yibentushu.com'){
  const fields=Object.entries({'申请人：':'本人','收件人：':mode==='ui-mismatch'?'错误值':data.receiverName,'手机号码：':data.receiverPhone,'所在地区：':[data.province,data.city,data.county].join('/'),'详细地址：':data.detailAddress}).map(([k,v])=>`<div class="word-pc-from-item-preview"><div class="label">${k}</div><div class="value">${v}</div></div>`).join('');
  return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><script>const api='https://testapi.yibentushu.com/supply-api/';if(location.hash==='#/apply'){fetch(api+'getInfo');fetch(api+'dept/book/apply/myList')}else if(location.hash.startsWith('#/apply-form-detail/')){fetch(api+'dept/book/apply/detail/'+location.hash.split('/').at(-1)).then(r=>r.json()).then(b=>{if(b.code!==200){location.hash='/error';document.body.textContent=b.msg;}else document.body.innerHTML='<main class="pc-page-apply-form-detail">${fields}<ul class="detailed-info"><li><div class="label">备注：</div><div class="value">${data.remark}</div></li></ul></main>'})}</script>`});
 }return route.abort();});
 const save=async png=>{assert.equal(png.subarray(0,4).toString('hex'),'89504e47');assert.ok((await page.locator('.pc-page-apply-form-detail .value').evaluateAll(es=>es.map(e=>getComputedStyle(e).color))).every(c=>c==='rgba(0, 0, 0, 0)'));images++;return 'masked.png';};
 for(const[c,m,status]of[[recipient,'normal','passed'],[recipient,'api-mismatch','failed'],[recipient,'ui-mismatch','failed'],[application,'normal','failed'],[nonowner,'normal','passed'],[nonowner,'leak','failed'],[nonowner,'generic','blocked']]){mode=m;await page.goto('about:blank');await page.goto(target);const r={status:'passed',detail:'shell'};await verifyConnectedEvidence(page,c,r,target,save,db);assert.equal(r.status,status,m+': '+r.detail);assert.ok(r.evidence);assert.ok(!r.detail.includes(data.receiverName));assert.ok(!r.detail.includes(data.receiverPhone));}
 assert.ok(images>=7);assert.ok(methods.every(m=>m==='GET'));
});
test('publisher negative check waits for delayed controls and fails a visible forbidden option',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let forbidden=false;
 const c={...recipient,source:'出版社用书',expected:'本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）'};
 await page.route('https://cdn.yibentushu.com/**',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><script>setTimeout(()=>{document.body.innerHTML='<main class="pc-page-home"><div class="home-form-item"><label>样书用途：</label><input role="combobox"></div></main>';document.querySelector('input').onclick=()=>{const list=document.createElement('div');list.innerHTML='<div role="option">营销用书</div><div role="option">产品用书</div>${forbidden?'<div role="option">出版社用书</div>':''}';document.body.append(list)}},200)</script>`}));
 for(const value of [false,true]){forbidden=value;await page.goto('about:blank');await page.goto(target);const r={status:'passed',detail:'shell'};await verifyConnectedEvidence(page,c,r,target,async()=> 'current.png');assert.equal(r.status,value?'failed':'passed',r.detail);}
});
test('copy binds application and order SVGs to fresh identifiers, restores clipboard observer, blocks missing orders',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:720}});let mode='normal';
 const c={...recipient,source:'员工端-历史申请记录页',expected:'申请编号/订单号支持一键复制按钮（H5设计稿已确认新增，便于技术排查）'};
 const db={count:async()=>1,snapshot:async()=>({apply_no:'OWN1'}),goods:async()=>[],nonowner:async()=>undefined,remarks:async()=>({})};
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='https://testapi.yibentushu.com'){const body=u.pathname.endsWith('getInfo')?{code:200,user:{userId:1}}:u.pathname.includes('/order/')?{code:200,total:mode==='empty'?0:1,rows:mode==='empty'?[]:[{orderId:'ORDER1'}]}:{code:200,total:1,rows:[{applyNo:'OWN1'}]};return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});}
  const applicationHtml='<div class="page-apply-item"><header class="head"><div class="or">OWN1<svg class="copy" width="30" height="30"><rect width="30" height="30"/></svg></div></header></div>';
  const orderHtml='<div class="page-logistics-item"><header class="head"><div class="or">ORDER1<svg class="copy" width="30" height="30"><rect width="30" height="30"/></svg></div></header></div>';
  return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><script>const api='https://testapi.yibentushu.com/supply-api/';if(location.hash==='#/apply'){fetch(api+'getInfo');fetch(api+'dept/book/apply/myList').then(()=>{document.body.innerHTML=${JSON.stringify(applicationHtml)};document.querySelector('.copy').onclick=()=>navigator.clipboard.writeText('OWN1')})}else if(location.hash==='#/logistics'){fetch(api+'h5/dept/book/order/myList').then(()=>{document.body.innerHTML=${JSON.stringify(orderHtml)};document.querySelector('.copy').onclick=()=>navigator.clipboard.writeText('${mode==='wrong'?'WRONG':'ORDER1'}')})}</script>`});
 });
 for(const[m,expected]of[['normal','passed'],['wrong','failed'],['empty','blocked']]){mode=m;await page.goto('about:blank');await page.goto(target);const r={status:'passed',detail:'shell'};await verifyConnectedEvidence(page,c,r,target,async()=> 'masked.png',db);assert.equal(r.status,expected,r.detail);assert.deepEqual(page.viewportSize(),{width:1280,height:720});assert.equal(await page.evaluate(()=>Object.hasOwn(navigator,'clipboard')),false);}
});
