import test from 'node:test';
import assert from 'node:assert/strict';

test('static-copy subchecks require an explicit page-copy cue and quoted literal', async () => {
  const { draftExplicitStaticCopySubcheck } = await import('../dist/adapters/read-only-subcheck-authoring.js');

  assert.deepEqual(draftExplicitStaticCopySubcheck({
    title: '页面提示文案「如有调样、周边产品等样书申请需求，请OA申请」',
    expected: '页面显示固定提示',
  }), [{ action: 'assertExactVisible', text: '如有调样、周边产品等样书申请需求，请OA申请' }]);

  assert.deepEqual(draftExplicitStaticCopySubcheck({
    title: '页面文案：“请联系运营OA申请”', expected: '文案需正确显示',
  }), [{ action: 'assertExactVisible', text: '请联系运营OA申请' }]);

  assert.equal(draftExplicitStaticCopySubcheck({ title: 'toast提示「暂无申请权限」', expected: '不进入表单' }), undefined,
    'transient feedback needs a known trigger and must not be treated as static copy');
  assert.equal(draftExplicitStaticCopySubcheck({ title: '后端备注「发送样书」+审批编号', expected: '备注中包含「发送样书」' }), undefined,
    'quoted backend values are not page-copy assertions');
  assert.equal(draftExplicitStaticCopySubcheck({ title: '页面提示文案', expected: '提示语待定' }), undefined,
    'do not invent text when no literal is specified');
});
