import type {Page,Request} from 'playwright';
import {actionablePreconditions,type BrowserCheck} from './document-test-workflow.js';
export type InvalidBookKind='book-missing'|'new-row-invalid-book';
type Result={status:string;detail:string;evidence?:string};
const prepared=new WeakMap<Page,{caseId:string;result:Result}>();
export function invalidBookKind(check:Pick<BrowserCheck,'expected'|'source'>):InvalidBookKind|undefined{
 if(check.expected==='编码不存在/输入错误：输入框边框变红，显示「未获取图书信息」'&&check.source.includes('输入物流编码'))return 'book-missing';
 if(check.expected==='新增行编码同样需通过易诚通校验，否则边框变红'&&check.source.includes('向下复制空白图书明细行'))return 'new-row-invalid-book';
}
export function reviewInvalidBook(check:BrowserCheck,evidence:string,targetUrl?:string){
 const kind=invalidBookKind(check);if(!kind||actionablePreconditions(check).length)return;
 let u:URL,p:{bookCodeAliasConfirmed?:boolean;bookCodeLabel?:string};try{u=new URL(targetUrl??'');p=JSON.parse(evidence);}catch{return;}
 if(u.origin!=='https://cdn.yibentushu.com'||!u.pathname.startsWith('/test-sample-apply/')||!p.bookCodeAliasConfirmed||!['自编码','物流编码'].includes(p.bookCodeLabel??''))return;
 return {kind,steps:[{action:'assertExactVisible' as const,text:p.bookCodeLabel!},{action:'blurByLabel' as const,label:p.bookCodeLabel!,rowIndex:kind==='book-missing'?0:1},{action:'assertFieldInvalid' as const,label:p.bookCodeLabel!,rowIndex:kind==='book-missing'?0:1},...(kind==='book-missing'?[{action:'assertExactVisible' as const,text:'未获取图书信息'}]:[])],detail:'只读审核：在本条准备钩子中实际输入固定数字探针，绑定该次图书查询；仅确认为不存在才核验原始红边及提示。新增行场景另核对原行不变；固定步骤再次直接断言字段无效，完整运行后检查不能由标题代替。'};
}
export async function prepareInvalidBook(page:Page,check:BrowserCheck){
 if(!invalidBookKind(check))return;prepared.delete(page);const result:Result={status:'passed',detail:''};await verifyInvalidBook(page,check,result);prepared.set(page,{caseId:check.id,result});
}
export async function verifyInvalidBook(page:Page,check:BrowserCheck,result:Result){
 const prior=prepared.get(page);if(prior?.caseId===check.id){prepared.delete(page);delete result.evidence;if(prior.result.status!=='passed'||result.status==='passed'){result.status=prior.result.status;result.detail=prior.result.detail;}else result.detail+='；准备阶段观察：'+prior.result.detail;return;}
 const kind=invalidBookKind(check);if(!kind||result.status!=='passed')return;delete result.evidence;
 try{
  const u=new URL(page.url());if(u.origin!=='https://cdn.yibentushu.com'||!u.pathname.startsWith('/test-sample-apply/')||u.hash.split('?')[0]!=='#/home')throw Error('Blocked: 当前不是未提交申请表单。');
  const tables=page.locator('.pc-page-home .word-pc-sample-item table'),rows=tables.locator('tbody tr');
  if(await rows.count()!==1)throw Error('Blocked: 未取得一行空白样书基线。');
  const snapshot=()=>rows.first().evaluate(el=>({cells:[...el.querySelectorAll('td')].slice(0,7).map(e=>e.textContent),values:[...el.querySelectorAll('input')].map(e=>e.value)}));const initial=await snapshot();
  if(kind==='new-row-invalid-book'){const add=page.locator('.pc-page-home').getByText('继续添加样书',{exact:true}).filter({visible:true});if(await add.count()!==1)throw Error('Blocked: 添加入口未唯一定位。');await add.click({timeout:5000});await page.waitForFunction(()=>document.querySelectorAll('.pc-page-home .word-pc-sample-item tbody tr').length===2,undefined,{timeout:3000});}
  const row=rows.nth(kind==='book-missing'?0:1),input=row.locator('td').first().locator('input');
  if(await input.count()!==1)throw Error('Blocked: 编码输入框未唯一定位。');
  const code='0000000000000',requests=new Set<Request>();const start=(r:Request)=>{try{const x=new URL(r.url());if(r.method()==='GET'&&x.origin==='https://testapi.yibentushu.com'&&x.pathname==='/supply-api/dept/book/apply/bookCheck'&&x.searchParams.get('productId')===code)requests.add(r);}catch{}};
  page.on('request',start);const pending=page.waitForResponse(r=>requests.has(r.request()),{timeout:10000}).then(async r=>({status:r.status(),body:await r.json()})).catch(()=>undefined);
  let read;try{await input.fill(code);await input.blur();read=await pending;}finally{page.off('request',start);}
  if(!read||read.status!==200||!read.body||typeof read.body.msg!=='string'||!/(?:图书|书籍|商品|编码).{0,12}(?:不存在|未找到|未获取)|(?:未找到|未获取).{0,12}(?:图书|书籍|商品)/.test(read.body.msg)||read.body.code===200)throw Error('Blocked: 本条探针未取得明确的图书不存在响应；超时、系统错误和真实存在均不当无效编码基线。');
  const red=await input.evaluate(el=>{const isRed=(v:string)=>{const a=v.match(/[\d.]+/g)?.map(Number)??[];return a.length>=3&&a[0]!>=120&&a[0]!>a[1]!*1.3&&a[0]!>a[2]!*1.3;};let node:Element|null=el;for(let n=0;node&&n<3;n++,node=node.parentElement){const s=getComputedStyle(node);if([s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor].some(isRed)||/rgba?\([^)]*\)/g.test(s.boxShadow)&&[...s.boxShadow.matchAll(/rgba?\([^)]*\)/g)].some(m=>isRed(m[0])))return true;}return false;});
  const hint=kind==='book-missing'?await page.getByText('未获取图书信息',{exact:true}).filter({visible:true}).count()===1:true;
  if(kind==='new-row-invalid-book'&&JSON.stringify(await snapshot())!==JSON.stringify(initial))throw Error('断言失败：新增行编码校验改变了原有行内容。');
  if(!red||!hint)throw Error('断言失败：本轮'+(kind==='new-row-invalid-book'?'新增行':'首行')+'已实际查询不存在的数字编码；'+(!red?'输入框边框未变红':'红边已验证')+(kind==='book-missing'?'，'+(!hint?'未显示原始提示「未获取图书信息」':'原始提示已验证'):'')+'。');
  result.detail='本轮'+(kind==='new-row-invalid-book'?'实际新增第二行并':'首行')+'输入不存在数字编码，成功取得对应不存在响应，输入框边框变红'+(kind==='book-missing'?'且显示原始提示「未获取图书信息」':'且原行内容保持')+'；未提交申请。';
 }catch(error){const m=error instanceof Error?error.message:'';result.status=m.startsWith('断言失败：')?'failed':'blocked';result.detail=/^(断言失败：|Blocked: )/.test(m)?m.replace(/^Blocked: /,''):'无效图书编码未取得完整查询及页面证据。';}
}
