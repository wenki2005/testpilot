import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { executeCommand } from '../dist/adapters/command-adapter.js';

test('cancelling Node test workers terminates the owned process tree within the budget', {timeout:10000}, async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'testpilot-cancel-tree-'));
  t.after(()=>rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  await writeFile(path.join(folder,'hang.test.mjs'),"import test from 'node:test';test('waiting worker',async()=>{await new Promise(()=>{});});setInterval(()=>{},1000);");
  const started=Date.now();
  const result=await executeCommand({id:'cancel-tree',title:'Cancel actual Node workers',command:{bin:process.execPath,args:['--test','hang.test.mjs'],cleanEnvironment:true,timeoutMs:8000}},folder,AbortSignal.timeout(700));
  assert.equal(result.status,'blocked');assert.ok(Date.now()-started<5000);
  assert.ok(result.evidence.some(e=>e.kind==='note'&&/cancellation/.test(e.content)));
});
