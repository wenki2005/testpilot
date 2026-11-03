import test from 'node:test';import assert from 'node:assert/strict';import{chromium}from'playwright';
import{difyRecordKind,reviewDifyRecord,verifyDifyRecordResult}from'../dist/adapters/dify-record-scenarios.js';
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const check={id:'xmind-75',title:'多行金额重量',expected:'多行样书明细逐行展示小计，总计=∑小计、预估总重=∑(数量×单本重量)',source:'员工端-申请表单明细展示页',steps:[],preconditions:[]};
test('multiline review binds exact source and preserves original case',()=>{const before=structuredClone(check);assert.equal(difyRecordKind(check),'application-multiline-totals');assert.ok(reviewDifyRecord(check,JSON.stringify({navigation:['历史申请记录']}),target));assert.equal(difyRecordKind({...check,source:'其他页面'}),undefined);assert.deepEqual(check,before);});
test('own multiline page verifies per-row/aggregate amounts and grams-to-kg; missing/other-owner fixtures stay blocked',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let mode='normal';const methods=[];
 const goods=[{productId:'S1',qty:2,price:25,weight:260},{productId:'S2',qty:3,price:49.8,weight:520}],dbGoods=goods.map(g=>({product_id:g.productId,qty:g.qty,price:g.price}));
 const db={count:async()=>1,applications:async()=>[{apply_no:'OWN1',examine_status:0}],goods:async()=>mode==='single'?dbGoods.slice(0,1):dbGoods,snapshot:async()=>mode==='nonowner'?undefined:{apply_no:'OWN1'}};
 await page.route('**/*',route=>{const u=new URL(route.request().url());methods.push(route.request().method());if(u.origin==='https://testapi.yibentushu.com'){
  const b=u.pathname.endsWith('myList')?{code:200,total:1,rows:[{applyNo:'OWN1',examineStatus:0}]}:u.pathname.endsWith('getInfo')?{code:200,user:{userId:1}}:u.pathname.includes('/dict/')?{code:200,data:[{dictValue:1,dictLabel:'营销用书'}]}:{code:200,data:{applyNo:'OWN1',goodsList:goods}};
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(b)});
 }
 const rows=goods.map(g=>`<tr><td>${g.productId}</td><td>${g.qty}</td><td>合成图书</td><td>合成出版社</td><td>${g.price}</td><td>${(g.qty*g.weight/(mode==='weight'?100:1000)).toFixed(2)}</td><td>¥${(g.qty*g.price).toFixed(2)}</td></tr>`).join('');
 const html=`<main class="pc-page-apply-form-detail"><div class="pc-page-form-detail-sample-details"><table><tbody>${rows}</tbody></table><div class="go-on-item"><div class="total"><span class="price">¥${mode==='total'?'999.00':'199.40'}</span></div><div class="total-weight">预估总重：2.08(公斤)</div></div></div></main>`;
 return route.fulfill({contentType:'text/html;charset=utf-8',body:`<meta charset="utf-8"><script>const api='https://testapi.yibentushu.com/supply-api/';if(location.hash==='#/apply'){fetch(api+'getInfo');fetch(api+'system/dict/data/type/dept_apply_use');fetch(api+'dept/book/apply/myList')}else if(location.hash.startsWith('#/apply-form-detail/'))fetch(api+'dept/book/apply/detail/OWN1').then(()=>document.body.innerHTML=${JSON.stringify(html)});</script>`});});
 for(const [m,status]of[['normal','passed'],['total','failed'],['weight','failed'],['single','blocked'],['nonowner','blocked']]){mode=m;await page.goto(target);const r={status:'passed',detail:''};await verifyDifyRecordResult(page,check,r,target,async png=>{assert.equal(png.subarray(0,4).toString('hex'),'89504e47');return 'masked.png';},db);assert.equal(r.status,status,r.detail);}
 assert.ok(methods.every(m=>m==='GET'));
});
