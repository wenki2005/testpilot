import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319',root=base+'/api/system-module-regression';
const directory='artifacts/dify-other-minimal';await mkdir(directory,{recursive:true});
const modules=[
 ['2d6950a6-996d-4096-b820-22a0cd1a7d02',['xmind-92']],
 ['50defb76-157a-4ed1-9f91-10a8ba991e0c',['xmind-91']],
 ['b7de8f06-4e4d-4a62-a48d-881566a6f933',['xmind-81','xmind-83']],
 ['a1288838-bcb7-43a2-b79c-179e54132ebb',['xmind-94']],
];
const get=async path=>{const r=await fetch(root+path);assert.equal(r.status,200);return r.json();};
const post=async(path,body)=>{const r=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const out=await r.json();assert.ok(r.ok,JSON.stringify(out));return out;};
if(process.argv.includes('--start')){
 const state=await get('');assert.ok(!state.batches.some(b=>['running','queued'].includes(b.phase)),'another batch active');
 for(const [id,caseIds] of modules){const m=await get('/modules/'+id);await post('/modules/'+id+'/core',{versionId:m.version.id,scope:'starter',caseIds});}
 const batch=await post('/batches',{systemId:'436847ad-f144-425f-b303-1ca9b22e0b52',moduleIds:modules.map(m=>m[0]),scope:'starter',runMode:'fixed',requestId:randomUUID()});
 await writeFile(directory+'/round.json',JSON.stringify(batch,null,2));console.log(JSON.stringify({started:batch.id}));
 process.exit(0);
}
const saved=JSON.parse(await readFile(directory+'/round.json','utf8'));const batch=await get('/batches/'+saved.id);
await writeFile(directory+'/round.json',JSON.stringify(batch,null,2));
console.log(JSON.stringify({id:batch.id,phase:batch.phase,counts:batch.counts,jobs:batch.jobs.map(j=>({id:j.id,name:j.moduleName,phase:j.phase,results:j.results.map(r=>({id:r.caseId,status:r.status,detail:r.detail}))}))}));
if(batch.phase!=='completed')process.exit(0);
assert.equal(batch.scope,'starter');assert.equal(batch.runMode,'fixed');assert.equal(batch.jobs.length,4);
assert.equal(batch.counts.error,0);assert.equal(batch.counts.not_executed,0);assert.equal(batch.counts.outside,0);
const baseline=JSON.parse(await readFile(directory+'/before.json','utf8'));let screenshots=0;const calls=[];
for(const [id,ids] of modules){
 const entry=batch.entries.find(e=>e.moduleId===id),job=batch.jobs.find(j=>j.id===entry.jobId),before=baseline.find(b=>b.module.id===id);
 assert.deepEqual(entry.selectedCaseIds,ids);assert.deepEqual(job.selectedCaseIds,ids);assert.equal(job.results.length,ids.length);
 assert.ok(job.documentRunId&&job.executionFinished);assert.equal(job.phase,'completed');
 assert.deepEqual(job.difyRuns.map(r=>r.phase),['dispatch','database-summary','report']);
 assert.ok(job.difyRuns.every(r=>r.status==='succeeded'&&r.id));calls.push(...job.difyRuns.map(r=>({jobId:job.id,phase:r.phase,id:r.id})));
 for(const r of job.results){
  const c=before.cases.find(c=>c.id===r.caseId);assert.equal(r.expected,c.expected);assert.equal(r.title,c.title);
  assert.ok(['passed','failed','blocked'].includes(r.status));assert.ok(r.evidence);
  const response=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${r.evidence}`);assert.equal(response.status,200);
  const png=Buffer.from(await response.arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');await writeFile(directory+'/'+r.caseId+'.png',png);screenshots++;
 }
}
for(const before of baseline){const after=await get('/modules/'+before.module.id);assert.deepEqual(after.cases,before.cases);assert.deepEqual(after.module.coreCaseIds,before.module.coreCaseIds);if(!modules.some(m=>m[0]===before.module.id))assert.deepEqual(after.module.starterCaseIds,before.module.starterCaseIds);}
const reportResponse=await fetch(root+'/batches/'+batch.id+'/report');assert.equal(reportResponse.status,200);const report=await reportResponse.text();
for(const job of batch.jobs)for(const r of job.results)assert.ok(report.includes(r.expected));await writeFile(directory+'/report.md',report);
const proof={verifiedAt:new Date().toISOString(),batchId:batch.id,counts:batch.counts,seconds:(Date.parse(batch.updatedAt)-Date.parse(batch.createdAt))/1000,sameRunScreenshots:screenshots,realDifyRuns:calls,documentRuns:batch.jobs.map(j=>({jobId:j.id,runId:j.documentRunId})),original131CasesPreserved:true,originalCorePreserved:true,formMinimalPreserved:true};
await writeFile(directory+'/proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
