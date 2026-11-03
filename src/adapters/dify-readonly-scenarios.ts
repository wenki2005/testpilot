import type {Page,Response,Request} from 'playwright';
import {createHash} from 'node:crypto';
import type {DifyCustomerFixture} from './dify-readonly-fixtures.js';
import {difyBookKind} from './dify-book-scenarios.js';
import {difyDeviceKind} from './dify-device-scenarios.js';
import {applicationFilter,difyListKind} from './dify-list-scenarios.js';
import {fieldValidityKind} from './dify-field-validity-scenarios.js';
import {isSampleRowDelete,verifySampleRowDelete} from './dify-sample-row-scenarios.js';
import {difyRecordKind} from './dify-record-scenarios.js';
import {invalidBookKind} from './dify-invalid-book-scenarios.js';
import {isExcludedCustomer} from './dify-excluded-customer-scenarios.js';
import {clientValidationKind} from './dify-client-validation-scenarios.js';
import {isApplicantIdentity} from './dify-applicant-identity-scenarios.js';
import {actionablePreconditions,type BrowserCheck} from './document-test-workflow.js';
import {browserRequestAllowed} from './login-handoff.js';
import{connectedEvidenceKind}from'./dify-connected-contract.js';

export type DepartmentReadOnlyKind='application-empty'|'order-empty'|'order-no-match'|'customer-no-match'|'quantity-range'|'phone-invalid'|'recipient-required'|'recipient-length'|'address-required'|'courier-fixed'|'region-selection'|'region-incomplete'|'book-nonnumeric'|'customer-external'|'customer-internal'|'customer-match'|'book-row-add'|'sample-row-delete';
export const noMatchProbe='TP_NO_MATCH_7E41_A023';
export function departmentReadOnlyKind(check:Pick<BrowserCheck,'expected'|'source'>):DepartmentReadOnlyKind|undefined{
 const e=check.expected,s=check.source??'';
 if(e==='无符合条件记录：空状态'&&s.includes('历史申请记录页'))return 'application-empty';
 if(e==='无订单：展示空状态'&&s.includes('订单列表页'))return 'order-empty';
 if(e==='无匹配：提示无结果'&&s.includes('关键字搜索订单'))return 'order-no-match';
 if(e==='无匹配客户：下拉无结果并提示'&&s.includes('费用划归客户'))return 'customer-no-match';
 if(e==='数量>9999：前端拦截提示超出范围'&&s.includes('输入图书数量'))return 'quantity-range';
 if(e==='非11位/含非数字字符：红色提示「手机号格式错误」P1'&&s.includes('填写手机号码'))return 'phone-invalid';
 if(e==='>20字：限制输入'&&s.includes('填写收件人'))return 'recipient-length';
 if(e==='为空：字段标红提示必填'&&s.includes('填写收件人'))return 'recipient-required';
 if(e==='未填写：标红提示必填'&&s.includes('填写详细地址'))return 'address-required';
 if(e==='发货方式固定为「快递」，无其他可选'&&s.includes('发货方式'))return 'courier-fixed';
 if(/快递公司由旺店通店铺默认快递决定/u.test(e)&&s.includes('发货方式'))return 'courier-fixed';
 if(e==='1004.00 外部客户—合作客户：正常展示可选'&&s.includes('客户列表数据范围'))return 'customer-external';
 if(e==='1004.06 内部客户—部门费用：正常展示可选'&&s.includes('客户列表数据范围'))return 'customer-internal';
 if(e==='命中关键词：下拉展示匹配客户名称供选择'&&s.includes('费用划归客户'))return 'customer-match';
 if(e==='新增一行含物流编码、图书数量、图书名称、出版社、定价字段'&&s.includes('向下复制空白图书明细行'))return 'book-row-add';
 if(isSampleRowDelete(check))return 'sample-row-delete';
 if(e==='逐级选择成功回填所在地区'&&s.includes('省/市/区三级联动'))return 'region-selection';
 if(e==='未选全三级：提交校验标红'&&s.includes('省/市/区三级联动'))return 'region-incomplete';
 if(e==='输入非数字：校验拦截，不调用接口'&&s.includes('输入物流编码'))return 'book-nonnumeric';
}
export const needsDifyReadback=(check:Pick<BrowserCheck,'expected'|'source'>)=>{const k=departmentReadOnlyKind(check);return !!connectedEvidenceKind(check)||isApplicantIdentity(check)||!!clientValidationKind(check)||isExcludedCustomer(check)||!!invalidBookKind(check)||!!difyRecordKind(check)||isSampleRowDelete(check)||!!fieldValidityKind(check)||!!difyListKind(check)||!!difyDeviceKind(check)||!!difyBookKind(check)||!!k&&['application-empty','order-empty','order-no-match','customer-no-match','phone-invalid','courier-fixed','region-selection','region-incomplete','customer-external','customer-internal','customer-match','book-row-add'].includes(k);};
export const isDifyRecordIndependent=(check:Pick<BrowserCheck,'expected'|'source'>)=>isApplicantIdentity(check)||!!clientValidationKind(check)||!!fieldValidityKind(check)||!!difyDeviceKind(check)||!!difyBookKind(check)||!!departmentReadOnlyKind(check)||['必填未完成时提交按钮置灰不可点击','>30字：限制输入或提示超长','>20字：限制输入'].includes(check.expected);

