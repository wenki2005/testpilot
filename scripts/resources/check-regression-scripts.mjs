#!/usr/bin/env node
// Verify that regression/scripts/ matches the live module registry: every case
// has one generated JSON, its steps/digest are current, and no stale files remain.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BASE_URL,
  DEFAULT_OUT_DIR,
  buildMirror,
  collectRegistry,
  sha256,
} from '../lib/regression-scripts-layout.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const baseUrl = arg('base-url', DEFAULT_BASE_URL);
const outDir = path.resolve(arg('out', DEFAULT_OUT_DIR));
const dataDir = path.resolve(arg('data-dir', process.env.TESTPILOT_DATA_DIR ?? 'artifacts/demo'));

async function walkJson(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  await walk(root);
  return found;
}

async function main() {
  const registry = await collectRegistry(baseUrl, dataDir, {systemId:arg('system-id', undefined),activeOnly:process.argv.includes('--active-only')});
  const { files, index } = buildMirror(registry);
  const errors = [];

  const actualFiles = new Set(await walkJson(outDir));
  for (const [relative, content] of files) {
    if (!relative.endsWith('.json')) continue;
    if (!actualFiles.has(relative)) {
      errors.push(`缺少文件：${relative}`);
      continue;
    }
    if (relative.endsWith('/_module.json') || relative === '_index.json' || relative.endsWith('/_index.json')) continue;
    let actual;
    try {
      actual = JSON.parse(await readFile(path.join(outDir, relative), 'utf8'));
    } catch (error) {
      errors.push(`无法解析 ${relative}：${error instanceof Error ? error.message : error}`);
      continue;
    }
    const expected = JSON.parse(content);
    if (actual.case?.id !== expected.case?.id) errors.push(`${relative}：case.id 不一致`);
    if (JSON.stringify(actual.script?.steps) !== JSON.stringify(expected.script?.steps)) errors.push(`${relative}：steps 与当前模块版本不一致`);
    if (actual.caseDigest !== expected.caseDigest) errors.push(`${relative}：caseDigest 不一致`);
    if (actual.version?.digest !== expected.version?.digest) errors.push(`${relative}：模块版本 digest 不一致`);
    const recomputed = sha256({ id: actual.case?.id, expected: actual.case?.expected, steps: actual.script?.steps });
    if (actual.caseDigest !== recomputed) errors.push(`${relative}：caseDigest 无法复算`);
  }

  for (const relative of actualFiles) {
    if (files.has(relative)) continue;
    errors.push(`多余/过期文件：${relative}（请重新导出或删除）`);
  }

  const indexPath = path.join(outDir, '_index.json');
  try {
    const actualIndex = JSON.parse(await readFile(indexPath, 'utf8'));
    if (JSON.stringify(actualIndex.totals) !== JSON.stringify(index.totals)) errors.push('_index.json：汇总数量与当前注册表不一致');
  } catch (error) {
    errors.push(`_index.json 无法读取：${error instanceof Error ? error.message : error}`);
  }

  console.log(JSON.stringify({
    checked: path.relative(process.cwd(), outDir).replace(/\\/g, '/') || '.',
    source: baseUrl,
    dataDir: path.relative(process.cwd(), dataDir).replace(/\\/g, '/') || '.',
    systems: index.totals.systems,
    modules: index.totals.modules,
    cases: index.totals.cases,
    fixed: index.totals.fixed,
    derived: index.totals.derived,
    noSteps: index.totals.noSteps,
    errors: errors.length,
  }, null, 2));
  for (const error of errors.slice(0, 30)) console.error(`- ${error}`);
  if (errors.length > 30) console.error(`- 其余 ${errors.length - 30} 项省略`);
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`请先启动 TestPilot（默认 ${DEFAULT_BASE_URL}），或传 --base-url。`);
  process.exitCode = 1;
});
