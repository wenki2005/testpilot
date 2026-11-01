import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

// Audit an already completed 13-case run. This verifier never starts Dify or a
// browser run; it checks the saved batch, original module snapshots and proofs.
const base=process.env.TESTPILOT_VERIFY_URL??'http://127.0.0.1:4319';
const root=base+'/api/system-module-regression';
const directory='artifacts/dify-13-minimal';
const saved=JSON.parse(await readFile(directory+'/batch.json','utf8'));
const before=JSON.parse(await readFile('artifacts/dify-other-minimal/before.json','utf8'));
const before13=JSON.parse(await readFile(directory+'/before.json','utf8'));
const api=async route=>{const response=await fetch(root+route);assert.equal(response.status,200,route);return response.json();};
const batch=await api('/batches/'+saved.batchId);
assert.equal(batch.phase,'completed','The 13-case real batch is not complete.');
assert.equal(batch.jobs.length,5);
assert.deepEqual(batch.counts,{passed:11,failed:1,blocked:1,error:0,not_executed:0,outside:0});
assert.equal(before.reduce((sum,item)=>sum+item.cases.length,0),131);
assert.equal(before13.reduce((sum,item)=>sum+item.caseCount,0),131);
assert.equal(batch.entries.reduce((sum,item)=>sum+item.selectedCaseIds.length,0),13);

let screenshotCount=0;
const difyRuns=[];
const modules=[];
const outcomes=[];
for(const baseline of before){
  const recorded=before13.find(item=>item.moduleId===baseline.module.id);
  assert.ok(recorded,'Missing 13-case pre-run module snapshot.');
  const current=await api('/modules/'+baseline.module.id);
  assert.deepEqual(current.cases,baseline.cases,`Original cases changed: ${baseline.module.name}`);
  assert.deepEqual(current.module.coreCaseIds,baseline.module.coreCaseIds,`Original core changed: ${baseline.module.name}`);
  assert.equal(current.version.id,recorded.versionId,`Module version changed: ${baseline.module.name}`);
  assert.deepEqual(current.cases.map(item=>item.id),recorded.caseIds,`Case IDs changed: ${baseline.module.name}`);
  assert.deepEqual(current.module.starterCaseIds,recorded.starterCaseIds,`Fixed starter scope changed: ${baseline.module.name}`);

  const entry=batch.entries.find(item=>item.moduleId===baseline.module.id);
  const job=batch.jobs.find(item=>item.id===entry?.jobId);
  assert.ok(entry&&job);
  assert.deepEqual(entry.selectedCaseIds,recorded.starterCaseIds);
  assert.deepEqual(job.selectedCaseIds,recorded.starterCaseIds);
  assert.equal(job.results.length,entry.selectedCaseIds.length);
  assert.equal(job.phase,'completed');
  assert.ok(job.executionFinished&&job.documentRunId);
  assert.deepEqual(job.difyRuns.map(item=>item.phase),['dispatch','database-summary','report']);
  assert.ok(job.difyRuns.every(item=>item.id&&item.status==='succeeded'));
  difyRuns.push(...job.difyRuns.map(item=>({jobId:job.id,phase:item.phase,id:item.id,status:item.status})));

  const dbChecks=job.databaseEvidence?.checks??[];
  for(const id of ['connection','fixtures','relations','account-scope'])assert.equal(dbChecks.find(item=>item.id===id)?.status,'passed',`${id} database evidence: ${baseline.module.name}`);
  assert.equal(dbChecks.find(item=>item.id==='account-list')?.status,'blocked');
  assert.equal(dbChecks.find(item=>item.id==='account-detail')?.status,'blocked');

  for(const result of job.results){
    const original=baseline.cases.find(item=>item.id===result.caseId);
    assert.ok(original,`Unknown original case ${result.caseId}`);
    assert.equal(result.expected,original.expected,`Original expected text changed: ${result.caseId}`);
    assert.equal(result.title,original.title,`Original title changed: ${result.caseId}`);
    assert.ok(['passed','failed','blocked'].includes(result.status));
    assert.ok(result.evidence,`Missing same-run screenshot: ${result.caseId}`);
    const evidence=await fetch(base+`/api/dify-web-modules/jobs/${job.id}/evidence/${result.evidence}`);
    assert.equal(evidence.status,200,`Screenshot unavailable: ${result.caseId}`);
    const bytes=Buffer.from(await evidence.arrayBuffer());
    assert.equal(bytes.subarray(0,4).toString('hex'),'89504e47',`Invalid PNG evidence: ${result.caseId}`);
    const imageDirectory=directory+'/screenshots';
    await mkdir(imageDirectory,{recursive:true});
    await writeFile(`${imageDirectory}/${baseline.module.id}-${result.caseId}.png`,bytes);
    screenshotCount++;
    outcomes.push({module:baseline.module.name,id:result.caseId,status:result.status,expected:result.expected,detail:result.detail,evidence:result.evidence});
  }
  modules.push({id:baseline.module.id,name:baseline.module.name,originalCaseCount:baseline.cases.length,selectedCaseIds:job.selectedCaseIds,jobId:job.id,documentRunId:job.documentRunId,counts:{passed:job.results.filter(item=>item.status==='passed').length,failed:job.results.filter(item=>item.status==='failed').length,blocked:job.results.filter(item=>item.status==='blocked').length},databaseEvidence:{status:job.databaseEvidence.status,checks:dbChecks.map(item=>({id:item.id,status:item.status}))}});
}

