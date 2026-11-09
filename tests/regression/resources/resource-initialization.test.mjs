import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),build=process.env.TESTPILOT_CHECK_BUILD??path.join(root,'dist');
const load=file=>import(pathToFileURL(path.join(build,file)).href);
const [{DifyWebModuleStore},{SystemModuleRegression},{readResourceDirectory},{initializeBundledResources}]=await Promise.all([load('adapters/regression/execution/module-execution-service.js'),load('adapters/regression/catalog/module-regression-service.js'),load('adapters/regression/resources/resource-directory.js'),load('bootstrap/resource-initialization.js')]);
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'testpilot-init-'));const no=async()=>{throw Error('Unexpected business, model or browser operation');};const deps={cloud:no,inspect:no,author:no,execute:no,cancel:no,continueLogin:no,recover:async()=>undefined,saveProject:async()=>{}};const store=new DifyWebModuleStore(dir,deps),catalog=new SystemModuleRegression(dir,store,deps);t.after(async()=>{catalog.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'testpilot-init-')));await fs.rm(dir,{recursive:true,force:true});});return{dir,store,catalog,deps};}
test('new installation contains all definitions, daily selection and no execution history or account',async t=>{
 const f=await fixture(t),result=await initializeBundledResources(f.catalog,path.join(root,'project-resources/department-sample'));assert.equal(result.status,'initialized');
 const state=f.catalog.state(),editor=f.catalog.editorCatalog(result.systemId);assert.equal(state.systems.length,1);assert.equal(state.modules.length,5);assert.equal(state.batches.length,0);assert.equal(f.store.state().jobs.length,0);assert.equal(Object.keys(state.accounts).length,0);assert.equal(editor.cases.length,131);assert.equal(editor.chains.length,4);assert.ok(editor.cases.every(c=>c.status==='not_executed'&&!c.resultAt));assert.equal(editor.cases.filter(c=>c.script.steps.length).length,74);assert.ok(state.modules.every(m=>m.versions.length===1));assert.equal(state.modules.reduce((n,m)=>n+(m.starterCaseIds?.length??0),0),39);assert.equal(state.systems[0].notifyFailures,false);assert.equal(state.systems[0].accountProfiles,undefined);
});
test('repeat initialization preserves local edits and reuses stable project and module IDs',async t=>{
 const f=await fixture(t),directory=path.join(root,'project-resources/department-sample');const first=await initializeBundledResources(f.catalog,directory);const before=f.catalog.exportResources(first.systemId),next=structuredClone(before.resources);next.cases[0].title='本机维护内容';await f.catalog.applyResources({resources:next,baseRevision:before.revision});const edited=f.catalog.exportResources(first.systemId);const second=await initializeBundledResources(f.catalog,directory);assert.equal(second.status,'existing');assert.deepEqual(f.catalog.exportResources(first.systemId),edited);assert.equal(f.catalog.state().systems.length,1);
});
test('missing or corrupt resources report a specific initialization error and do not create an empty project',async t=>{
 const f=await fixture(t);const missing=await initializeBundledResources(f.catalog,path.join(f.dir,'not-present'));assert.equal(missing.status,'missing');assert.equal(f.catalog.state().systems.length,0);
 const corrupt=path.join(f.dir,'corrupt');await fs.mkdir(corrupt);await fs.writeFile(path.join(corrupt,'project.json'),'{invalid');const result=await initializeBundledResources(f.catalog,corrupt);assert.equal(result.status,'error');assert.equal(f.catalog.state().systems.length,0);
});
test('a persistence failure never publishes a half-initialized catalog',async t=>{
 const f=await fixture(t),{resources}=readResourceDirectory(path.join(root,'project-resources/department-sample'));let saves=0;f.deps.saveProject=async()=>{if(++saves===2)throw Error('simulated storage failure');};await assert.rejects(()=>f.catalog.initializeResources(resources,{targetUrl:'https://example.test/',environment:'隔离'}),/storage failure/);assert.equal(f.catalog.state().systems.length,0);assert.equal(f.catalog.state().modules.length,0);
});
