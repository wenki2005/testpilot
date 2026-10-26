import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { executeDocumentApiLane, mapApprovedApiRunToDocumentCases } from '../dist/adapters/api-document-lane.js';

function fixture(status = 'passed') {
  const suite = { version: 1, name: 'approved fixture', cases: [
    { id: 'customer-read', title: 'Contract-backed customer read', request: { method: 'GET', path: '/customers' }, expect: { status: 200 } },
    { id: 'submit-check', title: 'Contract-backed submit check', request: { method: 'GET', path: '/submit-check' }, expect: { status: 200 } },
  ] };
  const id = 'a2a173d7-b5f5-4f25-a89c-f43c057f7fac';
  const digest = createHash('sha256').update(JSON.stringify(suite)).digest('hex');
  const candidate = { id, status: 'approved', digest, suite };
  const run = {
    scope: [`Approved API suite: ${id} (SHA-256 ${digest})`],
    limitations: ['POST/PUT/PATCH/DELETE requests are blocked unless --allow-mutations is explicitly supplied.'],
    results: [
      { caseId: 'customer-read', status },
      { caseId: 'submit-check', status: 'blocked' },
    ],
  };
  const documentCases = [
    { id: 'doc-customer', title: 'Customer classification', requirementRefs: ['REQ-1'] },
    { id: 'doc-submit', title: 'Submit guard', requirementRefs: ['REQ-2'] },
    { id: 'doc-ui', title: 'Visible UI message', selectedForRegression: false },
  ];
  const mapping = [
    { documentCaseId: 'doc-customer', apiCaseIds: ['customer-read'] },
    { documentCaseId: 'doc-submit', apiCaseIds: ['submit-check'] },
  ];
  return { candidate, run, documentCases, mapping };
}

test('maps approved API evidence only through explicit source-to-API mappings', () => {
  const results = mapApprovedApiRunToDocumentCases(fixture());
  assert.deepEqual(results.map(({ id, status }) => [id, status]), [
    ['doc-customer', 'passed'], ['doc-submit', 'blocked'],
  ]);
});

test('does not claim a document case passed when it has no explicit mapping or API evidence', () => {
  const input = fixture();
  input.mapping = input.mapping.slice(0, 1);
  const results = mapApprovedApiRunToDocumentCases(input);
  assert.equal(results[1].status, 'blocked');
  assert.match(results[1].detail, /No explicit approved API case mapping/);
});

test('rejects draft, tampered, foreign-run and unknown-case mappings', () => {
  const input = fixture();
  input.candidate.status = 'draft';
  assert.throws(() => mapApprovedApiRunToDocumentCases(input), /approved API suite/);

  const tampered = fixture();
  tampered.candidate.suite.name = 'changed after review';
  assert.throws(() => mapApprovedApiRunToDocumentCases(tampered), /digest/);

  const foreign = fixture();
  foreign.run.scope = [];
  assert.throws(() => mapApprovedApiRunToDocumentCases(foreign), /does not belong/);

  const unknown = fixture();
  unknown.mapping[0].apiCaseIds = ['guessed-endpoint'];
  assert.throws(() => mapApprovedApiRunToDocumentCases(unknown), /approved API suite/);
});

test('failed API assertions stay failed in the document lane', () => {
  const input = fixture('failed');
  assert.equal(mapApprovedApiRunToDocumentCases(input)[0].status, 'failed');
});

test('document API lane invokes the approved runner and preserves each mapped API outcome', async () => {
  const input = fixture();
  let calls = 0;
  const lane = await executeDocumentApiLane({
    candidate: input.candidate,
    documentCases: input.documentCases.slice(0, 2),
    mapping: input.mapping,
    runApproved: async (candidateId, options) => {
      calls++;
      assert.equal(candidateId, input.candidate.id);
      assert.deepEqual(options, { allowNetwork: false, allowMutations: false, allowConcurrency: false, selectedCaseIds: ['customer-read', 'submit-check'] });
      return { record: input.run };
    },
  });
  assert.equal(calls, 1);
  assert.equal(lane.results[0].status, 'passed');
  assert.equal(lane.results[1].status, 'blocked');
  assert.match(lane.summary, /1 通过、0 失败、1 阻塞/);
  assert.deepEqual(lane.scope, input.run.scope);
  assert.deepEqual(lane.limitations, input.run.limitations);
});

