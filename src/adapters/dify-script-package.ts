import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {readDocumentPackage} from './document-test-workflow.js';
import type {WebModuleJob} from './dify-web-modules.js';
import {formatDifyMarkdown} from './dify-markdown-pack.js';
import {assertDifyExportSafe} from './dify-export-policy.js';
import {needsDifyReadback} from './dify-readonly-scenarios.js';

/** Narrow Dify export compatibility fix; the shared runner source is unchanged. */
export function difyPortableRunner(source:string):string {
  const allowed=['assertControlEnabled','assertSelectedByRoleIndex','assertText','assertVisible','assertNotVisible','assertExactVisible','assertRoleVisible','assertValue','assertValueByPlaceholder','assertDisabled','assertRoleDisabled','assertFieldInvalid','assertMaxLengthOrMessage','assertNoHorizontalOverflow','assertNoFetchOrXhr','assertCurrentUrlUnchanged'];
  const match=source.match(/c\.steps\.some\(s=>(\[[^\]\n]+\])\.includes\(s\.action\)\)/);
  let existing:unknown;try{existing=JSON.parse(match?.[1]?.replaceAll("'",'"')??'null');}catch{}
  if(!match||!Array.isArray(existing)||!existing.length||existing.some(value=>!allowed.includes(value)))throw Error('固定脚本的断言协议发生变化，导出前需要重新核验。');
  return source.replace(match[0],`c.steps.some(s=>${JSON.stringify(allowed)}.includes(s.action))`);
}

/** Reuse the existing portable runner; export only this Dify batch's frozen scope. */
export async function difyScriptPackage(jobs:WebModuleJob[]):Promise<Buffer> {
  const completed=jobs.find(j=>j.documentRunId&&j.executionFinished);
  if(!completed?.documentRunId)throw Error('本轮尚未形成网页执行脚本包；可先导出 Markdown 用例。');
  const runnerFiles=unzipSync(await readDocumentPackage(completed.documentRunId));
  if(!runnerFiles['run.mjs']||!runnerFiles['package.json'])throw Error('本轮执行包缺少固定脚本，请恢复打包阶段后重试。');
  const files:Record<string,Uint8Array>={'README.md':strToU8('# Dify 模块固定脚本包\n\n每个任务目录包含本轮固定范围、原始预期、固定步骤及独立运行脚本。进入任务目录安装依赖并运行 npm test。需要登录的网站请使用自己的本机浏览器会话；包中不含登录态或凭据。\n\n此包独立运行不调用 Dify，不代表产生了新的 Dify 工作流记录。阻塞项保留原预期并清空不可证明完整预期的执行步骤，独立执行时仍应报告 blocked；范围外条目不进入执行选择。数据库只读核验仍需在 TestPilot 工作台执行，不随本脚本包导出。\n')};
  for(const job of jobs){
    const source=job.executionProject??job.snapshot;
    const cases=structuredClone(source.cases.filter(c=>job.selectedCaseIds.includes(c.id)));
    for(const c of cases){const result=job.results.find(r=>r.caseId===c.id);if(!result||!['passed','failed'].includes(result.status)||c.expected==='必填未完成时提交按钮置灰不可点击'||needsDifyReadback(c))c.steps=[];}
    assertDifyExportSafe({targetUrl:job.snapshot.targetUrl,cases});
    const prefix=job.id+'/';
    files[prefix+'run.mjs']=strToU8(difyPortableRunner(strFromU8(runnerFiles['run.mjs'])));files[prefix+'package.json']=runnerFiles['package.json'];
    files[prefix+'cases.json']=strToU8(JSON.stringify({targetUrl:job.snapshot.targetUrl,cases,selectedCaseIds:job.results.filter(r=>!r.outOfScope).map(r=>r.caseId)},null,2));
    files[prefix+'cases.md']=strToU8(formatDifyMarkdown(job.moduleName,cases));
    files[prefix+'manifest.json']=strToU8(JSON.stringify({jobId:job.id,moduleId:job.moduleId,moduleDigest:job.moduleDigest,planDigest:job.planDigest,selectedCaseIds:job.selectedCaseIds,originalResults:job.results.map(r=>({caseId:r.caseId,status:r.status,outOfScope:r.outOfScope})),readOnly:true,difyCalledByExportedRunner:false},null,2));
    if(cases.some(c=>c.expected==='必填未完成时提交按钮置灰不可点击'))files[prefix+'DIFY-CHECKS.md']=strToU8('必填未完成时提交按钮置灰不可点击：本机 Dify 额外验证渲染后的灰色背景。当前独立脚本不包含此样式检查，因此该条保留原预期并以无完整步骤/blocked 导出，不仅凭禁用状态宣称通过。请在 Dify 工作台运行此条。\n');
    if(cases.some(needsDifyReadback))files[prefix+'DIFY-READBACK.md']=strToU8('本目录包含需要 TestPilot 本机查询回读、提示颜色或完整表单有效性转换核验的用例。独立脚本不包含这些补充检查，相应条目保留原始预期并留空步骤，独立执行须报告 blocked。请在 TestPilot 固定回归工作台执行完整核验。\n');
  }
  return Buffer.from(zipSync(files));
}
