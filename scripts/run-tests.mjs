#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTestBrowsers, terminatePids } from './test-browser-processes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(root, 'test-artifacts', 'runs');
mkdirSync(testRoot, { recursive: true });
const ownedRoot = mkdtempSync(path.join(testRoot, 'run-'));
const owner = { schemaVersion: 1, root: ownedRoot, pid: process.pid, startedAt: new Date().toISOString() };
writeFileSync(path.join(ownedRoot, 'owner.json'), JSON.stringify(owner, null, 2));
const env = { ...process.env, TESTPILOT_TEST_RUN_DIR: ownedRoot, TESTPILOT_DATA_DIR: path.join(ownedRoot, 'default-data'), TESTPILOT_ARTIFACTS_DIR: path.join(ownedRoot, 'default-workflows'), TESTPILOT_BROWSER_CDP_ENDPOINT: '' };
const files = readdirSync(path.join(root, 'tests')).filter(n => /(?:\.test|\.integration)\.mjs$/.test(n)).sort().map(n => `tests/${n}`);
async function run(bin, args) {
  return new Promise(resolve => {
    const child = spawn(bin, args, { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', error => { console.error(error.message); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}
let code = await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
if (code === 0) code = await run(process.execPath, ['scripts/check-architecture.mjs']);
if (code === 0) code = await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', 'web']);
if (code === 0) {
  console.log(`Running ${files.length} test files serially; owned evidence: ${ownedRoot}`);
  code = await run(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files]);
}
if (code === 0) code = await run(process.execPath, ['node_modules/playwright/cli.js', 'test']);
const summary = { ...owner, completedAt: new Date().toISOString(), exitCode: code, files: files.length, retained: code !== 0 || process.argv.includes('--keep') };
writeFileSync(path.join(testRoot, `${path.basename(ownedRoot)}.json`), JSON.stringify(summary, null, 2));
if (!summary.retained) {
  const resolved = realpathSync(ownedRoot);
  if (path.dirname(resolved) !== realpathSync(testRoot) || !path.basename(resolved).startsWith('run-')) throw Error('Refusing cleanup outside owned test directory');
  terminatePids(listTestBrowsers([resolved]).map(b => b.pid));
  try { rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch { console.warn(`Owned test directory is locked; retained: ${resolved}`); }
} else console.log(`Evidence retained: ${ownedRoot}`);
process.exitCode = code;
