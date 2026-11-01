import test from 'node:test';
import assert from 'node:assert/strict';
import {difyCoverageGap} from '../dist/adapters/dify-case-quality.js';
import {missingDirectAssertion} from '../dist/adapters/document-case-quality.js';
import {parseDifyMarkdown,formatDifyMarkdown} from '../dist/adapters/dify-markdown-pack.js';
import {difyPortableRunner} from '../dist/adapters/dify-script-package.js';
import {assertDifyExportSafe} from '../dist/adapters/dify-export-policy.js';
import {difyBlocker,reviewedDifyReadOnlyPlan} from '../dist/adapters/dify-case-readiness.js';

test('Dify blocker categories explain the actual missing proof rather than blaming every case on login',()=>{
 const item=expected=>({expected,title:expected,steps:[],preconditions:[]});const reason='原包状态：hold-account-or-effect-review；需先确认账号、环境或副作用条件。';
 assert.equal(difyBlocker(item('全部必填完成：创建待审核记录'),reason).blockerCode,'write-required');assert.equal(difyBlocker(item('本人申请：申请人取当前企微登录人姓名与部门'),reason).blockerCode,'identity-evidence');assert.equal(difyBlocker(item('命中关键词：下拉展示匹配客户名称供选择'),reason).blockerCode,'fixture-required');assert.equal(difyBlocker(item('逐级选择成功回填所在地区'),reason).blockerCode,'assertion-incomplete');
 assert.match(difyBlocker({...item('状态按钮置灰'),source:'员工端-用书审批详情页'},reason).detail,/本人可见/);assert.match(difyBlocker({...item('展示新增字段'),source:'管理端后台（经销商系统服务端）'},reason).detail,/后台入口/);assert.match(difyBlocker({...item('仓库 ID 配置正确'),source:'系统配置依赖'},reason).detail,/权威基线/);assert.match(difyBlocker({...item('物流信息刷新'),source:'数据接口层'},reason).detail,/服务端/);
 const c=item('必填未完成时提交按钮置灰不可点击');const evidence=JSON.stringify({controls:[{placeholder:'请输入收件人姓名'},{name:'提交申请'}]});assert.ok(reviewedDifyReadOnlyPlan(c,evidence));assert.equal(reviewedDifyReadOnlyPlan({...c,expected:'正常提交'},evidence),undefined);assert.equal(reviewedDifyReadOnlyPlan({...c,preconditions:['需角色账号审批员']},evidence),undefined);assert.equal(reviewedDifyReadOnlyPlan(c,JSON.stringify({controls:[{placeholder:'请输入收件人姓名'},{placeholder:'请输入收件人姓名'},{name:'提交申请'}]})),undefined);
});

test('Dify exports reject credentials without rewriting original expectations or exporting password steps',()=>{
 const original={id:'account-test',title:'账号校验',source:'原始包',priority:'P0',preconditions:[],expected:'password=UNIT_ONLY_CREDENTIAL',steps:[]};const snapshot=structuredClone(original);
 assert.throws(()=>formatDifyMarkdown('测试',[original]),/凭据/);assert.deepEqual(original,snapshot);
 const passwordStep={...original,expected:'显示登录成功',steps:[{action:'fillByLabel',label:'密码',value:'UNIT_ONLY_PASSWORD'}]};assert.throws(()=>formatDifyMarkdown('测试',[passwordStep]),/凭据/);
 assert.throws(()=>formatDifyMarkdown('测试',[{...original,expected:'预期正常显示'}],{'account-test':['输入口令：UNIT_ONLY_PASSWORD']}),/凭据/);
 assert.doesNotThrow(()=>assertDifyExportSafe({expected:'密码字段不应被自动填写',steps:[]}));
 const before=process.env.TESTPILOT_DIFY_API_KEY;try{process.env.TESTPILOT_DIFY_API_KEY='app-UNIT_SECRET_SENTINEL';assert.throws(()=>assertDifyExportSafe({expected:'app-UNIT_SECRET_SENTINEL'}),/凭据/);}finally{if(before===undefined)delete process.env.TESTPILOT_DIFY_API_KEY;else process.env.TESTPILOT_DIFY_API_KEY=before;}
});

