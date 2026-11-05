import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {DifyWebModuleStore,moduleTarget,moduleDigest,checkModulePlan} from '../../../dist/adapters/regression/execution/module-execution-service.js';
import {DifyWorkflowError} from '../../../dist/adapters/integrations/dify/workflow-client.js';

const csv=(rows)=>['case_id,title,steps,expected_result,preconditions',...rows.map(c=>[c.id,c.title,JSON.stringify(c.steps??[{action:'assertText',text:'模块样例'}]),c.expected??'页面显示模块样例',c.preconditions??''].map(v=>'"'+v.replaceAll('"','""')+'"').join(','))].join('\n');
const cases=[{id:'one',title:'页面标题显示'},{id:'two',title:'页面提示显示'}];
const databaseContext={profileId:randomUUID(),targetUrl:'https://cdn.yibentushu.com/test-sample-apply/index.html#/home',databaseBinding:'department-supply-readonly'};
const dbEvidence=()=>({binding:'department-supply-readonly',capturedAt:new Date().toISOString(),status:'blocked',summary:{applications:55,goods:73,applicationsWithGoods:55,orphanGoods:0},checks:[{id:'connection',title:'只读连接',status:'passed',detail:'TLS 只读连接成功。'},{id:'account-list',title:'当前账号列表',status:'blocked',detail:'当前账号没有申请；不借用其他账号。'}]});
async function wait(store,key){for(let n=0;n<300;n++){const j=store.getJob(key);if(['completed','error','blocked','cancelled'].includes(j.phase)){await new Promise(r=>setTimeout(r,5));return store.getJob(key);}await new Promise(r=>setTimeout(r,5));}throw Error('job timeout');}
async function fixture(t,overrides={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'testpilot-dify-web-'));let executeCalls=0;const cloudCalls=[];
 const deps={
  cloud:async(kind,inputs)=>{cloudCalls.push({kind,inputs});if(kind==='prepare'){const source=JSON.parse(inputs.source_json);return {workflowRunId:randomUUID(),tokens:7,output:{baseline_sha256:source.baseline_sha256,cases:source.cases.map(c=>({...c,expected_result:c.source_expected_verbatim,review_status:'draft',execution_status:'not_executed',actual_result:null}))}};}const data=JSON.parse(inputs.execution_json);const output={...data};if(data.phase==='dispatch')output.action='execute-approved-suite';else output.counts=data.results.reduce((m,r)=>(m[r.status]++,m),{passed:0,failed:0,blocked:0,error:0,not_executed:0});return {workflowRunId:randomUUID(),tokens:0,output};},
  inspect:async()=>JSON.stringify({title:'模块样例',headings:['模块样例'],controls:[]}),author:async()=>[{action:'assertText',text:'模块样例'}],
  execute:async(project,id,ids)=>{executeCalls++;return {id,deterministic:{results:ids.map((key,i)=>({id:key,title:key,status:i===1?'failed':'passed',detail:i===1?'真实断言不匹配':'已找到预期文本'}))}};},
  cancel:async()=>{},continueLogin:async()=>{},recover:async()=>undefined,saveProject:async()=>{},...overrides
 };
 const store=new DifyWebModuleStore(root,deps);t.after(async()=>{store.close();assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'testpilot-dify-web-')));await rm(root,{recursive:true,force:true});});
 const imported=await store.import({fileName:'cases.csv',targetUrl:'https://example.com/index.html?lang=zh#/home',bytesBase64:Buffer.from(csv(cases)).toString('base64')});
 return {store,imported,deps,cloudCalls,root,calls:()=>executeCalls};
}

test('Dify receives case contents; actual failures survive dispatch and reporting; module history persists',async t=>{
 const {store,imported,cloudCalls,calls}=await fixture(t);const input={moduleId:imported.id,requestId:randomUUID()};const started=store.start(input);assert.equal(store.start(input).id,started.id);const done=await wait(store,started.id);
 assert.equal(done.phase,'completed');assert.equal(done.outcome,'failed');assert.equal(calls(),1);assert.equal(done.difyRuns.length,3);assert.ok(cloudCalls[0].inputs.source_json.includes('页面显示模块样例'));assert.equal(done.results[1].status,'failed');assert.ok(done.documentRunId);assert.match(done.report,/失败 1/);assert.equal(store.state().modules.length,1);
 assert.throws(()=>store.start({...input,selectedCaseIds:['one']}),/同一请求/);
 await assert.rejects(()=>store.cancel(done.id),/历史结果/);
});

