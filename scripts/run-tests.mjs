#!/usr/bin/env node
/**
 * Run the test suite, then reclaim what *this* run produced.
 *
 * Two problems had to be solved together:
 *  1. The suite writes each test's data to artifacts/<test-name>/<epoch-ms>/ and
 *     never removed it (>113 GB accumulated over a few days).
 *  2. A document test leaves a persistent Edge browser running by design, and
 *     that browser holds file locks on the very profile directory we want to
 *     delete (EBUSY on CrashpadMetrics-active.pma). Deleting without reaping
 *     the processes silently reclaims almost nothing.
 *
 * So cleanup = reaping test-owned browsers started during this run, then
 * deleting only directories born after the run began. Anything older is left
 * alone (that is the user's history), and on failure everything is kept
 * because a failing run is exactly when the evidence matters.
 *
 * Usage:
 *   node scripts/run-tests.mjs
 *   node scripts/run-tests.mjs --keep   # keep artifacts even when green
 */

import { spawn } from "node:child_process";
import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTestBrowsers, terminatePids } from "./test-browser-processes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(repoRoot, "tests");
const artifactsDir = path.join(repoRoot, "artifacts");
const testArtifactsDir = path.join(repoRoot, "test-artifacts");
const keep = process.argv.includes("--keep");

// Match the documented entry point: every tests/*.test.mjs, serially.
const files = readdirSync(testsDir)
  .filter(name => name.endsWith(".test.mjs"))
  .sort()
  .map(name => `tests/${name}`);

const startedAt = Date.now();
console.log(`running ${files.length} test files (serial)…`);

const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

const code = await new Promise(resolve => {
  child.on("exit", (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
  child.on("error", error => {
    console.error(`failed to start the test runner: ${error.message}`);
    resolve(1);
  });
});

if (code !== 0) {
  console.error("");
  console.error(`tests failed (exit ${code}); keeping run artifacts for inspection:`);
  console.error(`  ${artifactsDir}`);
  console.error("test browsers from this run were left running so the evidence stays open.");
  process.exit(code);
}

if (keep) {
  console.log("");
  console.log("--keep given; run artifacts and test browsers left in place.");
  process.exit(0);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const roots = [artifactsDir, testArtifactsDir].filter(existsSync);

function reap(scope) {
  const browsers = listTestBrowsers(scope, { createdAfter: startedAt });
  if (!browsers.length) return 0;
  const killed = terminatePids(browsers.map(b => b.pid));
  return killed;
}

function dirSize(dir) {
  let bytes = 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        try { bytes += statSync(abs).size; count++; } catch { /* vanished */ }
      }
    }
  }
  return { bytes, count };
}

function collectRemovable() {
  const removable = [];
  if (!existsSync(artifactsDir)) return removable;
  for (const parent of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!parent.isDirectory()) continue;
    const parentAbs = path.join(artifactsDir, parent.name);
    let parentCreated;
    try { parentCreated = statSync(parentAbs).birthtimeMs; } catch { continue; }
    if (parentCreated >= startedAt) { removable.push(parentAbs); continue; }
    let children = [];
    try { children = readdirSync(parentAbs, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const childAbs = path.join(parentAbs, child.name);
      try {
        if (statSync(childAbs).birthtimeMs >= startedAt) removable.push(childAbs);
      } catch { /* vanished */ }
    }
  }
  return removable;
}

const reaped = reap(roots);
if (reaped) {
  console.log("");
  console.log(`reaped ${reaped} test-owned browser process(es) from this run`);
  await sleep(2000);
}

let reclaimed = 0;
let filesRemoved = 0;
let remaining = collectRemovable();
let attempts = 0;

// Windows can hold a directory handle briefly after the owning process exits,
// so retry with a fresh reap between attempts instead of failing outright.
while (remaining.length && attempts < 5) {
  attempts++;
  for (const target of [...remaining]) {
    const { bytes, count } = dirSize(target);
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      reclaimed += bytes;
      filesRemoved += count;
      remaining = remaining.filter(t => t !== target);
    } catch { /* retried below */ }
  }
  if (remaining.length && attempts < 5) {
    reap(roots);
    await sleep(1000);
  }
}

console.log("");
if (!remaining.length && reclaimed === 0) {
  console.log("cleanup: nothing new to remove.");
} else {
  console.log(`cleanup: reclaimed ~${(reclaimed / 1024 ** 3).toFixed(2)} GB (${filesRemoved} files)`);
}
if (remaining.length) {
  console.warn(`cleanup: ${remaining.length} entr(ies) still locked after ${attempts} attempt(s); they will be caught by the next run.`);
  for (const target of remaining.slice(0, 5)) console.warn(`  - ${path.relative(repoRoot, target)}`);
}
