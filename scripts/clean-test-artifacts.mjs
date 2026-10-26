#!/usr/bin/env node
/**
 * Reclaim disk space left behind by test runs (the historical backlog).
 *
 * Every test file points TESTPILOT_DATA_DIR at artifacts/<test-name>/<epoch-ms>/,
 * and each document test launches a persistent Edge profile (one of which
 * carries a ~169 MB model file). With no cleanup the tree grew past 113 GB /
 * 376k files in a few days.
 *
 * Deleting is not enough on its own: those tests leave Edge processes running,
 * and a live browser holds a lock on its profile directory (EBUSY on
 * CrashpadMetrics-active.pma). Use --kill-test-browsers to reap test-owned
 * browsers first. Only processes whose --user-data-dir points inside
 * artifacts/ or test-artifacts/ are touched, so a user's own Edge is safe.
 *
 * Safety model:
 *   - Dry run by default; the deletion set is always reviewable first.
 *   - KEEP holds real user data and reviewed evidence and is never deleted.
 *
 * Usage:
 *   node scripts/clean-test-artifacts.mjs                          # dry run
 *   node scripts/clean-test-artifacts.mjs --yes --kill-test-browsers
 *   node scripts/clean-test-artifacts.mjs --yes --before 2026-10-20   # keep from the 20th on
 *   node scripts/clean-test-artifacts.mjs --yes --keep-days 7
 *   node scripts/clean-test-artifacts.mjs --all-demo-runs          # include demo run history
 */

import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTestBrowsers, terminatePids } from "./test-browser-processes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(repoRoot, "artifacts");
const testArtifactsDir = path.join(repoRoot, "test-artifacts");

/**
 * Directories that hold real user data or reviewed evidence. Never deleted.
 * - demo/          : the workbench's own data, including saved model settings
 * - runs/          : CLI run history
 * - validation/    : archived validation runs referenced by VALIDATION.md
 * - api-self-check/: a recorded self-check referenced by VALIDATION.md
 * - preview-*      : manual preview sessions
 */
const KEEP = new Set(["demo", "runs", "validation", "api-self-check"]);
const KEEP_PREFIX = ["preview-"];

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const allDemoRuns = args.includes("--all-demo-runs");
const killBrowsers = args.includes("--kill-test-browsers");
const keepDaysArg = args.indexOf("--keep-days");
const keepDays = keepDaysArg >= 0 ? Number(args[keepDaysArg + 1]) : 0;
if (!Number.isFinite(keepDays) || keepDays < 0) throw new Error("--keep-days expects a non-negative number");

// --before YYYY-MM-DD deletes runs created before local midnight of that date.
// Day-granular arithmetic is what people actually reason about ("keep from the
// 19th onwards"), and it avoids an off-by-hours cutoff that silently keeps or
// drops a whole day's runs.
const beforeArg = args.indexOf("--before");
let cutoff = keepDays > 0 ? Date.now() - keepDays * 86_400_000 : Infinity;
let cutoffLabel = keepDays ? `${keepDays} day(s) ago` : null;
if (beforeArg >= 0) {
  const raw = args[beforeArg + 1];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? ""));
  if (!match) throw new Error("--before expects YYYY-MM-DD");
  const [, y, m, d] = match;
  cutoff = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  cutoffLabel = `before ${raw} 00:00 local`;
}

function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        try { bytes += statSync(abs).size; files++; } catch { /* vanished */ }
      }
    }
  }
  return { bytes, files };
}

function isKept(name) {
  return KEEP.has(name) || KEEP_PREFIX.some(prefix => name.startsWith(prefix));
}

function createdOf(p) {
  try { return statSync(p).birthtimeMs; } catch { return Infinity; }
}