test('report retry reuses real results and never repeats browser execution',async t=>{
 let fail=true;const f=await fixture(t);const original=f.deps.cloud;f.deps.cloud=async(kind,inputs,...rest)=>{if(kind==='execution'&&JSON.parse(inputs.execution_json).phase==='report'&&fail){fail=false;throw new DifyWorkflowError('Dify 汇总暂时失败。','cloud-error');}return original(kind,inputs,...rest);};
 const started=f.store.start({moduleId:f.imported.id,requestId:randomUUID()});let done=await wait(f.store,started.id);assert.equal(done.phase,'error');assert.equal(done.outcome,'failed');assert.equal(done.results[1].status,'failed');await f.store.retry(done.id);done=await wait(f.store,done.id);assert.equal(done.phase,'completed');assert.equal(f.calls(),1);assert.equal(done.outcome,'failed');
});

test('modified source expectations from Dify cannot dispatch tests',async t=>{
 const f=await fixture(t);const original=f.deps.cloud;f.deps.cloud=async(...args)=>{const r=await original(...args);if(args[0]==='prepare')r.output.cases[0].expected_result='随意放宽';return r;};const done=await wait(f.store,f.store.start({moduleId:f.imported.id,requestId:randomUUID()}).id);assert.equal(done.phase,'error');assert.equal(f.calls(),0);assert.ok(done.results.every(r=>r.status==='not_executed'));
});

