import type {Page} from 'playwright';
import type {BrowserCheck} from '../domain/document-test-model.js';
import {createAuthorizedBrowserWrite} from './authorized-browser-write.js';

/** Bind a consumed operation to its originating run. Historical submissions
 * cannot satisfy a new run, and resolving an output never submits anything. */
export function createAuthorizedRunBinding(directory:string) {
  const writes=createAuthorizedBrowserWrite(directory);
  return {
    async resolveCase(item:BrowserCheck,projectId:string,runId:string):Promise<BrowserCheck> {
      if(!item.writeResultOperationId)return item;
      const record=await writes.read(item.writeResultOperationId);
      if(record.plan.projectId!==projectId || record.runId!==(item.writeResultSourceRunId ?? runId) || record.state!=='verified' || !record.applyNo)
        throw new Error('Blocked: 本轮没有已核验的提交编号；禁止使用历史申请替代本轮新建。');
      return JSON.parse(JSON.stringify(item).replaceAll('$APPLICATION_NUMBER',record.applyNo)) as BrowserCheck;
    },
    async completeCase(item:BrowserCheck,projectId:string,runId:string,targetUrl:string,page:Page):Promise<string|undefined> {
      if(!item.authorizedWriteOperationId)return;
      if(item.coverageGap || item.preconditionsConfirmed!==true)
        throw new Error('Blocked: 提交前仍有未验收条件；未释放写入。');
      const plan=(await writes.read(item.authorizedWriteOperationId)).plan;
      const canonical=(value:string)=>{const url=new URL(value);url.pathname=url.pathname.replace(/\/index\.html$/u,'/');return url.href;};
      if(canonical(plan.targetUrl)!==canonical(targetUrl))throw new Error('Blocked: 单次授权与本轮网站环境不匹配。');
      const record=await writes.execute(item.authorizedWriteOperationId,projectId,plan.targetUrl,page,runId);
      if(record.state!=='verified' || !record.applyNo)
        throw new Error('Blocked: 提交结果或编号尚未核验；禁止重提，需调查本次操作。');
      return `本轮单次提交已核验：operation=${item.authorizedWriteOperationId}，申请编号=${record.applyNo}`;
    },
  };
}
