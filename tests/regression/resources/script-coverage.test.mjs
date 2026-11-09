import test from 'node:test';
import assert from 'node:assert/strict';
import {scriptCoverage,scriptSupport} from '../../../dist/adapters/regression/resources/script-coverage.js';
import {readResourceDirectory} from '../../../dist/adapters/regression/resources/resource-directory.js';
import {fileURLToPath} from 'node:url';
import {scriptGapRequirement} from '../../../dist/adapters/regression/resources/script-gap-requirements.js';
const resources=readResourceDirectory(fileURLToPath(new URL('../../../project-resources/department-sample/',import.meta.url))).resources;
test('all original cases and 57 empty files have explicit implementation classification without verdicts',()=>{
 const before=JSON.stringify(resources),report=scriptCoverage(resources.cases);assert.equal(report.total,131);assert.equal(report.missingStepFiles,57);assert.equal(Object.values(report.counts).reduce((a,b)=>a+b,0),131);assert.ok(report.rows.every(r=>r.nextAction&&!('status'in r)));assert.equal(JSON.stringify(resources),before);
 const one=id=>report.rows.find(c=>c.id===id);assert.equal(one('xmind-50').kind,'authorized-write');assert.equal(one('xmind-85').kind,'specialized');assert.equal(one('xmind-77').kind,'missing');assert.equal(one('xmind-95').kind,'outside');
});
test('specialized bindings require unchanged source and expectation; an identifier alone grants no coverage',()=>{
 const c=resources.cases.find(c=>c.id==='xmind-85');assert.equal(scriptSupport(c).kind,'specialized');assert.equal(scriptSupport({...c,expected:'changed',sourcePath:[]}).kind,'missing');assert.equal(scriptSupport({...c,script:{...c.script,steps:[{action:'assertText',text:'sample'}]}}).kind,'steps');
});

test('all 17 gaps name their actual evidence requirements without granting execution coverage',()=>{
 const missing=resources.cases.filter(c=>scriptSupport(c).kind==='missing');
 assert.equal(missing.length,17);
 for(const c of missing){
  const requirement=scriptGapRequirement(c);assert.ok(requirement,c.id);
  assert.equal(scriptSupport(c).nextAction,requirement.nextAction);
  assert.equal(scriptSupport(c).handler,'');
  assert.equal(scriptGapRequirement({...c,expected:'changed requirement'}),undefined);
  assert.equal(scriptGapRequirement({...c,sourcePath:[]}),undefined);
 }
 const detail=id=>scriptSupport(resources.cases.find(c=>c.id===id)).nextAction;
 assert.match(detail('xmind-9'),/直属上级.*独立基线/);
 assert.match(detail('xmind-24'),/单次接口和数据库相同/);
 assert.match(detail('xmind-102'),/完整头部筛选区域/);
 assert.match(detail('xmind-113'),/隔离迁移\/回滚环境/);
 assert.match(detail('xmind-125'),/库存为零不等于查询失败/);
 assert.match(detail('xmind-77'),/不能把整个detail接口失败/);
});
