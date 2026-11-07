import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,json,fail} from '../shared/http-utils.js';
import {RunReportStore,ReportMetadataConflict} from '../../../adapters/reports/run-report-store.js';
import type {SystemModuleRegression} from '../../../adapters/regression/catalog/module-regression-service.js';
import type {DepartmentCoreChainStore} from '../../../adapters/regression/chains/core-chain-store.js';
import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {buildReportArchive} from '../../../adapters/reports/report-archive.js';
import {difyModuleEvidencePath} from '../../../adapters/regression/evidence/evidence-paths.js';
export function createRunReportRoutes(root:string,modules:SystemModuleRegression,cores:DepartmentCoreChainStore){
 const store=new RunReportStore(root,modules,cores);
 return async(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>=>{
  const route=url.pathname.slice('/api/system-module-regression/reports'.length);if(!url.pathname.startsWith('/api/system-module-regression/reports'))return false;
  try{if(route===''&&req.method==='GET'){json(res,200,store.catalog(url.searchParams.get('systemId')||undefined));return true;}
   const archive=route.match(/^\/(batch|core)\/([0-9a-f-]{36})\/archive$/i);
   if(archive&&req.method==='GET'){
    const detail=store.detail(archive[1],archive[2]!,url.searchParams.get('systemId')??'');
    const bytes=await buildReportArchive(detail,async uri=>{
     const file=uri.match(/\/([a-f0-9-]{36})\/evidence\/([a-f0-9]{64}\.png)$/i);if(!file)throw Error('无效证据');
     if(archive[1]==='core'){if(file[1]!==archive[2])throw Error('证据不属于本批次');return cores.evidence(file[1]!,file[2]!);}
     const job=modules.getBatch(archive[2]!).jobs.find(j=>j.id===file[1]);if(!job)throw Error('证据不属于本批次');const target=difyModuleEvidencePath(root,job,file[2]!);if(!target)throw Error('无效证据');
     const resolved=await realpath(target),base=await realpath(root);if(!resolved.startsWith(base+path.sep)||(await lstat(target)).isSymbolicLink())throw Error('证据越界');return readFile(resolved);
    });res.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename="TestPilot-${archive[2]}.zip"`,'content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return true;
   }
   const match=route.match(/^\/(batch|core)\/([0-9a-f-]{36})(?:\/(metadata))?$/i);
   if(match&&req.method==='GET'&&!match[3]){json(res,200,store.detail(match[1],match[2]!,url.searchParams.get('systemId')??''));return true;}
   if(match&&req.method==='POST'&&match[3]==='metadata'){json(res,200,store.saveMetadata(match[1],match[2]!,await bodyJson(req)));return true;}
   fail(res,404,'报告操作不存在。');
  }catch(error){fail(res,error instanceof ReportMetadataConflict?409:422,error instanceof Error?error.message:'报告读取失败。');}return true;
 };
}
