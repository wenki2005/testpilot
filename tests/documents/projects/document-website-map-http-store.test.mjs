import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { createDocumentWebsiteMapStore } from '../../../src/storage/document-projects/website-map-store.ts';
import { handleDocumentWebsiteMapRoutes } from '../../../src/interfaces/http/document-projects/website-map-routes.ts';

test('website maps survive a store restart, stay scoped to project, and reject unsafe artifact IDs', async t => {
  const root = path.resolve('test-artifacts'); await mkdir(root, { recursive: true });
  const directory = path.join(root, `a01-store-${randomUUID()}`);
  t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), root); await rm(directory, { recursive: true, force: true }); });
  const map = { id: randomUUID(), projectId: 'p', createdAt: new Date().toISOString(), pages: [], edges: [], state: 'partial', notices: ['interrupted'] };
  await createDocumentWebsiteMapStore(directory).save(map);
  const restarted = createDocumentWebsiteMapStore(directory);
  assert.deepEqual(await restarted.latest('p'), map); assert.equal(await restarted.latest('other-project'), undefined);
  assert.equal(await restarted.get('../outside'), undefined);
  await assert.rejects(restarted.save({ ...map, id: '../outside' }), /ID/u);
});

test('website discovery HTTP rejects caller targets and actions; replay is limited to a saved page ID', async t => {
  const calls = [];
  const service = { latest: async () => null, start: async id => { calls.push(['start', id]); return { id: randomUUID(), state: 'running' }; }, verifyPage: async (...args) => { calls.push(['verify', ...args]); return { status: 'verified' }; }, resolveCase:async(...args)=>{calls.push(['resolve',...args]);return {status:'verified'};} };
  const server = createServer(async (req, res) => { if (!await handleDocumentWebsiteMapRoutes(req, res, new URL(req.url, 'http://localhost').pathname, service, () => true)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/document-projects/p/website-map`;
  const post = (suffix, body) => fetch(url + suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('', { targetUrl: 'https://other.test/' })).status, 400); assert.equal(calls.length, 0);
  assert.equal((await post('', {})).status, 202); assert.deepEqual(calls[0], ['start', 'p']);
  const id = randomUUID();
  assert.equal((await post(`/pages/${id}/verify`, { steps: [{ action: 'delete' }] })).status, 400);
  assert.equal((await post(`/pages/${id}/verify`, {})).status, 200); assert.deepEqual(calls[1], ['verify', 'p', id]);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  assert.equal((await post('/cases/case-53/resolve',{targetUrl:'https://other.test'})).status,400);
  assert.equal((await post('/cases/case-53/resolve',{})).status,200);assert.deepEqual(calls.at(-1),['resolve','p','case-53']);
});
