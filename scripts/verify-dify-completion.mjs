import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';

// Verify the recorded real batch; this script never starts another external run.
const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319';
const root=base+'/api/system-module-regression',directory='artifacts/dify-completion';
const api=async url=>{const response=await fetch(url);assert.equal(response.status,200,url);return response.json();};
const saved=JSON.parse(await readFile(directory+'/full-round.json','utf8'));
const batch=await api(root+'/batches/'+saved.id);
await writeFile(directory+'/full-round.json',JSON.stringify(batch,null,2));
assert.equal(batch.phase,'completed','The real batch has not completed; no result is assumed.');
const before=JSON.parse(await readFile('.local/dify-core-baseline/readonly-expansion-before.json','utf8'));
assert.equal(batch.jobs.reduce((sum,job)=>sum+job.selectedCaseIds.length,0),131);
let screenshotCount=0,difyCount=0;const outcomes=[];
for(const entry of batch.entries){
 const original=before.modules.find(m=>m.module.id===entry.moduleId);assert.ok(original);
 const current=await api(root+'/modules/'+entry.moduleId);assert.deepEqual(current.cases,original.cases);assert.deepEqual(current.module.coreCaseIds,original.module.coreCaseIds);
 const job=batch.jobs.find(j=>j.id===entry.jobId);assert.equal(job.phase,'completed');assert.ok(job.difyRuns.length);difyCount+=job.difyRuns.length;
 assert.ok(job.difyRuns.every(r=>r.id&&r.status==='succeeded'&&r.phase!=='prepare'));
 for(const result of job.results){
  const source=original.cases.find(c=>c.id===result.caseId);assert.ok(source);assert.equal(result.expected,source.expected);assert.equal(result.title,source.title);
  if(['passed','failed'].includes(result.status)){
   assert.ok(result.evidence,'No same-run screenshot: '+result.caseId);assert.ok(job.documentRunId);
   const response=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${result.evidence}`);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(1,4).toString(),'PNG');screenshotCount++;
  }
  if(result.status==='blocked')assert.ok(result.detail&&result.nextAction&&result.blockerCode,'Missing actionable blocker: '+result.caseId);
  outcomes.push({module:entry.moduleName,id:result.caseId,status:result.status,outOfScope:result.outOfScope??false,expected:result.expected,detail:result.detail,blockerCode:result.blockerCode,nextAction:result.nextAction});
 }
}
const response=await fetch(root+'/batches/'+batch.id+'/report');assert.equal(response.status,200);const report=await response.text();for(const result of outcomes)assert.ok(report.includes(result.expected));await writeFile(directory+'/full-report.md',report);
const zipResponse=await fetch(root+'/batches/'+batch.id+'/scripts');assert.equal(zipResponse.status,200);const zip=Buffer.from(await zipResponse.arrayBuffer());await writeFile(directory+'/full-scripts.zip',zip);const files=unzipSync(zip);
for(const job of batch.jobs){
 const payload=JSON.parse(strFromU8(files[job.id+'/cases.json']));assert.equal(payload.cases.length,job.results.length);
 for(const c of payload.cases){assert.equal(c.expected,job.results.find(r=>r.caseId===c.id).expected);if(!['passed','failed'].includes(job.results.find(r=>r.caseId===c.id).status))assert.equal(c.steps.length,0);}
}
const proof={verifiedAt:new Date().toISOString(),batchId:batch.id,counts:batch.counts,original131CasesPreserved:true,originalCorePreserved:true,realDifyCalls:difyCount,sameRunScreenshots:screenshotCount,modules:batch.jobs.map(j=>({name:j.moduleName,jobId:j.id,documentRunId:j.documentRunId,difyRunIds:j.difyRuns.map(r=>r.id)})),outcomes};
await writeFile(directory+'/proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify({batchId:proof.batchId,counts:proof.counts,screenshots:screenshotCount,difyCalls:difyCount,originalsPreserved:true}));