function collectTargets() {
  const targets = [];

  if (existsSync(artifactsDir)) {
    for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || isKept(entry.name)) continue;
      const abs = path.join(artifactsDir, entry.name);
      let children = [];
      try { children = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
      const timestamped = children.filter(c => c.isDirectory() && /^\d{13}$/.test(c.name));

      if (timestamped.length === 0) {
        if (createdOf(abs) <= cutoff) targets.push({ path: abs, group: entry.name });
        continue;
      }
      for (const child of timestamped) {
        const childAbs = path.join(abs, child.name);
        if (createdOf(childAbs) <= cutoff) targets.push({ path: childAbs, group: entry.name });
      }
      for (const child of children) {
        if (/^\d{13}$/.test(child.name)) continue;
        const childAbs = path.join(abs, child.name);
        if (createdOf(childAbs) <= cutoff) targets.push({ path: childAbs, group: entry.name });
      }
    }
  }

  if (allDemoRuns) {
    const documentTests = path.join(artifactsDir, "demo", "document-tests");
    for (const sub of ["runs", "browser-profiles", "browser-sessions"]) {
      const abs = path.join(documentTests, sub);
      if (existsSync(abs)) targets.push({ path: abs, group: "demo/document-tests/" + sub });
    }
  }

  if (existsSync(testArtifactsDir)) {
    for (const entry of readdirSync(testArtifactsDir, { withFileTypes: true })) {
      const abs = path.join(testArtifactsDir, entry.name);
      if (createdOf(abs) <= cutoff) targets.push({ path: abs, group: "test-artifacts/" + entry.name });
    }
  }

  return targets;
}

const roots = [artifactsDir, testArtifactsDir].filter(existsSync);
const browsers = listTestBrowsers(roots);

const targets = collectTargets();
const grouped = new Map();
let totalBytes = 0;
let totalFiles = 0;
for (const target of targets) {
  const { bytes, files } = dirSize(target.path);
  totalBytes += bytes;
  totalFiles += files;
  const bucket = grouped.get(target.group) ?? { bytes: 0, files: 0, count: 0 };
  bucket.bytes += bytes;
  bucket.files += files;
  bucket.count++;
  grouped.set(target.group, bucket);
}

console.log(`repo: ${repoRoot}`);
console.log(`never touched: ${[...KEEP].join(", ")}, ${KEEP_PREFIX.join("*, ")}*`);
if (cutoffLabel) console.log(`only entries created ${cutoffLabel}`);
console.log("");

if (!targets.length) {
  console.log("nothing to clean.");
  process.exit(0);
}

console.log("would reclaim:");
for (const [name, info] of [...grouped.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${(info.bytes / 1024 ** 3).toFixed(2).padStart(8)} GB  ${String(info.files).padStart(8)} files  ${name}`);
}
console.log("");
console.log(`total: ${(totalBytes / 1024 ** 3).toFixed(2)} GB across ${totalFiles} files in ${targets.length} entr(ies)`);

if (browsers.length) {
  console.log("");
  console.log(`test-owned browser processes still running: ${browsers.length}`);
  console.log("  these hold locks on the profile directories and will cause EBUSY");
  if (!killBrowsers) console.log("  re-run with --kill-test-browsers to terminate them (your own Edge is never matched)");
}

if (!yes) {
  console.log("");
  console.log("dry run — nothing deleted. Re-run with --yes to delete.");
  process.exit(0);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (killBrowsers) {
  const killed = terminatePids(browsers.map(b => b.pid));
  console.log("");
  console.log(`terminated ${killed} test-owned browser process(es)`);
  if (killed) await sleep(2500);
}

let reclaimed = 0;
let filesRemoved = 0;
let remaining = [...targets];
for (let attempt = 1; attempt <= 5 && remaining.length; attempt++) {
  const stillBlocked = [];
  for (const target of remaining) {
    const { bytes, files } = dirSize(target.path);
    try {
      rmSync(target.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      reclaimed += bytes;
      filesRemoved += files;
    } catch (error) {
      stillBlocked.push({ target, error });
    }
  }
  remaining = stillBlocked;
  if (remaining.length && attempt < 5) {
    // A new browser may have been spawned by something else; reap again.
    const again = listTestBrowsers(roots);
    if (again.length) terminatePids(again.map(b => b.pid));
    await sleep(1500);
  }
}

console.log("");
console.log(`reclaimed ~${(reclaimed / 1024 ** 3).toFixed(2)} GB (${filesRemoved} files)`);
if (remaining.length) {
  console.warn(`${remaining.length} entr(ies) could not be removed:`);
  for (const { target, error } of remaining.slice(0, 8)) {
    console.warn(`  - ${path.relative(repoRoot, target.path)}: ${error.code ?? error.message}`);
  }
  console.warn("re-run with --kill-test-browsers, or close the browser holding them.");
  process.exitCode = 1;
}
