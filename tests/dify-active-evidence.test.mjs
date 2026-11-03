import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {captureMissingDifyFailureEvidence as capture,captureDifyBlockedEvidence} from '../dist/adapters/dify-web-browser.js';

test('active result page captures its current PNG but rejects login text, login routes and another origin',async t=>{
 const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'dify-active-evidence-'));
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end('<main>本轮业务证据</main>');});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('dify-active-evidence-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
 const page=await browser.newPage(),targetUrl=`http://127.0.0.1:${server.address().port}/`,project={id:'active-fixture',targetUrl};await page.goto(targetUrl);
 const result={id:'same-case',status:'passed',detail:'本轮业务检查通过'};await capture(root,project,'round1',result,true,page);assert.equal(result.status,'passed',result.detail);assert.ok(result.evidence);assert.equal((await readFile(path.join(root,'document-tests','runs','round1','screenshots',result.evidence))).subarray(1,4).toString(),'PNG');
 await page.goto(targetUrl+'#/login');const route={id:'login',status:'passed',detail:''};await capture(root,project,'round2',route,true,page);assert.equal(route.status,'blocked');assert.equal(route.evidence,undefined);
 await page.goto(targetUrl);await page.setContent('<main>请先登录</main>');const text={id:'auth-text',status:'passed',detail:''};await capture(root,project,'round3',text,true,page);assert.equal(text.status,'blocked');
 const other={id:'wrong-origin',status:'passed',detail:''};await capture(root,{...project,targetUrl:'https://example.com/'},'round4',other,true,page);assert.equal(other.status,'blocked');assert.match(other.detail,/检查目标地址/);
 const skip=await captureDifyBlockedEvidence(root,{...project,targetUrl:'https://cdn.yibentushu.com/test-sample-apply/index.html#/home'},'irrelevant',{source:'管理端后台',expected:'其他角色不可见'},new AbortController().signal);assert.equal(skip,undefined);
});
