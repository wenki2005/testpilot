import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiSuiteCandidate } from '../../src/adapters/api-suite-workflow.ts';
import { openApiOperationFacts, summarizeOpenApiSpecification } from '../../src/adapters/openapi-summary.ts';
import { createDocumentWorkflow } from '../../src/adapters/document-workflow-record.ts';
import { makeDocumentProject, saveDocumentProject, validateCases, writeDocumentSource } from '../../src/adapters/document-test-workflow.ts';

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
const projectDirectory = dirname(fileURLToPath(import.meta.url));
const requirementName = 'requirements.md';
const requirementBytes = await readFile(join(projectDirectory, requirementName));
const requirementText = requirementBytes.toString('utf8');
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

const existingProjects = await request(demoUrl + '/api/document-projects');
const existing = existingProjects.find(item => item.name === projectName);
if (existing) {
  assert.equal(existing.cases.length, 3, 'existing demo project has the expected case inventory');
  assert.equal(existing.siteVersions.length, 3, 'existing demo project has all three site versions');
  await import('./verify-regression.mjs');
  process.exit(0);
}
await request(sampleUrl + '/health');

const project = makeDocumentProject({
  name: projectName,
  fileName: requirementName,
  sourceFiles: [requirementName, openApiName],
  caseMode: 'existing',
  document: { format: 'markdown', text: requirementText },
  targetUrl: sampleUrl + '/?build=baseline',
});
const now = new Date().toISOString();
project.confirmationRequired = true;
project.sourceMaterials = [{
  id: randomUUID(), fileName: requirementName, role: 'requirements',
  sha256: createHash('sha256').update(requirementBytes).digest('hex'),
  byteLength: requirementBytes.byteLength, createdAt: now,
}, {
  id: randomUUID(), fileName: openApiName, role: 'coverage-reference',
  sha256: createHash('sha256').update(openApiBytes).digest('hex'),
  byteLength: openApiBytes.byteLength, createdAt: now,
}];
project.sourceRoles = [
  { fileName: requirementName, role: 'requirements' },
  { fileName: openApiName, role: 'coverage-reference' },
];
const dataSetId = randomUUID();
project.testDataSets = [{
  id: dataSetId, name: '本地合成记录',
  values: { recordName: 'Synthetic regression record' },
  createdAt: now, updatedAt: now,
}];
project.cases = validateCases([
  {
    id: 'landing-title', title: '主页面显示正确的网站标题',
    source: requirementName + ': landing page', entryPath: '/', modulePath: ['Application', 'Landing page'],
    requirementRefs: [requirementName + ': landing page'], priority: 'P1', category: 'functional',
    confidence: 'high', coverageAreas: ['functional'], lifecycleStatus: 'runnable', selectedForRegression: true,
    preconditions: [], preconditionsConfirmed: true, testData: ['recordName 来自本地合成数据组'],
    sideEffectRisk: 'none', cleanup: '', caseOrigin: 'manual', kind: 'visible',
    expected: '基线和修复版本页面上显示 Application Overview',
    steps: [
      { action: 'fillByLabel', label: 'Record name', value: '{{param:recordName}}' },
      { action: 'assertValue', label: 'Record name', value: '{{param:recordName}}' },
      { action: 'assertExactVisible', text: 'Application Overview' },
    ],
  },
  {
    id: 'record-api-contract', title: '接口契约：合成记录可创建、读取并由 fixture 清理',
    source: requirementName + ': record service; ' + openApiName + ': GET /api/records/{id}', modulePath: ['Application', 'Record service'],
    requirementRefs: [requirementName + ': record service', openApiName + ': GET /api/records/{id}'], priority: 'P1', category: 'functional',
    confidence: 'high', coverageAreas: ['functional'], lifecycleStatus: 'runnable', selectedForRegression: true,
    preconditions: [], preconditionsConfirmed: true, testData: ['fixture 每轮创建唯一 RUN_ID 记录'],
    sideEffectRisk: 'reversible', cleanup: '已审核 API fixture 在每轮结束后删除本轮 RUN_ID 记录。',
    caseOrigin: 'manual', kind: 'visible', expected: '记录创建和读取符合契约；每轮结束后记录已被清理。', steps: [],
  },
  {
    id: 'record-boundary-api', title: '接口契约边界：limit 1 至 100 之外返回 400',
    source: requirementName + ': data boundary; ' + openApiName + ': GET /api/records', modulePath: ['Application', 'Data boundaries'],
    requirementRefs: [requirementName + ': record-list limit', openApiName + ': GET /api/records'], priority: 'P2', category: 'boundary',
    confidence: 'high', coverageAreas: ['boundary'], lifecycleStatus: 'runnable', selectedForRegression: true,
    preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '',
    caseOrigin: 'manual', kind: 'visible', expected: 'limit=1 和 limit=100 返回 HTTP 200；limit=0 和 limit=101 返回 HTTP 400。', steps: [],
  },
]);

