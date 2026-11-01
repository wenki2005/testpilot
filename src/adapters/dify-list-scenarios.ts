import type {Page,Request} from 'playwright';
import {actionablePreconditions,type BrowserCheck} from './document-test-workflow.js';
import {isLoginPage} from './login-handoff.js';
import {captureDifyPng} from './dify-evidence.js';

export type DifyListKind='application-usage-filter'|'application-status-filter'|'order-matching-search'|'profile-shortcuts';
export function difyListKind(check:Pick<BrowserCheck,'source'|'expected'>):DifyListKind|undefined{
 if(check.expected==='按用途筛选（营销用书/产品用书）生效'&&check.source.includes('历史申请记录页'))return 'application-usage-filter';
 if(check.expected==='按状态筛选（待审批/已通过/已驳回）生效'&&check.source.includes('历史申请记录页'))return 'application-status-filter';
 if(check.expected==='模糊匹配返回对应订单'&&check.source.includes('关键字搜索订单'))return 'order-matching-search';
 if(check.expected==='页面平滑切换，数据实时加载，默认展示全部并支持分页20条'&&check.source.includes('员工端-我的页面')&&check.source.includes('快捷入口'))return 'profile-shortcuts';
}
export function reviewDifyList(check:BrowserCheck,evidence:string,targetUrl?:string){
 const kind=difyListKind(check);if(!kind||actionablePreconditions(check).length)return;
 let target:URL;try{target=new URL(targetUrl??'');}catch{return;}
 if(target.origin!=='https://cdn.yibentushu.com'||!target.pathname.startsWith('/test-sample-apply/'))return;
 let observed:{navigation?:string[];controls?:Array<{placeholder?:string}>};try{observed=JSON.parse(evidence);}catch{return;}
 if(observed.controls?.filter(c=>c.placeholder==='请输入收件人姓名').length!==1)return;
 const entry=kind==='order-matching-search'?'订单物流':'历史申请记录';
 if(kind!=='profile-shortcuts'&&observed.navigation?.filter(n=>n===entry).length!==1)return;
 const steps:BrowserCheck['steps']=kind==='profile-shortcuts'?[{action:'assertText',text:'费用划归客户'},{action:'assertText',text:'收件人'}]:[{action:'clickExactText',text:entry},{action:'assertText',text:kind==='order-matching-search'?'待发货':'营销用书'}];
 return {kind,steps,detail:'Dify 只读扩展：实际触发本条入口/筛选/搜索，绑定本条新请求和响应；有匹配数据才验证结果集，零记录只保留子检查并明确阻塞。原始预期与分页要求不降低。'};
}
type Result={status:string;detail:string;evidence?:string;evidenceNote?:string};
type Read={url:URL;rows:Record<string,unknown>[];total:number};
const application='dept/book/apply/myList',orders='h5/dept/book/order/myList';
const matches=(raw:string,suffix:string)=>{try{const u=new URL(raw);return u.origin==='https://testapi.yibentushu.com'&&u.pathname==='/supply-api/'+suffix;}catch{return false;}};

/** Runtime-only row values never leave this callback. Persist counts, booleans
 * and fixed labels only; another account's records are never queried. */
