import type {IncomingMessage,ServerResponse} from 'node:http';
import {bodyJson,json,fail} from '../shared/http-utils.js';
import {RunReportStore,ReportMetadataConflict} from '../../../adapters/reports/run-report-store.js';
import type {SystemModuleRegression} from '../../../adapters/regression/catalog/module-regression-service.js';
import type {DepartmentCoreChainStore} from '../../../adapters/regression/chains/core-chain-store.js';
export function createRunReportRoutes(root:string,modules:SystemModuleRegression,cores:DepartmentCoreChainStore){
 const store=new RunReportStore(root,modules,cores);
 return async(req:IncomingMessage,res:ServerResponse,url:URL):Promise<boolean>=>{
  const route=url.pathname.slice('/api/system-module-regression/reports'.length);if(!url.pathname.startsWith('/api/system-module-regression/reports'))return false;
  try{if(route===''&&req.method==='GET'){json(res,200,store.catalog(url.searchParams.get('systemId')||undefined));return true;}
   const match=route.match(/^\/(batch|core)\/([0-9a-f-]{36})(?:\/(metadata))?$/i);
   if(match&&req.method==='GET'&&!match[3]){json(res,200,store.detail(match[1],match[2]!,url.searchParams.get('systemId')??''));return true;}
   if(match&&req.method==='POST'&&match[3]==='metadata'){json(res,200,store.saveMetadata(match[1],match[2]!,await bodyJson(req)));return true;}
   fail(res,404,'报告操作不存在。');
  }catch(error){fail(res,error instanceof ReportMetadataConflict?409:422,error instanceof Error?error.message:'报告读取失败。');}return true;
 };
}
