import path from 'node:path';
import type {Route} from 'playwright';
import {readDepartmentDatabaseSummary,readDepartmentApplications,readDepartmentGoods,readDepartmentAccountCount,readDepartmentBlockerInventory} from './mysql-readonly-browser.js';
import {acquireDocumentPageLease,type DocumentProject} from './document-test-workflow.js';
import {launchPersistentTestPage,navigatePersistentPage} from './browser-runtime.js';
import {allowBrowserRequest,isAuthenticationRoute,isLoginPage} from './login-handoff.js';
import {supportsDepartmentDatabase,type RegressionDatabaseEvidence,type DatabaseCheck} from '../domain/regression-database-contract.js';

type Row=Record<string,unknown>;
const numberEqual=(a:unknown,b:unknown)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&String(a).trim()!==''&&String(b).trim()!==''&&Number.isFinite(Number(a))&&Number(a)===Number(b);

/** All raw identifiers are ephemeral. Return only counts/booleans and fixed field labels. */
export function compareDepartmentList(apiRows:Row[],databaseRows:Row[]):DatabaseCheck {
  if(!apiRows.length)return {id:'account-list',title:'当前账号申请列表',status:'blocked',detail:'当前账号没有返回申请记录；未使用其他人的数据代替。'};
  if(apiRows.length>20||apiRows.some(r=>typeof r.applyNo!=='string')||new Set(apiRows.map(r=>r.applyNo)).size!==apiRows.length)return {id:'account-list',title:'当前账号申请列表',status:'blocked',detail:'列表结构或记录范围不符合核验约定。'};
  const fields=[['examineStatus','examine_status'],['lockStatus','lock_status']] as const;
  let mismatch=0;let comparisons=0;
  for(const row of apiRows){const matches=databaseRows.filter(r=>r.apply_no===row.applyNo);if(matches.length!==1){mismatch++;continue;}for(const [api,db] of fields){if(row[api]===undefined)continue;comparisons++;if(!numberEqual(row[api],matches[0]![db]))mismatch++;}}
  if(mismatch)return {id:'account-list',title:'当前账号申请列表',status:'failed',detail:`核对当前账号返回的 ${apiRows.length} 条记录，发现 ${mismatch} 项记录或状态不一致；需要检查环境、并发更新和接口映射。`};
  if(!comparisons)return {id:'account-list',title:'当前账号申请列表',status:'blocked',detail:`${apiRows.length} 条记录能找到，但接口没有返回约定状态字段，未判为完整一致。`};
  return {id:'account-list',title:'当前账号申请列表',status:'passed',detail:`当前账号返回的 ${apiRows.length} 条记录均在测试库找到；${comparisons} 项状态值一致。仅覆盖当前页。`};
}

export function compareDepartmentGoods(apiRows:Row[],databaseRows:Row[]):DatabaseCheck {
  if(!apiRows.length||!databaseRows.length)return {id:'account-detail',title:'当前账号样书明细',status:'blocked',detail:'当前记录缺少可核对的明细；空结果不算通过。'};
  const unique=(rows:Row[],key:string)=>new Set(rows.map(r=>r[key])).size===rows.length;
  if(!unique(apiRows,'productId')||!unique(databaseRows,'product_id'))return {id:'account-detail',title:'当前账号样书明细',status:'blocked',detail:'明细存在重复商品，尚无可靠的一一对应键，未判为通过。'};
  let mismatch=Math.abs(apiRows.length-databaseRows.length);let compared=0;let missing=0;
  for(const row of apiRows){const match=databaseRows.find(r=>String(r.product_id)===String(row.productId));if(!match){mismatch++;continue;}for(const [api,db] of [['qty','qty'],['price','price']] as const){if(row[api]===undefined){missing++;continue;}compared++;if(!numberEqual(row[api],match[db]))mismatch++;}}
  return {id:'account-detail',title:'当前账号样书明细',status:mismatch?'failed':missing?'blocked':'passed',detail:mismatch?`${apiRows.length} 条明细中发现 ${mismatch} 项数量、单价或记录不一致。`:missing?'接口明细缺少约定字段，无法完成全部核对。':`${apiRows.length} 条明细、${compared} 项数量及单价与测试库一致。未核验提交、审批和物流。`};
}

