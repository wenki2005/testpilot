import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fieldValidityKind,reviewFieldValidity,verifyFieldTransitions,verifyFieldValidityResult,verifyQuantityInvalidTransitions} from '../../../../dist/adapters/regression/scenarios/application/field-validation.js';
import {difyCoverageGap} from '../../../../dist/adapters/regression/authoring/case-quality.js';
import {missingDirectAssertion} from '../../../../dist/adapters/documents/cases/case-quality.js';
import {needsDifyReadback,isDifyRecordIndependent} from '../../../../dist/adapters/regression/scenarios/scenario-planner.js';
const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/home';
const placeholders=['请输入收件人姓名','请输入手机号码','请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等'];
const cases=[['recipient-valid','文本≤20字：通过','填写收件人'],['phone-valid','11位数字：通过','填写手机号码'],['address-valid','手动输入≤20字：通过','填写详细地址']].map(([kind,expected,source],i)=>({id:'field-'+i,kind,expected,source:'原始XMind › '+source,steps:[],preconditions:[],testData:[]}));
const evidence=JSON.stringify({controls:placeholders.map(placeholder=>({placeholder}))});
test('validity review is exact-source and target bound, and an echo-only plan remains blocked without runtime review',()=>{
 for(const [i,c] of cases.entries()){
  const original=structuredClone(c);assert.equal(fieldValidityKind(c),c.kind);
  assert.equal(needsDifyReadback(c),true,'portable exports must not claim validity from input echo steps');
  assert.equal(isDifyRecordIndependent(c),true,'client validity does not require existing application records');
  const plan=reviewFieldValidity(c,evidence,target);assert.equal(plan.kind,c.kind);assert.equal(plan.steps[0].placeholder,placeholders[i]);
  assert.match(difyCoverageGap({...c,steps:plan.steps}),/回显/);assert.equal(difyCoverageGap({...c,steps:plan.steps},plan.kind),undefined);
  assert.equal(missingDirectAssertion({...c,steps:plan.steps}),undefined);assert.deepEqual(c,original);
  assert.equal(reviewFieldValidity({...c,source:'其他业务'},evidence,target),undefined);
  assert.equal(reviewFieldValidity(c,evidence,'https://example.com/'),undefined);
  assert.equal(reviewFieldValidity({...c,preconditions:['需要编号FIX-1的业务记录']},evidence,target),undefined);
  assert.equal(reviewFieldValidity(c,JSON.stringify({controls:[...JSON.parse(evidence).controls,{placeholder:placeholders[i]}]}),target),undefined);
 }
});
test('a passed input echo without this case preparation never becomes a validity pass',async()=>{
 const result={status:'passed',detail:'输入回显一致'};await verifyFieldValidityResult({},cases[0],result);assert.equal(result.status,'blocked');assert.match(result.detail,/输入回显不算/);
});
const fixture=(placeholder,mode='normal')=>`<div class="pc-page-home"><input placeholder="other" value="ready"><input placeholder="${placeholder}" value="${placeholder.includes('手机')?'13800138000':'Valid'}"><div class="home-footer"><div class="button" onclick="window.submitClicks++">提交申请</div></div></div><script>(()=>{window.submitClicks=0;const target=document.querySelectorAll('input')[1],other=document.querySelector('input'),button=document.querySelector('.button');target.addEventListener('input',()=>{${mode==='other-change'?'if(!target.value)other.value="changed";':''}const valid=${placeholder.includes('手机')?'/^\\d{11}$/.test(target.value)':'target.value.length>0&&target.value.length<=20'};button.classList.toggle('button-disabled',${mode==='ignore-invalid'?'false':'!valid'});});})();</script>`;
test('real browser proves enabled/disabled/enabled transitions, preserves other fields, and never clicks submit',async t=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());const page=await browser.newPage();
 for(const [i,p] of placeholders.entries()){
  await page.setContent(fixture(p));const valid=i===1?['13800138000']:['A','ABCDEFGHIJKLMNOPQRST'];await verifyFieldTransitions(page,p,valid,i===1?'123':'');
  assert.equal(await page.getByPlaceholder(p,{exact:true}).inputValue(),valid.at(-1));assert.equal(await page.evaluate(()=>window.submitClicks),0);
 }
 await page.setContent(fixture(placeholders[0],'ignore-invalid'));await assert.rejects(verifyFieldTransitions(page,placeholders[0],['Valid'],''),/无效字段/);
 await page.setContent(fixture(placeholders[0],'other-change'));await assert.rejects(verifyFieldTransitions(page,placeholders[0],['Valid'],''),/其他表单字段/);
 await page.setContent(fixture(placeholders[0])+`<input placeholder="${placeholders[0]}">`);await assert.rejects(verifyFieldTransitions(page,placeholders[0],['Valid'],''),/唯一/);
});

test('quantity validation covers all five invalid classes against an otherwise-valid form',async t=>{
 const c={id:'qty',expected:'数量为空/0/负数/小数/字母：拦截，提交按钮不可点亮',source:'原始XMind › 输入图书数量',steps:[],preconditions:[]};
 const proof=JSON.stringify({...JSON.parse(evidence),bookCodeAliasConfirmed:true,bookCodeLabel:'自编码'}),plan=reviewFieldValidity(c,proof,target);
 assert.equal(plan.kind,'quantity-invalid');assert.equal(needsDifyReadback(c),true);assert.equal(missingDirectAssertion({...c,steps:plan.steps}),undefined);assert.equal(difyCoverageGap({...c,steps:plan.steps},plan.kind),undefined);
 assert.equal(reviewFieldValidity({...c,source:'其他业务'},proof,target),undefined);
 const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());const page=await browser.newPage();
 const html=sanitize=>`<div class="pc-page-home"><input placeholder="other" value="ready"><table><thead><tr><th>数量（册）</th></tr></thead><tbody><tr><td><input placeholder="请输入" value="1"></td></tr></tbody></table><div class="home-footer"><div class="button">提交申请</div></div></div><script>(()=>{const q=document.querySelector('td input');q.addEventListener('input',()=>{${sanitize?'q.value=q.value.replace(/[^0-9]/g,"");':''}document.querySelector('.button').classList.toggle('button-disabled',!/^\\d+$/.test(q.value)||Number(q.value)<=0);});})();</script>`;
 await page.setContent(html(false));assert.match(await verifyQuantityInvalidTransitions(page),/abc/);
 await page.setContent(html(true));await assert.rejects(verifyQuantityInvalidTransitions(page),/提交仍可用/);
});
