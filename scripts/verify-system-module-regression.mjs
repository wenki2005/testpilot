import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const base=process.env.TESTPILOT_DEMO_URL??'http://127.0.0.1:4319';
const api=async(route,data)=>{const r=await fetch(base+'/api/system-module-regression'+route,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
const encode=rows=>Buffer.from(['case_id,title,steps,expected_result',...rows.map(c=>[c.id,c.title,JSON.stringify(c.steps),c.expected].map(v=>'"'+v.replaceAll('"','""')+'"').join(','))].join('\n')).toString('base64');
const cases=[
 {id:'sample-heading',title:'样例标题显示',expected:'页面显示模块测试样例',steps:[{action:'assertText',text:'模块测试样例'}]},
 {id:'sample-failure-probe',title:'已知缺失提示检出',expected:'页面显示故障检出专用提示',steps:[{action:'assertText',text:'故障检出专用提示（此样例故意不提供）'}]},
 {id:'sample-field',title:'姓名输入与回显',expected:'姓名字段回显测试员',steps:[{action:'fillByLabel',label:'姓名',value:'测试员'},{action:'assertValue',label:'姓名',value:'测试员'}]},
 {id:'sample-disabled',title:'提交按钮不可用',expected:'提交按钮为禁用状态',steps:[{action:'assertRoleDisabled',role:'button',name:'提交'}]},
 {id:'sample-no-script',title:'页面提示文案「模块测试样例」',expected:'页面显示完整文案：模块测试样例',steps:[]},
];
let state=await api('');const name='本地流程验证系统';const system=state.systems.find(s=>s.name===name)??await api('/systems',{name,environment:'受控样例',targetUrl:base+'/sample/dify-module'});
const modules=[];
for(const [name,rows] of [['页面与故障检出',cases.slice(0,2)],['表单与只读交互',cases.slice(2)]]){state=await api('');const old=state.modules.find(m=>m.systemId===system.id&&m.name===name);modules.push(await api('/modules/import',{systemId:system.id,...(old?{moduleId:old.id}:{}),name,fileName:'cases.csv',bytesBase64:encode(rows)}));}
const wait=async b=>{let phase='';for(let n=0;n<360;n++){const current=await api('/batches/'+b.id);const message=current.jobs.map(j=>j.moduleName+':'+j.phase).join(' | ');if(message!==phase){phase=message;console.log(JSON.stringify({batchId:b.id,phase:current.phase,modules:message}));}if(!['queued','running'].includes(current.phase))return current;await new Promise(r=>setTimeout(r,1000));}throw Error('真实多模块回归超时');};
const batch=await wait(await api('/batches',{systemId:system.id,moduleIds:modules.map(m=>m.id),requestId:randomUUID()}));
assert.equal(batch.phase,'completed',batch.message);assert.equal(batch.jobs.length,2);assert.equal(batch.counts.passed,4,JSON.stringify(batch.jobs.map(j=>j.results)));assert.equal(batch.counts.failed,1);assert.equal(batch.counts.blocked,0);assert.equal(batch.counts.not_executed,0);
for(const entry of batch.entries){const job=batch.jobs.find(j=>j.id===entry.jobId);assert.ok(job.documentRunId);assert.equal(job.moduleId,entry.versionId);assert.equal(job.moduleDigest,entry.digest);assert.deepEqual([...new Set(job.difyRuns.filter(r=>r.status==='succeeded').map(r=>r.phase))],['prepare','dispatch','report']);assert.ok(job.difyRuns.every(r=>r.id));for(const row of job.results){assert.ok(row.evidence);const image=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${row.evidence}`);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);}}
assert.equal(batch.jobs[0].results.find(r=>r.caseId==='sample-failure-probe').status,'failed');assert.equal(batch.jobs[1].results.find(r=>r.caseId==='sample-no-script').status,'passed');
const report=await(await fetch(base+'/api/system-module-regression/batches/'+batch.id+'/report')).text();assert.ok(report.includes(batch.id));assert.ok(batch.jobs.every(j=>report.includes(j.documentRunId)));
const again=await wait(await api('/batches/'+batch.id+'/retest',{mode:'failed',requestId:randomUUID()}));assert.equal(again.entries.length,1);assert.equal(again.entries[0].moduleId,modules[0].id);assert.equal(again.entries[0].version,batch.entries[0].version);assert.equal(again.parentBatchId,batch.id);assert.equal(again.counts.failed,1);
await mkdir('artifacts/system-module-verification',{recursive:true});await writeFile('artifacts/system-module-verification/real-e2e.json',JSON.stringify({verifiedAt:new Date().toISOString(),controlledSample:true,systemId:system.id,batch,retest:again},null,2));
console.log(JSON.stringify({verified:true,batchId:batch.id,retestBatchId:again.id,systemId:system.id,counts:batch.counts,jobIds:batch.jobs.map(j=>j.id),workflowRunIds:batch.jobs.flatMap(j=>j.difyRuns.map(r=>r.id))}));
