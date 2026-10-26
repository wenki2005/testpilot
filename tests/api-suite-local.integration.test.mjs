import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadApiSuite } from '../dist/storage/api-suite-loader.js';
import { runApiSuite } from '../dist/adapters/api-test-adapter.js';

test('API suite loader and runner work against a local mock with auth and mutation safeguards', async t => {
  let gets = 0;
  let privateHits = 0;
  let mutations = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      gets++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/private') {
      privateHits++;
      const auth = req.headers.authorization;
      if (!auth) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthenticated' })); }
      else if (auth === 'Bearer member-local') { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'forbidden' })); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ permitted: true })); }
      return;
    }
    if (req.method === 'POST' || req.method === 'DELETE') mutations++;
    res.writeHead(404); res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = await mkdtemp(join(tmpdir(), 'testpilot-api-local-'));
  t.after(async () => {
    server.closeAllConnections?.();
    if (server.listening) await new Promise(done => server.close(done));
    await rm(dir, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const priorMember = process.env.TESTPILOT_LOCAL_MEMBER;
  const priorAdmin = process.env.TESTPILOT_LOCAL_ADMIN;
  process.env.TESTPILOT_LOCAL_MEMBER = 'Bearer member-local';
  process.env.TESTPILOT_LOCAL_ADMIN = 'Bearer admin-local';
  t.after(() => {
    if (priorMember === undefined) delete process.env.TESTPILOT_LOCAL_MEMBER; else process.env.TESTPILOT_LOCAL_MEMBER = priorMember;
    if (priorAdmin === undefined) delete process.env.TESTPILOT_LOCAL_ADMIN; else process.env.TESTPILOT_LOCAL_ADMIN = priorAdmin;
  });
  const suitePath = join(dir, 'suite.json');
  await writeFile(suitePath, JSON.stringify({
    version: 1, name: 'Local API fixture', baseUrl,
    principals: { guest: {}, member: { headers: { authorization: '${ENV:TESTPILOT_LOCAL_MEMBER}' } }, admin: { headers: { authorization: '${ENV:TESTPILOT_LOCAL_ADMIN}' } } },
    cases: [
      { id: 'health', title: 'health is ready', request: { method: 'GET', path: '/health' }, expect: { status: 200, json: { status: 'ok' } } },
      { id: 'roles', title: 'private access varies by role', request: { method: 'GET', path: '/private' }, expect: { status: 401 }, accessControl: { principals: ['guest', 'member', 'admin'], expectByPrincipal: { guest: { status: 401, json: { error: 'unauthenticated' } }, member: { status: 403, json: { error: 'forbidden' } }, admin: { status: 200, json: { permitted: true } } } } },
      { id: 'mutation', title: 'mutation remains blocked', request: { method: 'POST', path: '/items', body: { run: '${RUN_ID}' } }, expect: { status: 201 } },
    ],
    fixtures: { setup: [], cleanup: [{ id: 'cleanup', title: 'cleanup run item', request: { method: 'DELETE', path: '/items/${RUN_ID}' }, expect: { status: 204 } }] },
  }));
  const suite = await loadApiSuite(suitePath);
  const outputRoot = resolve(dir, 'runs');
  const { record } = await runApiSuite({ suite, outputRoot });
  assert.equal(record.results.find(item => item.caseId === 'health').status, 'passed');
  assert.equal(record.results.find(item => item.caseId === 'roles').status, 'passed', JSON.stringify(record.results.find(item => item.caseId === 'roles')));
  assert.match(JSON.stringify(record.results.find(item => item.caseId === 'roles')), /401/);
  assert.match(JSON.stringify(record.results.find(item => item.caseId === 'roles')), /403/);
  assert.equal(record.results.find(item => item.caseId === 'mutation').status, 'blocked');
  assert.equal(gets, 1);
  assert.equal(privateHits, 3);
  assert.equal(mutations, 0, 'POST and cleanup DELETE must not reach the server without opt-in');
});




