import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentTestDataVersion } from '../dist/adapters/document-test-workflow.js';

test('test-data version is stable for key ordering and sensitive to data-set identity and resolved values', () => {
  const baseline = getDocumentTestDataVersion('dataset-a', { customerId: 'synthetic-1', region: 'north' });
  assert.equal(getDocumentTestDataVersion('dataset-a', { region: 'north', customerId: 'synthetic-1' }), baseline);
  assert.notEqual(getDocumentTestDataVersion('dataset-a', { customerId: 'synthetic-2', region: 'north' }), baseline);
  assert.notEqual(getDocumentTestDataVersion('dataset-b', { customerId: 'synthetic-1', region: 'north' }), baseline);
  assert.notEqual(getDocumentTestDataVersion(undefined, { customerId: 'synthetic-1', region: 'north' }), baseline);
});
