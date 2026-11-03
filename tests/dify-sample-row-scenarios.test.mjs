import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {isSampleRowDelete,verifySampleRowDelete} from '../dist/adapters/dify-sample-row-scenarios.js';
import {needsDifyReadback,reviewDepartmentReadOnly} from '../dist/adapters/dify-readonly-scenarios.js';
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const check={id:'xmind-35',expected:'每行提供删除按钮，可删除误加的样书行（H5设计稿已确认新增）',source:'原始XMind › 向下复制空白图书明细行',steps:[],preconditions:[]};
test('row deletion review preserves source, exact expectation, target and prerequisites',()=>{
 assert.equal(isSampleRowDelete(check),true);assert.equal(isSampleRowDelete({...check,expected:'删除订单'}),false);assert.equal(needsDifyReadback(check),true);
 const proof=JSON.stringify({bookCodeAliasConfirmed:true,bookCodeLabel:'自编码'}),plan=reviewDepartmentReadOnly(check,proof,target);assert.equal(plan.kind,'sample-row-delete');assert.ok(plan.steps.every(s=>s.action.startsWith('assert')));
 assert.equal(reviewDepartmentReadOnly({...check,source:'其他页面'},proof,target),undefined);assert.equal(reviewDepartmentReadOnly(check,proof,'https://example.com'),undefined);assert.equal(reviewDepartmentReadOnly({...check,preconditions:['指定记录FIX1']},proof,target),undefined);
});
test('row deletion requires a real row reduction and unchanged original contents',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let mode='normal';
 const html=()=>`<div class="pc-page-home"><div id="rows"></div><button type="button" id="add">继续添加样书</button></div><script>(()=>{const parent=document.querySelector('#rows');function row(){const d=document.createElement('div');d.className='word-pc-sample-item';d.innerHTML='<table><thead><tr><th>自编码</th><th>数量（册）</th><th>图书名称</th><th>出版社</th><th>定价(元)</th><th>预估总重（公斤）</th><th>小计(元)</th><th>操作</th></tr></thead><tbody><tr><td><input></td><td><input></td><td>书目</td><td>出版社</td><td>1</td><td>1</td><td>1</td><td><a href="javascript:;">删除</a></td></tr></tbody></table>';d.querySelector('a').onclick=()=>{${mode==='no-effect'?'return;':mode==='wrong-row'?'parent.firstElementChild.remove();':mode==='two-rows'?'parent.innerHTML="";':'d.remove();'}};${mode==='missing-delete'?'d.querySelector("a").remove();':''}parent.appendChild(d)}row();document.querySelector('#add').onclick=row;})();</script>`;
 await page.route('https://cdn.yibentushu.com/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:html()}));
 for(const m of ['normal','no-effect','wrong-row','two-rows','missing-delete']){mode=m;await page.goto('about:blank');await page.goto(target);const result={status:'passed',detail:'headers'};await verifySampleRowDelete(page,check,result);assert.equal(result.status,m==='normal'?'passed':'failed',m+': '+result.detail);if(m==='normal')assert.match(result.detail,/1→2→1/);}
 const wrong={status:'passed',detail:''};await page.goto('about:blank');await verifySampleRowDelete(page,check,wrong);assert.equal(wrong.status,'blocked');
});
