import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {zipSync,strToU8} from 'fflate';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),build=process.env.TESTPILOT_CHECK_BUILD??path.join(repo,'dist');
const load=f=>import(pathToFileURL(path.join(build,f)).href),{prepareCaseVersion}=await load('adapters/regression/resources/case-version-import.js');
const systemId='51000000-0000-4000-8000-000000000001',moduleId='51000000-0000-4000-8000-000000000002';
const row=(id,title)=>({id,moduleId,title,expected:title,manualSteps:[],prerequisites:[],sourcePath:['旧文件','模块'],sourceExpected:title,script:{caseId:id,dependsOn:[],steps:[{action:'assertText',text:title}]}});
const baseline=()=>({schema:1,project:{id:systemId,name:'样例'},modules:[{id:moduleId,name:'模块'}],cases:[row('xmind-1','一号行为'),row('xmind-2','二号行为')],chains:[]});
const xmind=nodes=>{
 const moduleTopic={id:'mod',title:'模块',children:{attached:nodes.map(([id,title])=>({id,title}))}};
 const document=[{rootTopic:{id:'root',title:'新文件',children:{attached:[moduleTopic]}}}];
 return {systemId,fileName:'新版.xmind',bytesBase64:Buffer.from(zipSync({'content.json':strToU8(JSON.stringify(document))})).toString('base64')};
};
test('legacy matching binds topic IDs then insertion and reordering preserve stable case IDs and scripts',async()=>{
 const initial=await prepareCaseVersion(baseline(),xmind([['t2','二号行为'],['t1','一号行为']]));assert.equal(initial.changed.length,0);assert.equal(initial.mappingUpdates.length,2);assert.deepEqual(initial.resources.cases.map(c=>c.id),['xmind-2','xmind-1']);assert.equal(initial.issues.length,0);
 const next=await prepareCaseVersion(initial.resources,xmind([['t1','一号行为已更新'],['new','新增行为'],['t2','二号行为']]));assert.equal(next.changed.length,1);assert.equal(next.added.length,1);assert.equal(next.removed.length,0);
 const updated=next.resources.cases.find(c=>c.id==='xmind-1');assert.equal(updated.scriptReview.status,'pending');assert.deepEqual(updated.script.steps,baseline().cases[0].script.steps);assert.equal(next.resources.cases.find(c=>c.sourceId==='xmind:new').script.steps.length,0);
});
test('ambiguous matching needs explicit mapping and missing prerequisites or core references block application',async()=>{
 const b=baseline();b.cases[1].sourceExpected='一号行为';b.cases[1].title='一号行为';const ambiguous=await prepareCaseVersion(b,xmind([['a','一号行为']]));assert.equal(ambiguous.unresolved.length,1);
 const data={...xmind([['a','一号行为']]),mapping:{'xmind:a':{moduleId,caseId:'xmind-1'}}};const mapped=await prepareCaseVersion(b,data);assert.equal(mapped.unresolved.length,0);assert.equal(mapped.removed.length,1);
 const refs=baseline();refs.cases[0].prerequisites=[{moduleId,caseId:'xmind-2'}];refs.cases[0].script.dependsOn=[{moduleId,caseId:'xmind-2',requiredStatus:'passed'}];refs.chains=[{id:'core',title:'核心',description:'',steps:[{id:'s',title:'步骤',expected:'',caseIds:['xmind-2']}]}];
 const missing=await prepareCaseVersion(refs,xmind([['a','一号行为']]));assert.ok(missing.issues.some(s=>s.includes('前置')));assert.ok(missing.issues.some(s=>s.includes('核心链路')));
});
test('whole update keeps old snapshots and pending script cannot execute',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'testpilot-whole-')),no=async()=>{throw Error('Business forbidden');},deps={cloud:no,inspect:no,author:no,execute:no,cancel:no,continueLogin:no,recover:async()=>undefined,saveProject:async()=>{}};
 const {DifyWebModuleStore}=await load('adapters/regression/execution/module-execution-service.js'),{SystemModuleRegression}=await load('adapters/regression/catalog/module-regression-service.js');const store=new DifyWebModuleStore(dir,deps),catalog=new SystemModuleRegression(dir,store,deps);t.after(async()=>{catalog.close();store.close();await fs.rm(dir,{recursive:true,force:true});});
 await catalog.initializeResources(baseline(),{targetUrl:'https://example.test',environment:'fixture'});const before=catalog.exportResources(systemId);const data={systemId,fileName:'cases.csv',bytesBase64:Buffer.from('case_id,title,steps,expected_result\nxmind-1,一号行为已更新,[],新预期\nxmind-2,二号行为,[],二号行为').toString('base64')};const preview=await prepareCaseVersion(before.resources,data);assert.equal(preview.scriptsToReview.length,1);await catalog.applyResources({resources:preview.resources,baseRevision:before.revision});
 const latest=catalog.editorCatalog(systemId).cases.find(c=>c.id==='xmind-1');assert.equal(latest.scriptReview.status,'pending');assert.throws(()=>store.start({moduleId:latest.versionId,requestId:randomUUID(),selectedCaseIds:['xmind-1']}),/脚本待核对/);assert.equal(catalog.editorHistory(moduleId,'xmind-1').length,2);assert.equal(catalog.editorHistory(moduleId,'xmind-1')[1].data.expected,'一号行为');
});
