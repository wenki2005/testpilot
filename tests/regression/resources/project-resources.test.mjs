import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const build=process.env.TESTPILOT_CHECK_BUILD??path.join(root,'dist');
const load=file=>import(pathToFileURL(path.join(build,file)).href);
const [{DifyWebModuleStore},{SystemModuleRegression},{validateProjectResources},{readResourceDirectory}]=await Promise.all([load('adapters/regression/execution/module-execution-service.js'),load('adapters/regression/catalog/module-regression-service.js'),load('adapters/regression/resources/project-resource-contract.js'),load('adapters/regression/resources/resource-directory.js')]);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'testpilot-resource-'));
 const no=async()=>{throw Error('Resource maintenance must not contact a business system or model.');};
 const deps={cloud:no,inspect:no,author:no,execute:no,cancel:no,continueLogin:no,recover:async()=>undefined,saveProject:async()=>{}};
 const store=new DifyWebModuleStore(dir,deps),catalog=new SystemModuleRegression(dir,store,deps);
 t.after(async()=>{catalog.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'testpilot-resource-')));await fs.rm(dir,{recursive:true,force:true});});
 const system=catalog.saveSystem({name:'资源验证',environment:'本地样例',targetUrl:'https://example.test/'});
 const csv='case_id,title,steps,expected_result\none,页面提示,[],原始预期\ntwo,第二项,[],第二项预期';
 const module=await catalog.importModule({systemId:system.id,name:'样例模块',fileName:'cases.csv',bytesBase64:Buffer.from(csv).toString('base64')});
 return {dir,store,catalog,system,module};
}
test('resource changes create a new executable module version and keep original history',async t=>{
 const f=await fixture(t),before=f.catalog.exportResources(f.system.id),incoming=structuredClone(before.resources);
 incoming.cases[0].expected='修改后预期';incoming.cases[0].script.steps=[{action:'assertText',text:'修改后预期'}];
 const preview=f.catalog.previewResources(incoming);assert.equal(preview.changed.length,1);assert.equal(preview.unchanged.length,1);
 const applied=await f.catalog.applyResources({resources:incoming,baseRevision:preview.revision});assert.equal(applied.applied,true);
 const current=f.catalog.cases(f.module.id);assert.equal(current.module.versions.length,2);assert.equal(current.cases[0].expected,'修改后预期');assert.equal(current.cases[0].steps[0].text,'修改后预期');
 assert.equal(f.catalog.cases(f.module.id,f.module.versions[0].id).cases[0].expected,'原始预期');
 const after=f.catalog.exportResources(f.system.id);assert.deepEqual(after.resources,incoming);
 const noChange=await f.catalog.applyResources({resources:incoming,baseRevision:after.revision});assert.equal(noChange.applied,false);assert.equal(f.catalog.getModule(f.module.id).versions.length,2);
});
test('stale preview cannot overwrite a newer edit',async t=>{
 const f=await fixture(t),first=f.catalog.exportResources(f.system.id),a=structuredClone(first.resources),b=structuredClone(first.resources);
 a.cases[0].title='第一位编辑';b.cases[0].title='较旧编辑';await f.catalog.applyResources({resources:a,baseRevision:first.revision});
 await assert.rejects(()=>f.catalog.applyResources({resources:b,baseRevision:first.revision}),/版本冲突/);assert.equal(f.catalog.exportResources(f.system.id).resources.cases[0].title,'第一位编辑');
});
test('cycles, foreign dependencies, unknown step actions and runtime fields fail before updating',async t=>{
 const f=await fixture(t),base=f.catalog.exportResources(f.system.id),bad=structuredClone(base.resources);
 const dep=i=>({moduleId:f.module.id,caseId:bad.cases[i].id});
 bad.cases[0].prerequisites=[dep(1)];bad.cases[0].script.dependsOn=[{...dep(1),requiredStatus:'passed'}];bad.cases[1].prerequisites=[dep(0)];bad.cases[1].script.dependsOn=[{...dep(0),requiredStatus:'passed'}];
 assert.throws(()=>f.catalog.previewResources(bad),/循环/);
 const steps=structuredClone(base.resources);steps.cases[0].script.steps=[{action:'runShell',command:'echo invalid'}];assert.throws(()=>f.catalog.previewResources(steps));
 const runtime=structuredClone(base.resources);runtime.cases[0].status='passed';assert.throws(()=>validateProjectResources(runtime));
 assert.equal(f.catalog.exportResources(f.system.id).revision,base.revision);
});
test('addition and removal retain old version snapshots, dependencies must remain valid',async t=>{
 const f=await fixture(t),base=f.catalog.exportResources(f.system.id),next=structuredClone(base.resources);
 next.cases=next.cases.filter(c=>c.id!=='two');next.cases.push({...structuredClone(next.cases[0]),id:'three',script:{caseId:'three',dependsOn:[],steps:[]}});
 const p=f.catalog.previewResources(next);assert.equal(p.added.length,1);assert.equal(p.removed.length,1);
 await f.catalog.applyResources({resources:next,baseRevision:p.revision});assert.deepEqual(f.catalog.cases(f.module.id).cases.map(c=>c.id),['one','three']);assert.deepEqual(f.catalog.cases(f.module.id,f.module.versions[0].id).cases.map(c=>c.id),['one','two']);
});
test('shipped individual files reconstruct all 131 definitions and existing scripts without results',()=>{
 const loaded=readResourceDirectory(path.join(root,'project-resources/department-sample'));assert.equal(loaded.resources.cases.length,131);assert.equal(loaded.resources.modules.length,5);assert.equal(loaded.resources.chains.length,4);assert.equal(loaded.modifiedFiles.length,0);assert.equal(loaded.resources.cases.filter(c=>c.script.steps.length).length,74);
 assert.ok(loaded.resources.cases.every(c=>!('status'in c)&&!('resultAt'in c)));
});
