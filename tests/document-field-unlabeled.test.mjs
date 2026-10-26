import test from 'node:test';
import assert from 'node:assert/strict';

test('document runner resolves a unique visible caption when the app omits accessible labels', async t => {
  const { launchTestBrowser } = await import('../dist/adapters/browser-runtime.js');
  const { isDocumentFieldInvalid, resolveDocumentField, validateCases } = await import('../dist/adapters/document-test-workflow.js');
  const browser = await launchTestBrowser({ headless: true });
  const page = await browser.newPage();
  t.after(async () => { await page.close().catch(() => undefined); await browser.close(); });
  await page.setContent(`<!doctype html><body>
    <section><span>收件人</span><input id="recipient"></section>
    <section><span>详细地址</span><textarea id="address"></textarea></section>
    <section><span>重复</span><input><input></section>
    <section><span>所在地区</span><select id="region" aria-invalid="true" style="border:2px solid red"><option>请选择</option></select></section>
    <section><div id="phone-field" style="border:2px solid red"><span>手机号码</span><input id="phone"></div></section>
    <section><span>行数量</span><input id="row-one"></section>
    <section><span>行数量</span><input id="row-two"></section>
    <table><thead><tr><th>数量（册）</th><th>图书名称</th></tr></thead><tbody><tr><td><input id="table-quantity"></td><td><input></td></tr></tbody></table>
  </body>`);
  const recipient = await resolveDocumentField(page, '收件人');
  await recipient.fill('测试收件人');
  assert.equal(await page.locator('#recipient').inputValue(), '测试收件人');
  await assert.rejects(resolveDocumentField(page, '重复'), /无法定位字段/);
  await assert.rejects(resolveDocumentField(page, '缺失'), /无法定位字段/);
  const repeated = await resolveDocumentField(page, '行数量');
  assert.equal(await repeated.getAttribute('id'), 'row-one');
  const repeatedSecond = await resolveDocumentField(page, '行数量', 1);
  assert.equal(await repeatedSecond.getAttribute('id'), 'row-two', 'repeated captions can address a specific visible row');
  const tableQuantity = await resolveDocumentField(page, '数量（册）');
  await tableQuantity.fill('10000');
  assert.equal(await page.locator('#table-quantity').inputValue(), '10000');
  const region = await resolveDocumentField(page, '所在地区');
  assert.equal(await region.getAttribute('id'), 'region', 'unlabeled dropdowns are addressable by their visible caption');
  assert.equal(await region.getAttribute('aria-invalid'), 'true');
  const phone = await resolveDocumentField(page, '手机号码');
  assert.equal(await page.locator('#phone-field').evaluate(isDocumentFieldInvalid), true, 'invalid styling on a single-field wrapper is evidence for its input');
  await page.locator('#phone-field').evaluate(el => { el.style.borderColor = 'rgb(200, 200, 200)'; });
  assert.equal(await phone.evaluate(isDocumentFieldInvalid), false, 'a neutral control and wrapper are not reported invalid');
  const blankInputCase = validateCases([{
    title: '清空必填字段', source: 'XMind fixture', kind: 'field', expected: '输入框为空',
    steps: [{ action: 'fillByLabel', label: '收件人', value: '' }, { action: 'assertValue', label: '收件人', value: '' }],
  }])[0];
  assert.equal(blankInputCase.steps[0].value, '');
  const placeholderValueCase = validateCases([{
    title: '客户选项回填', source: 'XMind fixture', kind: 'field', expected: '选项回填到字段',
    steps: [
      { action: 'fillByPlaceholder', placeholder: '请输入关键字或编码查询', value: '内部客户' },
      { action: 'assertValueByPlaceholder', placeholder: '请输入关键字或编码查询', value: '内部客户部*开心文化-部门费用' },
    ],
  }])[0];
  assert.equal(placeholderValueCase.steps[1].action, 'assertValueByPlaceholder', 'unlabeled inputs can be asserted using their exact visible placeholder');
  const roleIndexCase = validateCases([{
    title: '自定义客户 combobox', source: 'XMind fixture', kind: 'field', expected: '选中客户并回填',
    steps: [
      { action: 'fillByRoleIndex', role: 'combobox', index: 1, value: '内部客户' },
      { action: 'selectByRoleIndex', role: 'combobox', index: 1, value: '内部客户部*开心文化-部门费用' },
      { action: 'assertExactVisible', text: '内部客户部*开心文化-部门费用' },
    ],
  }])[0];
  assert.equal(roleIndexCase.steps[0].action, 'fillByRoleIndex', 'custom widgets can be addressed by an observed accessible role and stable index');
  assert.equal(roleIndexCase.steps[2].action, 'assertExactVisible', 'the selected custom-combobox value can be checked as visible rendered text');
  const emptyRequiredCase = validateCases([{
    title: '必填为空', source: 'XMind fixture', kind: 'field', expected: '提交按钮禁用',
    steps: [{ action: 'assertRoleDisabled', role: 'button', name: '提交' }],
  }])[0];
  assert.equal(emptyRequiredCase.steps[0].action, 'assertRoleDisabled');
  const longRemarkCase = validateCases([{
    title: '备注长度限制', source: 'XMind fixture', kind: 'field', expected: '输入限制或提示',
    steps: [{ action: 'assertMaxLengthOrMessage', label: '备注', maxLength: 30, message: '超长' }],
  }])[0];
  assert.equal(longRemarkCase.steps[0].maxLength, 30);
});
