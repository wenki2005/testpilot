import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {exportDifyConfiguration,importDifyConfiguration} from '../../../scripts/data/transfer-workspace-config.mjs';

test('machine transfer preserves source cases, versions, cached plans and minimal scope; imports no sessions, history or notifications',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dify-machine-transfer-')),source=path.join(root,'source'),dest=path.join(root,'dest');
 const systemId=randomUUID(),moduleId=randomUUID(),versionId=randomUUID(),profileId=randomUUID();
 const version={id:versionId,name:'模块',fileName:'cases.csv',digest:'fixture',project:{id:randomUUID(),targetUrl:'https://example.com/#/home',cases:[{id:'source-1',title:'原始标题',expected:'原始完整预期',steps:[]}]},cachedSteps:{'source-1':{sourceDigest:'unchanged',steps:[{action:'assertText',text:'原始完整预期'}]}}};
 const system={id:systemId,name:'测试系统',profileId,selectedModuleIds:[moduleId],notifyFailures:true,notifyScreenshots:true,accountProfiles:[{id:randomUUID(),name:'测试角色'}]};
 const module={id:moduleId,systemId,name:'模块',versions:[{id:versionId,version:1,caseCount:1}],coreCaseIds:['source-1'],starterCaseIds:['source-1'],starterVersionId:versionId};
 try{
  for(const [file,rows]of [['system-module-regression/catalog.sqlite',[['system',system],['module',module],['batch',{id:randomUUID(),systemId,phase:'completed',privateHistory:'never export'}]]],['dify-web-modules/records.sqlite',[['module',version],['job',{id:randomUUID(),privateHistory:'never export'}]]]]){
   await mkdir(path.dirname(path.join(source,file)),{recursive:true});const db=new DatabaseSync(path.join(source,file));db.exec('CREATE TABLE records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL)');for(const [kind,v]of rows)db.prepare('INSERT INTO records VALUES(?,?,?)').run(kind,v.id,JSON.stringify(v));db.close();
  }
  const fixture={schema:1,source:'test',capturedAt:new Date().toISOString(),customers:[]};await writeFile(path.join(source,'dify-web-modules','readonly-fixtures.json'),JSON.stringify(fixture));
  const bundle=await exportDifyConfiguration(source,systemId);assert.ok(!JSON.stringify(bundle).includes('never export'));assert.deepEqual(bundle.payload.versions[0],version);assert.deepEqual(bundle.payload.fixtures['readonly-fixtures.json'],fixture);
  const result=await importDifyConfiguration(dest,bundle);assert.equal(result.modules,1);assert.equal(result.minimalCases,1);assert.equal(result.loginRequired,true);assert.equal(result.historyImported,false);
  const db=new DatabaseSync(path.join(dest,'system-module-regression/catalog.sqlite'),{readOnly:true});const values=db.prepare('SELECT kind,payload FROM records').all();db.close();assert.deepEqual(values.map(v=>v.kind).sort(),['module','system']);const imported=JSON.parse(values.find(v=>v.kind==='system').payload);assert.notEqual(imported.profileId,profileId);assert.equal(imported.notifyFailures,false);assert.equal(imported.notifyScreenshots,false);assert.notEqual(imported.accountProfiles[0].id,system.accountProfiles[0].id);
  assert.deepEqual(JSON.parse(await readFile(path.join(dest,'dify-web-modules/readonly-fixtures.json'),'utf8')),fixture);
  const originalBytes=await readFile(path.join(dest,'system-module-regression/catalog.sqlite'));
  await assert.rejects(importDifyConfiguration(dest,bundle),/Destination already/);assert.deepEqual(await readFile(path.join(dest,'system-module-regression/catalog.sqlite')),originalBytes);
  const changed=structuredClone(bundle);changed.payload.versions[0].project.cases[0].expected='changed';await assert.rejects(importDifyConfiguration(path.join(root,'tampered'),changed),/Invalid or changed/);
  const unsafe=structuredClone(bundle);unsafe.payload.versions[0].project.cases[0].expected='password=PRIVATE_UNIT_TEST_SECRET';unsafe.digest=createHash('sha256').update(JSON.stringify(unsafe.payload)).digest('hex');await assert.rejects(importDifyConfiguration(path.join(root,'unsafe'),unsafe),/凭据/);
 }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('dify-machine-transfer-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