test('unconfirmed fixtures are blocked, not passed; confirming one item creates an explicit child run',async t=>{
 const f=await fixture(t);const m=await f.store.import({fileName:'fixture.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'fixture',title:'页面提示显示',preconditions:'已准备编号为 FIX-1 的数据'}])).toString('base64')});const first=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID()}).id);assert.equal(first.results[0].status,'blocked');assert.equal(first.results[0].needsConfirmation,true);assert.equal(f.calls(),0);const child=await wait(f.store,f.store.start({moduleId:m.id,parentJobId:first.id,selectedCaseIds:['fixture'],confirmedCaseIds:['fixture'],requestId:randomUUID()}).id);assert.equal(child.results[0].status,'passed');assert.equal(child.parentJobId,first.id);assert.equal(f.calls(),1);
});

test('plan guards reject stale digests, changed target, reordered or duplicate cases',async t=>{
 const f=await fixture(t);const done=await wait(f.store,f.store.start({moduleId:f.imported.id,requestId:randomUUID()}).id);checkModulePlan(done);const changed=structuredClone(done);changed.executionProject.targetUrl='https://other.example/';changed.planDigest=moduleDigest(changed.executionProject);assert.throws(()=>checkModulePlan(changed),/目标/);changed.executionProject=structuredClone(done.executionProject);changed.executionProject.cases=[changed.executionProject.cases[0],changed.executionProject.cases[0]];changed.planDigest=moduleDigest(changed.executionProject);assert.throws(()=>checkModulePlan(changed),/集合/);assert.throws(()=>f.store.start({moduleId:f.imported.id,selectedCaseIds:['unknown'],requestId:randomUUID()}),/选择范围/);
});

test('SPA routes remain stable; one-use OAuth codes are removed; long original expectations are preserved',async t=>{
 assert.equal(moduleTarget('https://example.com/index.html?code=one-use&lang=zh#/home'),'https://example.com/index.html?lang=zh#/home');assert.throws(()=>moduleTarget('https://user:pass@example.com/'),/账号密码/);const f=await fixture(t);const expected='必须完整保留原始预期。'.repeat(60);const m=await f.store.import({fileName:'long.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'long',title:'显示原始内容',expected}])).toString('base64')});assert.equal(m.project.cases[0].expected,expected);
});

test('cancellation during preflight never reaches Dify dispatch or browser execution',async t=>{
 const f=await fixture(t,{inspect:async(_p,_j,signal,onLogin)=>{onLogin(true);await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));return '';}});const job=f.store.start({moduleId:f.imported.id,requestId:randomUUID()});await f.store.cancel(job.id);const done=await wait(f.store,job.id);assert.equal(done.phase,'cancelled');assert.equal(f.calls(),0);assert.equal(f.cloudCalls.length,0);
});

test('reopening the store preserves a completed task and never replays it',async t=>{
 const f=await fixture(t);const done=await wait(f.store,f.store.start({moduleId:f.imported.id,requestId:randomUUID()}).id);const reopened=new DifyWebModuleStore(f.root,f.deps);try{assert.equal(reopened.getJob(done.id).documentRunId,done.documentRunId);assert.deepEqual(reopened.getJob(done.id).results,done.results);await new Promise(r=>setTimeout(r,20));assert.equal(f.calls(),1);}finally{reopened.close();}
});

test('missing steps can be authored without changing the original case or asking for JSON',async t=>{
 const f=await fixture(t);const m=await f.store.import({fileName:'manual.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'manual',title:'页面提示文案「模块样例」',steps:[]}])).toString('base64')});const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID()}).id);assert.equal(done.results[0].status,'passed',done.results[0].detail);assert.equal(done.snapshot.cases[0].steps.length,0);assert.ok(done.results[0].steps.length);assert.equal(done.results[0].expected,m.project.cases[0].expected);
});

test('Chinese password fields are redacted before Dify and never executed as automatic login',async t=>{
 const f=await fixture(t);const secret='PRIVATE_PASSWORD_SENTINEL_123';const m=await f.store.import({fileName:'credentials.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'password',title:'密码字段测试',expected:'密码不能进入云端',steps:[{action:'fillByLabel',label:'密码',value:secret},{action:'assertValue',label:'密码',value:secret}]}])).toString('base64')});const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID()}).id);assert.equal(done.results[0].status,'blocked');assert.equal(f.calls(),0);assert.ok(!JSON.stringify(f.cloudCalls).includes(secret));
});

test('credential-bearing original expectations remain local and unchanged; reports and Markdown reject unsafe export',async t=>{
 const f=await fixture(t);const expected='password=ONLY_UNIT_TEST_CREDENTIAL';const m=await f.store.import({fileName:'private-expected.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'credential-original',title:'原始凭据说明',expected,steps:[]}])).toString('base64')});const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID()}).id);assert.throws(()=>f.store.markdown(m.id),/凭据/);assert.throws(()=>f.store.reportForExport(done.id),/凭据/);assert.equal(f.store.getModule(m.id).project.cases[0].expected,expected);assert.equal(f.store.getJob(done.id).results[0].expected,expected);
});

test('a restarted executing task becomes interrupted and cannot silently replay browser actions',async t=>{
 const f=await fixture(t);const done=await wait(f.store,f.store.start({moduleId:f.imported.id,requestId:randomUUID()}).id);const crashed={...done,phase:'executing',executionFinished:false};const db=new DatabaseSync(path.join(f.root,'dify-web-modules','records.sqlite'));db.prepare('UPDATE records SET payload=? WHERE id=?').run(JSON.stringify(crashed),done.id);db.close();const reopened=new DifyWebModuleStore(f.root,f.deps);try{assert.equal(reopened.getJob(done.id).phase,'interrupted');await assert.rejects(()=>reopened.retry(done.id),/新建一轮重测/);assert.equal(f.calls(),1);}finally{reopened.close();}
});

test('out-of-scope requirements remain unexecuted and do not count as passes or product failures',async t=>{
 const f=await fixture(t);const m=await f.store.import({fileName:'scope.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'later',title:'本期不做：后续模块',expected:'范围外，待后续需求',steps:[]}])).toString('base64')});const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID()}).id);assert.equal(done.phase,'completed');assert.equal(done.results[0].outOfScope,true);assert.equal(done.results[0].status,'not_executed');assert.equal(done.outcome,'not_executed');assert.equal(f.calls(),0);assert.match(done.report,/范围外 1/);
});

test('prerequisite-blocked cases retain job-bound context screenshots without inventing a browser run or execution',async t=>{
 const captured=[];const f=await fixture(t,{captureBlockedEvidence:async(project,jobId,item)=>{captured.push({projectId:project.id,jobId,caseId:item.id});return {evidence:'a'.repeat(64)+'.png',evidenceNote:'本轮前置阻塞现场，业务断言未执行。'};}});
 const m=await f.store.import({fileName:'write.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'write',title:'真实提交',expected:'提交成功',steps:[]}])).toString('base64')});
 const original=structuredClone(m.project.cases);const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID(),runMode:'fixed'}).id);
 assert.equal(done.phase,'completed');assert.equal(done.results[0].status,'blocked');assert.equal(done.results[0].evidenceOrigin,'preflight');assert.match(done.results[0].evidenceNote,/未执行/);assert.equal(done.documentRunId,undefined);assert.equal(f.calls(),0);assert.equal(captured[0].jobId,done.id);assert.match(done.report,/截图说明/);assert.deepEqual(f.store.getModule(m.id).project.cases,original);
});

test('authorized write screenshots retain their execution origin without a shared document run or replay',async t=>{
 let submissions=0;const f=await fixture(t,{authorizedWrites:async(_project,_job,checks)=>{submissions++;return checks.map(c=>({caseId:c.id,status:'passed',detail:'合成业务提交和独立落库核对成功',evidence:'c'.repeat(64)+'.png',evidenceNote:'本轮授权执行页面'}));}});
 const m=await f.store.import({fileName:'write-origin.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'write-origin',title:'真实提交',expected:'提交成功',steps:[]}])).toString('base64')});
 const original=structuredClone(m.project.cases);const done=await wait(f.store,f.store.start({moduleId:m.id,requestId:randomUUID(),runMode:'fixed'}).id);
 assert.equal(done.phase,'completed');assert.equal(done.results[0].status,'passed');assert.equal(done.results[0].evidenceOrigin,'authorized-write');assert.deepEqual(done.authorizedWriteCaseIds,['write-origin']);assert.equal(done.documentRunId,undefined);assert.equal(submissions,1);assert.equal(f.calls(),0);assert.deepEqual(f.store.getModule(m.id).project.cases,original);
});

test('a browser interruption preserves each completed case before a final run exists',async t=>{
 const f=await fixture(t);let executions=0;f.deps.execute=async(_project,_id,ids,_stage,onResult)=>{executions++;onResult({id:ids[0],status:'passed',detail:'中断前已经完成的真实断言'});throw Error('测试浏览器连接中断');};const done=await wait(f.store,f.store.start({moduleId:f.imported.id,requestId:randomUUID()}).id);assert.equal(done.phase,'error');assert.equal(done.results[0].status,'passed');assert.equal(done.results[1].status,'not_executed');assert.equal(done.outcome,'blocked');await assert.rejects(()=>f.store.retry(done.id),/新建一轮重测/);assert.equal(executions,1);assert.match(f.store.renderReport(done),/通过 1/);
});

test('database evidence enters Dify preparation, is bound to dispatch, and is separately summarized without inflating case passes',async t=>{
 const f=await fixture(t,{database:async()=>dbEvidence()});const done=await wait(f.store,f.store.start({moduleId:f.imported.id,selectedCaseIds:['one'],requestId:randomUUID()},databaseContext).id);
 assert.equal(done.phase,'completed');assert.equal(done.results.length,1);assert.equal(done.results[0].status,'passed');assert.equal(done.outcome,'blocked');assert.equal(done.databaseEvidence.status,'blocked');
 const prepare=JSON.parse(f.cloudCalls.find(c=>c.kind==='prepare').inputs.source_json);assert.deepEqual(prepare.database_context,done.databaseEvidence);assert.equal(prepare.database_context_sha256,done.databaseEvidenceDigest);
 const report=f.cloudCalls.map(c=>c.inputs.execution_json&&JSON.parse(c.inputs.execution_json)).find(v=>v?.case_ids[0]==='database:connection');assert.equal(report.plan_digest,done.databaseEvidenceDigest);assert.equal(report.run_id,done.id);assert.deepEqual(report.database_evidence,done.databaseEvidence);
 assert.equal(done.difyRuns.filter(r=>r.phase==='database-summary').length,1);assert.match(done.report,/不计入 XMind 用例通过数/);assert.match(done.report,/通过 1/);checkModulePlan(done);
 const changed=structuredClone(done);changed.databaseEvidence.summary.applications=999;assert.throws(()=>checkModulePlan(changed),/数据库证据/);
 assert.throws(()=>f.store.start({moduleId:f.imported.id,requestId:randomUUID()},{...databaseContext,targetUrl:'https://example.com/'}),/环境不匹配/);
 const child=await wait(f.store,f.store.start({moduleId:f.imported.id,parentJobId:done.id,selectedCaseIds:['one'],requestId:randomUUID()}).id);assert.equal(child.databaseBinding,done.databaseBinding);assert.equal(child.snapshot.id,done.snapshot.id);assert.equal(child.snapshot.targetUrl,done.snapshot.targetUrl);
});

test('missing database adapter blocks supplemental verification but still executes independent webpage checks',async t=>{
 const f=await fixture(t);const done=await wait(f.store,f.store.start({moduleId:f.imported.id,selectedCaseIds:['one'],requestId:randomUUID()},databaseContext).id);assert.equal(f.calls(),1);assert.equal(done.databaseEvidence.checks[0].status,'blocked');assert.equal(done.results[0].status,'passed');assert.equal(done.outcome,'blocked');
});

test('missing personal records do not block completed input-only scope; connection and identity gaps still block it',async t=>{
 const evidence={...dbEvidence(),checks:['connection','fixtures','relations','account-scope'].map(id=>({id,title:id,status:'passed',detail:'本轮已核验'})).concat([{id:'account-list',title:'本人记录',status:'blocked',detail:'本人0条'},{id:'account-detail',title:'本人详情',status:'blocked',detail:'没有详情样本'}])};const f=await fixture(t,{database:async()=>structuredClone(evidence)});const m=await f.store.import({fileName:'independent.csv',targetUrl:databaseContext.targetUrl,bytesBase64:Buffer.from(csv([{id:'input-only',title:'>30字：限制输入或提示超长',expected:'>30字：限制输入或提示超长',steps:[{action:'fillByLabel',label:'备注',value:'X'.repeat(31)},{action:'assertMaxLengthOrMessage',label:'备注',maxLength:30,message:'超长'}]}])).toString('base64')});let done=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()},databaseContext).id);assert.equal(done.outcome,'passed');assert.equal(done.databaseEvidence.status,'blocked');assert.match(done.report,/不要求已有本人记录/);evidence.checks.find(c=>c.id==='account-scope').status='blocked';done=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()},databaseContext).id);assert.equal(done.outcome,'blocked');evidence.checks.find(c=>c.id==='account-scope').status='passed';evidence.checks.find(c=>c.id==='connection').status='blocked';done=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()},databaseContext).id);assert.equal(done.outcome,'blocked');
});

test('Dify cannot replace database counts; a report retry reuses the immutable database and browser evidence',async t=>{
 let reads=0;const f=await fixture(t,{database:async()=>{reads++;return dbEvidence();}});const cloud=f.deps.cloud;let corrupt=true;f.deps.cloud=async(...args)=>{const result=await cloud(...args);const d=args[1].execution_json&&JSON.parse(args[1].execution_json);if(corrupt&&d?.case_ids[0]==='database:connection')result.output.counts={passed:2,failed:0,blocked:0,error:0,not_executed:0};return result;};
 let done=await wait(f.store,f.store.start({moduleId:f.imported.id,selectedCaseIds:['one'],requestId:randomUUID()},databaseContext).id);assert.equal(done.phase,'error');assert.equal(done.results[0].status,'passed');const originalDigest=done.databaseEvidenceDigest;corrupt=false;await f.store.retry(done.id);done=await wait(f.store,done.id);assert.equal(done.phase,'completed');assert.equal(reads,1);assert.equal(f.calls(),1);assert.equal(done.databaseEvidenceDigest,originalDigest);
});

test('fixed mode executes package steps without prepare or author and keeps real Dify dispatch/report',async t=>{
 const f=await fixture(t,{author:async()=>{throw Error('Fixed regression must not author steps');}});
 for(let i=0;i<2;i++){const done=await wait(f.store,f.store.start({moduleId:f.imported.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(done.phase,'completed');assert.equal(done.runMode,'fixed');assert.deepEqual(done.difyRuns.map(r=>r.phase),['dispatch','report']);assert.equal(done.results[1].status,'failed');assert.match(done.report,/未调用模型整理/);}
 assert.equal(f.cloudCalls.filter(c=>c.kind==='prepare').length,0);assert.equal(f.calls(),2);
});

test('fixed mode blocks missing scripts; assist can produce a reusable source-bound script',async t=>{
 const f=await fixture(t);const module=await f.store.import({fileName:'no-steps.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'manual-fixed',title:'页面提示文案「模块样例」',steps:[]}])).toString('base64')});
 let done=await wait(f.store,f.store.start({moduleId:module.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(done.results[0].status,'blocked');assert.equal(f.calls(),0);
 done=await wait(f.store,f.store.start({moduleId:module.id,runMode:'assist',requestId:randomUUID()}).id);assert.equal(done.results[0].status,'passed');const cached=await wait(f.store,f.store.start({moduleId:module.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(cached.results[0].status,'passed');assert.ok(!cached.difyRuns.some(r=>r.phase==='prepare'));
});

test('Dify coverage guard blocks submission/validation echo false passes without changing original expectations',async t=>{
 const f=await fixture(t);const expected='0<字数≤30：正常提交';const module=await f.store.import({fileName:'quality.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(csv([{id:'original-39',title:'正常提交',expected,steps:[{action:'fillByLabel',label:'备注',value:'测试'},{action:'assertValue',label:'备注',value:'测试'}]}])).toString('base64')});const done=await wait(f.store,f.store.start({moduleId:module.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(done.results[0].status,'blocked');assert.equal(done.results[0].expected,expected);assert.equal(f.calls(),0);assert.match(done.results[0].detail,/不能用输入回显代替/);
});

test('Dify can review a bounded empty-required check but never bulk-clears legacy hold flags or reuses a review on changed controls',async t=>{
 let evidence=JSON.stringify({controls:[{placeholder:'请输入收件人姓名'},{name:'提交申请'}]});const f=await fixture(t,{inspect:async()=>evidence});const m=await f.store.import({fileName:'held.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from('case_id,title,steps,expected_result,status\nreview-52,必填未完成时提交按钮置灰不可点击,[],必填未完成时提交按钮置灰不可点击,hold-account-or-effect-review').toString('base64')});
 const first=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(first.results[0].status,'passed');assert.match(first.results[0].preparationReview,/未点击提交/);assert.ok(first.results[0].steps.every(s=>!s.action.startsWith('click')));assert.equal(f.store.getModule(m.id).project.cases[0].steps.length,0);assert.match(f.store.getModule(m.id).project.cases[0].coverageGap,/原包状态/);
 const second=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(second.results[0].status,'passed');evidence='{"controls":[]}';const changed=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(changed.results[0].status,'blocked');assert.equal(f.calls(),2);
});

test('readiness does not mislabel a fixed login-only legacy case as blocked but retains missing steps and effect holds',async t=>{
 const f=await fixture(t);const rows=[{id:'ready',title:'页面提示',steps:[{action:'assertText',text:'模块样例'}]},{id:'missing',title:'页面提示',steps:[]},{id:'held',title:'页面提示',steps:[{action:'assertText',text:'模块样例'}]}];const lines=csv(rows).split('\n');lines[0]+=',status';for(let n=1;n<lines.length;n++)lines[n]+=n===3?',hold-account-or-effect-review':',needs-login';const m=await f.store.import({fileName:'login-flag.csv',targetUrl:'https://example.com/',bytesBase64:Buffer.from(lines.join('\n')).toString('base64')});const ready=f.store.readiness(m.id);assert.equal(ready[0].coverageGap,undefined);assert.equal(ready[1].blockerCode,'steps-missing');assert.equal(ready[2].blockerCode,'legacy-review');assert.match(f.store.getModule(m.id).project.cases[0].coverageGap,/needs-login/);
});

test('reviewed list plans replace old shell steps only in the execution/cache, preserve source, and reject stale navigation',async t=>{
 let evidence=JSON.stringify({navigation:['历史申请记录','订单物流'],controls:[]});const f=await fixture(t,{inspect:async()=>evidence});const {formatDifyMarkdown}=await import('../../../dist/adapters/regression/authoring/markdown-case-pack.js');const original={id:'list-empty',title:'无订单：展示空状态',expected:'无订单：展示空状态',source:'原始XMind › 订单列表页',priority:'P2',preconditions:[],steps:[{action:'assertVisible',text:'无订单'}]};const m=await f.store.import({fileName:'empty.md',targetUrl:databaseContext.targetUrl,bytesBase64:Buffer.from(formatDifyMarkdown('订单',[original])).toString('base64')});const before=structuredClone(m.project.cases);const done=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(done.results[0].status,'passed',done.results[0].detail);assert.ok(done.results[0].steps.some(s=>s.action==='clickExactText'));assert.equal(f.store.readiness(m.id)[0].coverageGap,undefined);assert.match(f.store.markdown(m.id),/暂无订单物流记录/);assert.deepEqual(f.store.getModule(m.id).project.cases,before);evidence='{"navigation":[],"controls":[]}';const stale=await wait(f.store,f.store.start({moduleId:m.id,runMode:'fixed',requestId:randomUUID()}).id);assert.equal(stale.results[0].status,'blocked');assert.equal(f.calls(),1);
});
