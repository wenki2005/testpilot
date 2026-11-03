import test from 'node:test';
import assert from 'node:assert/strict';
import{departmentOaTemplateBaseline as baseline,verifyDepartmentOaTemplateConfiguration as verify}from'../dist/adapters/dify-oa-template-configuration.js';
import{connectedEvidenceKind}from'../dist/adapters/dify-connected-contract.js';
import{reviewConnectedEvidence}from'../dist/adapters/dify-connected-scenarios.js';
import{verifyConnectedEvidence}from'../dist/adapters/dify-connected-scenarios.js';
import{chromium}from'playwright';
import{isSafeReadOnlyBrowserCase}from'../dist/adapters/document-test-workflow.js';
const fixture=()=>({templates:baseline.map(b=>({name:b.name,templateId:b.templateId,deleted:false})),applications:baseline.map(b=>({usage:b.usage,templateId:b.templateId,count:2}))});
test('both named OA definitions and actual usage references match the fixed environment baseline',()=>{
 const s=fixture(),before=structuredClone(s),r=verify(s);assert.equal(r.status,'passed');assert.match(r.detail,/xmind-128/);assert.match(r.detail,/未将此结果扩展为xmind-119/);assert.deepEqual(s,before);
});
test('template existence does not hide wrong ID, name, duplicate, deletion or swapped usage',()=>{
 const mutations=[s=>{s.templates[0].templateId='0'},s=>{s.templates[0].name='其他流程'},s=>{s.templates.push({...s.templates[0]})},s=>{s.templates[0].deleted=true},s=>{s.applications[0].templateId=baseline[1].templateId},s=>{s.applications[0].templateId=null}];
 for(const change of mutations){const s=fixture();change(s);assert.equal(verify(s).status,'failed');}
});
test('missing usage samples and unknown usage stay blocked; inactive duplicate is ignored',()=>{
 const s=fixture();s.applications.pop();assert.equal(verify(s).status,'blocked');s.applications=[];assert.equal(verify(s).status,'blocked');
 const unsupported=fixture();unsupported.applications.push({usage:3,templateId:'unknown',count:1});assert.equal(verify(unsupported).status,'blocked');
 const archived=fixture();archived.templates.push({...archived.templates[0],deleted:true});assert.equal(verify(archived).status,'passed');
});
test('only the exact configuration requirement is enabled; OA creation and arbitrary sites remain gated',()=>{
 const c={id:'xmind-128',title:'配置',expected:'企微OA审批模板ID配置正确',source:'系统配置依赖 › 关键配置项就绪校验',steps:[],preconditions:[],preconditionsConfirmed:true};
 const evidence=JSON.stringify({controls:[{placeholder:'请输入收件人姓名'}]});
 assert.equal(connectedEvidenceKind(c),'oa-template-config');assert.equal(connectedEvidenceKind({...c,source:'其他配置'}),undefined);
 assert.equal(connectedEvidenceKind({...c,expected:'通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页'}),undefined);
 const plan=reviewConnectedEvidence(c,evidence,'https://cdn.yibentushu.com/test-sample-apply/index.html#/home');assert.ok(plan);assert.equal(isSafeReadOnlyBrowserCase({...c,steps:plan.steps}),true);assert.equal(reviewConnectedEvidence(c,evidence,'https://example.com/'),undefined);
});
test('runtime hook replaces a passed page title with real DB verdict and blocks failed queries',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
 await page.route('**/*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:'<meta charset="utf-8"><main class="pc-page-home">收货信息</main>'}));await page.goto(target);
 const c={expected:'企微OA审批模板ID配置正确',source:'系统配置依赖 › 关键配置项就绪校验'};
 for(const mode of['valid','wrong','offline']){
  let queried=0;const db={oaTemplates:async()=>{queried++;if(mode==='offline')throw Error('query failed');const s=fixture();if(mode==='wrong')s.applications[0].templateId=baseline[1].templateId;return s;}};
  const r={status:'passed',detail:'page title only'};await verifyConnectedEvidence(page,c,r,target,async bytes=>{assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');return'current.png';},db);
  assert.equal(queried,1);assert.equal(r.status,mode==='valid'?'passed':mode==='wrong'?'failed':'blocked',r.detail);assert.ok(r.evidence);assert.equal(page.url(),target);
 }
});
