import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Audit saved real results only. Never creates a run or calls an external AI.
const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319';
const root=base+'/api/system-module-regression';
const directory='artifacts/dify-expansion-20261031';
const selected=JSON.parse(await readFile(directory+'/run.json','utf8'));
const before=JSON.parse(await readFile(directory+'/before.json','utf8'));
const original=JSON.parse(await readFile('artifacts/dify-other-minimal/before.json','utf8'));
const api=async path=>{const response=await fetch(root+path);assert.equal(response.status,200,path);return response.json();};
const batch=await api('/batches/'+selected.batchId);
assert.equal(batch.phase,'completed');
assert.equal(batch.runMode,'fixed');assert.equal(batch.scope,'custom');
assert.equal(batch.jobs.length,5);
assert.equal(batch.entries.reduce((n,e)=>n+e.selectedCaseIds.length,0),22);
assert.equal(original.reduce((n,m)=>n+m.cases.length,0),131);
await mkdir(directory+'/screenshots',{recursive:true});
const dataRoot=process.env.TESTPILOT_VERIFY_DATA_DIR??'artifacts/demo';
const records=new DatabaseSync(path.join(dataRoot,'dify-web-modules','records.sqlite'),{readOnly:true});
const modules=[],outcomes=[],difyRuns=[];let screenshots=0;
for(const baseline of original){
 const current=await api('/modules/'+baseline.module.id);
 const saved=before.find(m=>m.module.id===baseline.module.id);
 assert.deepEqual(current.cases,baseline.cases,'Original XMind content changed.');
 assert.deepEqual(current.module.coreCaseIds,baseline.module.coreCaseIds,'Original core scope changed.');
 assert.equal(current.version.id,saved.version.id,'Immutable module version changed.');
 assert.ok(saved.module.starterCaseIds.every(id=>current.module.starterCaseIds.includes(id)),'An existing minimal case was removed.');
 const entry=batch.entries.find(e=>e.moduleId===baseline.module.id);
 const job=batch.jobs.find(j=>j.id===entry?.jobId);
 assert.ok(job);assert.equal(job.phase,'completed');assert.equal(job.executionFinished,true);
 assert.deepEqual(entry.selectedCaseIds,selected.caseSelections[baseline.module.id]);
 assert.deepEqual(job.selectedCaseIds,entry.selectedCaseIds);
 assert.equal(job.results.length,entry.selectedCaseIds.length);
 assert.ok(job.documentRunId,'Runnable cases have no linked browser run.');
 const stored=JSON.parse(records.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get('job',job.id).payload);
 assert.equal(stored.snapshot.id,batch.profileId,'A different account profile was used.');
 assert.equal(stored.snapshot.targetUrl,batch.targetUrl,'A different target was used.');
 assert.equal(stored.executionProject.id,batch.profileId);
 const run=JSON.parse(await readFile(path.join(dataRoot,'document-tests','runs',job.documentRunId,'run.json'),'utf8'));
 assert.equal(run.id,job.documentRunId);assert.equal(run.projectId,batch.profileId);
 assert.equal(createHash('sha256').update(JSON.stringify(job.databaseEvidence)).digest('hex'),job.databaseEvidenceDigest,'Database evidence fingerprint mismatch.');
 assert.ok(Date.parse(job.databaseEvidence.capturedAt)>=Date.parse(job.createdAt),'Database evidence predates this job.');
 assert.deepEqual(job.difyRuns.map(r=>r.phase),['dispatch','database-summary','report']);
 assert.ok(job.difyRuns.every(r=>r.id&&r.status==='succeeded'));
 difyRuns.push(...job.difyRuns.map(r=>({jobId:job.id,phase:r.phase,id:r.id,status:r.status})));
 const checks=job.databaseEvidence?.checks??[];
 for(const id of ['connection','fixtures','relations','account-scope'])assert.equal(checks.find(c=>c.id===id)?.status,'passed',baseline.module.name+':'+id);
 const counts={passed:0,failed:0,blocked:0};
 for(const result of job.results){
  const source=baseline.cases.find(c=>c.id===result.caseId);
  assert.ok(source);assert.equal(result.expected,source.expected);assert.equal(result.title,source.title);
  assert.ok(result.status in counts,'Incomplete or unexpected business outcome.');counts[result.status]++;
  assert.ok(result.evidence,'No screenshot: '+result.caseId);
  const response=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${result.evidence}`);
  assert.equal(response.status,200,result.caseId);assert.match(response.headers.get('content-type'),/image\/png/);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  await writeFile(`${directory}/screenshots/${result.caseId}.png`,bytes);screenshots++;
  if(result.caseId==='xmind-96'){
   assert.equal(result.status,'blocked');assert.equal(result.evidenceOrigin,'preflight');
   assert.match(result.evidenceNote,/未执行后台业务断言/);
   assert.ok(!job.difyRuns.find(r=>r.phase==='dispatch').caseIds.includes(result.caseId),'Preflight-blocked case dispatched as executable.');
   assert.ok(!run.deterministic.results.some(r=>r.id===result.caseId),'Preflight context was presented as a browser assertion.');
  }else{
   assert.equal(result.evidenceOrigin,'document-run');
   const actual=run.deterministic.results.find(r=>r.id===result.caseId);assert.ok(actual);
   assert.equal(actual.status,result.status);assert.equal(actual.evidence,result.evidence);assert.equal(actual.detail,result.detail);
  }
  outcomes.push({module:baseline.module.name,jobId:job.id,documentRunId:result.evidenceOrigin==='preflight'?null:job.documentRunId,...result});
 }
 const unknown=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${'0'.repeat(64)}.png`);assert.equal(unknown.status,404,'Unlinked evidence was exposed.');
 modules.push({name:baseline.module.name,id:baseline.module.id,jobId:job.id,documentRunId:job.documentRunId,selectedCaseIds:job.selectedCaseIds,counts,savedMinimalCaseIds:current.module.starterCaseIds,database:{status:job.databaseEvidence.status,checks:checks.map(c=>({id:c.id,status:c.status}))}});
}
records.close();
const backend=outcomes.find(r=>r.caseId==='xmind-96'),failure=outcomes.find(r=>r.caseId==='xmind-29');
assert.equal((await fetch(base+`/api/dify-web-modules/jobs/${failure.jobId}/evidence/${backend.evidence}`)).status,404,'A different job exposed the preflight image.');
assert.equal((await fetch(base+`/api/dify-web-modules/jobs/${backend.jobId}/evidence/${failure.evidence}`)).status,404,'A different job exposed the browser-run image.');
assert.equal(screenshots,22);assert.equal(difyRuns.length,15);
const response=await fetch(root+'/batches/'+batch.id+'/report');assert.equal(response.status,200);const report=await response.text();
for(const result of outcomes)assert.ok(report.includes(result.expected),'Report expectation missing: '+result.caseId);
const counts=outcomes.reduce((n,r)=>(n[r.status]++,n),{passed:0,failed:0,blocked:0});
for(const key of Object.keys(counts))assert.equal(batch.counts[key],counts[key]);
const proof={verifiedAt:new Date().toISOString(),batchId:batch.id,counts,originalCases:131,originalContentAndCorePreserved:true,sameAccountTargetAndDatabaseVerified:true,selectedCases:22,sameRunScreenshots:screenshots,successfulDifyCalls:difyRuns.length,savedMinimalCount:modules.reduce((n,m)=>n+m.savedMinimalCaseIds.length,0),modules,difyRuns,outcomes};
await writeFile(directory+'/batch.json',JSON.stringify(batch,null,2));
await writeFile(directory+'/report.md',report);
await writeFile(directory+'/proof.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify({batchId:batch.id,counts,screenshots,difyCalls:difyRuns.length,savedMinimalCount:proof.savedMinimalCount,modules:modules.map(m=>({name:m.name,...m.counts}))},null,2));
