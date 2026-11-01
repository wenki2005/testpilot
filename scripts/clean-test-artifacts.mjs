#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runsRoot = path.join(root, "test-artifacts", "runs");
if (!existsSync(runsRoot)) {
  console.log("No owned test artifacts to clean.");
  process.exit(0);
}

const realRunsRoot = realpathSync(runsRoot);
let removed = 0;
let retained = 0;
for (const name of readdirSync(realRunsRoot)) {
  if (!/^run-[A-Za-z0-9_-]+$/.test(name)) continue;
  const summaryPath = path.join(realRunsRoot, `${name}.json`);
  const runPath = path.join(realRunsRoot, name);
  if (!existsSync(summaryPath)) { retained++; continue; }
  let summary;
  try { summary = JSON.parse(readFileSync(summaryPath, "utf8")); }
  catch { retained++; continue; }
  if (summary.exitCode !== 0) { retained++; continue; }
  if (!existsSync(runPath)) {
    if (path.resolve(String(summary.root ?? "")) !== runPath) { retained++; continue; }
    rmSync(summaryPath, { force: true });
    removed++;
    continue;
  }
  if (!statSync(runPath).isDirectory()) { retained++; continue; }
  const realRunPath = realpathSync(runPath);
  if (path.dirname(realRunPath) !== realRunsRoot || !path.basename(realRunPath).startsWith("run-")) { retained++; continue; }
  const ownerPath = path.join(realRunPath, "owner.json");
  if (!existsSync(ownerPath)) { retained++; continue; }
  let owner;
  try { owner = JSON.parse(readFileSync(ownerPath, "utf8")); }
  catch { retained++; continue; }
  if (owner.root !== realRunPath || !Number.isInteger(owner.pid)) { retained++; continue; }
  rmSync(realRunPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  rmSync(summaryPath, { force: true });
  removed++;
}
console.log(`Removed ${removed} completed test run(s); retained ${retained} incomplete, failed, or unowned item(s).`);
