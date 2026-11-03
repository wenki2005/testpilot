import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { parseComputerUseToolArguments } from '../src/adapters/computer-use-tool-arguments.ts';
import { verifyExactAssertions } from '../src/adapters/computer-use.ts';
import { classifyComputerUseEvidence } from '../src/adapters/computer-use-evidence.ts';

test('compatible tool transports decode complete objects without inventing truncated or malformed actions',()=>{
  const expected={action:'type',text:'1234567890123456789012345678901'};
  for(const value of [expected,JSON.stringify(expected),JSON.stringify(JSON.stringify(expected)),`\x60\x60\x60json\n${JSON.stringify(expected)}\n\x60\x60\x60`])assert.deepEqual(parseComputerUseToolArguments(value),expected);
  for(const value of ['{"action":"type","text":"123', '{action:"type"}', '[]', 'null', '"type"',{},null])assert.throws(()=>parseComputerUseToolArguments(value));
});

test('no application submitted is not confused with no fixture application found',()=>{
  const evidence='In the visible 收件信息 section, the 收件人 field is populated with the exact synthetic test text “测试收件人” (5 characters, within the ≤20-character limit). The value remains displayed and no validation error is shown. No application was submitted.';
  assert.equal(classifyComputerUseEvidence({recordedStatus:'passed',recordedEvidence:evidence}).status,'passed');
  assert.equal(classifyComputerUseEvidence({recordedStatus:'passed',recordedEvidence:'No application records found; cannot verify the required detail state. No application was submitted.'}).status,'blocked');
  assert.equal(classifyComputerUseEvidence({recordedStatus:'passed',recordedEvidence:evidence,coverageGap:'必填条件未核实'}).status,'blocked');
});

test('visual verification shares the actual field resolver, keeps row identity and detects real mismatches',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<div style="display:none"><label>收件人<input value="hidden"></label></div><section><div><span>*收件人：</span><div><input maxlength="20" value="ABCDEFGHIJKLMNOPQRST"></div></div><div><span>*手机号码：</span><input value="19900000000"></div></section><table><tr><th>自编码</th><th>数量（册）</th></tr><tr><td><input value="first"></td><td><input value="2"></td></tr><tr><td><input value="second"></td><td><input value="3"></td></tr></table>');
    const item={steps:[{action:'assertValue',label:'收件人',value:'ABCDEFGHIJKLMNOPQRST'},{action:'assertValue',label:'自编码',rowIndex:1,value:'second'},{action:'assertValue',label:'数量（册）',rowIndex:1,value:'3'}]};
    assert.deepEqual(await verifyExactAssertions(page,item),{failures:[],unverified:[]});
    const wrong=await verifyExactAssertions(page,{steps:[{action:'assertValue',label:'收件人',value:'wrong'}]});
    assert.equal(wrong.failures.length,1);assert.deepEqual(wrong.unverified,[]);
  } finally {await browser.close();}
});

test('visual invalid styling uses the same nearest-control wrapper as deterministic checks',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<div><span>收件人</span><div style="box-shadow:0 0 0 1px rgb(245, 60, 60)"><input></div></div><div><span>备注</span><input></div>');
    assert.deepEqual(await verifyExactAssertions(page,{steps:[{action:'assertFieldInvalid',label:'收件人'}]}),{failures:[],unverified:[]});
    const normal=await verifyExactAssertions(page,{steps:[{action:'assertFieldInvalid',label:'备注'}]});assert.equal(normal.failures.length,1);
  } finally {await browser.close();}
});
