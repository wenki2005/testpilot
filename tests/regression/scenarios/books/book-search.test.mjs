import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {reviewDifyBook,validateDifyBookFixtures,verifyDifyBookResult,observeDifyBookResponses} from '../../../../dist/adapters/regression/scenarios/books/book-search.js';
import {isSafeReadOnlyBrowserCase} from '../../../../dist/adapters/documents/execution/workflow-facade.js';

const books=[{code:'1012500025',name:'Fixture Book A',publisher:'Fixture Press',price:25,weightGrams:260},{code:'1012500037',name:'Fixture Book B',publisher:'Fixture Press',price:49.8,weightGrams:520}];
const baseline={schema:1,source:'supply.biz_book_info',weightUnit:'g',capturedAt:new Date().toISOString(),books};
const details={id:'book',title:'图书信息',expected:'编码存在：展示图书名称、出版社名称、图书定价(元)、单本重量(公斤)',source:'原始 XMind › 输入物流编码',steps:[],preconditions:[],testData:[]};
const calculation={...details,id:'calculation',title:'数量计算',expected:'正整数（1~9999）：小计=数量×定价，总计=所有图书小计之和，预估总重=∑(数量×单本重量)',source:'原始 XMind › 输入图书数量'};
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const evidence=JSON.stringify({bookCodeLabel:'自编码',bookCodeAliasConfirmed:true,bookFixtureBaseline:baseline});
const reviewed=c=>{const plan=reviewDifyBook(c,evidence,target);return {...c,steps:plan.steps,testData:plan.executionData};};
const digest=s=>createHash('sha256').update(s).digest('hex');
const reads=books.map(b=>({code:b.code,ok:true,nameDigest:digest(b.name),publisherDigest:digest(b.publisher),price:b.price,weightGrams:b.weightGrams}));

test('book plans retain the independent baseline, source expectation and readonly boundaries',()=>{
 assert.equal(validateDifyBookFixtures(baseline).length,2);for(const bad of [{...baseline,weightUnit:'kg'},{...baseline,capturedAt:'2020-01-01'},{...baseline,books:[books[0],books[0]]}])assert.deepEqual(validateDifyBookFixtures(bad),[]);
 for(const c of [details,calculation]){const before=structuredClone(c);const plan=reviewDifyBook(c,evidence,target);assert.ok(plan);assert.equal(isSafeReadOnlyBrowserCase({...c,steps:plan.steps}),true);assert.deepEqual(c,before);assert.equal(reviewDifyBook(c,evidence,'https://other.example/'),undefined);assert.equal(reviewDifyBook({...c,preconditions:['必须已审批']},evidence,target),undefined);assert.equal(reviewDifyBook(c,'{}',target),undefined);}
});

function html(limit=9999){
 const table=b=>`<table><thead><tr>${['自编码','数量（册）','图书名称','出版社','定价(元)','预估总重（公斤）','小计(元)'].map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody><tr><td>${b.code}</td><td><label>数量（册）<input value="1" oninput="this.value=String(Math.min(Number(this.value),${limit}));window.update()"></label></td><td>${b.name}</td><td>${b.publisher}</td><td>${b.price}</td><td class="weight"></td><td class="subtotal"></td></tr></tbody></table>`;
 return books.map(table).join('')+'<div class="total-info"><span class="total-price"></span><span class="weight"></span></div><script>const data='+JSON.stringify(books)+';window.update=()=>{let total=0,weight=0;document.querySelectorAll("tbody tr").forEach((r,i)=>{const q=Number(r.querySelector("input").value);total+=q*data[i].price;weight+=q*data[i].weightGrams/1000;r.querySelector(".subtotal").textContent=(q*data[i].price).toFixed(2);r.querySelector(".weight").textContent=(q*data[i].weightGrams/1000).toFixed(2)});document.querySelector(".total-price").textContent="¥"+total.toFixed(2);document.querySelector(".total-info .weight").textContent="预估总重："+weight.toFixed(2)+"公斤"};window.update();</script>';
}
test('actual browser checks all formulas and upper bound; missing API evidence and clamped quantity never pass',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));const page=await browser.newPage();
 try{const check=reviewed(calculation);await page.setContent(html());const good={status:'passed',detail:'Base passed',evidence:'before-check.png'};await verifyDifyBookResult(page,check,good,reads);assert.equal(good.status,'passed');assert.match(good.detail,/9999 上界全部核验/);assert.equal(good.evidence,undefined);
  await page.setContent(html(999));const clamped={status:'passed',detail:'Base passed'};await verifyDifyBookResult(page,check,clamped,reads);assert.equal(clamped.status,'failed');assert.match(clamped.detail,/预期数量 9999，实际为 999/);assert.match(clamped.detail,/下界 通过/);assert.match(clamped.detail,/多书计算 通过/);assert.match(clamped.detail,/上界 失败/);assert.match(clamped.detail,/页面小计 50.00 \/ 149.40 元/);
  const absent={status:'passed',detail:'Base passed'};await verifyDifyBookResult(page,check,absent,[]);assert.equal(absent.status,'blocked');const drift={status:'passed',detail:'Base passed'};await verifyDifyBookResult(page,check,drift,[{...reads[0],price:1},reads[1]]);assert.equal(drift.status,'failed');assert.match(drift.detail,/独立数据库基线/);
 }finally{await browser.close();}
});

test('book response belongs to this case and code; unrelated, stale and mismatched responses cannot prove success',async()=>{
 const page=new EventEmitter();const observer=observeDifyBookResponses(page,target);const code=books[0].code;const url='https://testapi.yibentushu.com/supply-api/dept/book/apply/bookCheck?productId='+code;const request=()=>({method:()=> 'GET'});const emit=(r,body,raw=url)=>page.emit('response',{url:()=>raw,request:()=>r,status:()=>200,json:async()=>body});
 try{
  const first=request();page.emit('request',first);emit(first,{code:200,data:{productId:code,bookName:books[0].name,pubname:books[0].publisher,hprice:25,weight:260,secret:'NOT_PERSISTED'}});const good=await observer.take();assert.equal(good.length,1);assert.equal(good[0].ok,true);assert.ok(!JSON.stringify(good).includes('NOT_PERSISTED'));assert.ok(!JSON.stringify(good).includes(books[0].name));
  emit(first,{code:200,data:{productId:code}});assert.equal((await observer.take()).length,0);
  const mismatch=request();page.emit('request',mismatch);emit(mismatch,{code:200,data:{productId:books[1].code,bookName:books[0].name,pubname:books[0].publisher,hprice:25,weight:260}});assert.equal((await observer.take())[0].ok,false);
  const unrelated=request();page.emit('request',unrelated);emit(unrelated,{code:200,data:{productId:code}},url.replace('testapi.yibentushu.com','other.example'));assert.equal((await observer.take()).length,0);
 }finally{observer.close();assert.equal(page.listenerCount('response'),0);assert.equal(page.listenerCount('request'),0);}
});
