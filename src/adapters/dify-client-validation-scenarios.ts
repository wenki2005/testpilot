import type{Page,Route,Request}from'playwright';
import{actionablePreconditions,resolveDocumentField,type BrowserCheck}from'./document-test-workflow.js';
import{prepareCompleteDifyForm}from'./dify-field-validity-scenarios.js';
import{captureDifyPng}from'./dify-evidence.js';
export type ClientValidationKind='overweight-client-validation'|'region-client-validation'|'invalid-submit-validation'|'recipient-error-validation'|'phone-error-validation'|'address-error-validation';
type Result={status:string;detail:string;evidence?:string};
const prepared=new WeakMap<Page,{caseId:string;result:Result}>();
export function clientValidationKind(c:Pick<BrowserCheck,'expected'|'source'>):ClientValidationKind|undefined{
 if(c.expected==='为空：字段标红提示必填'&&c.source.includes('填写收件人'))return 'recipient-error-validation';
 if(c.expected==='非11位/含非数字字符：红色提示「手机号格式错误」P1'&&c.source.includes('填写手机号码'))return 'phone-error-validation';
 if(c.expected==='未填写：标红提示必填'&&c.source.includes('填写详细地址'))return 'address-error-validation';
 if(c.expected==='P0 所有样书预估总重>19公斤：弹出toast「已超重请修改数量或使用OA申请」，禁止提交'&&c.source.includes('自动计算小计、总计与预估总重'))return 'overweight-client-validation';
 if(c.expected==='未选全三级：提交校验标红'&&c.source.includes('省/市/区三级联动'))return 'region-client-validation';
 if(c.expected==='存在漏填或格式校验失败：对应字段输入框标红，不跳转'&&c.source.includes('点击「提交申请」按钮')&&c.source.includes('校验全部必填项与格式'))return 'invalid-submit-validation';
}
export function reviewClientValidation(c:BrowserCheck,evidence:string,targetUrl?:string){
 const kind=clientValidationKind(c);if(!kind||actionablePreconditions(c).length)return;let u:URL,p:{controls?:Array<{placeholder?:string}>;bookCodeAliasConfirmed?:boolean};try{u=new URL(targetUrl??'');p=JSON.parse(evidence);}catch{return;}
 if(u.origin!=='https://cdn.yibentushu.com'||!u.pathname.startsWith('/test-sample-apply/')||!p.bookCodeAliasConfirmed||['请输入收件人姓名','请输入手机号码'].some(s=>p.controls?.filter(c=>c.placeholder===s).length!==1))return;
 const errorLabel=kind==='phone-error-validation'?'手机号码':kind==='address-error-validation'?'详细地址':'收件人';
 const steps:BrowserCheck['steps']=kind==='region-client-validation'?[{action:'blurByLabel',label:'请选择区'},{action:'assertFieldInvalid',label:'请选择区'}]:kind==='invalid-submit-validation'||kind.endsWith('-error-validation')?[{action:'blurByLabel',label:errorLabel},{action:'assertFieldInvalid',label:errorLabel}]:[{action:'assertExactVisible',text:'收货信息'},{action:'assertExactVisible',text:'继续添加样书'}];
 return{kind,steps,detail:'只读审核：先核验完整有效表单，再只改变本条待测字段；触发校验的整个窗口阻止所有外发请求并记录尝试，不允许申请落库。直接核对原始toast或字段红色错误状态，不以按钮禁用代替。'};
}

/** Clicking a gray validation div does not bypass the network policy. Every
 * request during the isolated click is aborted, including native form posts;
 * any write attempt fails this check even though it cannot reach the server. */
