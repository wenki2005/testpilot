import path from 'node:path';
import {loadDifyCustomerFixtures} from './dify-readonly-fixtures.js';
import {loadDifyBookFixtures,observeDifyBookResponses,verifyDifyBookResult,difyBookKind} from './dify-book-scenarios.js';
import {verifyDifyDeviceResult,waitForDifyDeviceBaseline} from './dify-device-scenarios.js';
import {verifyDifyListResult} from './dify-list-scenarios.js';
import {maskDifyProfileEvidence,captureDifyPng} from './dify-evidence.js';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {collectDepartmentDatabaseEvidence} from './regression-database.js';
import { acquireDocumentPageLease, executeDocumentRun, cancelDocumentRun, getDocumentRun, saveDocumentProject, draftGroundedReadOnlyBrowserSteps } from './document-test-workflow.js';
import { launchPersistentTestPage, navigatePersistentPage, getExistingPersistentTestPage } from './browser-runtime.js';
import { allowBrowserRequest, waitForUserLogin, isLoginPage, isAuthenticationRoute, clearLoginHandoff, requestLoginContinue } from './login-handoff.js';
import { generateDocumentCaseSteps } from '../demo/runtime.js';
import { callDifyWorkflow } from './dify-workflow-client.js';
import type { WebModuleDependencies } from './dify-web-modules.js';
import {observeDifyReadOnlyResponses,verifyDepartmentReadOnlyResult,departmentReadOnlyKind,needsDifyReadback} from './dify-readonly-scenarios.js';

/** Dify-only fallback at the result callback, before the next case resets the page. */
export async function captureMissingDifyFailureEvidence(dataRoot:string,project:{id:string;targetUrl:string;browserProfileIsolation?:boolean},runId:string,result:{id:string;status:string;detail:string;evidence?:string},required=false){
  if((!['failed','blocked'].includes(result.status)&&!(required&&result.status==='passed'))||result.evidence)return;
  let client:import('playwright').CDPSession|undefined;
  const deadline=Date.now()+12000;
  const bounded=async<T>(operation:Promise<T>,ms=5000):Promise<T>=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('evidence-timeout')),Math.max(1,Math.min(ms,deadline-Date.now())));})]);}finally{clearTimeout(timer);}};
  try{
    const session=await bounded(getExistingPersistentTestPage(path.join(dataRoot,'document-tests','browser-profiles',project.browserProfileIsolation?`isolated-${project.id}`:project.id),{isolated:project.browserProfileIsolation===true}));
    if(!session||session.page.isClosed())throw Error('window-missing');
    if(new URL(session.page.url()).origin!==new URL(project.targetUrl).origin||await bounded(isLoginPage(session.page)))throw Error('not-business-page');
    await bounded(session.page.bringToFront());
    client=await bounded(session.context.newCDPSession(session.page));
    const shot=await bounded(captureDifyPng(session.page,client),8000);
    const name=createHash('sha256').update(result.id).digest('hex')+'.png';const directory=path.join(dataRoot,'document-tests','runs',runId,'screenshots');
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name),shot);result.evidence=name;
  }catch{if(required&&result.status==='passed'){result.status='blocked';result.detail+='；补充操作后的本轮截图未采集成功，未算完整通过。';}else result.detail+='；本轮现场截图未采集成功，断言结果保留。';}finally{if(client)await bounded(client.detach(),1000).catch(()=>{});}
}

/** A prerequisite screenshot is bound to its Dify job, without inventing a
 * document run or pretending that a blocked business assertion was executed. */
