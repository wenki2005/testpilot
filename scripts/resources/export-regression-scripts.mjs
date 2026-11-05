#!/usr/bin/env node
// Export the fixed BrowserStep scripts of every TestPilot module version into
// regression/scripts/ so a reviewer can find the script for any case by path.
// The mirror is generated; the source of truth is the running module registry.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BASE_URL,
  DEFAULT_OUT_DIR,
  buildMirror,
  collectRegistry,
} from '../lib/regression-scripts-layout.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const baseUrl = arg('base-url', DEFAULT_BASE_URL);
const outDir = path.resolve(arg('out', DEFAULT_OUT_DIR));
const dataDir = path.resolve(arg('data-dir', process.env.TESTPILOT_DATA_DIR ?? 'artifacts/demo'));

async function existingFiles(root) {
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
      else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name === '_GENERATED.md')) found.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  await walk(root);
  return found;
}

async function pruneEmptyDirs(root) {
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let kept = 0;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const childKept = await walk(full);
        if (!childKept) await rm(full, { recursive: true, force: true }).catch(() => {});
        kept += childKept;
      } else kept += 1;
    }
    return kept;
  }
  await walk(root);
}

async function main() {
  const registry = await collectRegistry(baseUrl, dataDir, {systemId:arg('system-id', undefined),activeOnly:process.argv.includes('--active-only')});
  const { files, index } = buildMirror(registry);
  await mkdir(outDir, { recursive: true });

  const previous = new Set(await existingFiles(outDir));
  for (const [relative, content] of files) {
    const target = path.join(outDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  let removed = 0;
  for (const relative of previous) {
    if (files.has(relative)) continue;
    await rm(path.join(outDir, relative), { force: true }).catch(() => {});
    removed += 1;
  }
  await pruneEmptyDirs(outDir);

  console.log(JSON.stringify({
    exported: path.relative(process.cwd(), outDir).replace(/\\/g, '/') || '.',
    source: baseUrl,
    dataDir: path.relative(process.cwd(), dataDir).replace(/\\/g, '/') || '.',
    systems: index.totals.systems,
    modules: index.totals.modules,
    cases: index.totals.cases,
    fixed: index.totals.fixed,
    derived: index.totals.derived,
    noSteps: index.totals.noSteps,
    removedStale: removed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`请先启动 TestPilot（默认 ${DEFAULT_BASE_URL}），或传 --base-url。`);
  process.exitCode = 1;
});
