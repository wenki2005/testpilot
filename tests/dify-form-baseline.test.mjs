import test from'node:test';import assert from'node:assert/strict';import{chromium}from'playwright';import{waitForDepartmentFormBaseline}from'../dist/adapters/dify-form-baseline.js';
test('known async form baseline waits for mounted controls; timeout is blocked and unrelated targets are untouched',async t=>{
 const b=await chromium.launch({channel:'msedge',headless:true});t.after(()=>b.close());const p=await b.newPage();const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
 await p.route('**/*',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:'<script>setTimeout(()=>document.body.innerHTML=\'<main class="pc-page-home"><input placeholder="请输入收件人姓名"><input placeholder="请输入手机号码"></main>\',150)</script>'}));await p.goto(target,{waitUntil:'domcontentloaded'});await waitForDepartmentFormBaseline(p,target,3000);
 await p.setContent('<main class="pc-page-home"></main>');await assert.rejects(waitForDepartmentFormBaseline(p,target,150),/^Error: Blocked:/);await waitForDepartmentFormBaseline(p,'https://example.com/',1);
});