/** Only these source-bound scenarios can replace old shell steps; all other holds remain. */
export function reviewDepartmentReadOnly(check:BrowserCheck,evidence:string,targetUrl?:string):{kind:DepartmentReadOnlyKind;steps:BrowserCheck['steps'];detail:string}|undefined{
 let url:URL;try{url=new URL(targetUrl??'');}catch{return;}
 if(url.origin!=='https://cdn.yibentushu.com'||!url.pathname.startsWith('/test-sample-apply/')||actionablePreconditions(check).length)return;
 const kind=departmentReadOnlyKind(check);if(!kind)return;
 // The original expectation explicitly requires validation at submission.
 // Selecting two regions and inspecting blur state cannot establish it.
 if(kind==='region-incomplete')return;
 let page:{navigation?:string[];customerSearchIndex?:number;regionSearchIndexes?:number[];bookCodeLabel?:string;bookCodeAliasConfirmed?:boolean;customerFixtures?:DifyCustomerFixture[];controls?:Array<{placeholder?:string}>};try{page=JSON.parse(evidence);}catch{return;}
 const has=(value:string)=>page.controls?.filter(c=>c.placeholder===value).length===1;
 const nav=(value:string)=>page.navigation?.filter(n=>n===value).length===1;
 let steps:BrowserCheck['steps'];
 if(kind==='application-empty'){
  if(!nav('历史申请记录'))return;
  steps=[{action:'clickExactText',text:'历史申请记录'},{action:'assertText',text:'产品用书'}];
 }else if(kind==='order-empty'||kind==='order-no-match'){
  if(!nav('订单物流'))return;
  steps=kind==='order-empty'?[{action:'clickExactText',text:'订单物流'},{action:'assertExactVisible',text:'暂无订单物流记录'}]:[{action:'clickExactText',text:'订单物流'},{action:'assertText',text:'待发货'},{action:'fillByPlaceholder',placeholder:'搜索订单号/书籍',value:noMatchProbe},{action:'blurByPlaceholder',placeholder:'搜索订单号/书籍'},{action:'assertExactVisible',text:'暂无订单物流记录'}];
 }else if(kind==='customer-no-match'){
  if(Number.isInteger(page.customerSearchIndex)&&page.customerSearchIndex!>=0&&page.customerSearchIndex!<=9)steps=[{action:'fillByRoleIndex',role:'combobox',index:page.customerSearchIndex!,value:noMatchProbe},{action:'assertExactVisible',text:'无数据'}];
  else if(has('请输入关键字或编码查询'))steps=[{action:'fillByPlaceholder',placeholder:'请输入关键字或编码查询',value:noMatchProbe},{action:'assertValueByPlaceholder',placeholder:'请输入关键字或编码查询',value:noMatchProbe},{action:'assertExactVisible',text:'无数据'}];else return;
 }else if(['customer-external','customer-internal','customer-match'].includes(kind)){
  const fixture=page.customerFixtures?.find(f=>f.category===(kind==='customer-internal'?'1004.06':'1004.00'));
  if(!fixture||!/^(?:\d{4}CL\d{12}|\d{2}-\d{5})$/.test(fixture.code)||!Number.isInteger(page.customerSearchIndex)||page.customerSearchIndex!<0||page.customerSearchIndex!>9)return;
  steps=[{action:'fillByRoleIndex',role:'combobox',index:page.customerSearchIndex!,value:fixture.code},...(kind==='customer-match'?[{action:'fillByRoleIndex' as const,role:'combobox' as const,index:page.customerSearchIndex!,value:fixture.code.slice(0,-1)}]:[]),{action:'assertText',text:'费用划归客户'}];
 }else if(kind==='book-row-add'){
  if(!page.bookCodeAliasConfirmed||!['自编码','物流编码'].includes(page.bookCodeLabel??''))return;
  steps=[page.bookCodeLabel!,'数量（册）','图书名称','出版社','定价(元)'].map(text=>({action:'assertExactVisible' as const,text}));
 }else if(kind==='sample-row-delete'){
  if(!page.bookCodeAliasConfirmed||!['自编码','物流编码'].includes(page.bookCodeLabel??''))return;
  steps=[{action:'assertExactVisible' as const,text:page.bookCodeLabel!},{action:'assertExactVisible' as const,text:'继续添加样书'}];
 }else if(kind==='region-selection'){
  const indexes=page.regionSearchIndexes;if(indexes?.length!==3||new Set(indexes).size!==3||indexes.some(i=>!Number.isInteger(i)||i<0||i>9))return;
  steps=['湖南省','长沙市','芙蓉区'].flatMap((value,i)=>[{action:'selectByRoleIndex' as const,role:'combobox' as const,index:indexes[i]!,value},{action:'assertExactVisible' as const,text:value}]);
 }else if(kind==='book-nonnumeric'){
  if(!['自编码','物流编码'].includes(page.bookCodeLabel??''))return;
  const label=page.bookCodeLabel!;steps=[{action:'startFetchOrXhrCapture'},{action:'fillByLabel',label,value:'TP_INVALID_ALPHA'},{action:'blurByLabel',label},{action:'assertFieldInvalid',label},{action:'assertNoFetchOrXhr',quietMs:1000}];
 }else if(kind==='quantity-range'){
  if(!has('请输入收件人姓名'))return;
  steps=[{action:'fillByLabel',label:'数量（册）',value:'10000'},{action:'blurByLabel',label:'数量（册）'},{action:'assertText',text:'超出范围'}];
 }else if(kind==='courier-fixed'){
  if(!has('请输入收件人姓名'))return;steps=[{action:'assertExactVisible',text:'仅支持快递'}];
 }else if(kind==='recipient-length'){
  const placeholders=['请输入收件人姓名','请输入收件人'].filter(value=>has(value));if(placeholders.length!==1)return;
  const placeholder=placeholders[0]!;steps=[{action:'assertVisible',text:'收货信息'},{action:'assertVisible',text:'收件人'},{action:'fillByPlaceholder',placeholder,value:'ABCDEFGHIJKLMNOPQRSTUVWXY'},{action:'assertValueByPlaceholder',placeholder,value:'ABCDEFGHIJKLMNOPQRST'}];
 }else if(kind==='recipient-required'||kind==='address-required'){

  if(kind==='recipient-required'?!has('请输入收件人姓名'):page.controls?.filter(c=>c.placeholder?.startsWith('请输入详细地址')).length!==1)return;
  const label=kind==='recipient-required'?'收件人':'详细地址';steps=[{action:'fillByLabel',label,value:''},{action:'blurByLabel',label},{action:'assertFieldInvalid',label},{action:'assertText',text:'必填'}];
 }else{
  if(!has('请输入手机号码'))return;
  steps=['123','12a45678901'].flatMap(value=>[{action:'fillByPlaceholder' as const,placeholder:'请输入手机号码',value},{action:'blurByPlaceholder' as const,placeholder:'请输入手机号码'},{action:'assertFieldInvalid' as const,label:'手机号码'},{action:'assertText' as const,text:'手机号格式错误'}]);
 }
 return {kind,steps,detail:'只读审核：'+({ 'application-empty':'实际进入本人申请列表，并检查本轮成功查询的零条结果与空态。','order-empty':'实际进入订单列表，核对无筛选成功查询为零条及空态。','order-no-match':'实际输入固定无匹配关键词并触发查询，核对本轮查询参数、零条结果与空态。','customer-no-match':'实际输入固定无匹配关键词，核对本轮客户查询为零条、下拉没有可选项且有空态提示。','quantity-range':'实际输入 10000 并失焦，保留原始超出范围提示断言。','phone-invalid':'分别输入短号码和含非数字字符的号码并失焦，核对字段错误、原始提示及提示颜色。','recipient-length':'使用本轮唯一收件人输入框输入25字符，并核对原预期的20字符截断，不通过相邻同名标签猜测控件。','recipient-required':'清空收件人并失焦，检查字段自身错误和原始必填提示。','address-required':'清空详细地址并失焦，检查字段自身错误和原始必填提示。','customer-external':'使用只读数据库确认的 1004.00 固定编码搜索，核对本轮返回的同一客户、实际选择和字段回填。','customer-internal':'使用只读数据库确认的 1004.06 固定编码搜索，核对本轮返回的同一客户、实际选择和字段回填。','customer-match':'使用固定客户编码去掉末位的部分关键词查询，核对本轮命中项、实际选择和字段回填。','book-row-add':'使用原 XMind 明确的物流编码（自编码/erp编码）映射，实际新增一行并核对行数增加及五类空白字段；不只检查列标题。','region-selection':'依次选择湖南省、长沙市、芙蓉区，并核对当前地区字段三个选中值，不用隐藏下拉文字代替回填。','region-incomplete':'只选择湖南省和长沙市，直接检查所在地区字段自身无效状态。','sample-row-delete':'实际新增一行并执行行内删除，确认删除操作只影响未提交的样书行。','book-nonnumeric':'输入非数字编码并失焦，检查字段自身拦截和限定窗口内没有 fetch/XHR，包括被策略阻止的请求也不能忽略。','courier-fixed':'核对固定快递文案，并检查发货方式所在字段区域未提供其他可选控件。'}[kind])+' 未提交申请或写数据库。'};
}

