import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { refreshDocumentPackage } from '../dist/adapters/document-package-refresh.js';

test('package refresh replaces stale cases from the saved project and preserves authoritative run evidence with explicit scope', () => {
  const previous = zipSync({
    'run.mjs': strToU8('/* runner implementation */'),
    'cases.json': strToU8('{"cases":[{"id":"stale"}]}'),
    'report.md': strToU8('stale report'),
    'run.json': strToU8('{"id":"stale-run"}'),
    'old-extra.json': strToU8('must not survive'),
  });
  const sourceMaterial = { id: 'material-1', fileName: 'spec.docx', role: 'requirements', sha256: 'a'.repeat(64), byteLength: 256, createdAt: '2026-10-18T00:00:00Z' };
  const project = { id: 'p1', name: 'Project', fileName: 'spec.docx', targetUrl: 'https://example.test', sourceMaterials: [sourceMaterial], cases: [
    { id: 'repaired', title: 'Updated', steps: [{ action: 'assertVisible', text: 'Ready' }] },
    { id: 'new-case', title: 'Current' },
  ] };
  const run = {
    id: 'run-1', projectId: 'p1', startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
    caseScope: { selectedCaseIds: ['repaired'], excludedCaseIds: [], totalCases: 2 },
    deterministic: { status: 'passed', results: [{ id: 'repaired', status: 'passed' }] },
    ai: { status: 'passed', results: [{ id: 'repaired', status: 'passed' }] },
    comparisons: [{ id: 'repaired' }], report: 'authoritative report', overall: 'partial', finalReady: false,
    materialVersion: 'material-version-1', sourceMaterialsSnapshot: [sourceMaterial],
    testDataSetId: 'dataset-1', testDataVersion: 'data-version-1', parameterValues: { marker: 'synthetic' },
    caseGeneration: { artifactId: 'generation-1', digest: 'gen-digest' },
    parentRunId: 'run-parent',
    retestLineage: { parentRunId: 'run-parent', selectedCaseIds: ['repaired'], reason: 'fixed selector' },
  };
  const bytes = refreshDocumentPackage(project, run, previous);
  const archive = unzipSync(bytes);
  assert.deepEqual(Object.keys(archive).sort(), ['README.md', 'artifacts.json', 'cases.json', 'package.json', 'refresh.json', 'report.md', 'run.json', 'run.mjs', 'workflow-plan.json', 'research-examples.json', 'source-roles.json', 'source-materials.json'].sort());
  assert.equal(JSON.parse(Buffer.from(archive['cases.json']).toString()).cases[0].steps[0].text, 'Ready');
  assert.equal(JSON.parse(Buffer.from(archive['cases.json']).toString()).cases.length, 2);
  assert.deepEqual(JSON.parse(Buffer.from(archive['cases.json']).toString()).selectedCaseIds, ['repaired']);
  assert.deepEqual(JSON.parse(Buffer.from(archive['cases.json']).toString()).excludedCaseIds, []);
  assert.equal(Buffer.from(archive['report.md']).toString(), 'authoritative report');
  assert.equal(JSON.parse(Buffer.from(archive['run.json']).toString()).id, 'run-1');
  assert.deepEqual(JSON.parse(Buffer.from(archive['run.json']).toString()).caseScope, run.caseScope);
  assert.deepEqual(JSON.parse(Buffer.from(archive['run.json']).toString()).caseGeneration, run.caseGeneration);
  assert.equal(JSON.parse(Buffer.from(archive['run.json']).toString()).parentRunId, run.parentRunId);
  assert.equal(JSON.parse(Buffer.from(archive['run.json']).toString()).materialVersion, run.materialVersion);
  assert.equal(JSON.parse(Buffer.from(archive['run.json']).toString()).testDataVersion, run.testDataVersion);
  assert.deepEqual(JSON.parse(Buffer.from(archive['run.json']).toString()).parameterValues, run.parameterValues);
  assert.equal(JSON.parse(Buffer.from(archive['cases.json']).toString()).testDataVersion, run.testDataVersion);
  assert.deepEqual(JSON.parse(Buffer.from(archive['source-materials.json']).toString()), [sourceMaterial]);
  assert.deepEqual(JSON.parse(Buffer.from(archive['run.json']).toString()).retestLineage, run.retestLineage);
  const refreshed = JSON.parse(Buffer.from(archive['refresh.json']).toString());
  assert.deepEqual(refreshed.casesWithoutRunEvidence, ['new-case']);
  assert.deepEqual(refreshed.runSelectedCaseIds, ['repaired']);
  assert.equal(archive['old-extra.json'], undefined);
  assert.equal(Buffer.from(archive['run.mjs']).toString(), '/* runner implementation */');
});

