import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DifyBatchNotifier,difyNotificationWebhook} from '../../../dist/adapters/regression/notifications/batch-notifier.js';

const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ONLY_UNIT_TEST_KEY';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
const batch=()=>({id:randomUUID(),systemName:'测试系统',phase:'completed',notifyFailures:true,notifyScreenshots:true,counts:{passed:0,failed:1,blocked:0,error:0,not_executed:0,outside:0},jobs:[{id:randomUUID(),moduleName:'测试模块',documentRunId:randomUUID(),phase:'completed',outcome:'failed',results:[{caseId:'original-1',status:'failed',detail:'PRIVATE_ACTUAL_DATA',evidence:'case.png'}]}]});
async function temporary(t){const root=await mkdtemp(path.join(os.tmpdir(),'tp-dify-notify-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('tp-dify-notify-'));await rm(root,{recursive:true,force:true});});return root;}

test('Dify notification is disabled by default and refuses non-WeCom URLs without a network call',async t=>{
 const root=await temporary(t);let calls=0;const n=new DifyBatchNotifier(root,()=>webhook,async()=>{calls++;return 'sent';},0);const b=batch();delete b.notifyFailures;const r=await n.deliver(b,undefined,()=>{});assert.equal(r.status,'disabled');assert.equal(calls,0);
 for(const value of ['http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=valid_key_123','https://qyapi.weixin.qq.com.evil.test/cgi-bin/webhook/send?key=valid_key_123','https://127.0.0.1/cgi-bin/webhook/send?key=valid_key_123',webhook+'&next=https://example.com',webhook+'&key=duplicate',webhook+'#fragment'])assert.equal(difyNotificationWebhook(value),undefined);
 assert.equal(difyNotificationWebhook(webhook),webhook);const off=new DifyBatchNotifier(root,()=>undefined,async()=>{throw Error('must not send');},0);assert.equal((await off.deliver(batch(),undefined,()=>{})).status,'disabled');
});

test('partial delivery retries only explicitly failed messages; no replay of sent summary or browser execution',async t=>{
 const root=await temporary(t);const b=batch();const dir=path.join(root,'document-tests','runs',b.jobs[0].documentRunId,'screenshots');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'case.png'),png);const calls=[];let imageAttempts=0;const n=new DifyBatchNotifier(root,()=>webhook,async(_url,payload)=>{calls.push(payload);return payload.msgtype==='image'&&++imageAttempts===1?'failed':'sent';},0);
 const saved=[];const first=await n.deliver(b,undefined,r=>saved.push(r));assert.equal(first.status,'partial');assert.deepEqual(first.items.map(i=>i.status),['sent','failed']);assert.ok(saved.some(r=>r.items.some(i=>i.status==='sending')));assert.equal(calls[1].image.md5,createHash('md5').update(png).digest('hex'));assert.ok(!JSON.stringify(calls).includes('PRIVATE_ACTUAL_DATA'));
 const second=await n.deliver(b,first,()=>{});assert.equal(second.status,'sent');assert.deepEqual(second.items.map(i=>i.attempts),[1,2]);assert.equal(calls.length,3);await n.deliver(b,second,()=>{});assert.equal(calls.length,3);assert.equal(b.jobs[0].results[0].status,'failed');
});

test('unknown receipt and process interruption never trigger silent duplicate notifications',async t=>{
 const root=await temporary(t);const b=batch();b.notifyScreenshots=false;let calls=0;const n=new DifyBatchNotifier(root,()=>webhook,async()=>{calls++;return 'uncertain';},0);const first=await n.deliver(b,undefined,()=>{});assert.equal(first.status,'uncertain');await n.deliver(b,first,()=>{});assert.equal(calls,1);
 const crashed={status:'sending',updatedAt:new Date().toISOString(),items:[{id:'summary',type:'summary',status:'sending',attempts:1}]};const recovered=await n.deliver(b,crashed,()=>{});assert.equal(recovered.status,'uncertain');assert.equal(calls,1);
});

test('missing, oversized or unbound screenshots are reported rather than replaced by unrelated evidence',async t=>{
 const root=await temporary(t);const b=batch();b.jobs[0].results[0].evidence='../private.png';let calls=0;const n=new DifyBatchNotifier(root,()=>webhook,async()=>{calls++;return 'sent';},0);const result=await n.deliver(b,undefined,()=>{});assert.equal(result.status,'partial');assert.equal(result.items[1].status,'skipped');assert.equal(calls,1);
 const large=batch();const dir=path.join(root,'document-tests','runs',large.jobs[0].documentRunId,'screenshots');await mkdir(dir,{recursive:true});const oversized=Buffer.alloc(2*1024*1024+1);png.copy(oversized);await writeFile(path.join(dir,'case.png'),oversized);const tooLarge=await n.deliver(large,undefined,()=>{});assert.equal(tooLarge.items[1].status,'skipped');assert.equal(calls,2);
 const pass=batch();pass.jobs[0].outcome='passed';pass.jobs[0].results[0].status='passed';pass.counts={...pass.counts,passed:1,failed:0};assert.equal((await n.deliver(pass,undefined,()=>{})).status,'not-needed');assert.equal(calls,2);
});

test('HTTP transport requires explicit WeCom acknowledgement and treats ambiguous failures as uncertain',async t=>{
 const root=await temporary(t);const b=batch();b.notifyScreenshots=false;const requests=[];let response=new Response(JSON.stringify({errcode:0}),{status:200});t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return response;});
 const n=new DifyBatchNotifier(root,()=>webhook,undefined,0);assert.equal((await n.deliver(b,undefined,()=>{})).status,'sent');assert.equal(requests[0].options.redirect,'error');assert.equal(JSON.parse(requests[0].options.body).msgtype,'markdown');
 response=new Response(JSON.stringify({errcode:93000,errmsg:'must not persist recipient response'}),{status:200});const rejected=await n.deliver(batch(),undefined,()=>{});assert.equal(rejected.status,'failed');assert.ok(!JSON.stringify(rejected).includes('recipient response'));
 response=new Response('service unavailable',{status:503});assert.equal((await n.deliver(batch(),undefined,()=>{})).status,'uncertain');
});
