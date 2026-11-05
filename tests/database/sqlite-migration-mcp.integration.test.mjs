import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { strFromU8, unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('SQLite migration MCP tools enforce review and deliver reusable evidence', { timeout: 30_000 }, async t => {
  const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
  const environment = { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: resolve(root, 'artifacts', 'sqlite-migration-mcp', String(Date.now())), TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '' };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = ''; demo.stdout.on('data', chunk => { demoLog += chunk.toString(); }); demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  const mcp = spawn(process.execPath, ['dist/mcp/server.js'], { cwd: root, env: { ...environment, TESTPILOT_BASE_URL: base }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let mcpLog = ''; mcp.stderr.on('data', chunk => { mcpLog += chunk.toString(); });
  const rpc = createJsonRpcClient(mcp);
  t.after(async () => {
    if (mcp.exitCode === null) { const exited = once(mcp, 'exit'); mcp.kill(); await exited.catch(() => undefined); }
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); }
    demo.closeAllConnections?.();
  });
  for (let i = 0; i < 100; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (i === 99) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sqlite-migration-mcp-fixture', version: '1.0.0' } } });
  assert.ok(initialized.result?.serverInfo, mcpLog);
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const required = ['testpilot_prepare_sqlite_migration_test', 'testpilot_get_sqlite_migration_test', 'testpilot_update_sqlite_migration_test', 'testpilot_review_sqlite_migration_test', 'testpilot_run_approved_sqlite_migration_test', 'testpilot_export_sqlite_migration_run'];
  assert.ok(required.every(name => tools.result.tools.some(tool => tool.name === name)), 'the published MCP catalog contains each SQLite workflow stage');

  const suite = { version: 1, name: 'MCP SQLite workflow', migrations: [{ id: '001-create', file: 'migrations/001-create.sql' }], scenarios: [{ id: 'table-check', title: 'Migration creates a table', migrations: ['001-create'], checks: [{ id: 'table-present', title: 'Table present', query: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_records'", expectedRows: [{ name: 'mcp_records' }] }] }] };
  const files = { 'migrations/001-create.sql': 'CREATE TABLE mcp_records (id INTEGER PRIMARY KEY);' };
  const preparedTool = await callTool(rpc, 3, 'testpilot_prepare_sqlite_migration_test', { suiteJson: JSON.stringify(suite), files });
  assert.equal(preparedTool.isError, undefined, preparedTool.content?.[0]?.text);
  const prepared = JSON.parse(preparedTool.content[0].text);
  assert.equal(prepared.status, 'draft');

  const readTool = await callTool(rpc, 4, 'testpilot_get_sqlite_migration_test', { suiteId: prepared.suiteId });
  assert.equal(readTool.isError, undefined);
  assert.equal(JSON.parse(readTool.content[0].text).files['migrations/001-create.sql'], files['migrations/001-create.sql']);
  const prematureRun = await callTool(rpc, 5, 'testpilot_run_approved_sqlite_migration_test', { suiteId: prepared.suiteId });
  assert.equal(prematureRun.isError, true, 'MCP cannot run an unreviewed suite');

  const revisedSuite = { ...suite, name: 'MCP SQLite workflow revision' };
  const revisedTool = await callTool(rpc, 6, 'testpilot_update_sqlite_migration_test', { suiteId: prepared.suiteId, suiteJson: JSON.stringify(revisedSuite), files });
  assert.equal(revisedTool.isError, undefined, revisedTool.content?.[0]?.text);
  const revised = JSON.parse(revisedTool.content[0].text);
  assert.equal(revised.revision, 2);
  assert.notEqual(revised.digest, prepared.digest);

  const approved = await callTool(rpc, 7, 'testpilot_review_sqlite_migration_test', { suiteId: prepared.suiteId, decision: 'approve', notes: 'Fixture reviewed.' });
  assert.equal(approved.isError, undefined);
  const immutableEdit = await callTool(rpc, 8, 'testpilot_update_sqlite_migration_test', { suiteId: prepared.suiteId, suiteJson: JSON.stringify(suite), files });
  assert.equal(immutableEdit.isError, true, 'MCP cannot edit an approved suite');
  const runTool = await callTool(rpc, 9, 'testpilot_run_approved_sqlite_migration_test', { suiteId: prepared.suiteId });
  assert.equal(runTool.isError, undefined, runTool.content?.[0]?.text);
  const run = JSON.parse(runTool.content[0].text);
  assert.equal(run.status, 'passed');
  assert.deepEqual(run.counts, { passed: 1, failed: 0, blocked: 0, error: 0 });

  const exported = await callTool(rpc, 10, 'testpilot_export_sqlite_migration_run', { runId: run.runId });
  assert.equal(exported.isError, undefined, exported.content?.[0]?.text);
  const resource = exported.content.find(item => item.type === 'resource' && item.resource.uri === `testpilot://sqlite-migration-runs/${run.runId}/package.zip`);
  assert.ok(resource);
  const archive = unzipSync(Buffer.from(resource.resource.blob, 'base64'));
  assert.equal(JSON.parse(strFromU8(archive['suite-sources/suite.json'])).name, revisedSuite.name);
  assert.equal(strFromU8(archive['suite-sources/migrations/001-create.sql']), files['migrations/001-create.sql']);
  assert.equal(JSON.parse(strFromU8(archive['run.json'])).status, 'passed');
  assert.match(strFromU8(archive['README.md']), /Re-run without AI/);
  assert.match(strFromU8(archive['report.md']), /SQLite migration evidence/);
});

function callTool(rpc, id, name, args) { return rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }).then(message => message.result); }
function createJsonRpcClient(child) {
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    for (;;) { const newline = buffer.indexOf('\n'); if (newline < 0) break; const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1); if (!line) continue; const message = JSON.parse(line); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); } }
  });
  child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`MCP server exited (${code}).`)); pending.clear(); });
  return message => new Promise((resolveResponse, reject) => { const timer = setTimeout(() => { pending.delete(message.id); reject(new Error(`Timed out waiting for MCP response ${message.id}.`)); }, 10_000); pending.set(message.id, { resolve: resolveResponse, reject, timer }); child.stdin.write(`${JSON.stringify(message)}\n`); });
}
async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
