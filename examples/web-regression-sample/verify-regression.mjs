import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiSuiteCandidate } from '../../src/adapters/api-suite-workflow.ts';
import { openApiOperationFacts, summarizeOpenApiSpecification } from '../../src/adapters/openapi-summary.ts';
import { loadDocumentProjects, saveDocumentProject, writeDocumentSource } from '../../src/adapters/document-test-workflow.ts';

function localHttpOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(label + ' must be a plain HTTP loopback origin (127.0.0.1, localhost, or ::1).');
  }
  return url.origin;
}

const demoUrl = localHttpOrigin(process.env.TESTPILOT_DEMO_URL ?? 'http://127.0.0.1:4317', 'TESTPILOT_DEMO_URL');
const sampleUrl = localHttpOrigin(process.env.TESTPILOT_SAMPLE_URL ?? 'http://127.0.0.1:4328', 'TESTPILOT_SAMPLE_URL');
const projectName = 'Northstar 网页回归演示（本地隔离）';
const selectedCaseIds = ['landing-title', 'record-api-contract', 'record-boundary-api'];
const projectDirectory = dirname(fileURLToPath(import.meta.url));
const openApiName = 'openapi.yaml';
const openApiBytes = await readFile(join(projectDirectory, openApiName));
const openApiText = openApiBytes.toString('utf8');
const openApi = await summarizeOpenApiSpecification(openApiText);
assert.ok(openApi, 'the sample publishes a validated OpenAPI contract');
const openApiOperations = openApi.operations
  .map(operation => String(operation.method) + ' ' + String(operation.path))
  .filter(operation => ['GET /api/records', 'GET /api/records/{id}'].includes(operation));
const selectedOpenApiFacts = openApiOperationFacts(openApi).filter(item => openApiOperations.includes(item.key));