export async function captureDifyBlockedEvidence(dataRoot:string,project:import('./document-test-workflow.js').DocumentProject,jobId:string,item:import('./document-test-workflow.js').BrowserCheck,signal:AbortSignal){
 const release=acquireDocumentPageLease(project.id);if(!release)return;
 let client:import('playwright').CDPSession|undefined,style:import('playwright').ElementHandle|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const session=await getExistingPersistentTestPage(path.join(dataRoot,'document-tests','browser-profiles',project.browserProfileIsolation?`isolated-${project.id}`:project.id),{isolated:project.browserProfileIsolation===true}).catch(()=>undefined);
 if(!session){release();return;}
 const page=session.page,original=page.url(),target=new URL(project.targetUrl);
 const policy=async(route:import('playwright').Route)=>{const r=route.request();await(allowBrowserRequest(r.method(),r.url(),project.id,{targetOrigin:target.origin,resourceType:r.resourceType(),authenticationPage:isAuthenticationRoute(page.url()),isNavigationRequest:r.isNavigationRequest(),isMainFrameNavigation:r.isNavigationRequest()&&r.frame()===page.mainFrame()})?route.continue():route.abort('blockedbyclient')).catch(()=>{});};
 try{
  signal.throwIfAborted();if(new URL(original).origin!==target.origin||await isLoginPage(page))return;
  await page.route('**/*',policy);
  const department=target.origin==='https://cdn.yibentushu.com'&&target.pathname.startsWith('/test-sample-apply/');
  const backend=/本期PC后台/.test(item.expected)||item.source.includes('管理端后台');
  const route=!backend&&/员工端-(?:历史申请记录|用书审批详情|申请表单明细)/.test(item.source)?'/apply':!backend&&/员工端-订单/.test(item.source)?'/logistics':'/home';
  if(department){const url=new URL(project.targetUrl);url.hash=route;await page.goto('about:blank');await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:15000});await page.locator(route==='/apply'?'.pc-page-apply':route==='/logistics'?'.pc-page-logistics':'.pc-page-home').waitFor({state:'visible',timeout:10000});}
  if(await isLoginPage(page))return;signal.throwIfAborted();await page.bringToFront();
  style=await maskDifyProfileEvidence(page,true);client=await page.context().newCDPSession(page);
  const shot=await captureDifyPng(page,client);
  const evidence=createHash('sha256').update(item.id).digest('hex')+'.png',directory=path.join(dataRoot,'dify-web-modules','evidence',jobId);
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,evidence),shot);
  return {evidence,evidenceNote:backend?'本轮前置阻塞现场：当前连接员工申样页面，没有管理后台入口和角色；未执行后台业务断言。':'本轮前置阻塞现场：展示同账号对应入口/列表的实际状态；业务断言尚未执行，不将截图视为用例通过。'};
 }finally{
  if(timer)clearTimeout(timer);await style?.evaluate(el=>el.parentNode?.removeChild(el)).catch(()=>{});await client?.detach().catch(()=>{});
  if(page.url()!==original){await page.goto('about:blank').catch(()=>{});await page.goto(original,{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});}
  await page.unroute('**/*',policy).catch(()=>{});release();
 }
}

/** The source asks for both disabled behavior and a gray appearance. */
export async function verifyDifyRequiredButtonAppearance(page:import('playwright').Page,result:{status:string;detail:string;evidence?:string},expected:string){
  if(result.status!=='passed'||expected!=='必填未完成时提交按钮置灰不可点击')return;
  try{
    const button=page.getByText('提交申请',{exact:true});if(await button.count()!==1)throw Error('提交控件不唯一');
    await button.scrollIntoViewIfNeeded({timeout:3000});
    const visual=await button.evaluate(el=>{const node=el.closest('button,[role="button"],[class*="button"],[class*="btn"]')??el;const style=getComputedStyle(node);const rgb=style.backgroundColor.match(/[\d.]+/g)?.map(Number)??[];const opaque=rgb.length===3||rgb.length===4&&rgb[3]===1;const gray=opaque&&rgb.length>=3&&Math.max(...rgb.slice(0,3))-Math.min(...rgb.slice(0,3))<=12&&Math.min(...rgb.slice(0,3))>=80&&Math.max(...rgb.slice(0,3))<=245;return {gray,color:style.backgroundColor};});
    if(!visual.gray)throw Error('提交控件背景未呈灰色');result.detail+='；Dify 本轮样式核验：提交控件背景为灰色 '+visual.color+'。';
  }catch{result.status='failed';result.detail='断言失败：提交控件禁用子检查已通过，但本轮没有验证到唯一提交控件的灰色背景。';delete result.evidence;}
}

