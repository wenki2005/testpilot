import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {verifyDepartmentReadOnlyResult} from '../dist/adapters/dify-readonly-scenarios.js';

test('filtered empty state requires a fresh successful zero response, selected filter and visible empty state',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();let body={code:200,total:0,rows:[]},queries=0;
 const html=show=>`<div class="pc-page-apply"><div class="apply-header"><div class="header-nav"><ul><li>全部</li><li onclick="this.classList.add('active');fetch('https://testapi.yibentushu.com/supply-api/dept/book/apply/myList?bookUsage=2').then(r=>r.json()).then(b=>{${show?'document.querySelector(\'#empty\').hidden=b.total!==0;':''}})">产品用书</li></ul></div></div><div id="empty" hidden>暂无申请记录</div></div>`;
 await page.route('https://cdn.yibentushu.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html(true)}));
 await page.route('https://testapi.yibentushu.com/**',r=>{queries++;return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});});
 await page.goto('https://cdn.yibentushu.com/test-sample-apply/index.html#/apply');
 const c={expected:'无符合条件记录：空状态',source:'原始XMind › 历史申请记录页 › 按样书用途/审批状态筛选',steps:[]};
 const reads=[{path:'/dept/book/apply/myList',unfiltered:true,ok:true,total:1,rows:1}];
 const result={status:'passed',detail:'进入列表',evidence:'before-filter.png'};
 await verifyDepartmentReadOnlyResult(page,c,result,reads);assert.equal(result.status,'passed',result.detail);assert.match(result.detail,/产品用书/);assert.equal(result.evidence,undefined);assert.equal(queries,1);
 body={code:500,total:0,rows:[]};await page.setContent(html(true));const error={status:'passed',detail:''};await verifyDepartmentReadOnlyResult(page,c,error,reads);assert.equal(error.status,'blocked');
 body={code:200,total:1,rows:[{}]};await page.setContent(html(true));const nonempty={status:'passed',detail:''};await verifyDepartmentReadOnlyResult(page,c,nonempty,reads);assert.equal(nonempty.status,'blocked');
 body={code:200,total:0,rows:[]};await page.setContent(html(false));const hidden={status:'passed',detail:''};await verifyDepartmentReadOnlyResult(page,c,hidden,reads);assert.equal(hidden.status,'failed');
 const stale={status:'passed',detail:''};await verifyDepartmentReadOnlyResult(page,c,stale,[]);assert.equal(stale.status,'blocked');
});

test('product records no longer block empty-state coverage when an actual approval-state filter is empty',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();let requests=[];
 await page.route('https://cdn.yibentushu.com/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:`<div class="pc-page-apply"><div class="apply-header"><div class="header-nav"><ul><li onclick="this.classList.add('active');window.search('bookUsage=2')">产品用书</li></ul></div></div><div class="apply-seek-form"><div class="seek-states"><ul><li onclick="this.classList.add('active');window.search('bookUsage=2&examineStatus=1')">已通过</li></ul></div></div><div id="empty" hidden>暂无申请记录</div></div><script>window.search=q=>fetch('https://testapi.yibentushu.com/supply-api/dept/book/apply/myList?'+q).then(r=>r.json()).then(b=>document.querySelector('#empty').hidden=b.total!==0)</script>`}));
 await page.route('https://testapi.yibentushu.com/**',r=>{const u=new URL(r.request().url());requests.push(u.search);const empty=u.searchParams.get('examineStatus')==='1';return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:200,total:empty?0:1,rows:empty?[]:[{bookUsage:2}]})});});
 await page.goto('https://cdn.yibentushu.com/test-sample-apply/index.html#/apply');const result={status:'passed',detail:''};await verifyDepartmentReadOnlyResult(page,{expected:'无符合条件记录：空状态',source:'历史申请记录页 › 按样书用途/审批状态筛选',steps:[]},result,[{path:'/dept/book/apply/myList',unfiltered:true,ok:true,total:2,rows:2}]);assert.equal(result.status,'passed',result.detail);assert.equal(requests.length,2);assert.match(result.detail,/产品用书 \/ 已通过/);
});