const workflow = await createDocumentWorkflow({ projectId: project.id, approvalPolicy: 'confirm-before-execution' });
project.workflowId = workflow.workflowId;
await writeDocumentSource(project, requirementBytes, requirementName, 1);
await writeDocumentSource(project, openApiBytes, openApiName, 2);
await saveDocumentProject(project);

const runIdToken = '$' + '{RUN_ID}';
const runScopedPath = '/api/records/' + runIdToken;
const suite = {
  version: 1, name: 'Northstar local synthetic record contract',
  description: 'Loopback-only API contract with a unique per-run setup record and cleanup.',
  baseUrl: sampleUrl,
  fixtures: {
    setup: [{
      id: 'create-record', title: 'Create one synthetic run-scoped record',
      source: requirementName + ': record service', priority: 'P1',
      request: { method: 'POST', path: '/api/records', body: { id: runIdToken, name: 'Synthetic regression record' } },
      expect: { status: 201, json: { name: 'Synthetic regression record', state: 'active' } },
    }],
    cleanup: [{
      id: 'delete-record', title: 'Delete the synthetic run-scoped record',
      source: 'isolated local fixture cleanup', priority: 'P1',
      request: { method: 'DELETE', path: runScopedPath }, expect: { status: 204 },
    }],
  },
  cases: [
    {
      id: 'record-read', title: 'Read the created synthetic record',
      source: 'OpenAPI: GET /api/records/{id}', requirementRefs: [openApiName + ': GET /api/records/{id}', 'record creation and reading'], priority: 'P1',
      request: { method: 'GET', path: runScopedPath },
      expect: { status: 200, json: { name: 'Synthetic regression record', state: 'active' } },
    },
    {
      id: 'record-missing', title: 'Missing record returns not found',
      source: 'OpenAPI: GET /api/records/{id}', requirementRefs: [openApiName + ': GET /api/records/{id}', 'missing record returns 404'], priority: 'P2',
      request: { method: 'GET', path: '/api/records/missing-record' },
      expect: { status: 404, json: { error: 'record not found' } },
    },
    {
      id: 'limit-minimum', title: 'Record list accepts the minimum limit',
      source: 'OpenAPI: GET /api/records', requirementRefs: [openApiName + ': GET /api/records', 'record-list minimum limit'], priority: 'P2',
      request: { method: 'GET', path: '/api/records?limit=1' },
      expect: { status: 200 },
    },
    {
      id: 'limit-maximum', title: 'Record list accepts the maximum limit',
      source: 'OpenAPI: GET /api/records', requirementRefs: [openApiName + ': GET /api/records', 'record-list maximum limit'], priority: 'P2',
      request: { method: 'GET', path: '/api/records?limit=100' },
      expect: { status: 200 },
    },
    {
      id: 'limit-below-minimum', title: 'Record list rejects a limit below 1',
      source: 'OpenAPI: GET /api/records', requirementRefs: [openApiName + ': GET /api/records', 'record-list limit lower error'], priority: 'P2',
      request: { method: 'GET', path: '/api/records?limit=0' },
      expect: { status: 400, json: { error: 'limit must be an integer from 1 to 100' } },
    },
    {
      id: 'limit-above-maximum', title: 'Record list rejects a limit above 100',
      source: 'OpenAPI: GET /api/records', requirementRefs: [openApiName + ': GET /api/records', 'record-list limit upper error'], priority: 'P2',
      request: { method: 'GET', path: '/api/records?limit=101' },
      expect: { status: 400, json: { error: 'limit must be an integer from 1 to 100' } },
    },
  ],
};
const apiSuite = await createApiSuiteCandidate(suite, {
  openApiOperations,
  openApiOperationFacts: selectedOpenApiFacts,
});
assert.deepEqual(apiSuite.suite.openApiCoverage.coveredOperationKeys, openApiOperations);
assert.ok(apiSuite.suite.openApiCoverage.scenarios.boundary.checks.every(item => item.status === 'covered'));
await request(demoUrl + '/api/api-suites/' + encodeURIComponent(apiSuite.id) + '/review', 'POST', {
  decision: 'approve',
  notes: 'Approved for this loopback-only sample; setup and cleanup use only synthetic RUN_ID records.',
});
const updated = await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/update', 'POST', {
  apiContract: {
    suiteId: apiSuite.id,
    mappings: [
      { documentCaseId: 'record-api-contract', apiCaseIds: ['record-read', 'record-missing'] },
      { documentCaseId: 'record-boundary-api', apiCaseIds: ['limit-minimum', 'limit-maximum', 'limit-below-minimum', 'limit-above-maximum'] },
    ],
    allowNetwork: false, allowMutations: true, allowConcurrency: false,
  },
});
assert.equal(updated.reviewStatus, 'draft');

