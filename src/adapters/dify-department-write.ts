import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import type {Page,Route} from 'playwright';
import {acquireDocumentPageLease,resolveDocumentField,type BrowserCheck,type DocumentProject} from './document-test-workflow.js';
import {getExistingPersistentTestPage} from './browser-runtime.js';
import {browserRequestAllowed} from './login-handoff.js';
import {prepareCompleteDifyForm} from './dify-field-validity-scenarios.js';
import {loadDifyBookFixtures} from './dify-book-scenarios.js';
import {readMarkedDepartmentApplication,readDepartmentGoods} from './mysql-readonly-browser.js';
import {captureDifyPng} from './dify-evidence.js';

type Row=Record<string,any>;
export type DepartmentWriteResult={caseId:string;status:'passed'|'failed'|'blocked';detail:string;evidence?:string;evidenceNote?:string};
type Authorization={schema:1;profileId:string;targetUrl:string;authorizedBy:'user';expiresAt:string;maxSubmissions:number;caseIds:string[]};
type Attempt={recipient:string;remarkLength:number;phase:'reserved'|'passed'|'failed'|'unknown';applyNo?:string;detail?:string;at:string};
type Journal={schema:1;jobId:string;profileId:string;startedAt:string;attempts:Attempt[];results?:DepartmentWriteResult[]};
const known=(u:string)=>{try{const v=new URL(u);return v.origin==='https://cdn.yibentushu.com'&&v.pathname==='/test-sample-apply/index.html';}catch{return false;}};
export function departmentWriteKind(c:Pick<BrowserCheck,'expected'|'source'>){
 if(c.expected==='0<字数≤30：正常提交'&&c.source.includes('员工端-样书申请表单页')&&c.source.includes('备注'))return 'note-submit';
 if(c.expected==='全部必填完成且格式正确：提交按钮可点击，跳转至用书审批详情页并创建待审核记录'&&c.source.includes('员工端-样书申请表单页')&&c.source.includes('点击「提交申请」按钮'))return 'complete-submit';
}
export function validDepartmentWriteAuthorization(a:unknown,p:Pick<DocumentProject,'id'|'targetUrl'>,checks:BrowserCheck[],time=Date.now()):a is Authorization{
 const v=a as Authorization;return !!v&&v.schema===1&&v.authorizedBy==='user'&&known(p.targetUrl)&&v.profileId===p.id&&v.targetUrl===p.targetUrl&&Date.parse(v.expiresAt)>time&&Number.isSafeInteger(v.maxSubmissions)&&v.maxSubmissions>0&&v.maxSubmissions<=20&&Array.isArray(v.caseIds)&&checks.every(c=>!!departmentWriteKind(c)&&v.caseIds.includes(c.id));
}
const database={marked:readMarkedDepartmentApplication,goods:readDepartmentGoods};

/** One bounded business submission. This never changes approval/order states
 * by SQL. The normal webpage runner and its read-only policy are unchanged. */
