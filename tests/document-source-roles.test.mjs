import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentInputRoles } from '../dist/adapters/document-source-roles.js';

test('held-out benchmark stays out of requirement and coverage model inputs', () => {
  const resolved = resolveDocumentInputRoles([
    { fileName: 'requirements.pdf', requestedRole: 'requirements', document: { format: 'pdf', text: 'REQ-SENTINEL: applicant may view status.' } },
    { fileName: '156-cases.xmind', requestedRole: 'auto', document: { format: 'xmind', text: 'BENCHMARK-SENTINEL: full old cases', testCases: [{ title: 'Old case', source: 'BENCHMARK-SENTINEL action', expected: 'BENCHMARK-SENTINEL expected' }] } },
    { fileName: 'public-reference.md', requestedRole: 'coverage-reference', document: { format: 'markdown', text: 'REFERENCE-SENTINEL: exploratory coverage idea' } },
  ]);
  const generationInput = `${resolved.requirementsText}\n${JSON.stringify(resolved.coverageReferences)}`;
  assert.match(generationInput, /REQ-SENTINEL/);
  assert.match(generationInput, /REFERENCE-SENTINEL/);
  assert.doesNotMatch(generationInput, /BENCHMARK-SENTINEL/);
  assert.equal(resolved.benchmarkCases.length, 1);
  assert.match(resolved.benchmarkCases[0].source, /BENCHMARK-SENTINEL/);
  assert.deepEqual(resolved.sourceRoles.map(item => item.role), ['requirements', 'held-out-benchmark', 'coverage-reference']);
});

test('bad source roles and oversized reference inputs are rejected with actionable errors', () => {
  assert.throws(() => resolveDocumentInputRoles([
    { fileName: 'baseline.xmind', requestedRole: 'requirements', document: { format: 'xmind', text: 'old tests', testCases: [{ title: 'Old', source: 'x', expected: 'y' }] } },
  ]), /标记为需求资料.*测试用例/);
  assert.throws(() => resolveDocumentInputRoles([
    { fileName: 'long-reference.md', requestedRole: 'coverage-reference', document: { format: 'markdown', text: 'x'.repeat(2_501) } },
  ]), /不会静默截断/);
  assert.throws(() => resolveDocumentInputRoles([
    { fileName: 'same.md', document: { format: 'markdown', text: 'a' } },
    { fileName: 'same.md', document: { format: 'markdown', text: 'b' } },
  ]), /文件名重复/);
});