export type DifyReadObservation={path:string;keyword:string;unfiltered:boolean;ok:boolean;rows?:number;total?:number;blockedByPolicy?:boolean;customers?:Array<{code:string;labelDigest:string}>};
function allowedReadOrigin(url:URL,targetUrl:string){const target=new URL(targetUrl);return url.origin===target.origin||target.origin==='https://cdn.yibentushu.com'&&target.pathname.startsWith('/test-sample-apply/')&&url.origin==='https://testapi.yibentushu.com'&&url.pathname.startsWith('/supply-api/');}
export function sanitizeDifyReadObservation(rawUrl:string,targetUrl:string,status:number,body:unknown):DifyReadObservation|undefined{
 const url=new URL(rawUrl);if(!allowedReadOrigin(url,targetUrl))return;
 const path=['/dept/book/apply/myList','/h5/dept/book/order/myList','/dept/book/apply/clientSearch'].find(p=>url.pathname.endsWith(p));if(!path)return;
 const data=body as {code?:number;rows?:unknown[];total?:number;data?:unknown[]};const rows=path.endsWith('clientSearch')?data?.data:data?.rows;
 return {path,keyword:url.searchParams.get('keyword')===noMatchProbe?noMatchProbe:/^(?:\d{4}CL\d{11,12}|\d{2}-\d{5})$/.test(url.searchParams.get('keyword')??'')?url.searchParams.get('keyword')!:url.searchParams.get('keyword')?'other':'',unfiltered:['applyNo','bookUsage','examineStatus','orderStatus','keyword'].every(k=>!url.searchParams.get(k)),ok:status===200&&data?.code===200&&Array.isArray(rows),...(Array.isArray(rows)?{rows:rows.length}:{}),...(path.endsWith('clientSearch')&&Array.isArray(rows)?{customers:rows.slice(0,100).flatMap(row=>{const c=row as {agentId?:unknown;agentName?:unknown};return typeof c.agentId==='string'&&typeof c.agentName==='string'?[{code:c.agentId,labelDigest:createHash('sha256').update(c.agentName.trim()).digest('hex')}]:[];})}:{}),...(Number.isFinite(data?.total)?{total:Number(data.total)}:{})};
}
export function observeDifyReadOnlyResponses(page:Page,targetUrl:string){
 let pending:Array<Promise<DifyReadObservation|undefined>>=[];
 let epoch=0;const requests=new WeakMap<Request,number>();const started=(request:Request)=>{requests.set(request,epoch);};page.on('request',started);
 const listener=(response:Response)=>{try{const url=new URL(response.url());if(requests.get(response.request())!==epoch||response.request().method()!=='GET'||!allowedReadOrigin(url,targetUrl)||!['/dept/book/apply/myList','/h5/dept/book/order/myList','/dept/book/apply/clientSearch'].some(p=>url.pathname.endsWith(p)))return;pending.push((async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const body=await Promise.race([response.json(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('readback timeout')),4000);})]);return sanitizeDifyReadObservation(response.url(),targetUrl,response.status(),body);}catch{return sanitizeDifyReadObservation(response.url(),targetUrl,response.status(),{});}finally{clearTimeout(timer);}})());}catch{}};
 const failed=(request:Request)=>{try{if(requests.get(request)!==epoch||!request.failure()?.errorText.includes('ERR_BLOCKED_BY_CLIENT')||browserRequestAllowed(request.method(),request.url(),{targetOrigin:new URL(targetUrl).origin,resourceType:request.resourceType()}))return;const read=sanitizeDifyReadObservation(request.url(),targetUrl,0,{});if(read)pending.push(Promise.resolve({...read,blockedByPolicy:true}));}catch{}};
 page.on('response',listener);
 page.on('requestfailed',failed);
 return {async take(kind?:DepartmentReadOnlyKind,customerKeyword?:string){const collected:DifyReadObservation[]=[];const deadline=Date.now()+6000;try{do{const batch=pending;pending=[];collected.push(...(await Promise.all(batch)).filter((o):o is DifyReadObservation=>!!o));if(!kind||['phone-invalid','quantity-range','recipient-length','recipient-required','address-required','courier-fixed','region-selection','region-incomplete','sample-row-delete','book-nonnumeric','book-row-add'].includes(kind)||collected.some(r=>r.path===(kind==='application-empty'?'/dept/book/apply/myList':kind.startsWith('customer-')?'/dept/book/apply/clientSearch':'/h5/dept/book/order/myList')&&(['customer-no-match','order-no-match'].includes(kind)?r.keyword===noMatchProbe:kind.startsWith('customer-')?customerKeyword?r.keyword===customerKeyword:r.keyword!==''&&r.keyword!=='other'&&r.keyword!==noMatchProbe:r.unfiltered)))return collected;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);return collected;}finally{epoch++;}},close(){page.off('response',listener);page.off('request',started);page.off('requestfailed',failed);}};
}

