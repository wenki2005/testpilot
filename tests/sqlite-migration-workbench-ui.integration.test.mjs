import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { strToU8, zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

test('workbench reviews and runs a SQLite migration suite without approving stale edits', { timeout: 30_000 }, async t => {
  const port = await reservePort(); const base = `http://127.0.0.1:${port}`;
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: resolve(root, 'artifacts', 'sqlite-migration-ui', String(Date.now())), TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; demo.stdout.on('data', chunk => { log += chunk.toString(); }); demo.stderr.on('data', chunk => { log += chunk.toString(); });
  let browser;
  t.after(async () => { if (browser) await browser.close(); if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited.catch(() => undefined); } });
  for (let i = 0; i < 100; i++) { if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${log}`); try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} if (i === 99) throw new Error(`Demo server did not start: ${log}`); await delay(100); }

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('button', { name: '数据库迁移测试' }).click();
  await page.getByRole('heading', { name: '数据库迁移测试' }).waitFor();
  await page.getByLabel('套件定义 JSON').fill(JSON.stringify({ version: 1, name: 'Workbench SQLite suite', migrations: [{ id: '001-create-example', file: 'migrations/001-create-example.sql' }], scenarios: [{ id: 'create-example-table', title: 'Create the expected table', migrations: ['001-create-example'], checks: [{ id: 'table-exists', title: 'Table exists', query: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sample_records'", expectedRows: [{ name: 'sample_records' }] }] }] }, null, 2));
  await page.getByLabel('SQL 文件 JSON').fill(JSON.stringify({ 'migrations/001-create-example.sql': 'CREATE TABLE sample_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL);' }, null, 2));
  await page.getByRole('button', { name: '保存草稿' }).click();
  await page.locator('.sqlite-state-line').getByText('待审核 · v1').waitFor();
  const approve = page.getByRole('button', { name: '批准套件' });
  assert.equal(await approve.isEnabled(), true);
  const savedSuiteText = await page.getByLabel('套件定义 JSON').inputValue();
  await page.getByLabel('套件定义 JSON').fill(JSON.stringify({ version: 1, name: 'Edited but not saved' }));
  assert.equal(await approve.isEnabled(), false, 'approval must not silently approve the previously saved version');
  await page.getByLabel('套件定义 JSON').fill(savedSuiteText);
  await page.getByRole('button', { name: '批准套件' }).click();
  await page.getByRole('button', { name: '运行迁移测试' }).waitFor();
  const runResponse = page.waitForResponse(response => /\/api\/sqlite-migration-suites\/.+\/run$/.test(response.url()));
  await page.getByRole('button', { name: '运行迁移测试' }).click();
  const run = await (await runResponse).json();
  assert.equal(run.status, 'passed');
  await page.getByRole('heading', { name: '运行结果：通过' }).waitFor();
  await page.getByRole('link', { name: '下载报告' }).waitFor();
  const packageLink = page.getByRole('link', { name: '下载脚本包' });
  await packageLink.waitFor();
  const packageUrl = new URL(await packageLink.getAttribute('href'), base).href;
  const packageBytes = Buffer.from(await (await fetch(packageUrl)).arrayBuffer());
  await page.getByLabel('导入 SQLite 脚本 ZIP').setInputFiles({ name: 'testpilot-sqlite-suite.zip', mimeType: 'application/zip', buffer: packageBytes });
  await page.getByRole('status').filter({ hasText: '脚本包已导入为新草稿' }).waitFor();
  assert.equal(JSON.parse(await page.getByLabel('套件定义 JSON').inputValue()).name, 'Workbench SQLite suite');
  assert.equal(JSON.parse(await page.getByLabel('SQL 文件 JSON').inputValue())['migrations/001-create-example.sql'], 'CREATE TABLE sample_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
  const traversalZip = zipSync({ 'suite-sources/suite.json': strToU8('{}'), 'suite-sources/../escape.sql': strToU8('SELECT 1;') });
  await page.getByLabel('导入 SQLite 脚本 ZIP').setInputFiles({ name: 'unsafe.zip', mimeType: 'application/zip', buffer: Buffer.from(traversalZip) });
  await page.getByRole('alert').filter({ hasText: '不安全的套件路径' }).waitFor();
  const oversizedSql = strToU8('x'.repeat(5 * 1024 * 1024 + 1));
  const oversizedZip = zipSync({ 'suite-sources/suite.json': strToU8('{}'), 'suite-sources/migrations/oversized.sql': oversizedSql });
  assert.ok(oversizedZip.byteLength < 10 * 1024 * 1024, 'the compressed bomb fixture stays under the archive upload limit');
  await page.getByLabel('导入 SQLite 脚本 ZIP').setInputFiles({ name: 'oversized.zip', mimeType: 'application/zip', buffer: Buffer.from(oversizedZip) });
  await page.getByRole('alert').filter({ hasText: '解压文件超过 5 MB' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const columns = await page.locator('.sqlite-editors').evaluate(element => getComputedStyle(element).gridTemplateColumns);
  assert.equal(columns.trim().split(/\s+/).length, 1, 'the editors stack on a narrow viewport');
});

async function reservePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