export async function isolatedClientValidation(page:Page,assertion:()=>Promise<void>){
 const u=new URL(page.url());if(u.origin!=='https://cdn.yibentushu.com'||!u.pathname.startsWith('/test-sample-apply/')||u.hash.split('?')[0]!=='#/home')throw Error('Blocked: 校验动作没有停留在约定的申请表单。');
 const submit=page.locator('.pc-page-home .home-footer > .button').filter({hasText:/^\s*提交申请\s*$/});
 if(await submit.count()!==1||!await submit.isVisible())throw Error('Blocked: 客户端校验按钮未唯一定位。');
 if(await submit.evaluate(el=>el instanceof HTMLButtonElement&&el.disabled||el instanceof HTMLInputElement&&el.disabled||getComputedStyle(el).pointerEvents==='none'))throw Error('Blocked: 提交控件本身不可交互，未强制点击或绕过禁用。');
 const writes:Request[]=[];const start=(r:Request)=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r);};
 const block=(r:Route)=>r.abort('blockedbyclient').catch(()=>{});page.on('request',start);await page.route('**/*',block);
 let problem:unknown;
 try{await submit.click({timeout:5000});try{await assertion();}catch(e){problem=e;}await new Promise(r=>setTimeout(r,800));if(writes.length)throw Error('断言失败：无效表单触发了'+writes.length+'次写请求尝试；均由隔离策略阻止，未发送至业务服务器。');if(page.url()!==u.href)throw Error('断言失败：无效表单校验后页面发生跳转。');if(problem)throw problem;}
 finally{await page.unroute('**/*',block).catch(()=>{});page.off('request',start);}
}