export async function verifyDepartmentReadOnlyResult(page:Page,check:BrowserCheck,result:{status:string;detail:string;evidence?:string},observations:DifyReadObservation[]){
 if(isSampleRowDelete(check)){await verifySampleRowDelete(page,check,result);return;}
 const kind=departmentReadOnlyKind(check);if(!kind||['quantity-range','recipient-length','recipient-required','address-required','region-incomplete','sample-row-delete','book-nonnumeric'].includes(kind)||!['passed','failed'].includes(result.status))return;
 if(kind==='book-row-add'){
  if(result.status!=='passed')return;
  const tables=page.locator('table').filter({has:page.getByRole('columnheader',{name:'图书名称',exact:true})});if(await tables.count()!==1){result.status='blocked';result.detail='未取得唯一图书明细表格，不能推断新增行。';return;}
  const table=tables.first();const headers=await table.locator('thead th').allTextContents();const names=headers.map(t=>t.trim());const indexes=[names.findIndex(t=>['自编码','物流编码'].includes(t)),...['数量（册）','图书名称','出版社','定价(元)'].map(name=>names.indexOf(name))];
  if(indexes.some(i=>i<0)||new Set(indexes).size!==5){result.status='failed';result.detail='断言失败：图书明细缺少原始预期要求的五类字段。';delete result.evidence;return;}
  // The target renders one complete table per book; other fixtures use one table with multiple rows.
  // Count logical book rows across matching tables rather than assuming one DOM table forever.
  const rows=tables.locator('tbody tr');const count=await rows.count();const add=page.getByText('继续添加样书',{exact:true}).filter({visible:true});if(count<1||count>9||await add.count()!==1){result.status='blocked';result.detail='新增样书的基线或唯一入口不满足本轮只读审核。';return;}
  await add.click({timeout:3000});const deadline=Date.now()+3000;while(await rows.count()===count&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  if(await rows.count()!==count+1){result.status='failed';result.detail='断言失败：点击继续添加样书后没有恰好新增一行。';delete result.evidence;return;}
  const newHeaders=await rows.last().evaluate(row=>[...row.closest('table')!.querySelectorAll('thead th')].map(el=>el.textContent?.trim()));
  const newIndexes=[newHeaders.findIndex(t=>t==='自编码'||t==='物流编码'),...['数量（册）','图书名称','出版社','定价(元)'].map(name=>newHeaders.indexOf(name))];
  const cells=rows.last().locator('td');let valid=newIndexes.every(i=>i>=0)&&new Set(newIndexes).size===5;
  for(const [field,index] of newIndexes.entries()){if(index<0)continue;const cell=cells.nth(index);if(await cell.count()!==1){valid=false;break;}if(field<2){const input=cell.locator('input');if(await input.count()!==1||await input.inputValue()!==''||!await input.isEnabled())valid=false;}else if((await cell.innerText()).trim()!=='')valid=false;}
  if(!valid){result.status='failed';result.detail='断言失败：新增行没有完整提供两类可编辑编码/数量输入和空白图书名称、出版社、定价字段。';delete result.evidence;return;}
  result.detail+='；依据原 XMind 的物流编码（自编码/erp编码）映射，实际行数 '+count+' → '+(count+1)+'，新增行五类字段完整且为空白。';delete result.evidence;return;
 }
 if(['customer-external','customer-internal','customer-match'].includes(kind)){
  const fills=check.steps.filter(s=>s.action==='fillByRoleIndex');const code=fills[0];const last=fills.at(-1);const fixtureCode=code&&'value' in code?code.value:undefined;const keyword=last&&'value' in last?last.value:undefined;
  const read=observations.filter(r=>r.path==='/dept/book/apply/clientSearch'&&r.keyword===keyword).at(-1);
  if(!read?.ok){result.status='blocked';result.detail='未取得本条固定客户查询的成功响应，不能凭下拉控件判断可选。';return;}
  const matched=read.customers?.filter(c=>c.code===fixtureCode);if(matched?.length!==1){result.status='failed';result.detail='断言失败：本轮客户查询未返回数据库分类基线中的固定客户。';delete result.evidence;return;}
  const options=page.getByRole('option').filter({visible:true});let choice:import('playwright').Locator|undefined;const deadline=Date.now()+4000;
  do{for(let i=0;i<await options.count();i++){const option=options.nth(i);if(createHash('sha256').update((await option.innerText()).trim()).digest('hex')===matched[0]!.labelDigest){if(choice){result.status='blocked';result.detail='客户同名选项不唯一，未猜测选择。';return;}choice=option;}}if(choice)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
  if(!choice){result.status='failed';result.detail='断言失败：本轮 API 命中的固定客户未在可见下拉中提供选择。';delete result.evidence;return;}
  await choice.click({timeout:3000});
  const labels=await page.getByRole('combobox').evaluateAll(elements=>elements.filter(el=>(el.closest('.home-form-item')?.querySelector('label')?.textContent??'').includes('费用划归客户')).map(el=>{const label=el.closest('.el-select')?.querySelector('.el-select__placeholder');return label&&label.getClientRects().length?label.textContent?.trim():undefined;}));
  if(labels.length!==1||!labels[0]||createHash('sha256').update(labels[0]).digest('hex')!==matched[0]!.labelDigest){result.status='failed';result.detail='断言失败：已选择固定客户，但字段没有正确回填该客户。';delete result.evidence;return;}
  if(result.status==='passed'){result.detail+='；固定客户编码 '+fixtureCode+' 的本轮'+(kind==='customer-match'?'部分关键词查询':'查询')+'、实际选择和回填一致；分类基线 '+(kind==='customer-internal'?'1004.06':'1004.00')+' 来自只读数据库。';delete result.evidence;}return;
 }
 if(kind==='region-selection'){
  if(result.status!=='passed')return;
  const selected=await page.getByRole('combobox').evaluateAll(elements=>elements.filter(el=>(el.closest('.home-form-item')?.querySelector('label')?.textContent??'').includes('所在地区')).map(el=>{const option=el.closest('.el-select')?.querySelector('.el-select__placeholder');return option&&option.getClientRects().length?option.textContent?.trim():undefined;}));
  if(JSON.stringify(selected)!==JSON.stringify(['湖南省','长沙市','芙蓉区'])){result.status='failed';result.detail='断言失败：地区三个控件的实际选中回填值与本轮逐级选择不一致。';delete result.evidence;}else result.detail+='；本轮三个地区控件实际回填为湖南省 / 长沙市 / 芙蓉区。';return;
 }
 if(kind==='phone-invalid'){
  if(result.status!=='passed')return;
  const hints=page.getByText('手机号格式错误',{exact:true}).filter({visible:true});const red=await hints.count()===1&&await hints.evaluate(el=>{const values=getComputedStyle(el).color.match(/[\d.]+/g)?.map(Number)??[];return values.length>=3&&values[0]!>=150&&values[0]!>values[1]!*1.3&&values[0]!>values[2]!*1.3;});if(!red){result.status='failed';result.detail='断言失败：未验证到原始手机号错误提示呈红色。';delete result.evidence;}else result.detail+='；本轮同时验证短号码、非数字输入及红色提示。';return;
 }
 if(kind==='courier-fixed'){
  if(result.status!=='passed')return;const text=page.getByText('仅支持快递',{exact:true}).filter({visible:true});const fixed=await text.count()===1&&await text.evaluate(el=>{const row=el.closest('.home-form-item');return !!row&&/发货方式/.test(row.textContent??'')&&row.querySelectorAll('input,select,button,a,[role="combobox"],[role="option"],[role="button"],[tabindex]').length===0;});if(!fixed){result.status='blocked';result.detail='尚未证明发货方式字段区域没有其他可选控件；不能只凭快递文案通过。';}else result.detail+='；本轮核对固定快递文案，发货方式字段区域的可选控件为 0 个。';return;
 }
 const path=kind==='application-empty'?'/dept/book/apply/myList':kind==='customer-no-match'?'/dept/book/apply/clientSearch':'/h5/dept/book/order/myList';
 const read=observations.filter(r=>r.path===path&&(kind==='order-no-match'||kind==='customer-no-match'?r.keyword===noMatchProbe:r.unfiltered)).at(-1);
 if(kind==='application-empty'&&read?.ok&&result.status==='passed'){
  if(new URL(page.url()).hash.split('?')[0]!=='#/apply'){result.status='blocked';result.detail='当前未停留在申请记录列表，未核验空态。';return;}
  try{
   let empty=read.rows===0&&read.total===0,filterLabel='';
   for(const [usage,label,expectedValue]of [[true,'产品用书','2'],[false,'已通过','1'],[false,'已驳回','2']] as const){
    if(empty)break;
    let control;try{control=await applicationFilter(page,usage,label);}catch{continue;}
    const requests=new Set<Request>(),key=usage?'bookUsage':'examineStatus';
    const request=(r:Request)=>{try{const u=new URL(r.url());if(r.method()==='GET'&&u.origin==='https://testapi.yibentushu.com'&&u.pathname==='/supply-api/dept/book/apply/myList'&&!!u.searchParams.get(key))requests.add(r);}catch{}};
    page.on('request',request);
    const pending=page.waitForResponse(r=>requests.has(r.request()),{timeout:10000}).then(async r=>({ok:r.status()===200,body:await r.json(),url:r.url()})).catch(()=>undefined);
    let response;try{await control.click({timeout:5000});response=await pending;}finally{page.off('request',request);}
    if(!response?.ok||response.body?.code!==200||!Array.isArray(response.body.rows)||response.body.total===undefined)throw Error('Blocked: 未取得本条筛选触发的成功新查询。');
    if(new URL(response.url).searchParams.get(key)!==expectedValue)throw Error('断言失败：'+label+'筛选发送的用途/审批状态值错误。');
    if(!await control.evaluate(el=>el.classList.contains('active')))throw Error('断言失败：空态筛选没有选中'+label+'。');
    empty=response.body.rows.length===0&&Number(response.body.total)===0;filterLabel+=(filterLabel?' / ':'')+label;
   }
   if(!empty)throw Error('Blocked: 本人用途/审批状态筛选仍有记录，未取得原预期要求的零匹配条件。');
   try{await page.getByText('暂无申请记录',{exact:true}).filter({visible:true}).first().waitFor({state:'visible',timeout:5000});}catch{throw Error('断言失败：本条成功查询为零条，但页面没有展示申请空态。');}
   result.detail='本条'+(filterLabel?'实际选择'+filterLabel+'，选中态正确，对应新查询返回':'无筛选新查询返回')+'0条、总数 0，页面展示暂无申请记录；只验证原来源“按用途/状态筛选后无符合条件记录”的空态，不代替有记录筛选集合用例。';delete result.evidence;
  }catch(error){const message=error instanceof Error?error.message:'';result.status=message.startsWith('断言失败：')?'failed':'blocked';result.detail=message.replace(/^Blocked: /,'')||'申请空态补充核验未完成。';delete result.evidence;}
  return;
 }
 if(!read?.ok||read.rows!==0||(kind!=='customer-no-match'&&read.total!==0)){
  result.status='blocked';result.detail=read?.blockedByPolicy?'TestPilot 共享只读请求策略阻止了此查询；需确认共享白名单的最小放行范围后再执行，未把空白当通过。':!read?'未取得本条用例触发的查询证据，不能仅凭空态文字判断通过。':!read.ok?'本条查询接口未成功，不能把错误后的空白当作正常空态。':'本条查询并非已确认的零条结果，当前不满足空态前置。';return;
 }
 if(result.status!=='passed')return;
 const route=new URL(page.url()).hash.split('?')[0];if(kind!=='customer-no-match'&&route!==(kind==='application-empty'?'#/apply':'#/logistics')){result.status='blocked';result.detail='没有停留在本条预期的申请/订单列表页面。';delete result.evidence;return;}
 if(kind==='customer-no-match'&&await page.getByRole('option').filter({visible:true}).count()){result.status='failed';result.detail='断言失败：客户查询为空，但下拉仍有可选项。';delete result.evidence;return;}
 result.detail+='；本条成功查询与页面空态一致：返回 0 条'+(kind==='customer-no-match'?'。':'，总数 0。');
}