async function request(url, method = 'GET', value) {
  const response = await fetch(url, {
    method,
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!response.ok) throw new Error(method + ' ' + new URL(url).pathname + ' failed (' + response.status + '): ' + (typeof body === 'string' ? body : JSON.stringify(body)));
  return body;
}

await request(sampleUrl + '/health');
const projects = await request(demoUrl + '/api/document-projects');
const listedProject = projects.find(item => item.name === projectName);
assert.ok(listedProject, 'seed the Northstar sample project before verification');
assert.deepEqual(listedProject.cases.map(item => item.id).sort(), [...selectedCaseIds].sort(), 'project keeps the full stable case inventory');
assert.ok(listedProject.apiContract?.suiteId, 'project links an API contract suite');
const testDataSet = listedProject.testDataSets?.find(item => item.name === '本地合成记录');
assert.ok(testDataSet, 'project keeps its reusable synthetic test data set');
const versionLabels = ['baseline', 'regression', 'fixed'];
for (const label of versionLabels) assert.ok(listedProject.siteVersions?.some(item => item.label === label), 'missing registered site version ' + label);

const project = (await loadDocumentProjects()).find(item => item.id === listedProject.id);
assert.ok(project, 'the local TestPilot project is readable from its configured project store');
const openApiDigest = createHash('sha256').update(openApiBytes).digest('hex');
if (!project.sourceMaterials?.some(item => item.fileName === openApiName && item.sha256 === openApiDigest)) {
  const createdAt = new Date().toISOString();
  project.sourceMaterials = [
    ...(project.sourceMaterials ?? []).filter(item => item.fileName !== openApiName),
    { id: randomUUID(), fileName: openApiName, role: 'coverage-reference', sha256: openApiDigest, byteLength: openApiBytes.byteLength, createdAt },
  ];
  project.sourceFiles = [...new Set([...(project.sourceFiles ?? []), openApiName])];
  project.sourceRoles = [
    ...(project.sourceRoles ?? []).filter(item => item.fileName !== openApiName),
    { fileName: openApiName, role: 'coverage-reference' },
  ];
  await writeDocumentSource(project, openApiBytes, openApiName, 2);
  await saveDocumentProject(project);
}

const suiteCandidate = await request(demoUrl + '/api/api-suites/' + encodeURIComponent(project.apiContract.suiteId));
const caseById = new Map(suiteCandidate.suite.cases.map(item => [item.id, item]));
const revisedCases = [
  {
    ...caseById.get('record-read'),
    source: 'OpenAPI: GET /api/records/{id}',
    requirementRefs: [openApiName + ': GET /api/records/{id}', 'record creation and reading'],
  },
  {
    ...caseById.get('record-missing'),
    source: 'OpenAPI: GET /api/records/{id}',
    requirementRefs: [openApiName + ': GET /api/records/{id}', 'missing record returns 404'],
  },
  ...[
    { id: 'limit-minimum', title: 'Record list accepts the minimum limit', path: '/api/records?limit=1', status: 200 },
    { id: 'limit-maximum', title: 'Record list accepts the maximum limit', path: '/api/records?limit=100', status: 200 },
    { id: 'limit-below-minimum', title: 'Record list rejects a limit below 1', path: '/api/records?limit=0', status: 400 },
    { id: 'limit-above-maximum', title: 'Record list rejects a limit above 100', path: '/api/records?limit=101', status: 400 },
  ].map(item => ({
    id: item.id,
    title: item.title,
    source: 'OpenAPI: GET /api/records',
    requirementRefs: [openApiName + ': GET /api/records', item.title],
    priority: 'P2',
    request: { method: 'GET', path: item.path },
    expect: item.status === 200 ? { status: 200 } : { status: 400, json: { error: 'limit must be an integer from 1 to 100' } },
  })),
];
const coverageMatches = suiteCandidate.suite.openApiCoverage
  && JSON.stringify([...suiteCandidate.suite.openApiCoverage.operationKeys].sort()) === JSON.stringify([...openApiOperations].sort())
  && revisedCases.every(item => suiteCandidate.suite.cases.some(saved => saved.id === item.id && saved.source === item.source));
let activeSuiteId = suiteCandidate.id;
let activeSuite = suiteCandidate;
if (!coverageMatches) {
  const suite = { ...suiteCandidate.suite, cases: revisedCases };
  const candidate = await createApiSuiteCandidate(suite, {
    openApiOperations,
    openApiOperationFacts: selectedOpenApiFacts,
  });
  await request(demoUrl + '/api/api-suites/' + encodeURIComponent(candidate.id) + '/review', 'POST', {
    decision: 'approve',
    notes: 'Approved against the bundled OpenAPI 3.1.0 contract. Read operations and both limit endpoints are explicit; mutations are limited to the run-scoped synthetic fixture and cleanup.',
  });
  activeSuiteId = candidate.id;
  activeSuite = candidate;
} else {
  assert.equal(suiteCandidate.status, 'approved', 'the reusable API contract version is approved');
}
assert.deepEqual(activeSuite.suite.openApiCoverage.coveredOperationKeys, openApiOperations);
assert.ok(activeSuite.suite.openApiCoverage.scenarios.boundary.checks.every(item => item.status === 'covered'));

const currentProject = (await request(demoUrl + '/api/document-projects')).find(item => item.id === project.id);
assert.ok(currentProject, 'the project remains visible in the TestPilot project list');
const mappedCases = currentProject.cases.map(item => item.id === 'record-boundary-api'
  ? { ...item, title: '接口契约边界：limit 1 至 100 之外返回 400', expected: 'limit=1 和 limit=100 返回 HTTP 200；limit=0 和 limit=101 返回 HTTP 400。' }
  : item);
const apiMappings = [
  { documentCaseId: 'record-api-contract', apiCaseIds: ['record-read', 'record-missing'] },
  { documentCaseId: 'record-boundary-api', apiCaseIds: ['limit-minimum', 'limit-maximum', 'limit-below-minimum', 'limit-above-maximum'] },
];
await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/update', 'POST', {
  cases: mappedCases,
  apiContract: { suiteId: activeSuiteId, mappings: apiMappings, allowNetwork: false, allowMutations: true, allowConcurrency: false },
});
await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/review', 'POST', {
  decision: 'approve',
  notes: 'Reviewed local UI assertion, exact OpenAPI case mappings, reusable synthetic data, and run-scoped fixture setup/cleanup.',
});

