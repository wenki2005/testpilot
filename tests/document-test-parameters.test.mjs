import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDocumentParameterNames, resolveDocumentRunParameters } from '../dist/adapters/document-test-workflow.js';

const dataSetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function project() {
  return {
    id: 'project-parameters',
    name: 'Parameter fixture',
    fileName: 'fixture.md',
    format: 'markdown',
    targetUrl: 'http://127.0.0.1/',
    sourceText: '',
    cases: [
      { id: 'case-one', steps: [
        { action: 'fillByLabel', label: 'Marker', value: '{{param:scenarioMarker}}' },
        { action: 'assertValue', label: 'Marker', value: '{{param:scenarioMarker}}' },
      ] },
      { id: 'case-two', steps: [{ action: 'assertExactVisible', text: '{{param:otherValue}}' }] },
    ],
    testDataSets: [{ id: dataSetId, name: 'Smoke input', values: { scenarioMarker: 'synthetic profile value', otherValue: 'other case value' }, createdAt: '2026-10-21T08:00:00.000Z', updatedAt: '2026-10-21T08:00:00.000Z' }],
  };
}

test('collects parameter references only from supported step value and assertion fields', () => {
  const target = project();
  target.cases[0].steps.push({ action: 'clickByRole', role: 'button', name: 'Static control label' });
  assert.deepEqual(collectDocumentParameterNames(target.cases), ['otherValue', 'scenarioMarker']);
});

test('resolves a saved data set plus per-run overrides for only the selected cases', () => {
  const target = project();
  assert.deepEqual(resolveDocumentRunParameters(target, ['case-one'], dataSetId, { scenarioMarker: 'override value' }), { scenarioMarker: 'override value' });
  assert.deepEqual(resolveDocumentRunParameters(target, ['case-two'], dataSetId), { otherValue: 'other case value' });
});

test('requires every selected parameter, while allowing explicit empty strings for negative tests', () => {
  const target = project();
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one']), /缺少.*scenarioMarker/iu);
  assert.deepEqual(resolveDocumentRunParameters(target, ['case-one'], undefined, { scenarioMarker: '' }), { scenarioMarker: '' });
});

test('rejects credential-like parameter values even when they use a synthetic field name', () => {
  const target = project();
  assert.throws(
    () => resolveDocumentRunParameters(target, ['case-one'], undefined, { scenarioMarker: 'Bearer abcdefghijklmnop' }),
    /令牌.*认证凭据/u,
  );
  target.testDataSets[0].values.scenarioMarker = 'https://example.test/?token=opaque-secret';
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one'], dataSetId), /令牌.*认证凭据/u);
});

test('rejects unknown parameter keys, unknown data sets, and credential-like parameter names', () => {
  const target = project();
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one'], undefined, { typo: 'value' }), /未知.*typo/iu);
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one'], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), /数据组不存在/iu);
  target.cases[0].steps[0].value = '{{param:password}}';
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one'], undefined, { password: 'not-stored' }), /password.*认证信息/iu);
});

test('rejects stale data-group keys instead of silently ignoring them', () => {
  const target = project();
  target.testDataSets[0].values.deletedParameter = 'stale';
  assert.throws(() => resolveDocumentRunParameters(target, ['case-one'], dataSetId), /deletedParameter/iu);
});
