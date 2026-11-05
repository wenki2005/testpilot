import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureDifyPng} from '../../../dist/adapters/regression/evidence/module-evidence.js';

test('stalled compositor capture falls back to the same live mobile viewport with a fresh PNG',async()=>{
 const browser=await chromium.launch({headless:true}).catch(()=>chromium.launch({channel:'msedge',headless:true}));
 const page=await browser.newPage({viewport:{width:390,height:844}}),calls=[];
 const client=await page.context().newCDPSession(page);
 try{
  await page.setContent('<main style="background:#6cf;height:800px">Current evidence, not a saved image</main>');
  const wrapper={send(method,args){calls.push(args.fromSurface);return args.fromSurface?new Promise(()=>{}):client.send(method,args);}};
  const started=Date.now(),png=await captureDifyPng(page,wrapper);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.deepEqual(calls,[true,false]);
  assert.equal(png.readUInt32BE(16),390);assert.equal(png.readUInt32BE(20),844);
  assert.ok(Date.now()-started<8000,'The bounded fallback must not stall a test.');
 }finally{await client.detach();await browser.close();}
});