export async function submitMarkedDepartmentForm(page:Page,project:DocumentProject,dataRoot:string,jobId:string,index:number,note:string,signal:AbortSignal,reserve:(a:Attempt)=>Promise<void>,db=database,prepare=prepareCompleteDifyForm){
 const recipient='TP'+jobId.replaceAll('-','').slice(0,8)+index+'勿发货',address='自动化流程测试勿发货';
 let userId='',armed=false,sent=0,payload:Row|undefined,attempt:Attempt|undefined;
 const policy=async(route:Route)=>{const r=route.request(),u=new URL(r.url());
  if(u.origin==='https://testapi.yibentushu.com'&&u.pathname==='/supply-api/dept/book/apply/submit'){
   if(armed&&!signal.aborted&&r.method()==='OPTIONS')return route.fallback();
   if(armed&&!signal.aborted&&r.method()==='POST'&&sent===0){let p:Row;try{p=r.postDataJSON();}catch{return route.abort('blockedbyclient');}
    // Claim the single request synchronously, before any asynchronous fixture
    // read: two near-simultaneous clicks must not both acquire this permit.
    sent++;
    const books=await loadDifyBookFixtures(dataRoot);
    if(p.receiverName!==recipient||p.receiverPhone!=='13800138000'||p.detailAddress!==address||p.remark!==note||Number(p.applyType)!==1||Number(p.bookUsage)!==1||p.province!=='湖南省'||p.city!=='长沙市'||p.county!=='芙蓉区'||!p.costClientId||!p.costClientName||!Array.isArray(p.goodsList)||p.goodsList.length!==2||books.length<2||!books.slice(0,2).every(b=>p.goodsList.filter((g:Row)=>g.productId===b.code&&Number(g.qty)===1).length===1))return route.abort('blockedbyclient');
    payload=p;return route.fallback();
   }return route.abort('blockedbyclient');
  }
  return browserRequestAllowed(r.method(),r.url(),{targetOrigin:new URL(project.targetUrl).origin,resourceType:r.resourceType(),isNavigationRequest:r.isNavigationRequest(),isMainFrameNavigation:r.isNavigationRequest()&&r.frame()===page.mainFrame()})?route.fallback():route.abort('blockedbyclient');
 };
 await page.unrouteAll({behavior:'wait'});await page.route('**/*',policy);
 try{
  signal.throwIfAborted();if(!known(project.targetUrl))throw Error('Blocked: 测试目标不匹配。');
  await page.goto('about:blank');const identity=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()==='https://testapi.yibentushu.com/supply-api/getInfo',{timeout:12000}).then(async r=>({http:r.status(),b:await r.json()})).catch(()=>undefined);
  const home=new URL(project.targetUrl);home.hash='/home';await page.goto(home.href,{waitUntil:'domcontentloaded',timeout:15000});const who=await identity;
  userId=String(who?.b?.user?.userId??'');if(who?.http!==200||who?.b?.code!==200||!/^\d{1,20}$/.test(userId))throw Error('Blocked: 未取得本轮认证身份，未提交。');
  if((await db.marked(userId,recipient)).length)throw Error('Blocked: 同一测试标记已存在，未重复提交。');
  await prepare(page,project.targetUrl,dataRoot);
  const books=await loadDifyBookFixtures(dataRoot);if(books.length<2)throw Error('Blocked: 缺两个图书的独立基线。');
  await page.getByText('继续添加样书',{exact:true}).click();const code=await resolveDocumentField(page,'自编码',1);await code.fill(books[1]!.code);await code.blur();
  await page.getByText(books[1]!.name,{exact:true}).first().waitFor({state:'visible',timeout:10000});const qty=await resolveDocumentField(page,'数量（册）',1);await qty.fill('1');await qty.blur();
  await page.getByPlaceholder('如有特殊要求请填写备注信息',{exact:true}).fill(note);await page.getByPlaceholder('请输入收件人姓名',{exact:true}).fill(recipient);await page.getByPlaceholder('请输入手机号码',{exact:true}).fill('13800138000');await page.getByPlaceholder('请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等',{exact:true}).fill(address);
  const submit=page.locator('.pc-page-home .home-footer > .button');if(await submit.count()!==1||await submit.evaluate(e=>/disabled/.test(e.className)||e.getAttribute('aria-disabled')==='true'))throw Error('断言失败：其他必填有效且备注长度'+note.length+'，提交按钮仍不可用。');
  signal.throwIfAborted();attempt={recipient,remarkLength:note.length,phase:'reserved',at:new Date().toISOString()};await reserve(attempt);armed=true;
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()==='https://testapi.yibentushu.com/supply-api/dept/book/apply/submit',{timeout:18000}).then(async r=>({http:r.status(),body:await r.json()})).catch(()=>undefined);
  await submit.click({timeout:5000});const reply=await response;armed=false;
  let rows:Row[]=[];for(let i=0;i<6;i++){rows=await db.marked(userId,recipient);if(rows.length)break;await new Promise(r=>setTimeout(r,300));}
  if(!reply||reply.http!==200||reply.body?.code!==200){attempt.phase=rows.length?'unknown':'failed';await reserve(attempt);throw Error((reply?.http===200&&reply.body?.code!==200?'断言失败：':'Blocked: ')+'实际提交未取得成功业务响应；按当前身份和唯一标记查询落库'+rows.length+'条。已保留执行日志，不自动重放提交。'+(reply?.body?.msg?' 服务端提示：'+String(reply.body.msg).slice(0,160):''));}
  if(sent!==1||!payload||rows.length!==1)throw Error('断言失败：接口返回成功，但唯一测试标记未对应恰好一条数据库申请。');
  const stored=rows[0]!,applyNo=String(reply.body.data?.applyNo??'');if(stored.apply_no!==applyNo)throw Error('断言失败：提交响应与数据库申请编号不一致。');
  attempt.applyNo=applyNo;
  for(const [api,col]of Object.entries({receiverName:'receiver_name',receiverPhone:'receiver_phone',detailAddress:'detail_address',province:'province',city:'city',county:'county',remark:'remark',costClientId:'cost_client_id',costClientName:'cost_client_name'}))if(String(stored[col]??'')!==String(payload[api]??''))throw Error('断言失败：落库字段'+api+'与本轮提交值不一致。');
  const goods=await db.goods(applyNo);if(goods.length!==2||!books.slice(0,2).every(b=>goods.filter(g=>g.product_id===b.code&&Number(g.qty)===1&&Number(g.price)===b.price).length===1))throw Error('断言失败：数据库两行图书、数量或单价与本轮独立基线不一致。');
  const amount=books.slice(0,2).reduce((s,b)=>s+b.price,0),grams=books.slice(0,2).reduce((s,b)=>s+b.weightGrams,0);
  if(Number(stored.total_amount)!==Number(amount.toFixed(2))||Number(stored.total_weight)!==grams||Number(stored.examine_status)!==0||Number(stored.lock_status)!==0||!stored.sp_id||!stored.template_id)throw Error('断言失败：真实落库金额、克重、待审批/未锁定状态或审批/模板编号不满足原预期。');
  await page.waitForFunction(no=>location.hash==='#/apply-detail/'+no,applyNo,{timeout:8000});await page.locator('.pc-page-apply-detail .audit-status').filter({hasText:'申请待审批'}).waitFor({state:'visible',timeout:8000});
  attempt.phase='passed';attempt.detail='真实提交、自动跳转、1条主表及2条明细落库一致';await reserve(attempt);
  return{applyNo,remarkLength:note.length,detail:'备注'+note.length+'字，真实POST一次成功；自动跳转同一审批详情并显示待审批。独立TLS数据库按本轮身份和唯一标记找到1条主记录、2条明细，客户/收货/备注/图书数量单价一致；金额'+amount.toFixed(2)+'元、重量'+grams+'克，审批号及模板号已保存。'};
 }catch(e){if(attempt&&attempt.phase==='reserved'){attempt.phase='unknown';attempt.detail='已尝试提交，完整核对未完成；禁止自动重放';await reserve(attempt);}throw e;}
 finally{armed=false;await page.unroute('**/*',policy).catch(()=>{});}
}