export async function collectDepartmentDatabaseEvidence(root:string,project:DocumentProject,signal:AbortSignal):Promise<RegressionDatabaseEvidence> {
  const evidence:RegressionDatabaseEvidence={binding:'department-supply-readonly',capturedAt:new Date().toISOString(),status:'blocked',checks:[]};
  if(!supportsDepartmentDatabase(project.targetUrl))throw Error('数据库绑定与被测环境不匹配。');
  try {evidence.summary=await readDepartmentDatabaseSummary();signal.throwIfAborted();evidence.checks.push({id:'connection',title:'测试库只读连接',status:'passed',detail:'使用 TLS 和只读事务读取 supply 测试库；未执行写入。'},
    {id:'fixtures',title:'申请与明细数据',status:evidence.summary.applications>0&&evidence.summary.goods>0?'passed':'blocked',detail:`有效申请 ${evidence.summary.applications} 条，样书明细 ${evidence.summary.goods} 条，涉及 ${evidence.summary.applicationsWithGoods} 个申请；这是全库数据量，不代表当前账号可见。`},
    {id:'relations',title:'明细关联检查',status:evidence.summary.orphanGoods?'failed':'passed',detail:`有效明细中找不到有效申请的记录：${evidence.summary.orphanGoods} 条。`});
  }catch {signal.throwIfAborted();evidence.checks.push({id:'connection',title:'测试库只读连接',status:'blocked',detail:'测试库未连接或只读查询失败，请在数据库工具中连接后重测。网页测试仍继续。'});return evidence;}
  const release=acquireDocumentPageLease(project.id);
  if(!release){evidence.checks.push({id:'account-list',title:'当前账号数据核对',status:'blocked',detail:'测试窗口正被占用，未读取当前账号记录。'});return evidence;}
  const session=await launchPersistentTestPage(path.join(root,'document-tests','browser-profiles',`isolated-${project.id}`),{isolated:true}).catch(()=>undefined);
  if(!session){release();evidence.checks.push({id:'account-list',title:'当前账号数据核对',status:'blocked',detail:'无法连接已登录的系统窗口。'});return evidence;}
  const policy=async(route:Route)=>{const r=route.request();await (allowBrowserRequest(r.method(),r.url(),project.id,{targetOrigin:new URL(project.targetUrl).origin,resourceType:r.resourceType(),isNavigationRequest:r.isNavigationRequest(),isMainFrameNavigation:r.isNavigationRequest()&&r.frame()===session.page.mainFrame(),authenticationPage:isAuthenticationRoute(session.page.url())})?route.continue():route.abort('blockedbyclient')).catch(()=>{});};
  const responseAt=(suffix:string)=>session.page.waitForResponse(r=>{const u=new URL(r.url());return u.origin==='https://testapi.yibentushu.com'&&u.pathname===suffix&&r.request().method()==='GET'
    &&(!suffix.endsWith('/myList')||['bookUsage','examineStatus','applyNo'].every(key=>!u.searchParams.get(key)));},{timeout:15000}).then(async r=>({ok:r.ok(),data:await r.json()})).catch(()=>undefined);
  let stage:'list'|'list-database'|'detail'='list';
  try {
    await session.page.route('**/*',policy);signal.throwIfAborted();
    if(await isLoginPage(session.page))throw Error('login');
    const listUrl=new URL(project.targetUrl);listUrl.hash='/apply';
    // End pending requests from the previous SPA view before capturing the
    // fresh document. The same tab/context retains the user's login session.
    await session.page.goto('about:blank');
    const listResponse=responseAt('/supply-api/dept/book/apply/myList');
    const identityResponse=responseAt('/supply-api/getInfo');
    await session.page.goto(listUrl.href,{waitUntil:'domcontentloaded',timeout:15000});
    const list=await listResponse;signal.throwIfAborted();
    if(!list?.ok||Number(list.data?.code)!==200||!Array.isArray(list.data.rows))throw Error('list');
    if(list.data.rows.length>20)throw Error('structure');
    const rows:Row[]=list.data.rows;
    stage='list-database';
    const identity=await identityResponse;signal.throwIfAborted();
    const userId=identity?.data?.user?.userId;
    if(identity?.ok&&Number(identity.data?.code)===200&&/^\d{1,20}$/.test(String(userId))){
      const count=await readDepartmentAccountCount(String(userId));
      evidence.checks.push({id:'account-scope',title:'当前账号数据范围',status:count===Number(list.data.total)?'passed':'failed',detail:count===Number(list.data.total)?`当前登录身份在测试库有 ${count} 条有效申请，与无筛选列表的总数一致。`:`当前登录身份的有效申请数 ${count} 与列表总数 ${Number(list.data.total)} 不一致；需要检查环境、权限或并发更新。`});
      if(count===Number(list.data.total)){
        try{evidence.blockerInventory=await readDepartmentBlockerInventory(String(userId));evidence.checks.push({id:'blocker-inventory',title:'阻塞数据与关联字段排查',status:'passed',detail:'已按本轮认证身份区分本人/其他账号申请状态、多行明细，核对申请表订单引用、审批模板、失败日志、发送队列和物流关联；只保存计数，逐条阻塞说明保留未验证部分。查询成功不代表相关业务用例通过。'});}
        catch{evidence.checks.push({id:'blocker-inventory',title:'阻塞数据与关联字段排查',status:'blocked',detail:'本轮扩展只读查询未完成，没有将查询失败解释为不存在字段或数据；已有网页核验继续。'});}
        signal.throwIfAborted();
      }
    }else evidence.checks.push({id:'account-scope',title:'当前账号数据范围',status:'blocked',detail:'未取得约定的当前登录身份字段，不能把全库记录数与个人列表相比。'});
    if(rows.some(r=>typeof r.applyNo!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.applyNo)))throw Error('structure');
    const dbRows=rows.length?await readDepartmentApplications(rows.map(r=>r.applyNo as string)):[];
    const listCheck=compareDepartmentList(rows,dbRows);evidence.checks.push(listCheck);
    if(rows.length&&listCheck.status==='passed') {
      stage='detail';
      const applyNo=rows[0]!.applyNo as string;
      const detailResponse=responseAt(`/supply-api/dept/book/apply/detail/${applyNo}`);
      const detailUrl=new URL(project.targetUrl);detailUrl.hash='/apply-form-detail/'+encodeURIComponent(applyNo);
      await navigatePersistentPage(session.page,detailUrl.href);const detail=await detailResponse;signal.throwIfAborted();
      if(!detail?.ok||Number(detail.data?.code)!==200||!Array.isArray(detail.data.data?.goodsList))throw Error('detail');
      evidence.checks.push(compareDepartmentGoods(detail.data.data.goodsList,await readDepartmentGoods(applyNo)));
      const labels=['基本信息','样书明细','收货信息'];
      await session.page.getByText('样书明细',{exact:true}).first().waitFor({state:'visible',timeout:5000}).catch(()=>{});
      const sections=await Promise.all(labels.map(text=>session.page.getByText(text,{exact:true}).first().isVisible()));
      evidence.checks.push({id:'detail-page',title:'明细页面打开',status:sections.every(Boolean)?'passed':'failed',detail:sections.every(Boolean)?'当前账号申请明细页面的三个主要区块可见；数据核对依据本页真实接口响应。':'明细接口已返回，但页面主要区块未全部显示。'});
    }else evidence.checks.push({id:'account-detail',title:'当前账号样书明细',status:'blocked',detail:'列表核验未完成，未挑选其他账号的数据或跳过权限访问明细。'});
  }catch {signal.throwIfAborted();evidence.checks.push({id:'browser-data',title:'当前账号网页与数据核对',status:'blocked',detail:stage==='list'?'未取得成功的当前账号无筛选列表响应，请检查登录及接口权限。未用全库记录替代。':stage==='list-database'?'已取得当前账号列表，但身份或记录与测试库的查询未完成。未判为通过。':'已取得当前账号列表，但明细接口、页面或数据库核对未完成。未判为通过。'});}
  finally {await navigatePersistentPage(session.page,project.targetUrl).catch(()=>{});await session.page.unroute('**/*',policy).catch(()=>{});release();}
  evidence.status=evidence.checks.some(c=>c.status==='failed')?'failed':evidence.checks.some(c=>c.status==='blocked')?'blocked':'passed';return evidence;
}
