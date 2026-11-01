import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { ModuleRegressionStore,resultCounts } from '../dist/adapters/module-regression.js';
import { runApiSuite } from '../dist/adapters/api-test-adapter.js';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function finish(store,id){for(let i=0;i<200;i++){const run=store.state().runs.find(r=>r.id===id);if(['completed','blocked','error'].includes(run.stage))return run;await new Promise(r=>setTimeout(r,10));}throw new Error('run did not finish');}
async function fixture(work){
  const dir=await mkdtemp(path.join(os.tmpdir(),'testpilot-module-'));let calls=0;let server=createServer((req,res)=>{calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:req.url==='/good'}));});server.listen(0,'127.0.0.1');await once(server,'listening');
  const suite={version:1,name:'synthetic local checks',baseUrl:`http://127.0.0.1:${server.address().port}/`,cases:['good','bad'].map(id=>({id,title:id,source:'Synthetic tool self-test',requirementRefs:['TOOL-SELFTEST'],request:{method:'GET',path:'/'+id,timeoutMs:1000},expect:{status:200,json:{ok:true}}}))};
  const candidate={id:randomUUID(),status:'approved',automaticReadOnlyRun:false,revision:1,createdAt:new Date().toISOString(),digest:hash(suite),suite};
  const stores=[];
  const make=(overrides={})=>{const store=new ModuleRegressionStore(dir,{candidate:async()=>candidate,execute:async(id,options)=>{assert.equal(id,candidate.id);return runApiSuite({suite,outputRoot:path.join(dir,'api-runs'),...options});},fetcher:async(_url,options)=>{
    const request=JSON.parse(options.body);assert.ok(!options.body.includes(suite.baseUrl));assert.ok(!options.body.includes('SENSITIVE'));const data=JSON.parse(request.inputs.execution_json);const result={...data};if(data.phase==='dispatch')result.action='execute-approved-suite';else result.counts=resultCounts(data.results);return Response.json({workflow_run_id:randomUUID(),data:{status:'succeeded',outputs:{result:JSON.stringify(result)}}});},...overrides});stores.push(store);return store;};
  try{await work({make,candidate,suite,dir,calls:()=>calls});}finally{stores.forEach(s=>{try{s.close();}catch{}});server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
}
const register=(store,candidate)=>store.register({name:'synthetic module',suiteId:candidate.id,reviewer:'self-test',notes:'Synthetic tool validation only',confirmed:true});
const input=plan=>({moduleId:plan.id,method:'api-direct',systemVersion:'synthetic-v1',dataLabel:'synthetic-only',tester:'self-test',requestId:randomUUID(),allowNetwork:false});
test('direct and Dify execution use the same fixed assertions, preserve real failures, and share module history',async()=>fixture(async({make,candidate,calls})=>{
  const old=process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;process.env.TESTPILOT_DIFY_EXECUTION_API_KEY='SENSITIVE';
  try{const store=make();const plan=await register(store,candidate);const firstInput=input(plan);const first=await store.start(firstInput);assert.equal((await store.start(firstInput)).id,first.id);const direct=await finish(store,first.id);assert.equal(direct.outcome,'failed');assert.deepEqual(direct.results.map(r=>r.status),['passed','failed']);
    const next=await store.start({...input(plan),method:'dify'});const dify=await finish(store,next.id);assert.equal(dify.stage,'completed');assert.equal(dify.workflowStatus,'completed');assert.equal(dify.outcome,'failed');assert.equal(dify.difyRuns.length,2);assert.deepEqual(direct.results,dify.results);assert.equal(calls(),4);const unified=await store.unifiedRuns();assert.equal(unified.length,2);assert.deepEqual(new Set(unified.map(r=>r.method)),new Set(['api-direct','dify']));store.close();const reopened=make();assert.equal(reopened.state().runs.length,2);
  }finally{if(old===undefined)delete process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;else process.env.TESTPILOT_DIFY_EXECUTION_API_KEY=old;}
}));
test('changed Dify manifest cannot dispatch any target requests',async()=>fixture(async({make,candidate,calls})=>{
  const old=process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;process.env.TESTPILOT_DIFY_EXECUTION_API_KEY='test';
  try{const store=make({fetcher:async()=>Response.json({data:{status:'succeeded',outputs:{result:JSON.stringify({action:'execute-approved-suite',case_ids:['injected']})}}})});const plan=await register(store,candidate);const r=await store.start({...input(plan),method:'dify'});const done=await finish(store,r.id);assert.equal(done.stage,'blocked');assert.equal(calls(),0);assert.ok(done.results.every(r=>r.status==='not_executed'));}finally{if(old===undefined)delete process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;else process.env.TESTPILOT_DIFY_EXECUTION_API_KEY=old;}
}));
test('Dify web package check receives only hashed case IDs, counts and digest',async()=>fixture(async({make})=>{
  const oldKey=process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;process.env.TESTPILOT_DIFY_EXECUTION_API_KEY='SENSITIVE';
  try{let sent;const store=make({fetcher:async(_url,options)=>{sent=options.body;const data=JSON.parse(JSON.parse(options.body).inputs.execution_json);return Response.json({workflow_run_id:randomUUID(),data:{status:'succeeded',outputs:{result:JSON.stringify({...data,action:'check-approved-web-package'})}}});}});const manifest={schema:1,phase:'web-package-check',run_id:randomUUID(),module_id:randomUUID(),package_digest:'a'.repeat(64),case_ids:[createHash('sha256').update('opaque-1').digest('hex')],status_counts:{runnable:0,held:1,draft:0}};const result=await store.checkWebPackage(manifest);assert.equal(result.status,'ok');assert.match(sent,/web-package-check/);assert.doesNotMatch(sent,/case title|targetUrl|cookie|oauth/i);store.close();}finally{if(oldKey===undefined)delete process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;else process.env.TESTPILOT_DIFY_EXECUTION_API_KEY=oldKey;}
}));
test('missing target credentials block before network access',async()=>fixture(async({make,candidate,calls})=>{
  candidate.suite.cases[0].request.headers={authorization:'Bearer ${ENV:TESTPILOT_NONEXISTENT_MODULE_TEST_TOKEN}'};candidate.digest=hash(candidate.suite);
  const store=make();const plan=await register(store,candidate);const run=await store.start(input(plan));const done=await finish(store,run.id);assert.equal(done.stage,'blocked');assert.match(done.message,/缺少本机/);assert.equal(calls(),0);
}));
test('cloud report failure never erases real assertion failures and their artifact ID',async()=>fixture(async({make,candidate,calls})=>{
  const old=process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;process.env.TESTPILOT_DIFY_EXECUTION_API_KEY='test';
  try{const store=make({fetcher:async(_url,options)=>{const data=JSON.parse(JSON.parse(options.body).inputs.execution_json);if(data.phase==='report')return new Response('upstream secret',{status:503});return Response.json({data:{status:'succeeded',outputs:{result:JSON.stringify({...data,action:'execute-approved-suite'})}}});}});const plan=await register(store,candidate);const r=await store.start({...input(plan),method:'dify'});const done=await finish(store,r.id);assert.equal(done.stage,'error');assert.equal(done.outcome,'failed');assert.equal(done.workflowStatus,'error');assert.ok(done.apiRunId);assert.equal(calls(),2);assert.doesNotMatch(JSON.stringify(done),/upstream secret/);}finally{if(old===undefined)delete process.env.TESTPILOT_DIFY_EXECUTION_API_KEY;else process.env.TESTPILOT_DIFY_EXECUTION_API_KEY=old;}
}));
test('unapproved, mutating or trace-free suites cannot be bound',async()=>fixture(async({make,candidate})=>{
  const store=make();candidate.status='draft';await assert.rejects(register(store,candidate),/已批准/);candidate.status='approved';candidate.suite.cases[0].source='';candidate.digest=hash(candidate.suite);await assert.rejects(register(store,candidate));
  candidate.suite.cases[0].source='Synthetic';candidate.suite.cases[0].request={method:'POST',path:'/mutate/${RUN_ID}'};
  candidate.suite.fixtures={setup:[],cleanup:[{id:'cleanup',title:'cleanup',request:{method:'DELETE',path:'/mutate/${RUN_ID}'},expect:{status:200}}]};candidate.digest=hash(candidate.suite);await assert.rejects(register(store,candidate),/只读/);
}));
test('a changed approved suite blocks a bound module without using the new assertions',async()=>fixture(async({make,candidate,calls})=>{
  const store=make();const plan=await register(store,candidate);candidate.suite.cases[0].expect.json={ok:false};candidate.digest=hash(candidate.suite);const r=await store.start(input(plan));const done=await finish(store,r.id);assert.equal(done.outcome,'blocked');assert.match(done.message,/发生变化/);assert.equal(calls(),0);
}));