export async function prepareClientValidation(page:Page,c:BrowserCheck,target:string,dataRoot:string,saveEvidence:(png:Buffer)=>Promise<string>,prepare=prepareCompleteDifyForm){
 const kind=clientValidationKind(c);if(!kind)return;prepared.delete(page);const result:Result={status:'passed',detail:''};
 try{
  const book=await prepare(page,target,dataRoot);
  if(kind.endsWith('-error-validation')){
   const label=kind==='phone-error-validation'?'手机号码':kind==='address-error-validation'?'详细地址':'收件人';
   const input=await resolveDocumentField(page,label),values=kind==='phone-error-validation'?['123','12a45678901']:[''];const failures:string[]=[],observations:string[]=[];
   const valid=await input.inputValue(),before=await validationAppearance(input);
   for(const value of values){
    await input.fill(value);await input.blur();if(await input.inputValue()!==value)throw Error('Blocked: 无效字段已被转换，未建立本条输入前置。');
    await isolatedClientValidation(page,async()=>{
     await input.blur();await page.waitForTimeout(250);const after=await validationAppearance(input);
     const message=(await page.locator('.el-message__content,.van-toast__text,.van-toast').filter({visible:true}).allTextContents()).join(' ');
     const prompt=kind==='phone-error-validation'?message.includes('手机号格式错误'):/必填|不能为空|请.{0,10}(?:收件人|地址)/.test(message);
     const red=after.red&&(after.error||!before.red&&!after.focused);
     observations.push(label+'输入'+(value===''?'空值':kind==='phone-error-validation'&&value.includes('a')?'非数字号码':'短号码')+'：'+(red?'有':'无')+'红色错误状态，'+(prompt?'有':'无')+'原预期提示');
     if(!red||!prompt){failures.push('缺少'+[!red?'字段红色错误状态':'',!prompt?'原预期提示':''].filter(Boolean).join('及'));if(!result.evidence)result.evidence=await saveEvidence(await captureDifyPng(page));}
    });if(value!==values.at(-1)){await input.fill(valid);await input.blur();}
   }
   result.status=failures.length?'failed':'passed';result.detail='其他必填项及图书/客户基线均有效，仅改变本字段；实际触发隔离客户端校验，所有外发请求被阻止、无业务写入且未跳转。'+observations.join('；')+'。';
  }else if(kind==='overweight-client-validation'){
   const qty=Math.floor(19000/book.weightGrams)+1;if(qty<2||qty>999)throw Error('Blocked: 现有图书不能在已知数量范围内构造超过19公斤的测试输入。');
   const input=await resolveDocumentField(page,'数量（册）');await input.fill(String(qty));await input.blur();if(await input.inputValue()!==String(qty))throw Error('Blocked: 超重数量被页面改变，未执行原阈值断言。');
   const expected=Number((book.weightGrams*qty/1000).toFixed(2)),total=page.locator('.pc-page-home .total-info .weight');
   if(await total.count()!==1||Number((await total.innerText()).match(/([\d.]+)\s*公斤/)?.[1])!==expected||expected<=19)throw Error('Blocked: 页面总重未与独立克重基线匹配，不能推断满足超重前置。');
   await isolatedClientValidation(page,async()=>{try{await page.getByText('已超重请修改数量或使用OA申请',{exact:true}).filter({visible:true}).waitFor({state:'visible',timeout:2000});}catch{throw Error('断言失败：总重已超过19公斤，触发客户端校验后未显示原始超重toast。');}result.evidence=await saveEvidence(await captureDifyPng(page));});
   result.detail='完整表单其余字段有效，独立重量计算与页面均为'+expected.toFixed(2)+'公斤（>19）；实际点击触发校验，显示原始超重toast、无写请求尝试且未跳转。整个触发窗所有外发请求均被阻止，未提交申请。';
  }else if(kind==='invalid-submit-validation'){
   const fields=[{label:'收件人漏填',placeholder:'请输入收件人姓名',valid:'测试收件人',invalid:''},{label:'手机格式错误',placeholder:'请输入手机号码',valid:'13800138000',invalid:'123'},{label:'详细地址漏填',placeholder:'请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等',valid:'测试地址一号',invalid:''}];
   const failures:string[]=[],observations:string[]=[];
   for(const field of fields){
    const input=page.getByPlaceholder(field.placeholder,{exact:true});if(await input.count()!==1)throw Error('Blocked: 待校验字段未唯一定位。');
    await input.fill(field.valid);await input.blur();const before=await validationAppearance(input);
    await input.fill(field.invalid);await input.blur();if(await input.inputValue()!==field.invalid)throw Error('Blocked: 无效输入被转换，尚未建立本条反例。');
    await isolatedClientValidation(page,async()=>{await input.blur();await new Promise(r=>setTimeout(r,100));const after=await validationAppearance(input);if(!after.red){failures.push(field.label+'触发校验后没有红色边框/错误状态');observations.push(field.label+'：无红色错误状态');}else if(!after.error&&(before.red||after.focused))throw Error('Blocked: 已有主题/焦点红色不能作为字段校验错误的证据。');else observations.push(field.label+'：红色错误状态');});
    if(failures.length){result.evidence=await saveEvidence(await captureDifyPng(page));break;}
    await input.fill(field.valid);await input.blur();
   }
   if(failures.length){result.status='failed';result.detail='完整有效表单仅改变一个字段；'+failures.join('；')+'。无写请求尝试、未跳转。该反例已违反原始通用预期；未声称已覆盖所有字段组合。';}
   else{result.status='blocked';result.detail='已隔离触发并核对收件人漏填、手机格式错误、地址漏填：'+observations.join('；')+'；无写请求尝试、未跳转。其余必填项和格式组合尚未全部覆盖，完整用例保留阻塞。';}
  }else{
   const group=page.locator('.pc-page-home .home-form-item').filter({has:page.locator('label').filter({hasText:'所在地区'})}),combos=group.getByRole('combobox');if(await group.count()!==1||await combos.count()!==3)throw Error('Blocked: 地区组未唯一定位。');
   for(const[index,label]of ['湖北省','武汉市'].entries()){await combos.nth(index).click();const option=page.getByRole('option',{name:label,exact:true}).filter({visible:true});await option.waitFor({state:'visible',timeout:5000});if(await option.count()!==1)throw Error('Blocked: 地区选项未唯一定位。');await option.click();}
   const values=await combos.evaluateAll(es=>es.map(e=>e.closest('.el-select')?.querySelector('.el-select__placeholder')?.textContent?.trim()??''));if(values[0]!=='湖北省'||values[1]!=='武汉市'||values[2]==='芙蓉区'||values[2]&& !/请选择/.test(values[2]))throw Error('Blocked: 未取得仅省、市已选择且区县为空的实际状态。');
   const appearance=()=>combos.nth(2).evaluate(input=>{const root=input.closest('.el-select');if(!root)return{red:false,error:false,focused:false};const isRed=(v:string)=>{const a=v.match(/[\d.]+/g)?.map(Number)??[];return a.length>=3&&a[0]!>=120&&a[0]!>a[1]!*1.3&&a[0]!>a[2]!*1.3;};const nodes=[root,...root.querySelectorAll('input,.el-input__wrapper,.el-select__wrapper')];return{red:nodes.some(n=>{const s=getComputedStyle(n);return [['Top',s.borderTopColor],['Right',s.borderRightColor],['Bottom',s.borderBottomColor],['Left',s.borderLeftColor]].some(([side,color])=>parseFloat(s.getPropertyValue('border-'+side!.toLowerCase()+'-width'))>0&&isRed(color!))||[...s.boxShadow.matchAll(/rgba?\([^)]*\)/g)].some(m=>isRed(m[0]));}),error:nodes.some(n=>n.getAttribute('aria-invalid')==='true'||/(?:^|\s)(?:is-error|is-invalid|has-error)(?:\s|$)/.test(String(n.className))),focused:root.matches(':focus-within')||!!root.querySelector('.is-focused,.is-focus')};});
   await combos.nth(0).blur();await combos.nth(1).blur();await combos.nth(2).blur();await new Promise(r=>setTimeout(r,100));const before=await appearance();
   await isolatedClientValidation(page,async()=>{
    await combos.nth(2).blur();await new Promise(r=>setTimeout(r,100));const after=await appearance();
    if(!after.red)throw Error('断言失败：其他必填有效、地区仅选省市未选区县；实际触发提交校验后，未选的区县控件未出现红色边框/错误状态。');
    if(!after.error&&(before.red||after.focused))throw Error('Blocked: 区县已有主题/焦点红色样式，未取得明确错误标记或提交触发后的颜色变化，未将装饰色算校验通过。');
   });
   result.detail='完整有效表单仅将地区改为已选省市、区县未选，实际触发提交校验并直接验证地区组红色错误状态；无写请求尝试、未跳转，整个触发窗所有外发请求均被阻止。';
  }
 }catch(error){const m=error instanceof Error?error.message:'';result.status=m.startsWith('断言失败：')?'failed':'blocked';result.detail=/^(断言失败：|Blocked: )/.test(m)?m.replace(/^Blocked: /,''):'客户端隔离校验的完整基线或证据未完成。';}
 prepared.set(page,{caseId:c.id,result});
}
async function validationAppearance(input:import('playwright').Locator){
 return input.evaluate(el=>{const root=el.closest('.home-form-item')??el.parentElement??el;const red=(v:string)=>{const a=v.match(/[\d.]+/g)?.map(Number)??[];return a.length>=3&&a[0]!>=120&&a[0]!>a[1]!*1.3&&a[0]!>a[2]!*1.3;};const nodes=[el,...root.querySelectorAll('.el-input__wrapper,.el-input,.el-textarea')];return{red:nodes.some(n=>{const s=getComputedStyle(n);return ['top','right','bottom','left'].some(side=>parseFloat(s.getPropertyValue('border-'+side+'-width'))>0&&red(s.getPropertyValue('border-'+side+'-color')))||[...s.boxShadow.matchAll(/rgba?\([^)]*\)/g)].some(m=>red(m[0]));}),error:[root,...nodes].some(n=>n.getAttribute('aria-invalid')==='true'||/(?:^|\s)(?:is-error|is-invalid|has-error)(?:\s|$)/.test(String(n.className))),focused:root.matches(':focus-within')};});
}
export function verifyClientValidation(page:Page,c:BrowserCheck,result:Result){
 if(!clientValidationKind(c))return;const saved=prepared.get(page);prepared.delete(page);
 if(!saved||saved.caseId!==c.id){result.status='blocked';result.detail='缺少本条完整表单及隔离校验记录，子步骤不能代替原始预期。';delete result.evidence;return;}
 if(saved.result.status!=='passed'||result.status==='passed'){Object.assign(result,saved.result);if(!saved.result.evidence)delete result.evidence;}else result.detail+='；隔离校验观察：'+saved.result.detail;
}