test('executes only API cases mapped to selected document cases while validating the complete project mapping', async () => {
  const input = fixture();
  const selectedCases = input.documentCases.slice(0, 2).map(item => ({ ...item, selectedForRegression: item.id === 'doc-customer' }));
  const run = { ...input.run, results: input.run.results.filter(item => item.caseId === 'customer-read') };
  let selectedApiCaseIds;
  const lane = await executeDocumentApiLane({
    candidate: input.candidate,
    documentCases: selectedCases,
    mapping: input.mapping,
    runApproved: async (_candidateId, options) => {
      selectedApiCaseIds = options.selectedCaseIds;
      return { record: run };
    },
  });

  assert.deepEqual(selectedApiCaseIds, ['customer-read'], 'unselected mapped API cases must not be sent');
  assert.deepEqual(lane.results.map(item => [item.id, item.status, item.apiCaseResults.map(result => result.caseId)]), [
    ['doc-customer', 'passed', ['customer-read']],
  ]);
});

test('document API orchestration blocks missing mappings and delegates write gates to the approved runner', async () => {
  const missing = fixture();
  missing.mapping = missing.mapping.slice(0, 1);
  let calls = 0;
  const missingLane = await executeDocumentApiLane({
    candidate: missing.candidate,
    documentCases: missing.documentCases.slice(0, 2),
    mapping: missing.mapping,
    runApproved: async () => { calls++; return { record: missing.run }; },
  });
  assert.equal(calls, 0);
  assert.ok(missingLane.results.every(result => result.status === 'blocked'));
  assert.match(missingLane.results[0].detail, /缺少文档用例到 API case 的显式映射/);

  const authorized = fixture();
  authorized.candidate.suite.fixtures = { setup: [{ id: 'create-run-fixture', title: 'Create run fixture', request: { method: 'POST', path: '/fixtures', body: { runId: '${RUN_ID}' } }, expect: { status: 201 } }], cleanup: [{ id: 'delete-run-fixture', title: 'Delete run fixture', request: { method: 'DELETE', path: '/fixtures/${RUN_ID}' }, expect: { status: 204 } }] };
  authorized.candidate.suite.principals = { reader: { headers: { authorization: '${ENV:API_READER_TOKEN}' } }, guest: {} };
  authorized.candidate.suite.cases[0].accessControl = { principals: ['reader', 'guest'], expectByPrincipal: { reader: { status: 200 }, guest: { status: 401 } } };
  authorized.candidate.suite.cases[1].concurrency = 2;
  authorized.candidate.digest = createHash('sha256').update(JSON.stringify(authorized.candidate.suite)).digest('hex');
  authorized.run.scope = [`Approved API suite: ${authorized.candidate.id} (SHA-256 ${authorized.candidate.digest})`];
  const authorizedOptions = [];
  const authorizedLane = await executeDocumentApiLane({
    candidate: authorized.candidate,
    documentCases: authorized.documentCases.slice(0, 2),
    mapping: authorized.mapping,
    allowMutations: true,
    allowConcurrency: true,
    runApproved: async (_id, options) => { authorizedOptions.push(options); return { record: authorized.run }; },
  });
  assert.deepEqual(authorizedOptions, [{ allowNetwork: false, allowMutations: true, allowConcurrency: true, selectedCaseIds: ['customer-read', 'submit-check'] }]);
  assert.equal(authorizedLane.results[0].status, 'passed');

  const lifecycleFailure = fixture();
  lifecycleFailure.run.results.push({ caseId: 'fixture-cleanup-delete', title: '[fixture cleanup] Delete run fixture', status: 'error' });
  const lifecycleLane = await executeDocumentApiLane({
    candidate: lifecycleFailure.candidate,
    documentCases: lifecycleFailure.documentCases.slice(0, 2),
    mapping: lifecycleFailure.mapping,
    runApproved: async () => ({ record: lifecycleFailure.run }),
  });
  assert.equal(lifecycleLane.results[0].status, 'blocked', 'a passing case cannot hide failed cleanup');
  assert.match(lifecycleLane.results[0].detail, /cleanup未全部通过/);
});