assert.equal(screenshotCount,13);
assert.equal(difyRuns.length,15);
const reportResponse=await fetch(root+'/batches/'+batch.id+'/report');
assert.equal(reportResponse.status,200);
const report=await reportResponse.text();
for(const result of outcomes)assert.ok(report.includes(result.expected),`Report omitted original expectation ${result.id}`);
await writeFile(directory+'/report.md',report);

const stabilization=[];
for(const file of ['xmind-94-current.json','xmind-94-stability.json']){
  const entry=JSON.parse(await readFile('artifacts/dify-other-minimal/'+file,'utf8'));
  const previous=await api('/batches/'+entry.batchId);
  const result=previous.jobs.flatMap(job=>job.results).find(item=>item.caseId==='xmind-94');
  assert.equal(result?.status,'passed',`xmind-94 stability round ${file}`);
  stabilization.push({batchId:entry.batchId,status:result.status});
}
const proof={verifiedAt:new Date().toISOString(),batchId:batch.id,scope:batch.scope,runMode:batch.runMode,counts:batch.counts,originalCaseCount:131,selectedCaseCount:13,original131CasesPreserved:true,originalCorePreserved:true,fixedModuleSelectionsPreserved:true,sameRunScreenshots:screenshotCount,successfulDifyRuns:difyRuns.length,difyRuns,modules,stabilization,outcomes};
await writeFile(directory+'/proof.json',JSON.stringify(proof,null,2));
const lines=[
  '# TestPilot Dify 五模块最小回归验收',
  '',
  `验收时间：${proof.verifiedAt}`,
  `批次：${batch.id}`,
  `范围：五个固定模块，共 ${proof.selectedCaseCount} 条；原始 ${proof.originalCaseCount} 条用例与核心范围逐项保留。`,
  `结果：${batch.counts.passed} 通过，${batch.counts.failed} 失败，${batch.counts.blocked} 阻塞，${batch.counts.error} 异常，${batch.counts.not_executed} 未执行。`,
  `同轮 Dify：${proof.successfulDifyRuns} 次真实调用均成功（每模块派发、数据库汇总、报告）；网页执行 ${modules.length} 份，截图 ${screenshotCount} 张。`,
  '数据库：同轮 TLS 只读连接、全库样例、关联完整性和当前账号范围检查通过；当前账号本人申请列表与详情仍阻塞，因为账号无可见申请记录，未使用其他账号数据代替。',
  '',
  '## 模块结果',
  '',
  ...modules.map(module=>`- ${module.name}：${module.counts.passed} 通过，${module.counts.failed} 失败，${module.counts.blocked} 阻塞。`),
  '',
  '## 需要保留的问题',
  '',
  '- xmind-29：真实失败。输入 9999 后页面只保留 999，金额和重量也随实际数量偏离；原预期未修改。',
  '- xmind-92：阻塞。当前账号认证资料缺手机号和认证头像；未将默认头像或空手机号算通过。',
  '- 当前账号数据库列表/详情证据：阻塞。测试库只读连接与汇总正常，但该账号没有可见申请记录。',
  '- xmind-94：已通过两次定向复跑和本次五模块批次，共三轮；PC/H5 实际布局和同账号只读链路均完成。',
  '',
  '## 验收边界',
  '',
  '本轮涵盖固定最小集合和当前空记录状态；不代表历史详情、非空分页、审批、物流明细、申请提交或通知渠道已验收。没有写目标数据库，也没有提交、审批或取消业务。',
  '',
];
await writeFile(directory+'/acceptance.md',lines.join('\n'));
console.log(JSON.stringify({batchId:proof.batchId,counts:proof.counts,originalCasesPreserved:true,realDifyRuns:proof.successfulDifyRuns,sameRunScreenshots:proof.sameRunScreenshots,stabilizedXmind94:stabilization.length,dbAccountDataBlocked:true}));