export function webModuleDependencies(dataRoot:string):WebModuleDependencies {
  return {
    cloud:callDifyWorkflow,
    database:(project,signal)=>collectDepartmentDatabaseEvidence(dataRoot,project,signal),
    captureBlockedEvidence:(project,jobId,item,signal)=>captureDifyBlockedEvidence(dataRoot,project,jobId,item,signal),
    saveProject:saveDocumentProject,
    recover:getDocumentRun,
    async inspect(project,job,signal,onLogin){
      const release=acquireDocumentPageLease(project.id);if(!release)throw new Error('这个模块的测试窗口正在被其他操作占用。');
      const session=await launchPersistentTestPage(path.join(dataRoot,'document-tests','browser-profiles',project.browserProfileIsolation ? `isolated-${project.id}` : project.id),{isolated:project.browserProfileIsolation===true}).catch(error=>{release();throw error;});
      const policy=async(route:import('playwright').Route)=>{const request=route.request();const allowed=allowBrowserRequest(request.method(),request.url(),project.id,{targetOrigin:new URL(project.targetUrl).origin,resourceType:request.resourceType(),isNavigationRequest:request.isNavigationRequest(),isMainFrameNavigation:request.isNavigationRequest()&&request.frame()===session.page.mainFrame(),authenticationPage:isAuthenticationRoute(session.page.url())});await (allowed?route.continue():route.abort('blockedbyclient')).catch(()=>{});};
      const abort=()=>clearLoginHandoff(project.id);signal.addEventListener('abort',abort,{once:true});
      try{
        await session.page.route('**/*',policy);signal.throwIfAborted();await navigatePersistentPage(session.page,project.targetUrl);
        if(await isLoginPage(session.page))await waitForUserLogin(project.id,job.id,project.targetUrl,session.browser,session.page,async waiting=>onLogin(waiting));
        signal.throwIfAborted();
        if(new URL(session.page.url()).origin!==new URL(project.targetUrl).origin)throw new Error('测试窗口没有进入目标网站，请完成登录后重试。');
        const customerFixtures=await loadDifyCustomerFixtures(dataRoot);
        const books=await loadDifyBookFixtures(dataRoot);const bookFixtureBaseline=books.length?{schema:1,source:'supply.biz_book_info',weightUnit:'g',capturedAt:new Date().toISOString(),books}:undefined;
        const bookCodeAliasConfirmed=project.cases.some(c=>c.source.includes('输入物流编码（自编码/erp编码）'));
        const navigation:string[]=[];for(const name of ['历史申请记录','订单物流'])if(await session.page.getByText(name,{exact:true}).filter({visible:true}).count()===1)navigation.push(name);
        const customerMatches:number[]=[];const combos=session.page.getByRole('combobox');for(let index=0;index<await combos.count();index++)if(await combos.nth(index).evaluate(el=>(el.closest('.home-form-item')?.querySelector('label')?.textContent??'').includes('费用划归客户')))customerMatches.push(index);const customerSearchIndex=customerMatches.length===1?customerMatches[0]:undefined;
        const regionSearchIndexes:number[]=[];for(let index=0;index<await combos.count();index++)if(await combos.nth(index).evaluate(el=>(el.closest('.home-form-item')?.querySelector('label')?.textContent??'').includes('所在地区')))regionSearchIndexes.push(index);
        let bookCodeLabel:string|undefined;for(const name of ['自编码','物流编码'])if(await session.page.getByRole('columnheader',{name,exact:true}).count()===1)bookCodeLabel=name;
        const observed=await session.page.evaluate(()=>({title:document.title,headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.textContent?.trim()).filter(Boolean).slice(0,30),controls:[...document.querySelectorAll('input,select,textarea,button,[role="button"],[class*="button"],[class*="btn"],a')].filter(e=>e.getClientRects().length).slice(0,120).map(e=>{const el=e as HTMLInputElement;return {tag:el.tagName.toLowerCase(),role:el.getAttribute('role')??(el.tagName==='BUTTON'||el.matches('[class*="button"],[class*="btn"]')?'button':el.tagName==='A'?'link':undefined),name:el.getAttribute('aria-label')??(el.labels?.[0]?.textContent??(el.tagName==='BUTTON'||el.matches('[class*="button"],[class*="btn"]')?el.textContent:''))?.trim(),placeholder:el.getAttribute('placeholder')??undefined};}),links:[...document.querySelectorAll('a')].map(e=>e.textContent?.trim()).filter(Boolean).slice(0,30)}));return JSON.stringify({...observed,navigation,customerSearchIndex,regionSearchIndexes,bookCodeLabel,bookCodeAliasConfirmed,customerFixtures,bookFixtureBaseline});
      }finally{signal.removeEventListener('abort',abort);await session.page.unroute('**/*',policy).catch(()=>{});release();}
    },
    async author(project,item,evidence,proposal){const grounded=draftGroundedReadOnlyBrowserSteps(item);if(grounded?.length)return grounded;return generateDocumentCaseSteps(project.targetUrl,{...item,caseGenerationActions:proposal},evidence);},
    async execute(project,runId,selected,onStage,onResult){
      const session=await getExistingPersistentTestPage(path.join(dataRoot,'document-tests','browser-profiles',project.browserProfileIsolation?`isolated-${project.id}`:project.id),{isolated:project.browserProfileIsolation===true});
      const observer=session?observeDifyReadOnlyResponses(session.page,project.targetUrl):undefined;
      const bookObserver=session?observeDifyBookResponses(session.page,project.targetUrl):undefined;
      try{return await executeDocumentRun(project,{runId,runMode:'regression',selectedCaseIds:selected,scopePlan:{mode:selected.length===1?'single':'custom',targetCaseIds:selected,impactCaseIds:[]},captureEvidence:true,onStage:async stage=>onStage?.(stage),onCasePrepared:async(source,page)=>waitForDifyDeviceBaseline(page,source,project.targetUrl),onCaseResult:async result=>{
        const source=project.cases.find(c=>c.id===result.id);const reads=await observer?.take(source?departmentReadOnlyKind(source):undefined,source?.steps.filter(s=>s.action==='fillByRoleIndex').at(-1)?.value)??[];
        const bookReads=await bookObserver?.take(source)??[];
        if(source&&session)await verifyDifyBookResult(session.page,source,result,bookReads).catch(()=>{if(result.status==='passed'){result.status='blocked';result.detail='图书完整断言尚未完成，未将子步骤通过当作业务通过。';}});
        if(source&&session)await verifyDepartmentReadOnlyResult(session.page,source,result,reads).catch(()=>{if(result.status==='passed'){result.status='blocked';result.detail='本条只读补充证据采集未完成；保留未验证状态。';}});
        const saveEvidence=async(png:Buffer)=>{const name=createHash('sha256').update(result.id).digest('hex')+'.png';const directory=path.join(dataRoot,'document-tests','runs',runId,'screenshots');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name),png);return name;};
        if(source&&session)await verifyDifyDeviceResult(session.page,source,result,project.targetUrl,saveEvidence);
        if(source&&session)await verifyDifyListResult(session.page,source,result,project.targetUrl,saveEvidence);
        if(source&&needsDifyReadback(source)&&!session&&result.status==='passed'){result.status='blocked';result.detail='缺少本轮页面与查询补充核验，不能只按子步骤判断通过。';}
        if(result.status==='passed'&&source?.expected==='必填未完成时提交按钮置灰不可点击'){
          if(session)await verifyDifyRequiredButtonAppearance(session.page,result,source.expected);else{result.status='blocked';result.detail='必填与禁用子检查完成，但缺少当前页面的置灰样式证据。';delete result.evidence;}
        }
        await captureMissingDifyFailureEvidence(dataRoot,project,runId,result,!!source&&(!!difyBookKind(source)||['customer-external','customer-internal','customer-match','book-row-add'].includes(departmentReadOnlyKind(source)??'')));onResult?.(result);
      }});}finally{observer?.close();bookObserver?.close();}
    },
    async cancel(projectId,runId){clearLoginHandoff(projectId);if(runId)await cancelDocumentRun(runId);},
    async continueLogin(projectId){await requestLoginContinue(projectId);},
  };
}
