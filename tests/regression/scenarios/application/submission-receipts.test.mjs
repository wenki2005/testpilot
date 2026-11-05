import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import os from'node:os';import path from'node:path';
import {readDepartmentCreationReceipts,readDepartmentCreationBaselines}from'../../../../dist/adapters/regression/scenarios/application/submission-receipts.js';
import{createHash}from'node:crypto';
test('creation proof requires the same profile, job-bound journal and completed submission',async t=>{
 const parent=os.tmpdir(),root=await mkdtemp(path.join(parent,'dify-receipts-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(parent));assert.ok(path.basename(root).startsWith('dify-receipts-'));await rm(root,{recursive:true,force:true});});
 const folder=path.join(root,'dify-web-modules','authorized-writes');await mkdir(folder,{recursive:true});const jobId='f0000000-0000-4000-8000-000000000001',profile='f0000000-0000-4000-8000-000000000002';
 const log={schema:1,jobId,profileId:profile,attempts:[{phase:'passed',applyNo:'202611030183'},{phase:'sending',applyNo:'202611030184'},{phase:'unknown',applyNo:'202611030185'}]};await writeFile(path.join(folder,jobId+'.json'),JSON.stringify(log));assert.deepEqual([...await readDepartmentCreationReceipts(root,profile)],['202611030183']);assert.equal((await readDepartmentCreationReceipts(root,'other')).size,0);await writeFile(path.join(folder,jobId+'.json'),JSON.stringify({...log,jobId:'mismatch'}));assert.equal((await readDepartmentCreationReceipts(root,profile)).size,0);
});

test('independent API task receipts require intact source, successful response and complete readback',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dify-api-receipts-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=path.join(root,'dify-web-modules','business-creation-receipts');await mkdir(folder,{recursive:true});
 const taskId='f0000000-0000-4000-8000-000000000003',profile='PROFILE',applyNo='202611040031';
 const source={schema:1,taskId,samples:[{applyNo,phase:'verified',recipient:'TPsynthetic勿发货',reservedAt:'2026-11-04T01:00:00Z',verifiedAt:'2026-11-04T01:01:00Z',response:{http:200,code:200,applyNo},databaseChecks:{oneMaster:true,templatePresent:true}}]};
 const text=JSON.stringify(source);await writeFile(path.join(folder,taskId+'.source.json'),text);
 const readback=Object.fromEntries(['singleApplication','sameOwner','markedRecipient','goodsMatch','amountMatch','weightMatch','templateMatch'].map(k=>[k,true]));
 const manifest={schema:2,origin:'authorized-business-api',profileId:profile,taskId,targetUrl:'https://cdn.yibentushu.com/test-sample-apply/index.html#/home',source:{file:taskId+'.source.json',sha256:createHash('sha256').update(text).digest('hex')},applications:[{applyNo,verified:true,readback}]};
 const file=path.join(folder,taskId+'.json');await writeFile(file,JSON.stringify(manifest));assert.deepEqual([...await readDepartmentCreationReceipts(root,profile)],[applyNo]);assert.equal((await readDepartmentCreationReceipts(root,'OTHER')).size,0);
 await writeFile(file,JSON.stringify({...manifest,applications:[{applyNo,verified:true,readback:{...readback,goodsMatch:false}}]}));assert.equal((await readDepartmentCreationReceipts(root,profile)).size,0);
 const current=JSON.stringify({...source,samples:[{...source.samples[0],approvalStatus:0,lockStatus:0,orderNo:null,quantity:3,usage:2,databaseChecks:{oneMaster:true,approvalReferences:true}}]});await writeFile(path.join(folder,taskId+'.source.json'),current);const currentManifest={...manifest,source:{...manifest.source,sha256:createHash('sha256').update(current).digest('hex')}};await writeFile(file,JSON.stringify(currentManifest));assert.deepEqual([...await readDepartmentCreationReceipts(root,profile)],[applyNo]);assert.deepEqual(await readDepartmentCreationBaselines(root,profile),[{applyNo,verifiedAt:'2026-11-04T01:01:00Z',approvalStatus:0,lockStatus:0,orderPresent:false,quantity:3,usage:2}]);assert.deepEqual(await readDepartmentCreationBaselines(root,'OTHER'),[]);
 await writeFile(file,JSON.stringify(manifest));await writeFile(path.join(folder,taskId+'.source.json'),text+' ');await assert.rejects(()=>readDepartmentCreationReceipts(root,profile),/摘要不一致/);
});