export async function executeAuthorizedDepartmentWrites(root:string,project:DocumentProject,jobId:string,checks:BrowserCheck[],signal:AbortSignal,progress:(message:string)=>void):Promise<DepartmentWriteResult[]>{
 const selected=checks.filter(c=>departmentWriteKind(c));if(!selected.length)return[];
 let auth:unknown;try{auth=JSON.parse(await readFile(path.join(root,'dify-web-modules','department-write-authorization.json'),'utf8'));}catch{return[];}
 if(!validDepartmentWriteAuthorization(auth,project,selected))return[];
 const dir=path.join(root,'dify-web-modules','authorized-writes');await mkdir(dir,{recursive:true});const file=path.join(dir,jobId+'.json');
 try{const old=JSON.parse(await readFile(file,'utf8')) as Journal;if(old.results)return old.results;return selected.map(c=>({caseId:c.id,status:'blocked',detail:'本任务存在未完成的真实写入日志；先按唯一标记核对，不自动重放。'}));}catch{}
 const release=acquireDocumentPageLease(project.id);if(!release)return selected.map(c=>({caseId:c.id,status:'blocked',detail:'业务测试窗口被占用，未提交。'}));
 const journal:Journal={schema:1,jobId,profileId:project.id,startedAt:new Date().toISOString(),attempts:[]};const results:DepartmentWriteResult[]=[];
 let page:Page|undefined;
 try{
  let used=0;for(const name of await readdir(dir)){if(!/^[a-f0-9-]+\.json$/.test(name))continue;const j=JSON.parse(await readFile(path.join(dir,name),'utf8')) as Journal;if(j.profileId===project.id)used+=j.attempts.length;}
  const notes=selected.some(c=>departmentWriteKind(c)==='note-submit')?['测',('TP'+jobId.replaceAll('-','')).slice(0,27)+'勿发货']:[('TP'+jobId.replaceAll('-','')).slice(0,27)+'勿发货'];
  if(used+notes.length>auth.maxSubmissions)throw Error('Blocked: 本轮授权的有界测试提交数量已用完；未创建新申请。');
  const session=await getExistingPersistentTestPage(path.join(root,'document-tests','browser-profiles',project.browserProfileIsolation?`isolated-${project.id}`:project.id),{isolated:project.browserProfileIsolation===true});if(!session)throw Error('Blocked: 已登录测试窗口不可用。');page=session.page;
  await writeFile(file,JSON.stringify(journal,null,2),{flag:'wx'});
  const save=async(a:Attempt)=>{const at=journal.attempts.findIndex(v=>v.recipient===a.recipient);if(at<0)journal.attempts.push({...a});else journal.attempts[at]={...a};await writeFile(file,JSON.stringify(journal,null,2));};
  const observations:string[]=[],successful:string[]=[];let problem:string|undefined;
  for(let i=0;i<notes.length;i++){progress('正在执行授权测试写入：备注'+notes[i]!.length+'字；提交前保存标记，提交后逐字段核对落库。');try{const r=await submitMarkedDepartmentForm(page,project,root,jobId,i,notes[i]!,signal,save);observations.push(r.detail);successful.push(r.detail);}catch(e){problem=e instanceof Error?e.message:'Blocked: 实际业务提交核对未完成。';break;}}
  let evidence:string|undefined;const style=await page.addStyleTag({content:'.pc-page-home input,.pc-page-home textarea,.pc-page-apply-detail .value,.pc-page-apply-detail .info-step .hint1,.pc-page-apply-detail .info-step .hint2,.pc-page-apply-detail .audit-status .desc{color:transparent!important;text-shadow:none!important}'});
  try{const png=await captureDifyPng(page),folder=path.join(root,'dify-web-modules','evidence',jobId);await mkdir(folder,{recursive:true});evidence=createHash('sha256').update(png).digest('hex')+'.png';await writeFile(path.join(folder,evidence),png);}finally{await style.evaluate(el=>el.parentNode?.removeChild(el));}
  for(const c of selected){const ok=departmentWriteKind(c)==='complete-submit'?successful.length>0:observations.length===notes.length&&!problem;results.push({caseId:c.id,status:ok?'passed':problem?.startsWith('断言失败：')?'failed':'blocked',detail:ok?(departmentWriteKind(c)==='note-submit'?'备注1字和30字边界分别真实提交并落库。':'全部必填有效，已实际点击提交、自动跳转并创建本人待审核记录。')+observations.join(' '):[...observations,problem??'完整写入验证未完成。'].join(' '),...(evidence?{evidence,evidenceNote:'本轮真实业务提交后的脱敏页面；数据库证据为独立TLS只读回查，未用SQL改审批状态。'}:{})});}
 }catch(e){const message=e instanceof Error?e.message:'Blocked: 写入验证未完成。';for(const c of selected)results.push({caseId:c.id,status:message.startsWith('断言失败：')?'failed':'blocked',detail:message.replace(/^Blocked: /,'')});}
 finally{journal.results=results;await writeFile(file,JSON.stringify(journal,null,2));release();}
 return results;
}
