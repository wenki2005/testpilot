import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('system profiles isolate actual cookies even when a global external-browser endpoint is configured',async()=>{
  const root=await mkdtemp(path.join(process.env.TESTPILOT_TEST_RUN_DIR??os.tmpdir(),'system-browser-'));
  process.env.TESTPILOT_DATA_DIR=root;process.env.TESTPILOT_BROWSER_HEADLESS='1';process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN='0';process.env.TESTPILOT_BROWSER_CDP_ENDPOINT='http://127.0.0.1:1';
  const {launchPersistentTestPage,getExistingPersistentTestPage,closePersistentTestPages}=await import('../../../dist/adapters/browser/browser-runtime.js');
  try{const a=await launchPersistentTestPage(path.join(root,'browser-profiles','isolated-system-a'),{isolated:true});await a.context.addCookies([{name:'system-private',value:'A_ONLY_TEST_COOKIE',domain:'example.com',path:'/'}]);const b=await launchPersistentTestPage(path.join(root,'browser-profiles','isolated-system-b'),{isolated:true});assert.equal((await b.context.cookies('https://example.com/')).some(c=>c.name==='system-private'),false);const again=await launchPersistentTestPage(path.join(root,'browser-profiles','isolated-system-a'),{isolated:true});assert.equal(again.page,a.page);assert.equal((await again.context.cookies('https://example.com/')).find(c=>c.name==='system-private')?.value,'A_ONLY_TEST_COOKIE');assert.equal((await getExistingPersistentTestPage(path.join(root,'browser-profiles','isolated-system-a'),{isolated:true})).page,a.page);
  }finally{await closePersistentTestPages();const expected=path.resolve(process.env.TESTPILOT_TEST_RUN_DIR??os.tmpdir());assert.equal(path.dirname(path.resolve(root)),expected);assert.ok(path.basename(root).startsWith('system-browser-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
