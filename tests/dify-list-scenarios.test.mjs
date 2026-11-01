import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {reviewDifyList,verifyDifyListResult} from '../dist/adapters/dify-list-scenarios.js';
import {needsDifyReadback} from '../dist/adapters/dify-readonly-scenarios.js';

const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const usage={id:'usage',source:'员工端-历史申请记录页',expected:'按用途筛选（营销用书/产品用书）生效',preconditions:[],steps:[]};
const status={...usage,id:'status',expected:'按状态筛选（待审批/已通过/已驳回）生效'};
const orders={...usage,id:'orders',source:'员工端-订单列表页 › 关键字搜索订单',expected:'模糊匹配返回对应订单'};
const shortcuts={...usage,id:'shortcuts',source:'员工端-我的页面 › 快捷入口',expected:'页面平滑切换，数据实时加载，默认展示全部并支持分页20条'};
const evidence=JSON.stringify({navigation:['历史申请记录','订单物流'],controls:[{placeholder:'请输入收件人姓名'}]});

test('list plans are source/target bound and require local readback; source cases remain immutable',()=>{
 for(const check of [usage,status,orders,shortcuts]){const original=structuredClone(check);assert.ok(reviewDifyList(check,evidence,target));assert.equal(needsDifyReadback(check),true);assert.equal(reviewDifyList(check,evidence,'https://other.example/'),undefined);assert.equal(reviewDifyList({...check,source:'other'},evidence,target),undefined);assert.equal(reviewDifyList({...check,preconditions:['需指定记录']},evidence,target),undefined);assert.deepEqual(check,original);}
});

test('real browser exercises filters and shortcuts: zero records block, complete matching fixtures pass, wrong results fail',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));const page=await browser.newPage();let rows=[],wrong=false;const calls=[];
 const html=`<!doctype html><meta charset="utf-8"><script>
 const route=location.hash.slice(1).split('?')[0],api='https://testapi.yibentushu.com/supply-api/';
 if(route==='/my'){document.write('<main class="page-my"><a href="/test-sample-apply/index.html?view=apply#/apply">我的申请</a><a href="/test-sample-apply/index.html?view=logistics#/logistics">订单物流</a></main>');}
 else if(route==='/apply'){document.write('<main class="pc-page-apply">'+['营销用书','产品用书','待审批','已通过','已驳回'].map((t,i)=>'<button onclick="choose(this,'+i+')">'+t+'</button>').join('')+'</main>');window.choose=(e,i)=>{document.querySelectorAll('button').forEach(b=>b.classList.remove('active'));e.classList.add('active');fetch(api+'dept/book/apply/myList?pageNum=1&pageSize=20&'+(i<2?'bookUsage='+(i+1):'examineStatus='+(i-2)));};fetch(api+'dept/book/apply/myList?pageNum=1&pageSize=20');}
 else if(route==='/logistics'){document.write('<main>订单列表<input placeholder="搜索订单号/书籍"></main>');fetch(api+'h5/dept/book/order/myList?pageNum=1&pageSize=20');document.querySelector('input').onkeydown=e=>{if(e.key==='Enter')fetch(api+'h5/dept/book/order/myList?pageNum=1&pageSize=20&keyword='+encodeURIComponent(e.target.value));};}
 else document.write('<main>费用划归客户 收件人</main>');
 </script>`;
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());calls.push(req.method());if(url.origin==='https://cdn.yibentushu.com')return route.fulfill({contentType:'text/html;charset=utf-8',body:html});if(url.origin==='https://testapi.yibentushu.com'){let matched=rows;for(const key of ['bookUsage','examineStatus'])if(url.searchParams.has(key)&&!wrong)matched=matched.filter(row=>String(row[key])===url.searchParams.get(key));if(url.searchParams.get('keyword'))matched=matched.filter(row=>row.orderNo?.includes(url.searchParams.get('keyword')));return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:200,rows:matched,total:matched.length})});}return route.abort();});
 let images=0;const save=async bytes=>{assert.equal(bytes.subarray(0,4).toString('hex'),'89504e47');images++;return 'current.png';};
 try{
  await page.goto(target);
  const empty={status:'passed',detail:'base'};await verifyDifyListResult(page,usage,empty,target,save);assert.equal(empty.status,'blocked');assert.match(empty.detail,/缺少.*本人记录/);assert.equal(empty.evidence,'current.png');
  const noOrder={status:'passed',detail:'base'};await verifyDifyListResult(page,orders,noOrder,target,save);assert.equal(noOrder.status,'blocked');assert.match(noOrder.detail,/为0条/);
  rows=[{applyNo:'a',bookUsage:1,examineStatus:0},{applyNo:'b',bookUsage:2,examineStatus:1},{applyNo:'c',bookUsage:1,examineStatus:2}];
  for(const check of [usage,status]){const result={status:'passed',detail:'base'};await verifyDifyListResult(page,check,result,target,save);assert.equal(result.status,'passed',result.detail);}
  wrong=true;const bad={status:'passed',detail:'base'};await verifyDifyListResult(page,usage,bad,target,save);assert.equal(bad.status,'failed');assert.match(bad.detail,/不属于/);wrong=false;rows=[];
  const entry={status:'passed',detail:'base'};await verifyDifyListResult(page,shortcuts,entry,target,save);assert.equal(entry.status,'blocked',entry.detail);assert.match(entry.detail,/每页20条/);assert.match(entry.detail,/没有足够/);assert.equal(await page.evaluate(()=>navigator.userAgent.includes(' Mobile')),false);
  assert.equal(images,6);assert.ok(calls.every(method=>method==='GET'));
 }finally{await browser.close();}
});
