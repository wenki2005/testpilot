import type { BatchView, TestedSystem } from '../../src/domain/system-module-contract';
import type { WebModuleJobView } from '../../src/domain/dify-web-module-contract';

type CaseResult=WebModuleJobView['results'][number];
type LatestResult={result:CaseResult;startedAt:number;batchId:string;jobId:string};
export type LatestModuleResults=Map<string,Map<string,LatestResult>>;

/** Keep results within the current account/environment and immutable module
 * version. A cancelled run's unexecuted rows must not erase earlier evidence;
 * retrying an old report must not make its execution newer than a later run. */
export function latestModuleResults(batches:BatchView[],system?:TestedSystem):LatestModuleResults{
  const index:LatestModuleResults=new Map();if(!system)return index;
  const profileId=system.activeAccountId??system.profileId;
  for(const batch of batches){
    if(batch.systemId!==system.id||batch.profileId!==profileId||batch.targetUrl!==system.targetUrl||batch.environment!==system.environment)continue;
    for(const entry of batch.entries){
      const job=batch.jobs.find(job=>job.id===entry.jobId);if(!job)continue;
      const startedAt=Date.parse(job.createdAt)||Date.parse(batch.createdAt)||0;
      const key=entry.moduleId+':'+entry.versionId,results=index.get(key)??new Map<string,LatestResult>();
      for(const result of job.results){
        if(result.status==='not_executed'&&!result.outOfScope)continue;
        const previous=results.get(result.caseId);
        if(!previous||startedAt>=previous.startedAt)results.set(result.caseId,{result,startedAt,batchId:batch.id,jobId:job.id});
      }
      index.set(key,results);
    }
  }
  return index;
}

export function latestModuleSummary(index:LatestModuleResults,moduleId:string,versionId:string,caseIds:string[]|undefined,total:number){
  const selected=caseIds?new Set(caseIds):undefined;
  const expected=selected?.size??total;
  const counts={passed:0,failed:0,blocked:0,error:0,not_executed:0,outside:0};
  for(const[caseId,{result}]of index.get(moduleId+':'+versionId)??[]){
    if(selected&&!selected.has(caseId))continue;
    if(result.outOfScope)counts.outside++;
    else counts[result.status]++;
  }
  const recorded=Object.values(counts).reduce((sum,count)=>sum+count,0);
  counts.not_executed+=Math.max(0,expected-recorded);
  const labels={passed:'通过',failed:'失败',blocked:'阻塞',error:'异常',not_executed:'未执行',outside:'范围外'};
  const label=Object.entries(counts).filter(([,count])=>count>0).map(([status,count])=>count+' '+labels[status as keyof typeof labels]).join(' · ')||'未执行';
  const type=counts.failed?'failed':counts.error?'error':counts.blocked?'blocked':counts.not_executed?'not_executed':counts.passed?'passed':'not_executed';
  return{label,type,counts};
}
