import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.TESTPILOT_DEMO_URL??'http://127.0.0.1:4319';
const cases=[
 {id:'sample-heading',title:'样例标题显示',expected:'页面显示模块测试样例',steps:[{action:'assertText',text:'模块测试样例'}]},
 {id:'sample-field',title:'姓名输入与回显',expected:'姓名字段回显测试员',steps:[{action:'fillByLabel',label:'姓名',value:'测试员'},{action:'assertValue',label:'姓名',value:'测试员'}]},
 {id:'sample-disabled',title:'提交按钮不可用',expected:'提交按钮为禁用状态',steps:[{action:'assertRoleDisabled',role:'button',name:'提交'}]},
 {id:'sample-no-script',title:'页面提示文案「模块测试样例」',expected:'页面显示完整文案：模块测试样例',steps:[]},
 {id:'sample-failure-probe',title:'已知缺失提示检出',expected:'页面显示故障检出专用提示',steps:[{action:'assertText',text:'故障检出专用提示（此样例故意不提供）'}]},
];
const csv=['case_id,title,steps,expected_result',...cases.map(c=>[c.id,c.title,JSON.stringify(c.steps),c.expected].map(v=>'"'+v.replaceAll('"','""')+'"').join(','))].join('\n');
await writeFile('examples/dify-web-module-sample.csv',csv);
const api=async(path,data)=>{const r=await fetch(base+'/api/dify-web-modules'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error);return v;};
const imported=await api('/import',{name:'受控样例：Dify 完整流程',fileName:'dify-web-module-sample.csv',bytesBase64:Buffer.from(csv).toString('base64'),targetUrl:base+'/sample/dify-module'});
const wait=async job=>{let last='';for(let i=0;i<240;i++){const current=await api('/jobs/'+job.id);if(current.phase!==last){console.log(JSON.stringify({jobId:job.id,phase:current.phase,message:current.message}));last=current.phase;}if(['completed','error','blocked','cancelled'].includes(current.phase))return current;await new Promise(r=>setTimeout(r,1000));}throw Error('模块真实联调超时');};
const done=await wait(await api('/jobs',{moduleId:imported.id,requestId:randomUUID()}));
assert.equal(done.phase,'completed',done.message);assert.equal(done.results.filter(r=>r.status==='passed').length,4,JSON.stringify(done.results));assert.equal(done.results.find(r=>r.caseId==='sample-no-script').status,'passed');assert.equal(done.results.find(r=>r.caseId==='sample-failure-probe').status,'failed');assert.equal(done.outcome,'failed');assert.ok(done.documentRunId);assert.ok(done.results.every(r=>r.evidence));assert.deepEqual([...new Set(done.difyRuns.filter(r=>r.status==='succeeded').map(r=>r.phase))],['prepare','dispatch','report']);assert.ok(done.difyRuns.every(r=>r.id));
const child=await wait(await api('/jobs/'+done.id+'/retest',{requestId:randomUUID(),selectedCaseIds:['sample-failure-probe']}));assert.equal(child.parentJobId,done.id);assert.equal(child.results.length,1);assert.equal(child.results[0].status,'failed');assert.notEqual(child.documentRunId,done.documentRunId);
await mkdir('artifacts/dify-module-verification',{recursive:true});await writeFile('artifacts/dify-module-verification/real-e2e.json',JSON.stringify({verifiedAt:new Date().toISOString(),controlledSample:true,main:done,retest:child},null,2));console.log(JSON.stringify({verified:true,mainJobId:done.id,retestJobId:child.id,actualPassed:4,actualFailed:1,difyRuns:done.difyRuns}));
