import test from'node:test';import assert from'node:assert/strict';
import{DifyWebModuleStore}from'../dist/adapters/dify-web-modules.js';
import{DifyWorkflowError}from'../dist/adapters/dify-workflow-client.js';
test('transient dispatch retries same manifest, retains failed attempt; prepare and permanent failures do not retry',async()=>{
 for(const[phase,code,expectedCalls]of[['dispatch','http_503',2],['prepare','http_503',1],['dispatch','http_401',1]]){
  let calls=0;const job={id:'test-job',phase:'dispatching',difyRuns:[]},input={execution_json:'same-manifest'},context={deps:{cloud:async(_kind,inputs)=>{assert.deepEqual(inputs,input);calls++;if(calls===1)throw new DifyWorkflowError('upstream',undefined,code);return{workflowRunId:'success',output:{ok:true}};}},save:()=>{},event:()=>{}};
  const pending=DifyWebModuleStore.prototype.cloud.call(context,job,phase,0,input,['case-1'],new AbortController().signal,'execution');
  if(expectedCalls===2){assert.deepEqual(await pending,{ok:true});assert.deepEqual(job.difyRuns.map(v=>v.status),['failed','succeeded']);}else await assert.rejects(pending,e=>e.code===code);
  assert.equal(calls,expectedCalls);
 }
});
