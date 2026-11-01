import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';

const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319';
const api=async(route,data)=>{const response=await fetch(base+'/api/system-module-regression'+route,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await response.json();assert.equal(response.ok,true,value.error??route);return value;};
const state=await api('');const system=state.systems.find(s=>s.id==='436847ad-f144-425f-b303-1ca9b22e0b52');assert.ok(system);
const proposed={
 '登录入口与公共基础':['xmind-1','xmind-92','xmind-93'],
 '申样申请与经销商数据':['xmind-4','xmind-10','xmind-17','xmind-18','xmind-21','xmind-25','xmind-29','xmind-33','xmind-37','xmind-39','xmind-46','xmind-50'],
 '申请记录与审批详情':['xmind-53','xmind-54','xmind-55','xmind-56','xmind-57','xmind-61','xmind-73','xmind-74','xmind-75','xmind-78','xmind-79','xmind-87'],
 '订单与物流':['xmind-80','xmind-81','xmind-82','xmind-83','xmind-84','xmind-85'],
 'PC/H5 横向适配':['xmind-94'],
};
const before={};const summaries=[];
for(const m of state.modules.filter(m=>m.systemId===system.id&&!m.archived)){
 const pack=await api('/modules/'+m.id);before[m.id]=pack;
 const ids=proposed[m.name];assert.ok(ids);for(const id of ids)assert.ok(pack.cases.some(c=>c.id===id));
 if(!process.argv.includes('--existing'))await api('/modules/'+m.id+'/core',{versionId:pack.version.id,caseIds:ids});const after=await api('/modules/'+m.id);assert.deepEqual(after.cases,pack.cases);assert.deepEqual(after.module.coreCaseIds,ids);
 summaries.push({name:m.name,moduleId:m.id,core:ids.length,total:pack.cases.length,ids});
}
const module=state.modules.find(m=>m.systemId===system.id&&m.name==='申样申请与经销商数据');const version=module.versions.at(-1);
const wait=async(batch)=>{let last='';for(let n=0;n<600;n++){const value=await api('/batches/'+batch.id);const current=value.jobs.map(j=>j.phase).join(',');if(current!==last){last=current;console.log(JSON.stringify({batchId:batch.id,phase:value.phase,jobs:current}));}if(!['queued','running'].includes(value.phase))return value;await new Promise(r=>setTimeout(r,1000));}throw Error('Real fixed regression timed out.');};
const runs=[];
let preparation=process.argv.includes('--existing')?state.batches.find(b=>b.systemId===system.id&&b.runMode==='assist'&&b.scope==='core'&&b.entries.length===1&&b.entries[0].moduleId===module.id):undefined;
if(process.argv.includes('--prepare')){preparation=await wait(await api('/batches',{systemId:system.id,moduleIds:[module.id],versionSelections:{[module.id]:version.id},runMode:'assist',scope:'core',requestId:randomUUID()}));assert.equal(preparation.jobs[0].phase,'completed',preparation.jobs[0].message);}
for(let round=0;round<2;round++){
 const prior=state.batches.filter(b=>b.systemId===system.id&&b.runMode==='fixed'&&b.scope==='core'&&b.phase==='completed'&&b.entries.length===1&&b.entries[0].moduleId===module.id).slice(0,2).reverse();
 const batch=await wait(process.argv.includes('--existing')?prior[round]:await api('/batches',{systemId:system.id,moduleIds:[module.id],versionSelections:{[module.id]:version.id},runMode:'fixed',scope:'core',requestId:randomUUID()}));
 assert.equal(batch.phase,'completed');const job=batch.jobs[0];assert.equal(job.phase,'completed',job.message);assert.equal(job.runMode,'fixed');assert.equal(job.results.length,12);assert.ok(job.difyRuns.every(r=>r.phase!=='prepare'&&r.status==='succeeded'&&r.id));for(const phase of ['dispatch','report','database-summary'])assert.ok(job.difyRuns.some(r=>r.phase===phase));
 assert.equal(job.results.find(r=>r.caseId==='xmind-39').status,'blocked');assert.ok(job.documentRunId);assert.equal(job.databaseEvidence.checks.find(c=>c.id==='connection').status,'passed');
 for(const row of job.results){const original=before[module.id].cases.find(c=>c.id===row.caseId);assert.equal(row.expected,original.expected);assert.equal(row.title,original.title);if(row.evidence){const image=await fetch(`${base}/api/dify-web-modules/jobs/${job.id}/evidence/${row.evidence}`);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);}}
 runs.push(batch);
}
const response=await fetch(base+'/api/system-module-regression/batches/'+runs[1].id+'/scripts');assert.equal(response.ok,true);const zip=unzipSync(new Uint8Array(await response.arrayBuffer()));const prefix=runs[1].jobs[0].id+'/';const cases=JSON.parse(strFromU8(zip[prefix+'cases.json']));assert.equal(cases.cases.length,12);assert.equal(cases.cases.find(c=>c.id==='xmind-39').steps.length,0);assert.ok(zip[prefix+'run.mjs']);assert.ok(zip[prefix+'package.json']);assert.ok(zip[prefix+'manifest.json']);
const old=await api('/batches/ef6febfc-10e2-472d-9aad-69595176f5e5');assert.equal(old.jobs[0].results.find(r=>r.caseId==='xmind-39').status,'passed','Historical results must not be rewritten.');
const dir='artifacts/dify-core-verification';await mkdir(dir,{recursive:true});await writeFile(dir+'/real-e2e.json',JSON.stringify({verifiedAt:new Date().toISOString(),systemId:system.id,modules:summaries,preparation,runs,scriptFiles:Object.keys(zip),historicalStatusPreserved:true},null,2));
console.log(JSON.stringify({verified:true,modules:summaries.map(({ids,...m})=>m),runs:runs.map(b=>({batchId:b.id,counts:b.counts,jobId:b.jobs[0].id,workflowRuns:b.jobs[0].difyRuns.length,documentRunId:b.jobs[0].documentRunId})),scriptFiles:Object.keys(zip)}));
