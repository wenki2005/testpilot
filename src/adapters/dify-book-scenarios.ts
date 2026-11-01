import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {Page,Request,Response} from 'playwright';
import {actionablePreconditions,resolveDocumentField,type BrowserCheck} from './document-test-workflow.js';

export type DifyBookFixture={code:string;name:string;publisher:string;price:number;weightGrams:number};
export type DifyBookKind='book-details'|'book-calculation';
const marker='Dify只读图书基线：';
const digest=(value:string)=>createHash('sha256').update(value.trim()).digest('hex');
export function difyBookKind(check:Pick<BrowserCheck,'expected'|'source'>):DifyBookKind|undefined{
 if(check.expected==='编码存在：展示图书名称、出版社名称、图书定价(元)、单本重量(公斤)'&&check.source.includes('输入物流编码'))return 'book-details';
 if(check.expected==='正整数（1~9999）：小计=数量×定价，总计=所有图书小计之和，预估总重=∑(数量×单本重量)'&&check.source.includes('输入图书数量'))return 'book-calculation';
}
export function validateDifyBookFixtures(value:unknown,now=Date.now()):DifyBookFixture[]{
 const v=value as {schema?:number;source?:string;weightUnit?:string;capturedAt?:string;books?:DifyBookFixture[]};const time=Date.parse(v?.capturedAt??'');
 if(v?.schema!==1||v.source!=='supply.biz_book_info'||v.weightUnit!=='g'||!Number.isFinite(time)||time>now+60000||now-time>7*86400000||!Array.isArray(v.books)||v.books.length<2||v.books.length>10)return [];
 if(v.books.some(b=>!b||!/^\d{10,13}$/.test(b.code)||typeof b.name!=='string'||!b.name.trim()||b.name.length>200||typeof b.publisher!=='string'||!b.publisher.trim()||b.publisher.length>100||!Number.isFinite(b.price)||b.price<=0||b.price>1000000||!Number.isFinite(b.weightGrams)||b.weightGrams<=0||b.weightGrams>1000000)||new Set(v.books.map(b=>b.code)).size!==v.books.length)return [];
 return v.books.map(b=>({code:b.code,name:b.name,publisher:b.publisher,price:b.price,weightGrams:b.weightGrams}));
}
export async function loadDifyBookFixtures(root:string){try{return validateDifyBookFixtures(JSON.parse(await readFile(path.join(root,'dify-web-modules','book-fixtures.json'),'utf8')));}catch{return [];}}
export function reviewDifyBook(check:BrowserCheck,evidence:string,targetUrl?:string){
 const kind=difyBookKind(check);if(!kind||actionablePreconditions(check).length)return;
 let url:URL;try{url=new URL(targetUrl??'');}catch{return;}if(url.origin!=='https://cdn.yibentushu.com'||!url.pathname.startsWith('/test-sample-apply/'))return;
 let page:{bookCodeLabel?:string;bookCodeAliasConfirmed?:boolean;bookFixtureBaseline?:unknown};try{page=JSON.parse(evidence);}catch{return;}
 const books=validateDifyBookFixtures(page.bookFixtureBaseline).slice(0,kind==='book-details'?1:2);
 if(!books.length||!page.bookCodeAliasConfirmed||!['物流编码','自编码'].includes(page.bookCodeLabel??''))return;
 const steps:BrowserCheck['steps']=[];
 for(const [index,book] of books.entries()){
  if(index)steps.push({action:'clickExactText',text:'继续添加样书'});
  steps.push({action:'fillByLabel',label:page.bookCodeLabel!,rowIndex:index,value:book.code},{action:'blurByLabel',label:page.bookCodeLabel!,rowIndex:index},{action:'assertExactVisible',text:book.name},{action:'fillByLabel',label:'数量（册）',rowIndex:index,value:'1'},{action:'blurByLabel',label:'数量（册）',rowIndex:index});
 }
 return {kind,steps,executionData:[marker+JSON.stringify({schema:1,source:'supply.biz_book_info',weightUnit:'g',books})],detail:'只读审核：固定数据库图书基线，逐项对照本轮成功接口与页面名称、出版社、定价和公斤重量；'+(kind==='book-calculation'?'实际检查数量 1、3、9999 及两种书的小计/总计/总重，保留上限断言。':'数量置 1，检查单本公斤重量。')+' 不提交、不写库。'};
}
type BookRead={code:string;ok:boolean;nameDigest?:string|undefined;publisherDigest?:string|undefined;price?:number;weightGrams?:number};
const endpoint=(raw:string,target:string)=>{try{const u=new URL(raw),t=new URL(target);return t.origin==='https://cdn.yibentushu.com'&&t.pathname.startsWith('/test-sample-apply/')&&u.origin==='https://testapi.yibentushu.com'&&u.pathname==='/supply-api/dept/book/apply/bookCheck'?u:undefined;}catch{return;}};
export function observeDifyBookResponses(page:Page,targetUrl:string){
 let epoch=0,pending:Array<Promise<BookRead>>=[];const requests=new WeakMap<Request,number>();const start=(r:Request)=>requests.set(r,epoch);
 const response=(r:Response)=>{const u=endpoint(r.url(),targetUrl);if(!u||r.request().method()!=='GET'||requests.get(r.request())!==epoch)return;const code=u.searchParams.get('productId')??'';if(!/^\d{10,13}$/.test(code))return;
  pending.push((async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const body=await Promise.race([r.json(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('book-read-timeout')),4000);})]);const b=body?.data;return {code,ok:r.status()===200&&body?.code===200&&b?.productId===code,...(b?{nameDigest:typeof b.bookName==='string'?digest(b.bookName):undefined,publisherDigest:typeof b.pubname==='string'?digest(b.pubname):undefined,price:Number(b.hprice),weightGrams:Number(b.weight)}:{})};}catch{return {code,ok:false};}finally{clearTimeout(timer);}})());
 };
 page.on('request',start);page.on('response',response);
 return {async take(check?:BrowserCheck){const reads:BookRead[]=[];const needed=difyBookKind(check??{expected:'',source:''});const expected=check?.steps.flatMap(s=>s.action==='fillByLabel'&&['自编码','物流编码'].includes(s.label)?[s.value]:[])??[];const deadline=Date.now()+6000;
  try{do{const batch=pending;pending=[];reads.push(...await Promise.all(batch));if(!needed||expected.every(code=>reads.some(r=>r.code===code)))return reads;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);return reads;}finally{epoch++;}},close(){page.off('request',start);page.off('response',response);}};
}
export async function verifyDifyBookResult(page:Page,check:BrowserCheck,result:{status:string;detail:string;evidence?:string},reads:BookRead[]){
 const kind=difyBookKind(check);if(!kind||!['passed','failed'].includes(result.status))return;
 const encoded=check.testData?.filter(v=>v.startsWith(marker));let books:DifyBookFixture[];try{if(encoded?.length!==1)throw Error();books=JSON.parse(encoded[0]!.slice(marker.length)).books;if(books.length!==(kind==='book-details'?1:2))throw Error();}catch{result.status='blocked';result.detail='缺少本轮冻结的图书基线，未以接口实际值反推预期。';return;}
 for(const book of books){const read=reads.filter(r=>r.code===book.code).at(-1);if(!read?.ok){result.status='blocked';result.detail='未取得固定图书 '+book.code+' 的本轮成功查询，不能凭残留文字通过。';return;}if(read.nameDigest!==digest(book.name)||read.publisherDigest!==digest(book.publisher)||read.price!==book.price||read.weightGrams!==book.weightGrams){result.status='failed';result.detail='断言失败：图书 '+book.code+' 本轮接口字段与独立数据库基线不一致。';delete result.evidence;return;}}
 if(result.status!=='passed')return;
 const rows=page.locator('table').filter({has:page.getByRole('columnheader',{name:'图书名称',exact:true})}).locator('tbody tr');
 if(await rows.count()!==books.length){result.status='blocked';result.detail='本轮图书行数与冻结的测试数据不一致。';return;}
 const problems:string[]=[];const stages:string[]=[];
 const numeric=(value:string)=>Number(value.replace(/[¥￥,\s]/g,''));
 const verify=async(quantities:number[],label:string)=>{
  const startProblems=problems.length;const actualQuantities:string[]=[];
  for(const [index,qty] of quantities.entries()){const control=await resolveDocumentField(page,'数量（册）',index);await control.fill(String(qty));await control.blur();const actual=await control.inputValue();actualQuantities.push(actual);if(actual!==String(qty))problems.push(label+'：第 '+(index+1)+' 行预期数量 '+qty+'，实际为 '+actual);}
  const deadline=Date.now()+1500;let snapshot:Array<{name:string;publisher:string;price:number;weight:number;subtotal:number}>;
  do{snapshot=[];for(let index=0;index<books.length;index++){const row=rows.nth(index);const values=await row.evaluate(el=>{const headers=[...el.closest('table')!.querySelectorAll('thead th')].map(e=>e.textContent?.trim());const cells=[...el.querySelectorAll('td')];const text=(name:string)=>cells[headers.indexOf(name)]?.textContent?.trim()??'';return {name:text('图书名称'),publisher:text('出版社'),price:text('定价(元)'),weight:text('预估总重（公斤）'),subtotal:text('小计(元)')};});snapshot.push({...values,price:numeric(values.price),weight:numeric(values.weight),subtotal:numeric(values.subtotal)});}if(snapshot.every((r,i)=>r.subtotal===Number((books[i]!.price*quantities[i]!).toFixed(2))))break;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);
  for(const [i,row] of snapshot.entries()){const book=books[i]!,qty=quantities[i]!;if(row.name!==book.name||row.publisher!==book.publisher||row.price!==book.price)problems.push(label+'：第 '+(i+1)+' 行书目字段未正确回填');if(row.subtotal!==Number((book.price*qty).toFixed(2)))problems.push(label+'：第 '+(i+1)+' 行小计不等于数量×定价');if(row.weight!==Number((book.weightGrams*qty/1000).toFixed(2)))problems.push(label+'：第 '+(i+1)+' 行公斤重量与独立基线不一致');}
  if(kind==='book-calculation'){
   const totalPrice=page.locator('.total-info .total-price'),totalWeight=page.locator('.total-info .weight');if(await totalPrice.count()!==1||await totalWeight.count()!==1){problems.push('未取得唯一的总价/总重显示');return;}
   const price=Number(books.reduce((sum,b,i)=>sum+b.price*quantities[i]!,0).toFixed(2));const weight=Number(books.reduce((sum,b,i)=>sum+b.weightGrams*quantities[i]!/1000,0).toFixed(2));if(numeric(await totalPrice.innerText())!==price)problems.push(label+'：总计不等于各行小计之和');const weightText=await totalWeight.innerText();const actual=Number(weightText.match(/([\d.]+)\s*公斤/)?.[1]);if(actual!==weight)problems.push(label+'：总重不等于两种图书数量×克重÷1000之和');
  }
  stages.push(label+' '+(problems.length===startProblems?'通过':'失败')+'：预期数量 '+quantities.join(' / ')+'，页面数量 '+actualQuantities.join(' / ')+'；页面小计 '+snapshot.map(r=>r.subtotal.toFixed(2)).join(' / ')+' 元、重量 '+snapshot.map(r=>r.weight.toFixed(2)).join(' / ')+' 公斤');
 };
 if(kind==='book-details')await verify([1],'单本回填');else{await verify([1,1],'下界');await verify([2,3],'多书计算');await verify([9999,1],'上界');}
 delete result.evidence;
 if(problems.length){result.status='failed';result.detail='断言失败：'+problems.join('；')+'。阶段核验：'+stages.join('；')+'。'+(problems.some(p=>p.includes('预期数量'))?'数量输入与预期不同，后续金额/重量差异可能由同一输入截断引起；整条仍为失败。':'');}else result.detail+='；本轮成功接口、独立数据库基线与页面书目/公斤重量一致'+(kind==='book-calculation'?'，数量下界、多书小计总计总重和 9999 上界全部核验。':'。')+'阶段核验：'+stages.join('；')+'。';
}
