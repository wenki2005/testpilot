import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { unzipSync } from 'fflate';
import { loadSqliteMigrationSuite } from '../dist/storage/sqlite-migration-suite.js';
import { runSqliteMigrationSuite } from '../dist/adapters/sqlite-migration-adapter.js';

const root = resolve(import.meta.dirname, '..');

test('SQLite migration runner isolates each scenario, rolls back failed SQL and packages immutable source evidence', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'testpilot-sqlite-suite-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = resolve(root, 'examples', 'migrations', 'demo-hub-sqlite');
  await cp(source, join(temp, 'suite'), { recursive: true });
  const suitePath = join(temp, 'suite', 'suite.json');
  const suite = await loadSqliteMigrationSuite(suitePath);
  const result = await runSqliteMigrationSuite({ suite, suitePath, projectRoot: join(temp, 'suite'), outputRoot: join(temp, 'runs') });
  assert.equal(result.record.status, 'passed');
  assert.deepEqual(result.record.results.map(item => item.status), ['passed', 'passed']);
  const failureEvidence = result.record.results[1].evidence.map(item => item.content).join('\n');
  assert.match(failureEvidence, /rolled back to its savepoint/);
  assert.match(failureEvidence, /no-partial-table:.*expected \[\]; actual \[\]/);
  assert.match(result.record.sqliteMigration.suiteDigest, /^[a-f0-9]{64}$/);
  assert.match(result.record.sqliteMigration.sqliteVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(result.record.sqliteMigration.scenarios[0].checks[0].status, 'passed');
  assert.deepEqual(result.record.sqliteMigration.scenarios[0].checks[0].actualRows, [{ name: 'Ada', status: 'active' }, { name: 'Lin', status: 'legacy' }]);
  assert.equal(result.record.sqliteMigration.scenarios[1].migrationEvents[0].status, 'expected-failure-rolled-back');
  const archive = unzipSync(await readFile(result.packagePath));
  assert.ok(archive['suite-sources/suite.json']);
  assert.ok(archive['suite-sources/migrations/002-partial-invalid.sql']);
  assert.ok(archive['report.md']);
  const packagedRun = JSON.parse(Buffer.from(archive['run.json']).toString('utf8'));
  assert.equal(packagedRun.runId, result.record.runId);
  assert.equal(packagedRun.sqliteMigration.suiteDigest, result.record.sqliteMigration.suiteDigest);
  assert.match(Buffer.from(archive['report.md']).toString('utf8'), /SQLite migration evidence/);
  const readme = Buffer.from(archive['README.md']).toString('utf8');
  assert.match(readme, /Re-run without AI/);
  assert.match(readme, /npm run dev -- run-migrations --suite artifacts\/imported-migrations\/suite-sources\/suite\.json --project-root artifacts\/imported-migrations\/suite-sources/);
  assert.equal(await readFile(result.recordPath, 'utf8').then(text => JSON.parse(text).status), 'passed');
  const replayRoot = join(temp, 'replay');
  for (const [archivePath, contents] of Object.entries(archive)) {
    if (!archivePath.startsWith('suite-sources/')) continue;
    const destination = join(replayRoot, archivePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  const replayOutput = join(temp, 'replay-runs');
  const cliOutput = execFileSync(process.execPath, [resolve(root, 'dist', 'cli.js'), 'run-migrations', '--suite', join(replayRoot, 'suite-sources', 'suite.json'), '--project-root', join(replayRoot, 'suite-sources'), '--out', replayOutput], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.match(cliOutput, /PASSED — Demo Hub sample SQLite migration verification/);
  assert.match(cliOutput, /Scenarios: 2 passed \/ 2 total/);
});

test('SQLite migration runner blocks ATTACH and rejects suite path traversal', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'testpilot-sqlite-refusal-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, 'project');
  const migrationDir = join(projectRoot, 'migrations');
  await mkdir(migrationDir, { recursive: true });
  const suitePath = join(projectRoot, 'suite.json');
  await writeFile(join(migrationDir, 'bad.sql'), "ATTACH DATABASE 'outside.db' AS outside_db;", 'utf8');
  const suiteData = {
    version: 1,
    name: 'Refusal fixture',
    migrations: [{ id: 'bad-attach', file: 'migrations/bad.sql' }],
    scenarios: [{ id: 'blocked-attach', title: 'Reject external database attachment', migrations: ['bad-attach'], checks: [{ id: 'still-empty', title: 'Empty database remains queryable', query: 'SELECT name FROM sqlite_master ORDER BY name', expectedRows: [] }] }],
  };
  await writeFile(suitePath, JSON.stringify(suiteData), 'utf8');
  const suite = await loadSqliteMigrationSuite(suitePath);
  const result = await runSqliteMigrationSuite({ suite, suitePath, projectRoot, outputRoot: join(temp, 'runs') });
  assert.equal(result.record.status, 'failed');
  assert.match(result.record.results[0].evidence[0].content, /unsupported SQLite command ATTACH/);
  await writeFile(suitePath, JSON.stringify({ ...suiteData, migrations: [{ id: 'bad-attach', file: '../outside.sql' }] }), 'utf8');
  await assert.rejects(loadSqliteMigrationSuite(suitePath), /Invalid migration at index 0/);
});

test('SQLite migration runner terminates an unbounded query and reports it as blocked', { timeout: 20000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'testpilot-sqlite-timeout-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, 'project');
  const migrationDir = join(projectRoot, 'migrations');
  await mkdir(migrationDir, { recursive: true });
  const suitePath = join(projectRoot, 'suite.json');
  await writeFile(join(migrationDir, 'noop.sql'), 'CREATE TABLE marker (id INTEGER);', 'utf8');
  await writeFile(join(projectRoot, 'baseline.sql'), 'CREATE TABLE numbers (n INTEGER);', 'utf8');
  await writeFile(join(projectRoot, 'fixtures.sql'), `INSERT INTO numbers (n) VALUES ${Array.from({ length: 1000 }, (_, index) => `(${index})`).join(',')};`, 'utf8');
  await writeFile(suitePath, JSON.stringify({
    version: 1,
    name: 'Timeout fixture',
    baseline: 'baseline.sql',
    fixtures: ['fixtures.sql'],
    migrations: [{ id: 'noop', file: 'migrations/noop.sql' }],
    scenarios: [{ id: 'unbounded-select', title: 'A high-cost aggregate query is time boxed', migrations: ['noop'], checks: [{ id: 'spin', title: 'Cross join aggregate must stop at the worker limit', query: 'SELECT count(*) AS n FROM numbers a CROSS JOIN numbers b CROSS JOIN numbers c CROSS JOIN numbers d', expectedRows: [] }] }],
  }), 'utf8');
  const suite = await loadSqliteMigrationSuite(suitePath);
  const result = await runSqliteMigrationSuite({ suite, suitePath, projectRoot, outputRoot: join(temp, 'runs') });
  assert.equal(result.record.status, 'blocked');
  assert.equal(result.record.results[0].status, 'blocked');
  assert.match(result.record.results[0].evidence[0].content, /exceeded the 8000 ms process limit/);
});
