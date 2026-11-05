import {difyScriptArchiveName} from '../../domain/dify-script-layout.js';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { DifyRegressionStore } from "../../adapters/dify-regression.js";
import { ModuleRegressionStore } from "../../adapters/module-regression.js";
import { DifyWebModuleStore } from "../../adapters/dify-web-modules.js";
import { difyModuleEvidencePath } from "../../adapters/dify-module-evidence-path.js";
import { SystemModuleRegression } from "../../adapters/system-module-regression.js";
import {DepartmentCoreChainStore}from'../../adapters/department-core-chain-store.js';
import { webModuleDependencies } from "../../adapters/dify-web-browser.js";
import {getDocumentProject,getDocumentRunProgress} from '../../adapters/document-run-executor.js';
import {json,fail,bodyJson,documentBody} from './http-utils.js';
import {createRunReportRoutes} from './run-report-routes.js';

/** Owns the Dify endpoints; the shared server only mounts this handler. */
export function createDifyRegressionRoutes({artifactsDir,host,port}:{artifactsDir:string;host:string;port:number}) {
const difyRegression = new DifyRegressionStore(path.join(artifactsDir, "dify-regression"));
const moduleRegression = new ModuleRegressionStore(artifactsDir);
const difyWebModules = new DifyWebModuleStore(artifactsDir, webModuleDependencies(artifactsDir));
const systemModules = new SystemModuleRegression(artifactsDir, difyWebModules, webModuleDependencies(artifactsDir));
const coreChains=new DepartmentCoreChainStore(artifactsDir,systemModules,webModuleDependencies(artifactsDir));
const reportRoutes=createRunReportRoutes(artifactsDir,systemModules,coreChains);
// Many open workbench tabs poll the same multi-megabyte history. Serialize it
// once per second so status polling does not starve browser protocol messages.
let systemModuleStateCache:{expires:number;body:string}|undefined;

  return async function handleDifyRegressionRoutes(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean> {
    if(!['/api/system-module-regression','/api/dify-web-modules','/api/module-regression','/api/dify-regression'].some(prefix=>url.pathname===prefix||url.pathname.startsWith(prefix+'/'))) return false;
    await (async()=>{
  if(await reportRoutes(req,res,url))return;
  if (url.pathname.startsWith('/api/system-module-regression')) {
    if(req.method==='POST'){systemModuleStateCache=undefined;res.once('finish',()=>{systemModuleStateCache=undefined;});}
    try {
      const root='/api/system-module-regression';const route=url.pathname.slice(root.length);
      if(route==='/case-editor'&&req.method==='GET'){json(res,200,systemModules.editorCatalog(url.searchParams.get('systemId')||undefined));return;}
      if(route==='/case-editor/prerequisites'&&req.method==='POST'){const data=await documentBody(req);if(coreChains.activeForSystem(String(data.systemId)))throw Error('核心链路正在运行，请结束后整理。');json(res,200,systemModules.savePrerequisitePlan(data));return;}
      const editorScript=route.match(/^\/case-editor\/([0-9a-f-]{36})\/([^/]+)\/script$/i);
      if(editorScript&&req.method==='GET'){json(res,200,systemModules.editorScript(editorScript[1]!,decodeURIComponent(editorScript[2]!),url.searchParams.get('version')||undefined));return;}
      const editor=route.match(/^\/case-editor\/([0-9a-f-]{36})(?:\/([^/]+))?$/i);
      if(editor){if(req.method==='GET'&&editor[2]){json(res,200,systemModules.editorHistory(editor[1]!,decodeURIComponent(editor[2])));return;}if(req.method==='POST'&&!editor[2]){if(coreChains.activeForSystem(systemModules.getModule(editor[1]!).systemId))throw Error('核心链路正在运行，请结束后保存。');json(res,200,await systemModules.saveEditorCase(editor[1]!,await bodyJson(req)));return;}fail(res,404,'用例编辑操作不存在。');return;}
      if(route==='/core-chains'&&req.method==='GET'){json(res,200,coreChains.state(url.searchParams.get('systemId')??''));return;}
      if(route==='/core-chains/runs'&&req.method==='POST'){json(res,202,coreChains.start(await bodyJson(req)));return;}
      const core=route.match(/^\/core-chains\/runs\/([0-9a-f-]{36})(?:\/(cancel|continue|evidence)(?:\/([0-9a-f]{64}\.png))?)?$/i);
      if(core){const id=core[1]!;if(req.method==='GET'&&core[2]==='evidence'&&core[3]){const bytes=await coreChains.evidence(id,core[3]);res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(bytes);return;}if(req.method==='GET'&&!core[2]){json(res,200,coreChains.get(id));return;}if(req.method==='POST'&&core[2]==='cancel'){json(res,200,await coreChains.cancel(id));return;}if(req.method==='POST'&&core[2]==='continue'){json(res,200,await coreChains.continue(id));return;}fail(res,404,'核心链路操作不存在。');return;}
      if(req.method==='POST'&&route==='/batches'){const data=await bodyJson(req);if(coreChains.activeForSystem(String(data.systemId)))throw Error('核心链路正在使用该系统窗口，请结束后再运行模块。');json(res,202,systemModules.start(data));return;}
      if(req.method==='POST'&&/^\/(systems|modules|batches)\//.test(route)){const key=route.split('/')[2];if(key){let id:string|undefined;try{id=route.startsWith('/systems/')?key:route.startsWith('/modules/')?systemModules.getModule(key).systemId:systemModules.getBatch(key).systemId;}catch{}if(id&&coreChains.activeForSystem(id))throw Error('核心链路正在运行，请先结束后再修改系统或执行其他回归。');}}
      if(req.method==='GET'&&route==='/template.md'){res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename=module-template.md'});res.end('# 模块名称\n\n## case-1 | 用例标题\n\n- 优先级：P1\n- 来源：原始需求或用例编号\n\n### 前置条件\n- 请填写需要的账号或业务记录条件\n\n### 操作步骤\n1. 打开模块入口\n2. 请填写实际操作\n\n### 预期结果\n请填写原始预期，不能使用实际执行结果替代\n');return;}
      if(req.method==='GET'&&route===''){if(!systemModuleStateCache||systemModuleStateCache.expires<=Date.now())systemModuleStateCache={expires:Date.now()+1000,body:JSON.stringify(systemModules.state())};res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(systemModuleStateCache.body);return;}
      if(req.method==='POST'&&route==='/systems'){json(res,200,systemModules.saveSystem(await bodyJson(req)));return;}
      if(req.method==='POST'&&route==='/modules/import'){json(res,200,await systemModules.importModule(await documentBody(req)));return;}
      if(req.method==='POST'&&route==='/modules/attach'){json(res,200,systemModules.attachLegacy(await bodyJson(req)));return;}
      if(req.method==='POST'&&route==='/scripts/export'){const output=await systemModules.selectionScripts(await bodyJson(req));res.writeHead(200,{'content-type':'application/zip','cache-control':'no-store','content-disposition':`attachment; filename="Dify_current_scripts.zip"; filename*=UTF-8''${encodeURIComponent(output.fileName)}`});res.end(output.bytes);return;}
      const system=route.match(/^\/systems\/([0-9a-f-]{36})\/(selection|connect|continue|disconnect|accounts|account-selection)$/i);
      if(req.method==='POST'&&system){const key=system[1]!;const action=system[2];const data=await bodyJson(req);if(action==='accounts')json(res,200,systemModules.addAccount(key,data));else if(action==='account-selection')json(res,200,systemModules.selectAccount(key,data.accountId));else if(action==='selection')json(res,200,systemModules.saveSelection(key,data.moduleIds));else if(action==='connect')json(res,202,systemModules.connect(key));else if(action==='continue')json(res,200,await systemModules.continueConnection(key));else json(res,200,await systemModules.cancelConnection(key));return;}
      const module=route.match(/^\/modules\/([0-9a-f-]{36})(?:\/(archive|core|markdown))?$/i);
      if(module){if(req.method==='POST'&&module[2]==='core'){json(res,200,systemModules.saveCore(module[1]!,await bodyJson(req)));return;}if(req.method==='GET'&&module[2]==='markdown'){const text=systemModules.markdown(module[1]!,url.searchParams.get('version')??undefined);res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename=module-cases.md'});res.end(text);return;}if(req.method==='GET'&&!module[2]){json(res,200,systemModules.cases(module[1]!,url.searchParams.get('version')??undefined));return;}if(req.method==='POST'&&module[2]==='archive'){json(res,200,systemModules.archiveModule(module[1]!, (await bodyJson(req)).archived));return;}}
      const confirmation=route.match(/^\/batches\/([0-9a-f-]{36})\/confirm-case$/i);
      if(req.method==='POST'&&confirmation){json(res,202,systemModules.confirmCase(confirmation[1]!,await bodyJson(req)));return;}
      const batch=route.match(/^\/batches\/([0-9a-f-]{36})(?:\/(cancel|continue|retest|report|scripts|retry-report|retry-notification))?$/i);
      if(batch){const key=batch[1]!;const action=batch[2];if(req.method==='GET'&&action==='scripts'){const bytes=await systemModules.scripts(key);const fileName=difyScriptArchiveName(systemModules.getBatch(key));res.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename="Dify_fixed_scripts_${key.slice(0,8)}.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`});res.end(bytes);return;}if(req.method==='GET'&&!action){json(res,200,systemModules.getBatch(key));return;}if(req.method==='GET'&&action==='report'){const report=systemModules.report(key).replaceAll('/api/dify-web-modules/',`http://${host}:${port}/api/dify-web-modules/`);res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename="system-regression-report.md"'});res.end(report);return;}if(req.method==='POST'){if(action==='retry-notification')json(res,200,await systemModules.retryNotification(key));else if(action==='retry-report')json(res,202,systemModules.retryReports(key));else if(action==='cancel')json(res,200,await systemModules.cancel(key));else if(action==='continue')json(res,200,await systemModules.continueBatch(key));else if(action==='retest')json(res,202,systemModules.retest(key,await bodyJson(req)));else {fail(res,404,'接口不存在。');}return;}}
      fail(res,404,'接口不存在。');return;
    }catch(error){fail(res,422,error instanceof Error?error.message:'系统模块操作失败。');return;}
  }
  if (url.pathname.startsWith('/api/dify-web-modules')) {
    try {
      if (req.method === 'GET' && url.pathname === '/api/dify-web-modules') { json(res,200,difyWebModules.state()); return; }
      if (req.method === 'POST' && url.pathname === '/api/dify-web-modules/import') { const module=await difyWebModules.import(await documentBody(req)); json(res,200,{id:module.id,name:module.name,caseCount:module.project.cases.length}); return; }
      if (req.method === 'POST' && url.pathname === '/api/dify-web-modules/jobs') { json(res,202,difyWebModules.start(await bodyJson(req))); return; }
      const match=url.pathname.match(/^\/api\/dify-web-modules\/jobs\/([0-9a-f-]{36})(?:\/(retry|cancel|continue|retest|report|evidence)(?:\/([0-9a-f]{64}\.png))?)?$/i);
      if (match) {
        const key=match[1]!, action=match[2]; const job=difyWebModules.getJob(key);
        if(req.method==='GET'&&!action){
          const {snapshot,executionProject,...view}=job;const progress=job.documentRunId&&!job.executionFinished?await getDocumentRunProgress(job.documentRunId):undefined;
          const results=view.results.map(row=>{const actual=progress?.results.find(r=>r.lane==='deterministic'&&r.id===row.caseId);return actual?{...row,status:['passed','failed','blocked'].includes(actual.status)?actual.status:'not_executed',detail:actual.detail,evidence:actual.evidence}:row;});
          json(res,200,{...view,results,...(progress?{progress:{...progress.progress,currentCase:progress.currentCase}}:{})});return;
        }
        if(req.method==='GET'&&action==='report'){const report=difyWebModules.reportForExport(key).replaceAll('/api/dify-web-modules/',`http://${host}:${port}/api/dify-web-modules/`);res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename="module-report.md"'});res.end(report);return;}
        if(req.method==='GET'&&action==='evidence'&&match[3]){const file=difyModuleEvidencePath(artifactsDir,job,match[3]);if(!file){fail(res,404,'没有该证据。');return;}const bytes=await readFile(file);res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(bytes);return;}
        if(req.method==='POST'){
          if(action==='retry'){json(res,202,await difyWebModules.retry(key));return;}
          if(action==='cancel'){json(res,200,await difyWebModules.cancel(key));return;}
          if(action==='continue'){json(res,200,await difyWebModules.continue(key));return;}
          if(action==='retest'){const data=await bodyJson(req);const selected=data.selectedCaseIds??job.results.filter(r=>!r.outOfScope&&['failed','blocked','not_executed'].includes(r.status)).map(r=>r.caseId);json(res,202,difyWebModules.start({moduleId:job.moduleId,parentJobId:job.id,selectedCaseIds:selected,confirmedCaseIds:data.confirmedCaseIds??[],requestId:data.requestId}));return;}
        }
      }
      fail(res,404,'模块操作不存在。');
    } catch(error) {fail(res,422,error instanceof Error?String(error.message).slice(0,500):'模块操作失败。');}
    return;
  }
  if (url.pathname.startsWith("/api/module-regression")) {
    try {
      if (req.method === "GET" && url.pathname === "/api/module-regression") { json(res, 200, { ...moduleRegression.state(), records: await moduleRegression.unifiedRuns() }); return; }
      if (req.method === "POST" && url.pathname === "/api/module-regression/plans") { json(res, 200, await moduleRegression.register(await bodyJson(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/module-regression/run") { json(res, 200, await moduleRegression.start(await bodyJson(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/module-regression/web-package-check") {
        const data = await bodyJson(req);
        if (!data || typeof data.projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.projectId)) { fail(res, 400, "需要有效的模块项目编号。"); return; }
        const project = await getDocumentProject(data.projectId);
        if (!project) { fail(res, 404, "模块用例包不存在或已被删除。"); return; }
        const cases = project.cases;
        const statusCounts = { runnable: 0, held: 0, draft: 0 };
        for (const item of cases) {
          if (item.lifecycleStatus === "runnable" && item.sideEffectRisk === "none" && item.selectedForRegression !== false && (!item.preconditions?.length || item.preconditionsConfirmed === true)) statusCounts.runnable++;
          else if (item.sideEffectRisk !== "none" || (item.preconditions?.length ?? 0) > 0 && item.preconditionsConfirmed !== true) statusCounts.held++;
          else statusCounts.draft++;
        }
        const manifest = {
          schema: 1 as const, phase: "web-package-check" as const, run_id: randomUUID(), module_id: project.id,
          package_digest: createHash("sha256").update(JSON.stringify({ cases: project.cases, sourceFiles: project.sourceFiles ?? [project.fileName] })).digest("hex"),
          case_ids: cases.map(item => createHash("sha256").update(`${project.id}:${item.id}`).digest("hex")), status_counts: statusCounts,
        };
        json(res, 200, await moduleRegression.checkWebPackage(manifest)); return;
      }
      fail(res, 404, "not found");
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "模块回归操作失败。"); }
    return;
  }
  if (url.pathname.startsWith("/api/dify-regression")) {
    try {
      if (req.method === "GET" && url.pathname === "/api/dify-regression") { json(res, 200, difyRegression.state()); return; }
      if (req.method === "POST") {
        const data = await documentBody(req);
        const action = url.pathname.slice("/api/dify-regression/".length);
        const value = action === "import" ? difyRegression.importBaseline(data)
          : action === "xmind" ? difyRegression.importXmind(data.name, data.bytesBase64)
          : action === "generate" ? difyRegression.start(data)
          : action === "review" ? difyRegression.review(data)
          : action === "runs" ? difyRegression.createRun(data)
          : action === "result" ? difyRegression.recordResult(data) : undefined;
        if (value) { json(res, 200, value); return; }
      }
      fail(res, 404, "not found");
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "回归记录操作失败。"); }
    return;
  }

    })();
    return true;
  };
}
