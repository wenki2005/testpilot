import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('conflicting approved expectations require review without rewriting failures or proposing a rerun', { timeout: 25_000 }, async t => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'testpilot-expectations-'));
  const originalDataDir = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = testRoot;
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"code":401}');
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { target.close(resolve); target.closeAllConnections(); });
    if (originalDataDir === undefined) delete process.env.TESTPILOT_DATA_DIR; else process.env.TESTPILOT_DATA_DIR = originalDataDir;
    const resolved = await realpath(testRoot);
    assert.ok(resolved.startsWith(await realpath(os.tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  });
  const workflow = await import('../../dist/adapters/api/suite-workflow.js');
  const { conflictingReadOnlyExpectations } = await import('../../dist/adapters/api/expectation-review.js');
  const suite = {
    version: 1, name: 'Local conflicting anonymous expectations', baseUrl: `http://127.0.0.1:${target.address().port}`,
    cases: [
      { id: 'business-code', title: 'Existing transport convention', request: { method: 'GET', path: '/resource' }, expect: { status: 200, json: { code: 401 } } },
      { id: 'transport-code', title: 'Transport status policy', request: { method: 'GET', path: '/resource' }, expect: { status: 401 } },
    ],
  };
  const candidate = await workflow.createApiSuiteCandidate(suite);
  await workflow.reviewApiSuiteCandidate(candidate.id, 'approve', 'Local fixture, no external target');
  const executed = await workflow.executeApprovedApiSuite(candidate.id, {});
  assert.equal(executed.record.status, 'failed');
  assert.equal(executed.record.results.find(result => result.caseId === 'transport-code').status, 'failed');
  const store = await workflow.getApiFindingHistory(candidate.id);
  const finding = store.findings.find(item => item.caseId === 'transport-code');
  assert.ok(finding);
  const before = await readFile(executed.recordPath, 'utf8');
  const diagnosis = await workflow.diagnoseApiFinding(candidate.id, finding.findingId);
  assert.equal(diagnosis.classification, 'manual-review');
  assert.equal(diagnosis.recommendation.canRun, false);
  assert.match(diagnosis.summary, /business-code 预期 200/);
  assert.match(diagnosis.summary, /transport-code 预期 401/);
  assert.equal(await readFile(executed.recordPath, 'utf8'), before, 'diagnosis never rewrites the original failed run');
  assert.equal((await workflow.getApiSuiteCandidate(candidate.id)).digest, candidate.digest);

  await t.test('different identities are not treated as identical requests', () => {
    const roleSuite = structuredClone(suite);
    roleSuite.cases[0].request.headers = { Authorization: 'Bearer fixture-member' };
    roleSuite.cases[1].request.headers = { authorization: 'Bearer fixture-guest' };
    assert.deepEqual(conflictingReadOnlyExpectations(roleSuite, 'transport-code'), []);
    roleSuite.cases[1].request.headers = { authorization: 'Bearer fixture-member' };
    assert.equal(conflictingReadOnlyExpectations(roleSuite, 'transport-code').length, 2, 'header names are case insensitive');
  });
  await t.test('stateful and explicit role-matrix scenarios retain their own semantics', () => {
    const stateful = structuredClone(suite);
    stateful.cases.push({ id: 'change-state', title: 'State transition', request: { method: 'POST', path: '/resource' }, expect: { status: 201 } });
    assert.deepEqual(conflictingReadOnlyExpectations(stateful, 'transport-code'), []);
    const roleSuite = structuredClone(suite);
    roleSuite.cases[1].accessControl = { principals: ['guest'], expectByPrincipal: { guest: { status: 401 } } };
    assert.deepEqual(conflictingReadOnlyExpectations(roleSuite, 'transport-code'), []);
  });
  await t.test('consistent expectations still allow the ordinary failure diagnosis', async () => {
    const consistent = structuredClone(suite);
    consistent.cases[0].expect.status = 401;
    const next = await workflow.createApiSuiteCandidate(consistent);
    await workflow.reviewApiSuiteCandidate(next.id, 'approve', 'Local consistent fixture');
    await workflow.executeApprovedApiSuite(next.id, {});
    const history = await workflow.getApiFindingHistory(next.id);
    const ordinary = await workflow.diagnoseApiFinding(next.id, history.findings[0].findingId);
    assert.equal(ordinary.classification, 'assertion-failure');
    assert.equal(ordinary.recommendation.canRun, true);
  });
});
