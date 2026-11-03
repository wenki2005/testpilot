import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleMysqlRoutes } from '../src/interfaces/http/mysql-routes.ts';

async function withMysqlRoutes(dependencies, run) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleMysqlRoutes(req, res, url, dependencies).then(handled => {
      if (!handled && !res.headersSent) { res.writeHead(404); res.end(); }
    }).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function fakeDependencies(calls) {
  return {
    connect: async input => { calls.push(['connect', input]); return { connected: true }; },
    disconnect: async () => { calls.push(['disconnect']); },
    listColumns: async table => { calls.push(['columns', table]); return [{ name: 'id' }]; },
    listTables: async () => ['sample'],
    config: () => ({ readonly: true }),
    status: () => ({ connected: false, readonly: true }),
    readRows: async (table, offset, limit) => { calls.push(['rows', table, offset, limit]); return []; },
  };
}

test('MySQL read-only HTTP routes delegate through injected database capabilities', async () => {
  const calls = [];
  const dependencies = fakeDependencies(calls);
  await withMysqlRoutes(dependencies, async base => {
    const status = await fetch(`${base}/api/mysql/status`);
    assert.deepEqual(await status.json(), { connected: false, readonly: true });
    const columns = await fetch(`${base}/api/mysql/tables/sample/columns`);
    assert.deepEqual(await columns.json(), [{ name: 'id' }]);
    const rows = await fetch(`${base}/api/mysql/tables/sample/rows?offset=5&limit=10`);
    assert.deepEqual(await rows.json(), []);
    assert.deepEqual(calls, [['columns', 'sample'], ['rows', 'sample', 5, 10]]);
  });
});

test('MySQL connect validates the request and masks adapter failures that may contain credentials', async () => {
  const calls = [];
  const dependencies = fakeDependencies(calls);
  dependencies.connect = async input => { calls.push(['connect', input]); throw new Error('database rejected password super-secret'); };
  await withMysqlRoutes(dependencies, async base => {
    const invalid = await fetch(`${base}/api/mysql/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'qa', password: 'pw', extra: true }) });
    assert.equal(invalid.status, 400);
    const rejected = await fetch(`${base}/api/mysql/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'qa', password: 'super-secret' }) });
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).error, '无法连接测试库，请检查用户名、密码和网络；密码未保存。');
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'connect');
});

test('MySQL compatibility requires explicit TLS mode and rejects plaintext or global TLS overrides', async () => {
  const calls = [];
  await withMysqlRoutes(fakeDependencies(calls), async base => {
    const send = body => fetch(`${base}/api/mysql/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (const tlsMode of ['disabled', false, null, 'preferred']) {
      assert.equal((await send({ user: 'qa', password: 'pw', tlsMode })).status, 400);
    }
    assert.equal((await send({ user: 'qa', password: 'pw', rejectUnauthorized: false })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await send({ user: 'qa', password: 'pw', tlsMode: 'encrypted-unverified' })).status, 200);
    assert.deepEqual(calls, [['connect', { user: 'qa', password: 'pw', tlsMode: 'encrypted-unverified' }]]);
  });
});

test('MySQL strict TLS failure is returned without an automatic compatibility retry', async () => {
  const calls = [];
  const dependencies = fakeDependencies(calls);
  dependencies.connect = async input => { calls.push(input); throw new Error('MySQL TLS 证书无法验证；未建立连接。'); };
  await withMysqlRoutes(dependencies, async base => {
    const response = await fetch(`${base}/api/mysql/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'qa', password: 'pw' }) });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /TLS/);
    assert.deepEqual(calls, [{ user: 'qa', password: 'pw' }]);
  });
});
