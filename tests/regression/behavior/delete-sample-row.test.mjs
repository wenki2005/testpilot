import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCases } from '../../../dist/adapters/documents/execution/workflow-facade.js';

const base = {
  kind: 'visible',
  title: '样书行删除',
  expected: '每行提供删除按钮，可删除误加的样书行',
  source: '部门申样书 › 样书明细区 › 点击继续添加样书',
  steps: [],
};

test('deleteSampleRow is an accepted scoped action', () => {
  const [value] = validateCases([{
    ...base,
    steps: [
      { action: 'clickExactText', text: '继续添加样书' },
      { action: 'deleteSampleRow' },
    ],
  }]);
  assert.equal(value.steps.length, 2);
  assert.equal(value.steps[1].action, 'deleteSampleRow');
});

test('deleteSampleRow keeps rowIndex bounds checked', () => {
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'deleteSampleRow', rowIndex: 99 }] }]), /rowIndex/);
  const [value] = validateCases([{ ...base, steps: [{ action: 'deleteSampleRow', rowIndex: 0 }] }]);
  assert.equal(value.steps[0].rowIndex, 0);
});

test('generic delete text is still blocked as a high-impact click', () => {
  assert.throws(() => validateCases([{
    ...base,
    steps: [{ action: 'clickExactText', text: '删除' }],
  }]), /禁止提交、保存、删除/);
});
