import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DifyRegressionStore, validateDifyOutput } from '../../../dist/adapters/regression/authoring/case-baseline-store.js';

const sha = 'a'.repeat(64);
const source = {case_id:'XM-1',title:'旧功能',source_path:['基线','字段','必须拦截'],source_sha256:sha,source_expected_verbatim:'必须拦截',preconditions_proposed:[],steps_proposed:['查看'],needs_confirmation:['准备账号']};
const valid = () => ({baseline_sha256:sha,cases:[{...source,expected_result:source.source_expected_verbatim,review_status:'draft',execution_status:'not_executed',actual_result:null}]});
test('rejects changed expectations, missing/duplicate sources and fabricated passes', () => {
  assert.equal(validateDifyOutput(valid(),sha,[source]).length,1);
  for (const mutate of [o=>o.cases[0].expected_result='放宽预期',o=>o.cases[0].source_path=['别的路径'],o=>o.cases[0].execution_status='passed',o=>o.cases=[],o=>o.cases.push(o.cases[0]),o=>o.baseline_sha256='b'.repeat(64)]) {
    const output=valid(); mutate(output); assert.throws(()=>validateDifyOutput(output,sha,[source]));
  }
});
test('records cloud success as unexecuted drafts; preserves reviews, run versions and edits after reopen', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'testpilot-dify-'));
  const old=process.env.TESTPILOT_DIFY_API_KEY; process.env.TESTPILOT_DIFY_API_KEY='test-only-placeholder';
  let store; let calls=0;
  try {
    store=new DifyRegressionStore(directory, async (_url,options)=> { calls++; const request=JSON.parse(options.body); assert.equal(request.response_mode,'blocking'); assert.equal(JSON.parse(request.inputs.source_json).cases[0].case_id,'XM-1'); return Response.json({workflow_run_id:'cloud-run',data:{status:'succeeded',outputs:{result:JSON.stringify(valid())}}}); });
    const baseline=store.importBaseline({name:'旧基线',baseline_sha256:sha,cases:[source]});
    const input={baselineId:baseline.id,sourceIds:['XM-1'],requestId:randomUUID()};
    const task=store.start(input); assert.equal(store.start(input).id,task.id);
    await new Promise(r=>setTimeout(r,40)); assert.equal(calls,1);
    const version=store.state().versions[0]; assert.equal(version.cases[0].execution_status,'not_executed');
    const initial=store.createRun({versionId:version.id,systemVersion:'test-v1',databaseLabel:'synthetic',tester:'tester'});
    assert.throws(()=>store.recordResult({runId:initial.id,caseId:'XM-1',status:'passed',actual:'看过了',evidence:'操作记录'}),/未绑定/);
    store.review({versionId:version.id,decision:'approved',reviewer:'tester',notes:'测试中的模拟审核'});
    const run=store.createRun({versionId:version.id,systemVersion:'test-v1',databaseLabel:'synthetic',tester:'tester'});
    assert.throws(()=>store.recordResult({runId:run.id,caseId:'XM-1',status:'passed',actual:'拦截',evidence:''}),/证据/);
    store.recordResult({runId:run.id,caseId:'XM-1',status:'blocked',actual:'无测试账号',evidence:''});
    store.close(); store=new DifyRegressionStore(directory);
    const saved=store.state(); assert.equal(saved.runs[0].results[0].status,'blocked'); assert.equal(saved.runs[0].versionDigest,version.digest); assert.equal(saved.versions[0].cases[0].actual_result,null); assert.equal(saved.reviews.length,1);
  } finally { store?.close(); if(old===undefined) delete process.env.TESTPILOT_DIFY_API_KEY; else process.env.TESTPILOT_DIFY_API_KEY=old; await rm(directory,{recursive:true,force:true}); }
});
test('HTTP errors stay durable errors and do not create case versions', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'testpilot-dify-error-'));
  const old=process.env.TESTPILOT_DIFY_API_KEY; process.env.TESTPILOT_DIFY_API_KEY='test-only-placeholder'; let store;
  try {
    store=new DifyRegressionStore(directory,async()=>new Response('secret echoed upstream',{status:429}));
    const baseline=store.importBaseline({name:'synthetic',baseline_sha256:sha,cases:[source]});
    store.start({baselineId:baseline.id,sourceIds:['XM-1'],requestId:randomUUID()}); await new Promise(r=>setTimeout(r,30));
    assert.equal(store.state().versions.length,0); assert.equal(store.state().tasks[0].status,'error'); assert.match(store.state().tasks[0].error,/429/); assert.doesNotMatch(JSON.stringify(store.state()),/secret echoed/);
    store.close(); store=new DifyRegressionStore(directory); assert.equal(store.state().tasks[0].execution_status,'not_executed');
  } finally { store?.close(); if(old===undefined) delete process.env.TESTPILOT_DIFY_API_KEY; else process.env.TESTPILOT_DIFY_API_KEY=old; await rm(directory,{recursive:true,force:true}); }
});
