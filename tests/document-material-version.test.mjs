import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentMaterialVersion } from '../dist/adapters/document-test-workflow.js';

const project = overrides => ({
  id: 'material-fixture',
  sourceText: 'requirements v1',
  sourceMaterials: [
    { id: 'one', fileName: 'requirements.md', role: 'requirements', sha256: 'a'.repeat(64), byteLength: 16, createdAt: '2026-10-21T00:00:00.000Z' },
    { id: 'two', fileName: 'coverage.md', role: 'coverage-reference', sha256: 'b'.repeat(64), byteLength: 18, createdAt: '2026-10-21T00:00:00.000Z' },
  ],
  ...overrides,
});

test('source-material version is stable across IDs, timestamps and input order', () => {
  const first = project();
  const reordered = project({ sourceMaterials: [...project().sourceMaterials].reverse().map(item => ({ ...item, id: `new-${item.id}`, createdAt: '2026-10-22T00:00:00.000Z' })) });
  assert.equal(getDocumentMaterialVersion(first), getDocumentMaterialVersion(reordered));
});

test('source-material version changes when source content, role or attached material changes', () => {
  const baseline = getDocumentMaterialVersion(project());
  assert.notEqual(getDocumentMaterialVersion(project({ sourceText: 'requirements v2' })), baseline);
  assert.notEqual(getDocumentMaterialVersion(project({ sourceMaterials: project().sourceMaterials.map((item, index) => index ? item : { ...item, sha256: 'c'.repeat(64) }) })), baseline);
  assert.notEqual(getDocumentMaterialVersion(project({ sourceMaterials: project().sourceMaterials.map((item, index) => index ? item : { ...item, role: 'coverage-reference' }) })), baseline);
});