test('Dify portable export recognizes implemented non-text assertions without weakening the no-assertion guard',()=>{
 const gate="c.steps.some(s=>['assertText','assertVisible','assertExactVisible','assertRoleVisible','assertValue','assertValueByPlaceholder','assertDisabled'].includes(s.action))";const evaluate=Function('c','return '+difyPortableRunner(gate));assert.equal(evaluate({steps:[{action:'assertRoleDisabled'}]}),true);assert.equal(evaluate({steps:[{action:'assertFieldInvalid'}]}),true);assert.equal(evaluate({steps:[{action:'fillByLabel'}]}),false);assert.equal(evaluate({steps:[]}),false);assert.throws(()=>difyPortableRunner('different runner'),/协议/);
 const modern=Function('c','return '+difyPortableRunner(difyPortableRunner(gate)));assert.equal(modern({steps:[{action:'assertRoleDisabled'}]}),true);assert.equal(modern({steps:[]}),false);
});

test('Dify-only gate rejects echo/disabled false positives and leaves unrelated entry policy unchanged',()=>{
 const original={title:'备注',expected:'正常提交',steps:[{action:'fillByLabel',label:'备注',value:'输入'},{action:'assertValue',label:'备注',value:'输入'}]};
 assert.match(difyCoverageGap(original),/提交/);assert.equal(missingDirectAssertion(original),undefined);
 assert.match(difyCoverageGap({...original,expected:'11位数字：通过'}),/校验通过/);
 assert.match(difyCoverageGap({...original,expected:'数量为空/0/负数：拦截',steps:[{action:'fillByLabel',label:'数量',value:'0'},{action:'assertRoleDisabled',role:'button',name:'提交'}]}),/其他必填项/);
 assert.equal(difyCoverageGap({...original,expected:'备注字段回显输入'}),undefined);
 assert.match(difyCoverageGap({...original,expected:'发货方式固定为快递，无其他可选',steps:[{action:'assertText',text:'快递'}]}),/选项集合/);
 assert.match(difyCoverageGap({...original,expected:'外部客户正常展示可选',steps:[{action:'assertText',text:'外部客户'}]}),/实际选择/);
 assert.equal(difyCoverageGap({title:'提交',expected:'必填未完成时提交按钮置灰不可点击',steps:[{action:'assertRoleDisabled',role:'button',name:'提交'}]}),undefined);
});

test('Markdown preserves ids, priorities, multiline original expectations, source and generated fixed steps across export/import',()=>{
 const source={id:'stable-1',title:'固定提示',priority:'P0',source:'原始用例 › 提示',preconditions:['已完成登录'],expected:'第一行\n\n## 这是预期内容而非用例标题\n第二行',steps:[{action:'assertText',text:'固定提示'}]};
 const text=formatDifyMarkdown('模块',[source],{'stable-1':['打开入口','查看提示']});const parsed=parseDifyMarkdown(text);const c=parsed.document.testCases[0];assert.equal(c.id,source.id);assert.equal(c.title,source.title);assert.equal(c.expected,source.expected);assert.equal(c.source,source.source);assert.equal(c.priority,'P0');assert.deepEqual(c.steps,source.steps);assert.deepEqual(parsed.manualSteps['stable-1'],['打开入口','查看提示']);
 assert.throws(()=>parseDifyMarkdown(text.replace('优先级：P0','优先级：P9')),/优先级/);
 assert.throws(()=>parseDifyMarkdown('## no-expected | 标题\n### 操作步骤\n1. 打开页面'),/缺少/);
 assert.throws(()=>parseDifyMarkdown(text.replace('```text','```text\n```')),/未闭合|未知栏目/);
});
