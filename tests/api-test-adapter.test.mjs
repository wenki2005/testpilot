import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('declarative HTTP API suites stay on target, record scrubbed evidence, and gate mutations', async t => {
  const dataDir = resolve(root, 'artifacts', 'api-adapter-fixture', String(Date.now()));
  const outputRoot = resolve(dataDir, 'runs');
  let posts = 0;
  let authSeen = false;
  let outsideHits = 0;
  let activeConcurrent = 0;
  let maxConcurrent = 0;
  let concurrentHits = 0;
  const roleHits = [];
  const fixtureIds = new Set();
  const createdItems = new Set();
  const outside = createServer((_req, res) => { outsideHits++; res.end('must not be reached'); });
  outside.listen(0, '127.0.0.1'); await once(outside, 'listening');
  const target = createServer(async (req, res) => {
    if (req.url === '/v1/leave') { res.writeHead(302, { location: `http://127.0.0.1:${outside.address().port}/steal` }); res.end(); return; }
    if (req.url === '/v1/health') {
      authSeen = req.headers.authorization === 'Bearer fixture-secret';
      res.writeHead(200, { 'content-type': 'application/json', 'x-service-mode': 'ready' });
      res.end(JSON.stringify({ status: 'ok', nested: { count: 3 }, apiToken: 'response-secret' })); return;
    }
    if (req.url === '/v1/private') {
      const authorization = req.headers.authorization ?? '';
      roleHits.push(authorization);
      if (!authorization) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthenticated' })); return; }
      if (authorization === 'Bearer member-fixture') { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); return; }
      if (authorization === 'Bearer admin-fixture') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ permitted: true, signingKey: 'server-private-key' })); return; }
      res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid' })); return;
    }
    if (req.url === '/v1/fixtures' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const id = JSON.parse(body).runId; fixtureIds.add(id);
      res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: true })); return;
    }
    if (req.url?.startsWith('/v1/fixtures/')) {
      const id = req.url.split('/').at(-1);
      if (req.method === 'GET') {
        if (fixtureIds.has(id)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id, isolated: true })); }
        else { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'missing' })); }
        return;
      }
      if (req.method === 'DELETE') { fixtureIds.delete(id); res.writeHead(204); res.end(); return; }
    }
    if (req.url === '/v1/concurrent') {
      concurrentHits++; activeConcurrent++; maxConcurrent = Math.max(maxConcurrent, activeConcurrent);
      await new Promise(done => setTimeout(done, 60));
      activeConcurrent--;
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ready: true })); return;
    }
    if (req.url === '/v1/items' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const parsed = JSON.parse(body); createdItems.add(parsed.id);
      posts++;
      res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ created: true })); return;
    }
    if (req.url?.startsWith('/v1/items/') && req.method === 'DELETE') { createdItems.delete(req.url.split('/').at(-1)); res.writeHead(204); res.end(); return; }
    if (req.url === '/v1/slow') { await new Promise(done => setTimeout(done, 250)); res.writeHead(200); res.end('late'); return; }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  t.after(() => { for (const server of [target, outside]) { server.closeAllConnections(); server.close(); } });
  process.env.TESTPILOT_API_TOKEN = 'fixture-secret';
  process.env.TESTPILOT_MEMBER_TOKEN = 'member-fixture';
  process.env.TESTPILOT_ADMIN_TOKEN = 'admin-fixture';
  const { loadApiSuite, calculateOpenApiCoverage } = await import('../dist/storage/api-suite-loader.js');
  const { runApiSuite } = await import('../dist/adapters/api-test-adapter.js');
  const targetBase = `http://127.0.0.1:${target.address().port}/v1/`;
  const runSuite = async (name, cases, options = {}, suiteExtra = {}) => {
    const filePath = resolve(dataDir, `${name}.json`);
    await mkdir(dataDir, { recursive: true });
    await writeFile(filePath, JSON.stringify({ version: 1, name, baseUrl: targetBase, ...suiteExtra, cases }));
    const suite = await loadApiSuite(filePath);
    return runApiSuite({ suite, outputRoot: resolve(outputRoot, name), ...options });
  };

  await t.test('GET assertions, environment-backed auth and evidence redaction', async () => {
    const { record, recordPath } = await runSuite('get-health', [{
      id: 'health', title: 'health payload and mode',
      source: '部门申样书需求文档 V1.0', requirementRefs: ['REQ-API-01', 'REQ-API-03'], priority: 'P1',
      request: { method: 'GET', path: '/v1/health', headers: { authorization: 'Bearer ${ENV:TESTPILOT_API_TOKEN}' } },
      expect: { status: 200, headers: { 'x-service-mode': 'ready' }, json: { status: 'ok', nested: { count: 3 } } },
    }]);
    assert.equal(record.status, 'passed');
    assert.equal(authSeen, true);
    const saved = await readFile(recordPath, 'utf8');
    assert.doesNotMatch(saved, /fixture-secret|response-secret/);
    assert.match(saved, /\[REDACTED\]/);
    assert.match(saved, /HTTP 200/);
    assert.deepEqual(record.results[0].designTrace, { source: '部门申样书需求文档 V1.0', requirementRefs: ['REQ-API-01', 'REQ-API-03'], priority: 'P1' });
    assert.match(JSON.parse(saved).results[0].assertion.expected, /\"status\":200/);
    const report = await readFile(recordPath.replace(/run\.json$/, 'report.md'), 'utf8');
    assert.match(report, /REQ-API-01, REQ-API-03/);
    assert.match(report, /部门申样书需求文档 V1\.0/);
    assert.match(report, /HTTP 200/);
  });

  await t.test('OpenAPI design targets are compared with observed statuses and no-response cases', async () => {
    const suite = {
      version: 1, name: 'Design versus observed fixture', baseUrl: targetBase,
      cases: [
        { id: 'design-404', title: 'contract success receives not found', source: 'OpenAPI: GET /notfound', requirementRefs: ['R-404'], request: { method: 'GET', path: '/v1/notfound' }, expect: { status: 200 } },
        { id: 'design-timeout', title: 'contract success times out', source: 'OpenAPI: GET /slow', requirementRefs: ['R-SLOW'], request: { method: 'GET', path: '/v1/slow', timeoutMs: 100 }, expect: { status: 200 } },
        { id: 'design-body-failure', title: 'status class matches but JSON contract fails', source: 'OpenAPI: GET /health', requirementRefs: ['R-BODY'], request: { method: 'GET', path: '/v1/health' }, expect: { status: 200, json: { status: 'wrong' } } },
      ],
    };
    const facts = [
      { key: 'GET /notfound', declaredStatuses: ['200', '404'], securityRequired: false, hasBoundaryConstraints: false },
      { key: 'GET /slow', declaredStatuses: ['200'], securityRequired: false, hasBoundaryConstraints: false },
      { key: 'GET /health', declaredStatuses: ['200'], securityRequired: false, hasBoundaryConstraints: false },
    ];
    suite.openApiCoverage = calculateOpenApiCoverage(suite, facts.map(item => item.key), facts);
    const { record, recordPath, packagePath } = await runApiSuite({ suite, outputRoot: resolve(outputRoot, 'design-observed') });
    const checks = record.apiDesignAssessment.checks;
    assert.deepEqual(checks.find(item => item.operationKey === 'GET /notfound' && item.category === 'success'), {
      category: 'success', operationKey: 'GET /notfound', label: 'Successful response', expectedResponse: '2xx', caseId: 'design-404', observedStatuses: [404], resultStatus: 'failed', status: 'mismatch',
    });
    assert.equal(checks.find(item => item.operationKey === 'GET /slow' && item.category === 'success')?.status, 'no-response');
    assert.equal(checks.find(item => item.operationKey === 'GET /health' && item.category === 'success')?.status, 'confirmed', 'HTTP status-class confirmation is separate from the failing JSON assertion');
    assert.equal(checks.find(item => item.operationKey === 'GET /health' && item.category === 'success')?.resultStatus, 'failed');
    assert.equal(checks.find(item => item.operationKey === 'GET /notfound' && item.category === 'error')?.status, 'not-authored');
    const report = await readFile(recordPath.replace(/run\.json$/, 'report.md'), 'utf8');
    assert.match(report, /OpenAPI design targets vs observed run/);
    assert.match(report, /HTTP 404/);
    assert.match(report, /no-response/);
    assert.match(report, /not-authored/);
    const { unzipSync, strFromU8 } = await import('fflate');
    const zippedRun = JSON.parse(strFromU8(unzipSync(await readFile(packagePath))['run.json']));
    assert.deepEqual(zippedRun.apiDesignAssessment, record.apiDesignAssessment, 'the reusable package must preserve the exact design-vs-observed findings');
  });

  await t.test('authorization and value-level boundary targets retain their own observed response outcome', async () => {
    const suite = {
      version: 1, name: 'Auth and boundary comparison', baseUrl: targetBase,
      cases: [
        { id: 'private-guest', title: 'guest receives denial', source: 'OpenAPI: GET /private', request: { method: 'GET', path: '/v1/private' }, expect: { status: 401, json: { error: 'unauthenticated' } } },
        { id: 'health-verbose', title: 'verbose enum value', source: 'OpenAPI: GET /health', request: { method: 'GET', path: '/v1/health?verbose=true' }, expect: { status: 200 } },
      ],
    };
    const facts = [
      { key: 'GET /private', declaredStatuses: ['200', '401', '403'], securityRequired: true, hasBoundaryConstraints: false },
      { key: 'GET /health', declaredStatuses: ['200', '404'], securityRequired: false, hasBoundaryConstraints: true, boundaryRequirements: [{ id: 'GET /health:query:verbose:enum-1', label: 'query parameter verbose enum value true', locator: { in: 'query', name: 'verbose' }, value: true, expectedStatus: 'success' }] },
    ];
    suite.openApiCoverage = calculateOpenApiCoverage(suite, facts.map(item => item.key), facts);
    const { record } = await runApiSuite({ suite, outputRoot: resolve(outputRoot, 'auth-boundary-observed') });
    const checks = record.apiDesignAssessment.checks;
    assert.equal(checks.find(item => item.category === 'authorization' && item.operationKey === 'GET /private')?.status, 'confirmed');
    assert.equal(checks.find(item => item.category === 'authorization' && item.operationKey === 'GET /private')?.observedStatuses.join(','), '401');
    assert.equal(checks.find(item => item.category === 'boundary' && item.requirementId === facts[1].boundaryRequirements[0].id)?.status, 'mismatch');
    assert.deepEqual(checks.find(item => item.category === 'boundary' && item.requirementId === facts[1].boundaryRequirements[0].id)?.observedStatuses, [404]);
  });

  await t.test('run-api CLI entry point executes a saved suite and writes artifacts', async () => {
    const suitePath = resolve(dataDir, 'cli-suite.json');
    await writeFile(suitePath, JSON.stringify({ version: 1, name: 'CLI API fixture', cases: [{ id: 'health-cli', title: 'CLI health check', request: { method: 'GET', path: '/v1/health' }, expect: { status: 200 } }] }));
    const child = spawn(process.execPath, ['dist/cli.js', 'run-api', '--suite', suitePath, '--base-url', targetBase, '--out', resolve(dataDir, 'cli-runs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, output);
    assert.match(output, /PASSED — CLI API fixture/);
    const jsonFiles = await (await import('node:fs/promises')).readdir(resolve(dataDir, 'cli-runs'));
    assert.equal(jsonFiles.length, 1);
  });

  await t.test('access-control matrix checks guest, member and admin expectations without leaking credentials', async () => {
    const suiteExtra = { principals: {
      guest: { headers: {} },
      member: { headers: { authorization: 'Bearer ${ENV:TESTPILOT_MEMBER_TOKEN}' } },
      admin: { headers: { authorization: 'Bearer ${ENV:TESTPILOT_ADMIN_TOKEN}' } },
    } };
    const caseDefinition = {
      id: 'private-resource', title: 'private resource role permissions',
      request: { method: 'GET', path: '/v1/private' },
      expect: { status: 401 },
      accessControl: {
        principals: ['guest', 'member', 'admin'],
        expectByPrincipal: {
          guest: { status: 401, json: { error: 'unauthenticated' } },
          member: { status: 403, json: { error: 'forbidden' } },
          admin: { status: 200, json: { permitted: true } },
        },
      },
    };
    const { record, recordPath } = await runSuite('role-matrix', [caseDefinition], {}, suiteExtra);
    assert.equal(record.status, 'passed');
    assert.equal(record.results.length, 1, 'a role matrix is one traceable test case');
    assert.deepEqual(roleHits.slice(-3), ['', 'Bearer member-fixture', 'Bearer admin-fixture']);
    const saved = await readFile(recordPath, 'utf8');
    assert.doesNotMatch(saved, /member-fixture|admin-fixture|server-private-key/);
    assert.match(saved, /guest:.*401/);
    assert.match(saved, /member:.*403/);
    assert.match(saved, /admin:.*200/);
  });

  await t.test('mutations are blocked by default and run only with explicit opt-in', async () => {
    const item = { id: 'create', title: 'create fixture item', request: { method: 'POST', path: '/v1/items', body: { id: '${RUN_ID}', label: 'synthetic' } }, expect: { status: 201, json: { created: true } } };
    const lifecycle = { fixtures: { setup: [], cleanup: [{ id: 'remove-created', title: 'remove created item', request: { method: 'DELETE', path: '/v1/items/${RUN_ID}' }, expect: { status: 204 } }] } };
    const denied = await runSuite('post-denied', [item], {}, lifecycle);
    assert.equal(denied.record.status, 'blocked');
    assert.equal(denied.record.results[0].status, 'blocked');
    assert.equal(posts, 0, 'a blocked mutation must not reach the target');
    const allowed = await runSuite('post-opt-in', [item], { allowMutations: true }, lifecycle);
    assert.equal(allowed.record.status, 'passed');
    assert.equal(posts, 1);
    assert.equal(createdItems.size, 0, 'explicit cleanup must remove the run-scoped mutation');
  });

  await t.test('concurrent batches have a separate opt-in and verify simultaneous overlap', async () => {
    const load = { id: 'parallel-health', title: 'parallel health check', concurrency: 8, request: { method: 'GET', path: '/v1/concurrent' }, expect: { status: 200, json: { ready: true } } };
    const denied = await runSuite('parallel-denied', [load]);
    assert.equal(denied.record.status, 'blocked');
    assert.equal(concurrentHits, 0, 'default blocked concurrent checks must not reach the target');
    const allowed = await runSuite('parallel-allowed', [load], { allowConcurrency: true });
    assert.equal(allowed.record.status, 'passed');
    assert.match(allowed.record.results[0].title, /8 concurrent requests/);
    assert.ok(maxConcurrent > 1, `requests should overlap, observed ${maxConcurrent}`);
    assert.equal(concurrentHits, 8);
  });

  await t.test('run-scoped fixture is created and always cleaned after checks, including failures', async () => {
    const fixtures = {
      setup: [{ id: 'seed-run', title: 'seed isolated record', request: { method: 'POST', path: '/v1/fixtures', body: { runId: '${RUN_ID}' } }, expect: { status: 201, json: { created: true } } }],
      cleanup: [{ id: 'clean-run', title: 'delete isolated record', request: { method: 'DELETE', path: '/v1/fixtures/${RUN_ID}' }, expect: { status: 204 } }],
    };
    const isolatedCase = { id: 'read-run', title: 'read isolated record', request: { method: 'GET', path: '/v1/fixtures/${RUN_ID}' }, expect: { status: 200, json: { isolated: true } } };
    const blocked = await runSuite('fixture-blocked', [isolatedCase], {}, { fixtures });
    assert.equal(blocked.record.status, 'blocked');
    assert.equal(fixtureIds.size, 0, 'setup and cleanup mutations are not sent without opt-in');
    assert.match(blocked.record.results[0].title, /fixture setup/);

    const passed = await runSuite('fixture-pass', [isolatedCase], { allowMutations: true }, { fixtures });
    assert.equal(passed.record.status, 'passed');
    assert.deepEqual(passed.record.results.map(item => item.status), ['passed', 'passed', 'passed']);
    assert.equal(fixtureIds.size, 0, 'fixture cleanup removes run-scoped test data');
    const extraCase = { id: 'unselected-health', title: 'unselected health case', request: { method: 'GET', path: '/v1/health' }, expect: { status: 200 } };
    const targeted = await runSuite('fixture-targeted-rerun', [isolatedCase, extraCase], { allowMutations: true, caseIds: ['read-run'], rerunOf: '123e4567-e89b-42d3-a456-426614174000' }, { fixtures });
    assert.deepEqual(targeted.record.results.map(item => item.caseId), ['seed-run', 'read-run', 'clean-run'], 'setup and cleanup still surround the selected case, while unrelated cases are omitted');
    assert.deepEqual(targeted.record.apiRerun, { parentRunId: '123e4567-e89b-42d3-a456-426614174000', caseIds: ['read-run'] });
    assert.match(targeted.record.scope.join('\n'), /Executed API cases: 1\/2 \(selected read-run\)/);
    assert.equal(fixtureIds.size, 0, 'targeted rerun preserves run-scoped cleanup');
    await assert.rejects(() => runSuite('fixture-invalid-rerun', [isolatedCase], { allowMutations: true, caseIds: ['clean-run'], rerunOf: '123e4567-e89b-42d3-a456-426614174000' }, { fixtures }), /only case IDs from the approved suite/);
    assert.equal(fixtureIds.size, 0, 'invalid selections fail before setup can mutate target data');
    const failing = await runSuite('fixture-failing-case', [{ ...isolatedCase, expect: { status: 200, json: { doesNotExist: true } } }], { allowMutations: true }, { fixtures });
    assert.equal(failing.record.status, 'failed');
    assert.equal(failing.record.results.at(-1).title, '[fixture cleanup] delete isolated record');
    assert.equal(fixtureIds.size, 0, 'cleanup still runs after an assertion failure');
    const cleanupFailure = await runSuite('fixture-cleanup-failure', [isolatedCase], { allowMutations: true }, { fixtures: { ...fixtures, cleanup: [{ ...fixtures.cleanup[0], expect: { status: 200 } }] } });
    assert.equal(cleanupFailure.record.status, 'failed');
    assert.equal(cleanupFailure.record.results.at(-1).status, 'failed', 'cleanup failure must remain visible rather than be swallowed');
    assert.equal(fixtureIds.size, 0, 'the fixture endpoint still removed the record even though the assertion was wrong');
  });

  await t.test('target-prefix escape and redirects never send traffic to another origin', async () => {
    const { record } = await runSuite('redirect', [{ id: 'redirect', title: 'redirect should be exposed', request: { method: 'GET', path: '/v1/leave' }, expect: { status: 200 } }]);
    assert.equal(record.results[0].assertion.actual, 'HTTP 302', 'redirect is returned as a response and not followed');
    assert.equal(outsideHits, 0);
    const escaped = await runSuite('prefix-escape', [
      { id: 'escape', title: 'escape configured prefix', request: { method: 'GET', path: '/outside' }, expect: { status: 200 } },
      { id: 'bug', title: 'valid request reveals status mismatch', request: { method: 'GET', path: '/v1/health' }, expect: { status: 201 } },
    ]);
    assert.equal(escaped.record.results[0].status, 'blocked');
    assert.equal(escaped.record.results[1].status, 'failed');
    assert.equal(escaped.record.status, 'failed', 'a blocked check must not hide a detected product failure');
  });

  await t.test('status and timeout mismatches are distinguishable from transport errors', async () => {
    const { record } = await runSuite('assertion-failure', [
      { id: 'wrong-status', title: 'wrong status is assertion failure', request: { method: 'GET', path: '/v1/health' }, expect: { status: 201 } },
      { id: 'slow', title: 'request timeout', request: { method: 'GET', path: '/v1/slow', timeoutMs: 100 }, expect: { status: 200 } },
    ]);
    assert.equal(record.status, 'failed');
    assert.equal(record.results[0].status, 'failed');
    assert.equal(record.results[1].status, 'failed');
    assert.ok(record.results[1].evidence.some(item => item.kind === 'timeout'));
  });

  await t.test('suite validation rejects external paths, duplicate IDs and malformed base URLs', async () => {
    const filePath = resolve(dataDir, 'invalid.json');
    const invalidPath = { version: 1, name: 'invalid', cases: [{ id: 'x', title: 'x', request: { method: 'GET', path: '//evil.invalid' }, expect: { status: 200 } }] };
    await writeFile(filePath, JSON.stringify(invalidPath));
    await assert.rejects(loadApiSuite(filePath), /origin-relative/);
    const duplicate = { version: 1, name: 'duplicate', cases: ['a', 'b'].map(id => ({ id, title: id, request: { method: 'GET', path: '/' }, expect: { status: 200 } })).map(item => ({ ...item, id: 'same' })) };
    await writeFile(filePath, JSON.stringify(duplicate));
    await assert.rejects(loadApiSuite(filePath), /Duplicate API case ID/);
    const external = await loadApiSuite(await writeSuite(filePath, { version: 1, name: 'external', baseUrl: 'https://example.invalid', cases: [] }));
    await assert.rejects(runApiSuite({ suite: external, outputRoot }), /--allow-network/);
    await writeFile(filePath, JSON.stringify({ version: 1, name: 'too much concurrency', cases: [{ id: 'x', title: 'x', concurrency: 51, request: { method: 'GET', path: '/' }, expect: { status: 200 } }] }));
    await assert.rejects(loadApiSuite(filePath), /concurrency must be 1–50/);
    await writeFile(filePath, JSON.stringify({ version: 1, name: 'inline credential', principals: { admin: { headers: { authorization: 'Bearer never-store-this' } } }, cases: [] }));
    await assert.rejects(loadApiSuite(filePath), /must use a \$\{ENV:VARIABLE_NAME\} reference/);
    await writeFile(filePath, JSON.stringify({ version: 1, name: 'broken matrix', principals: { guest: {}, admin: {} }, cases: [{ id: 'x', title: 'x', request: { method: 'GET', path: '/' }, expect: { status: 200 }, accessControl: { principals: ['guest', 'admin'], expectByPrincipal: { guest: { status: 401 } } } }] }));
    await assert.rejects(loadApiSuite(filePath), /exactly one expectation for every principal/);
    await writeFile(filePath, JSON.stringify({ version: 1, name: 'unisolated mutation', cases: [{ id: 'x', title: 'x', request: { method: 'POST', path: '/items', body: { name: 'x' } }, expect: { status: 201 } }] }));
    await assert.rejects(loadApiSuite(filePath), /Mutating API cases require explicit fixtures.cleanup/);
  });
});

async function writeSuite(path, value) { await writeFile(path, JSON.stringify(value)); return path; }