const registerVersion = async (label, build, changeNotes) => {
  const saved = await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/site-versions', 'POST', {
    label, environment: 'local isolated sample', targetUrl: sampleUrl + '/?build=' + build, changeNotes,
  });
  return saved.siteVersions.find(item => item.label === label);
};
const versions = [
  await registerVersion('baseline', 'baseline', 'Stable initial behavior.'),
  await registerVersion('regression', 'regression', 'Intentional regression: landing heading changes.'),
  await registerVersion('fixed', 'fixed', 'Restore the expected landing heading.'),
];
assert.ok(versions.every(Boolean), 'all three local deployment versions were registered');
await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/review', 'POST', {
  decision: 'approve',
  notes: 'Reviewed local UI assertion, API mapping, parameter data and synthetic run-scoped setup/cleanup.',
});

const selectedCaseIds = project.cases.map(item => item.id);
const runVersion = async (siteVersionId, baselineRunId) => {
  const started = await request(demoUrl + '/api/document-projects/' + encodeURIComponent(project.id) + '/start', 'POST', {
    runMode: 'regression', selectedCaseIds, siteVersionId,
    ...(baselineRunId ? { baselineRunId } : {}), testDataSetId: dataSetId,
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
const assertNoRecordsRemain = async label => {
  const records = await fetch(sampleUrl + '/api/records?limit=100').then(response => response.json());
  assert.deepEqual(records.items, [], label + ' cleanup leaves no sample records behind');
};

const baseline = await runVersion(versions[0].id);
assert.equal(baseline.overall, 'passed', JSON.stringify(baseline.comparisons));
await assertNoRecordsRemain('baseline run');
const regressed = await runVersion(versions[1].id, baseline.id);
assert.equal(regressed.overall, 'failed', JSON.stringify(regressed.comparisons));
assert.equal(regressed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'regression');
await assertNoRecordsRemain('regression run');
const fixed = await runVersion(versions[2].id, regressed.id);
assert.equal(fixed.overall, 'passed', JSON.stringify(fixed.comparisons));
assert.equal(fixed.baselineComparison.find(item => item.caseId === 'landing-title')?.disposition, 'fixed');
await assertNoRecordsRemain('fixed run');

console.log(JSON.stringify({
  status: 'seeded-and-verified', projectId: project.id, projectName,
  apiSuiteId: apiSuite.id, runIds: [baseline.id, regressed.id, fixed.id],
  outcomes: [baseline.overall, regressed.overall, fixed.overall],
  baselineComparisons: regressed.baselineComparison,
  fixedComparisons: fixed.baselineComparison,
  sampleDataRemainingAfterEachRun: false,
}, null, 2));
