import test from 'node:test';
import assert from 'node:assert/strict';

test('document DSL validates exact placeholder-based read-only input steps', async () => {
  const { validateCases } = await import('../dist/adapters/document-test-workflow.js');
  const [item] = validateCases([{
    id: 'case-placeholder',
    title: 'Search by placeholder',
    source: 'Search input exposes an accessible placeholder',
    expected: 'A unique query produces the empty result state',
    kind: 'visible',
    steps: [
      { action: 'fillByPlaceholder', placeholder: '搜索订单号/书籍', value: 'TP-NO-ORDER-20261018' },
      { action: 'blurByLabel', label: '搜索订单号/书籍' },
      { action: 'assertExactVisible', text: '暂无订单物流记录' },
    ],
  }]);
  assert.deepEqual(item.steps[0], {
    action: 'fillByPlaceholder',
    placeholder: '搜索订单号/书籍',
    value: 'TP-NO-ORDER-20261018',
  });
  assert.deepEqual(item.steps[1], { action: 'blurByLabel', label: '搜索订单号/书籍' });
  assert.throws(() => validateCases([{
    id: 'case-invalid-placeholder', title: 'Invalid', source: 'Input', expected: 'Visible', kind: 'visible',
    steps: [{ action: 'fillByPlaceholder', placeholder: '  ', value: 'x' }],
  }]), /placeholder 无效/);
});