test('package refresh preserves the run-time case and executed-step snapshots after project edits', () => {
  const previous = zipSync({ 'run.mjs': strToU8('runner bytes'), 'cases.json': strToU8('{"cases":[]}') });
  const project = {
    id: 'p1', name: 'Project', fileName: 'spec.md', targetUrl: 'https://example.test', cases: [
      { id: 'stable', title: 'Edited after the run', steps: [{ action: 'assertVisible', text: 'Changed' }] },
      { id: 'added-later', title: 'New case', steps: [] },
    ],
  };
  const run = {
    id: 'historical-run', projectId: 'p1', startedAt: '2026-10-20T00:00:00Z', completedAt: '2026-10-20T00:01:00Z',
    caseSnapshotVersion: 1, caseVersion: 'run-case-hash',
    caseScope: { selectedCaseIds: ['stable'], excludedCaseIds: [], totalCases: 1 },
    caseSnapshots: [{ id: 'stable', title: 'Original title', steps: [{ action: 'fillByLabel', label: 'Scenario marker', value: '{{param:marker}}' }] }],
    executionCaseSnapshots: [{ id: 'stable', title: 'Original title', steps: [{ action: 'fillByLabel', label: 'Scenario marker', value: 'value used during this run' }] }],
    deterministic: { status: 'passed', results: [{ id: 'stable', status: 'passed' }] }, ai: { status: 'not-applicable', results: [] },
    comparisons: [{ id: 'stable' }], report: 'original report', overall: 'passed', finalReady: true,
  };

  const archive = unzipSync(refreshDocumentPackage(project, run, previous));
  const cases = JSON.parse(Buffer.from(archive['cases.json']).toString());
  assert.equal(cases.caseSnapshotSource, 'run-snapshot');
  assert.equal(cases.caseVersion, 'run-case-hash');
  assert.equal(cases.cases.length, 1, 'cases.json keeps the run-time project extent');
  assert.equal(cases.cases[0].title, 'Original title');
  assert.equal(cases.cases[0].steps[0].value, 'value used during this run');
  assert.equal(cases.caseSnapshots[0].steps[0].value, '{{param:marker}}', 'the authored parameterized revision remains available alongside the executed input');
  assert.equal(cases.executionCaseSnapshots[0].steps[0].value, 'value used during this run');
  assert.deepEqual(cases.selectedCaseIds, ['stable']);
  const refresh = JSON.parse(Buffer.from(archive['refresh.json']).toString());
  assert.equal(refresh.caseSnapshotSource, 'run-snapshot');
  assert.deepEqual(refresh.caseSnapshotIds, ['stable']);
  assert.deepEqual(refresh.currentCaseIds, ['stable', 'added-later']);
});

test('refreshed artifact manifest has reviewable SHA-256, media types, and source links', () => {
  const previous = zipSync({ 'run.mjs': strToU8('runner bytes') });
  const project = {
    id: 'p1', name: 'Project', fileName: 'spec.docx', targetUrl: 'https://example.test',
    workflowPlan: ['generate', 'execute'],
    researchExamples: [{ title: 'Example', url: 'https://example.test/docs', snippet: 'Reference' }],
    caseGeneration: {
      artifactId: 'gen-artifact-1', version: 1, generatedAt: '2026-10-19T00:00:00Z', digest: 'original-generation-digest',
      requirements: [], qualitySummary: { caseCount: 1 }, warnings: [], sources: [{ kind: 'requirements', label: 'spec.docx' }],
      transferredCases: [{ sourceCaseId: 'AI-1', projectCaseId: 'CASE-1' }],
    },
    cases: [{ id: 'CASE-1', title: 'Generated case' }],
  };
  const run = {
    id: 'run-1', projectId: 'p1', startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
    caseScope: { selectedCaseIds: ['CASE-1'], excludedCaseIds: [], totalCases: 1 }, deterministic: {}, ai: {},
    comparisons: [{ id: 'CASE-1' }], report: 'report', overall: 'partial', finalReady: false,
  };
  const archive = unzipSync(refreshDocumentPackage(project, run, previous));
  const manifest = JSON.parse(Buffer.from(archive['artifacts.json']).toString());
  assert.equal(manifest.algorithm, 'SHA-256');
  assert.equal(manifest.manifestSelfDigestExcluded, true);
  assert.equal(manifest.previousPackageSha256, createHash('sha256').update(previous).digest('hex'));
  assert.equal(manifest.artifacts.some(item => item.path === 'artifacts.json'), false);
  for (const item of manifest.artifacts) {
    assert.ok(archive[item.path], `manifest path exists: ${item.path}`);
    const bytes = Buffer.from(archive[item.path]);
    assert.equal(item.sizeBytes, bytes.byteLength, `manifest byte length: ${item.path}`);
    assert.equal(item.sha256, createHash('sha256').update(bytes).digest('hex'), `manifest digest: ${item.path}`);
    assert.ok(item.mediaType);
    assert.ok(item.artifactType);
    assert.ok(Array.isArray(item.sources));
    assert.ok(item.sources.length > 0);
  }
  const generated = manifest.artifacts.find(item => item.path === 'case-generation.json');
  assert.equal(generated.artifactType, 'case-generation-provenance');
  assert.deepEqual(generated.sources, [{
    kind: 'case-generation-artifact', id: 'gen-artifact-1', field: 'caseGeneration', digest: 'original-generation-digest',
  }]);
  assert.equal(generated.sha256, createHash('sha256').update(archive['case-generation.json']).digest('hex'));
  const packedRun = JSON.parse(Buffer.from(archive['run.json']).toString());
  assert.deepEqual(packedRun.caseGeneration, { artifactId: 'gen-artifact-1', version: 1, digest: 'original-generation-digest' });
  const runArtifact = manifest.artifacts.find(item => item.path === 'run.json');
  assert.ok(runArtifact.sources.some(source => source.kind === 'case-generation-artifact' && source.id === 'gen-artifact-1' && source.digest === 'original-generation-digest'));
});