const versions = Object.fromEntries(versionLabels.map(label => [label, listedProject.siteVersions.find(item => item.label === label)]));
const runVersion = async (label, baselineRunId, parameterValues = {}) => {
  const started = await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/start', 'POST', {
    runMode: 'regression', selectedCaseIds, siteVersionId: versions[label].id, testDataSetId: testDataSet.id,
    ...(baselineRunId ? { baselineRunId } : {}),
    ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const progress = await request(demoUrl + '/api/document-runs/' + encodeURIComponent(started.runId) + '/progress');
    if (progress.status === 'completed') return await request(demoUrl + '/api/document-runs/' + encodeURIComponent(started.runId));
    if (progress.status === 'failed') throw new Error('Run ' + started.runId + ' failed: ' + JSON.stringify(progress));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Run ' + started.runId + ' timed out; saved progress remains available in TestPilot.');
};
const assertClean = async label => {
  const records = await request(sampleUrl + '/api/records?limit=100');
  assert.deepEqual(records.items, [], label + ' cleanup leaves no sample records behind');
};
const assertRunScope = result => assert.deepEqual(result.caseScope.selectedCaseIds, selectedCaseIds, 'run uses the explicitly selected case IDs');
const assertApiResults = result => {
  const recordCase = result.apiContract.results.find(item => item.id === 'record-api-contract');
  assert.equal(recordCase.status, 'passed', recordCase.detail);
  assert.deepEqual(recordCase.apiCaseResults.map(item => [item.caseId, item.status]), [['record-read', 'passed'], ['record-missing', 'passed']]);
  const boundaryCase = result.apiContract.results.find(item => item.id === 'record-boundary-api');
  assert.equal(boundaryCase.status, 'passed', boundaryCase.detail);
  assert.deepEqual(boundaryCase.apiCaseResults.map(item => [item.caseId, item.status]), [
    ['limit-minimum', 'passed'], ['limit-maximum', 'passed'], ['limit-below-minimum', 'passed'], ['limit-above-maximum', 'passed'],
  ]);
};

const stableBaselines = [];
for (let attempt = 0; attempt < 3; attempt++) {
  const previousRunId = stableBaselines.at(-1)?.id;
  const result = await runVersion('baseline', previousRunId);
  assertRunScope(result);
  assert.equal(result.overall, 'passed', JSON.stringify(result.comparisons));
  assert.equal(result.siteVersionSnapshot.id, versions.baseline.id);
  assert.equal(result.testDataSetId, testDataSet.id);
  assert.ok(result.testDataVersion, 'run records a fixed test-data version');
  assert.ok(result.sourceMaterialsSnapshot.some(item => item.fileName === openApiName && item.sha256 === openApiDigest));
  assertApiResults(result);
  if (previousRunId) assert.equal(result.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'unchanged');
  await assertClean('stable baseline run ' + (attempt + 1));
  stableBaselines.push(result);
}
const baseline = stableBaselines.at(-1);

const regressed = await runVersion('regression', baseline.id);
assertRunScope(regressed);
assert.equal(regressed.overall, 'failed', JSON.stringify(regressed.comparisons));
assert.equal(regressed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'regression');
assert.equal(regressed.baselineComparison.find(item => item.caseId === 'record-api-contract')?.disposition, 'unchanged');
assertApiResults(regressed);
await assertClean('regression run');

const fixed = await runVersion('fixed', regressed.id);
assertRunScope(fixed);
assert.equal(fixed.overall, 'passed', JSON.stringify(fixed.comparisons));
assert.equal(fixed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'fixed');
assertApiResults(fixed);
await assertClean('fixed run');

const parameterVariant = await runVersion('fixed', fixed.id, { recordName: 'Synthetic regression record variant' });
assertRunScope(parameterVariant);
assert.equal(parameterVariant.overall, 'passed');
assert.equal(parameterVariant.parameterValues.recordName, 'Synthetic regression record variant');
assert.notEqual(parameterVariant.testDataVersion, fixed.testDataVersion, 'run parameter changes create a distinct immutable data version');
assert.equal(parameterVariant.baselineTestDataChanged, true, 'the comparison flags data changes instead of attributing them to the site');
assertApiResults(parameterVariant);
await assertClean('parameter variant run');

console.log(JSON.stringify({
  status: 'regression-flow-verified', projectId: project.id, projectName,
  stableBaselineRunIds: stableBaselines.map(item => item.id),
  regressionRunId: regressed.id, fixedRunId: fixed.id, parameterVariantRunId: parameterVariant.id,
  outcomes: [...stableBaselines.map(item => item.overall), regressed.overall, fixed.overall],
  parameterVariantOutcome: parameterVariant.overall,
  openApiCoverage: activeSuite.suite.openApiCoverage,
  regression: regressed.baselineComparison.find(item => item.caseId === 'landing-title'),
  fix: fixed.baselineComparison.find(item => item.caseId === 'landing-title'),
  parameterVersionChanged: parameterVariant.testDataVersion !== fixed.testDataVersion,
  comparisonNotedDataChange: parameterVariant.baselineTestDataChanged,
  sampleDataRemainingAfterEachRun: false,
}, null, 2));
