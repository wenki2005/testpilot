/** Verify an existing real business batch. Does not create or mutate target data. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319';
const batchId=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(batchId??''))throw Error('Provide an existing batch UUID.');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const get=async p=>{const r=await fetch(base+p);assert.equal(r.ok,true,`Request failed: ${p}`);return r.json();};
const batch=await get(`/api/system-module-regression/batches/${batchId}`);
assert.equal(batch.phase,'completed','Real batch is not complete; do not claim acceptance.');
assert.equal(batch.databaseBinding,'department-supply-readonly');
const proof={batchId:batch.id,targetUrl:batch.targetUrl,verifiedAt:new Date().toISOString(),counts:batch.counts,jobs:[]};
for(const entry of batch.entries){
 const job=await get(`/api/dify-web-modules/jobs/${entry.jobId}`);
 assert.equal(job.phase,'completed');assert.equal(job.moduleId,entry.versionId);assert.equal(job.moduleDigest,entry.digest);assert.ok(job.documentRunId);assert.equal(job.executionFinished,true);
 const pack=await get(`/api/system-module-regression/modules/${entry.moduleId}?version=${entry.version}`);
 for(const result of job.results){const source=pack.cases.find(c=>c.id===result.caseId);assert.ok(source);assert.equal(result.expected,source.expected);assert.equal(result.title,source.title);}
 const evidence=job.databaseEvidence;assert.ok(evidence);assert.equal(job.databaseEvidenceDigest,digest(evidence));
 assert.equal(evidence.checks.find(c=>c.id==='connection')?.status,'passed');assert.ok(evidence.summary.applications>0);assert.ok(evidence.summary.goods>0);
 assert.ok(evidence.checks.find(c=>c.id==='account-scope'),'Current account scope must be explicit.');
 const dbRun=job.difyRuns.find(r=>r.phase==='database-summary'&&r.status==='succeeded');assert.ok(dbRun?.id);
 const manifest={schema:1,run_id:job.id,module_id:job.moduleId,plan_digest:job.databaseEvidenceDigest,suite_digest:job.moduleDigest,case_ids:evidence.checks.map(r=>`database:${r.id}`)};
 const inputs={execution_json:JSON.stringify({...manifest,phase:'report',results:evidence.checks.map(r=>({case_id:`database:${r.id}`,status:r.status})),database_evidence:evidence})};
 assert.equal(dbRun.inputDigest,digest(inputs),'The actual Dify input must bind this job and this exact database evidence.');
 for(const phase of ['prepare','dispatch','report'])assert.ok(job.difyRuns.some(r=>r.phase===phase&&r.status==='succeeded'&&r.id),`Missing real Dify ${phase}`);
 let screenshots=0;for(const row of job.results.filter(r=>r.evidence)){const r=await fetch(`${base}/api/dify-web-modules/jobs/${job.id}/evidence/${row.evidence}`);assert.equal(r.ok,true);assert.match(r.headers.get('content-type'),/image\/png/);assert.ok((await r.arrayBuffer()).byteLength>100);screenshots++;}
 assert.ok(screenshots>0);
 const report=await fetch(`${base}/api/system-module-regression/batches/${batch.id}/report`);assert.equal(report.ok,true);const text=await report.text();for(const value of [job.id,job.documentRunId,job.databaseEvidenceDigest,dbRun.id])assert.ok(text.includes(value),`Report missing ${value}`);
 proof.jobs.push({jobId:job.id,moduleId:entry.moduleId,version:entry.version,documentRunId:job.documentRunId,databaseEvidenceDigest:job.databaseEvidenceDigest,databaseEvidence:evidence,screenshots,originalExpectationsPreserved:job.results.length,difyRuns:job.difyRuns.map(r=>({phase:r.phase,id:r.id,status:r.status,inputDigest:r.inputDigest}))});
}
const dir=path.resolve('artifacts/dify-database-verification');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'real-e2e.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