test('package refresh rejects cross-project or incomplete evidence', () => {
  const previous = zipSync({ 'run.mjs': strToU8('runner') });
  const project = { id: 'p1', name: 'Project', fileName: 'spec', targetUrl: 'https://example.test', cases: [] };
  const run = { id: 'r', projectId: 'p2', caseScope: {}, deterministic: {}, ai: {}, comparisons: [], report: 'report' };
  assert.throws(() => refreshDocumentPackage(project, run, previous), /do not match/);
});

test('package refresh repairs missing network observer and disabled-submit classification in an older runner', () => {
  const previous = zipSync({ 'run.mjs': strToU8("await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});let capturedUrl;for(const s of c.steps??[]){if(s.action==='triggerClientValidation'){const c=typeof p.className==='string'?p.className:'';return /(?:^|\\s)(?:is-)?disabled(?:\\s|$)/i.test(c);blockAllValidationRequests=true;try{await el.click({timeout:5000})}finally{blockAllValidationRequests=false}}}") });
  const project = { id: 'p1', name: 'Project', fileName: 'spec.xmind', targetUrl: 'https://example.test', cases: [{ id: 'case-1', title: 'Case' }] };
  const run = { id: 'run-1', projectId: 'p1', startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z', caseScope: { selectedCaseIds: ['case-1'], excludedCaseIds: [], totalCases: 1 }, deterministic: {}, ai: {}, comparisons: [{ id: 'case-1' }], report: 'report', overall: 'partial', finalReady: false };
  const archive = unzipSync(refreshDocumentPackage(project, run, previous));
  const runner = Buffer.from(archive['run.mjs']).toString();
  assert.match(runner, /Unexpected fetch\/XHR count/);
  assert.match(runner, /submit button disabled; valid synthetic fixtures required/);
  assert.match(runner, /\/disabled\/i\.test\(c\)/);
  assert.match(runner, /blockAllValidationRequests=true/);
});

test('refreshed exports redact sensitive browser fields, headers, report text and credential URLs', () => {
  const previous = zipSync({ 'run.mjs': strToU8('runner bytes') });
  const project = {
    id: 'p1', name: 'Project', fileName: 'spec.md',
    targetUrl: 'https://example.test/?access_token=url-secret&mode=smoke',
    cases: [{
      id: 'case-1', title: 'Synthetic flow',
      steps: [
        { action: 'fillByLabel', label: 'Password', value: 'LocalPass-7!' },
        { action: 'fillByLabel', label: 'Scenario marker', value: 'synthetic-case-42' },
      ],
    }],
  };
  const run = {
    id: 'run-1', projectId: 'p1', startedAt: '2026-10-18T00:00:00Z', completedAt: '2026-10-18T00:01:00Z',
    siteVersionSnapshot: { id: 'version-1', label: 'v1', environment: 'local', targetUrl: project.targetUrl, changeNotes: '', createdAt: '2026-10-18T00:00:00Z' },
    caseScope: { selectedCaseIds: ['case-1'], excludedCaseIds: [], totalCases: 1 },
    deterministic: { results: [{ id: 'case-1', detail: 'Authorization: Bearer result-secret-value' }] },
    ai: {}, comparisons: [{ id: 'case-1' }],
    report: 'Cookie: report-secret-value',
    overall: 'passed', finalReady: true, parameterValues: { scenarioMarker: 'Bearer parameter-secret-value' },
  };
  const archive = unzipSync(refreshDocumentPackage(project, run, previous));
  const exportedText = Object.values(archive).map(bytes => Buffer.from(bytes).toString()).join('\\n');
  for (const secret of ['url-secret', 'LocalPass-7!', 'result-secret-value', 'report-secret-value', 'parameter-secret-value']) {
    assert.equal(exportedText.includes(secret), false, secret + ' must not appear in the exported package');
  }
  assert.match(exportedText, /synthetic-case-42/u, 'non-sensitive synthetic values remain reproducible');
  const cases = JSON.parse(Buffer.from(archive['cases.json']).toString());
  assert.equal(cases.cases[0].steps[0].value, '[REDACTED]');
  assert.equal(cases.cases[0].steps[1].value, 'synthetic-case-42');
});