export async function verifyDifyListResult(page:Page,check:BrowserCheck,result:Result,targetUrl:string,saveEvidence:(png:Buffer)=>Promise<string>){
 const kind=difyListKind(check);if(!kind||result.status!=='passed')return;
 const original=await page.evaluate(()=>({ua:navigator.userAgent,width:innerWidth,height:innerHeight,url:location.href}));
 const client=await page.context().newCDPSession(page);let mobile=false;const stages:string[]=[];
 const load=async(route:string)=>{await page.goto('about:blank');const url=new URL(targetUrl);url.hash=route;await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:15000});if(await isLoginPage(page))throw Error('Blocked: 当前账号登录未保持，未执行记录断言。');};
 const read=async(suffix:string,action:()=>Promise<void>,predicate?:(url:URL)=>boolean):Promise<Read>=>{
  const fresh=new Set<Request>();const onRequest=(r:Request)=>{if(r.method()==='GET'&&matches(r.url(),suffix)&&(!predicate||predicate(new URL(r.url()))))fresh.add(r);};page.on('request',onRequest);
  const pending=page.waitForResponse(r=>fresh.has(r.request()),{timeout:10000}).then(async r=>{const body=await r.json();if(r.status()!==200||body.code!==200||!Array.isArray(body.rows)||!Number.isFinite(Number(body.total)))throw Error('Blocked: 本条列表查询未返回成功且结构完整的数据，空白不算正常空态。');return {url:new URL(r.url()),rows:body.rows,total:Number(body.total)};});
  try{await action();return await pending;}finally{page.off('request',onRequest);void pending.catch(()=>{});}
 };
 const capture=async()=>{
  delete result.evidence;let timer:ReturnType<typeof setTimeout>|undefined,style:import('playwright').ElementHandle|undefined;
  try{
   await page.bringToFront();
   if(kind==='order-matching-search')style=await page.addStyleTag({content:'input[placeholder="搜索订单号/书籍"]{color:transparent!important}'});
   result.evidence=await saveEvidence(await captureDifyPng(page,client));
   result.evidenceNote='本条只读操作后的同轮页面截图；'+(result.status==='blocked'?'已完成的子检查不代表完整用例通过。':'原始预期保持。')+(kind==='order-matching-search'?'业务订单关键词已脱敏。':'');
  }catch{if(result.status==='passed')result.status='blocked';result.detail+='；本轮截图采集未完成，未借用其他用例或历史截图。';}
  finally{if(timer)clearTimeout(timer);await style?.evaluate(el=>el.parentNode?.removeChild(el)).catch(()=>{});}
 };
 try{
  if(kind==='profile-shortcuts'){
   mobile=true;await client.send('Network.setUserAgentOverride',{userAgent:original.ua.replace(/ Mobile/g,'')+' Mobile'});await page.setViewportSize({width:390,height:844});
   for(const [label,route,suffix] of [['我的申请','/apply',application],['订单物流','/logistics',orders]]){
    await load('/my');await page.locator('.page-my').waitFor({state:'visible',timeout:7000});
    const response=await read(suffix!,()=>page.getByText(label!,{exact:true}).click({timeout:5000}));
    if(new URL(page.url()).hash.split('?')[0]!=='#'+route)throw Error('断言失败：我的页面快捷入口没有进入对应列表。');
    if(response.url.searchParams.get('pageSize')!=='20'||response.url.searchParams.get('pageNum')!=='1')throw Error('断言失败：'+label+'默认分页参数不是每页20条、第一页。');
    if(['bookUsage','examineStatus','orderStatus','keyword'].some(key=>!!response.url.searchParams.get(key)))throw Error('断言失败：'+label+'入口没有默认展示全部。');
    stages.push(label+'：实际入口、成功新查询、默认全部、每页20条已核对');
    if(response.total<=20){result.status='blocked';continue;}
    const next=await read(suffix!,()=>page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight)).then(()=>{}),u=>u.searchParams.get('pageNum')==='2');
    if(next.url.searchParams.get('pageSize')!=='20'||next.rows.length>20)throw Error('断言失败：'+label+'第二页未遵守20条分页。');
    stages.push(label+'：第二页加载已实际触发');
   }
   result.detail=stages.join('；')+(result.status==='blocked'?'；当前账号没有足够的本人记录，无法验证20条后的翻页和有记录列表；保留原始完整预期为阻塞。':'；两条入口与分页链均完成。');
  }else{
   const suffix=kind==='order-matching-search'?orders:application;
   const baseline=await read(suffix,()=>load(kind==='order-matching-search'?'/logistics':'/apply'));
   if(kind==='order-matching-search'){
    if(!baseline.rows.length){result.status='blocked';result.detail='本轮同账号订单查询成功但为0条；缺少可匹配的本人订单，未使用他人订单或把无匹配空态当成模糊命中通过。';}
    else{
     const originalOrder=baseline.rows[0]!,code=originalOrder.orderNo;
     if(typeof code!=='string'||code.length<4)throw Error('Blocked: 本人订单缺少可唯一核对的订单编号，未猜测字段。');
     const keyword=code.slice(0,-2),input=page.getByPlaceholder('搜索订单号/书籍',{exact:true});
     const searched=await read(orders,async()=>{await input.fill(keyword);await input.press('Enter');await input.blur();},u=>u.searchParams.get('keyword')===keyword);
     if(!searched.rows.some(row=>row.orderNo===code)||searched.rows.some(row=>!String(row.orderNo??'').includes(keyword)&&!String(row.firstBookName??'').includes(keyword)))throw Error('断言失败：部分订单关键词查询没有正确返回对应本人订单。');
     result.detail='本轮使用本人列表中的订单编号部分关键词实际查询；成功响应包含原订单且当前页均匹配，业务编号未持久化。';
    }
   }else{
    const usage=kind==='application-usage-filter',key=usage?'bookUsage':'examineStatus';
    const options=usage?['营销用书','产品用书']:['待审批','已通过','已驳回'];let datasetComplete=baseline.total===baseline.rows.length&&baseline.rows.length>0;const used=new Set<string>();
    for(const label of options){
     const control=page.getByText(label,{exact:true}).filter({visible:true});if(await control.count()!==1)throw Error('Blocked: 申请列表筛选项不是唯一可见控件，未猜测点击。');
     const response=await read(application,()=>control.click({timeout:5000}),u=>u.searchParams.has(key)&&u.searchParams.get(key)!=='');
     const value=response.url.searchParams.get(key)!;if(used.has(value))throw Error('断言失败：不同筛选项发送了相同筛选值。');used.add(value);
     if(response.rows.some(row=>String(row[key])!==value))throw Error('断言失败：'+label+'筛选返回了不属于该项的记录。');
     if(!await control.evaluate(el=>el.classList.contains('active')))throw Error('断言失败：'+label+'筛选后未标记当前选项。');
     stages.push(label+'：已实际点击、对应查询成功、选中态正确（'+response.total+'条）');
     const expected=baseline.rows.filter(row=>String(row[key])===value);
     if(!expected.length||response.total!==expected.length||response.rows.length!==expected.length)datasetComplete=false;
     else if(JSON.stringify(expected.map(row=>row.applyNo).sort())!==JSON.stringify(response.rows.map(row=>row.applyNo).sort()))throw Error('断言失败：'+label+'筛选结果与本轮完整本人基线集合不一致。');
    }
    if(!datasetComplete){result.status='blocked';result.detail=stages.join('；')+'；缺少涵盖各分类/状态的本人记录，不能用全部为空证明筛选结果正确，完整用例仍阻塞。';}
    else result.detail=stages.join('；')+'；筛选结果与本轮完整本人基线集合逐项一致。';
   }
  }
 }catch(error){const message=error instanceof Error?error.message:'';result.status=message.startsWith('断言失败：')?'failed':'blocked';result.detail=message.startsWith('断言失败：')||message.startsWith('Blocked: ')?message.replace(/^Blocked: /,''):'本条入口/筛选/搜索未取得完整的新查询或页面证据；保留阻塞，未把超时或空白判通过。';}
 finally{
  await capture();
  if(mobile){try{await client.send('Network.setUserAgentOverride',{userAgent:original.ua});await page.setViewportSize({width:original.width,height:original.height});}catch{if(result.status==='passed')result.status='blocked';result.detail+='；原设备恢复未完成。';}}
  try{await page.goto('about:blank');await page.goto(original.url,{waitUntil:'domcontentloaded',timeout:15000});}catch{if(result.status==='passed')result.status='blocked';result.detail+='；原页面恢复未完成。';}
  await client.detach().catch(()=>{});
 }
}
