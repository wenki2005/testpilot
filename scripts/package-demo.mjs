#!/usr/bin/env node
/**
 * Package the TestPilot demo distribution.
 *
 * Why this exists: the first shipped build had a launcher that could not start
 * on a plain Chinese Windows install. `启动演示.cmd` was UTF-8 without BOM and
 * used LF line endings, so cmd.exe (code page 936) truncated `-ExecutionPolicy`
 * and executed `echo` lines as commands. The fix is structural, not cosmetic:
 *   - .cmd content must be ASCII-only + CRLF + no BOM, because cmd.exe parses
 *     batch files in the OEM code page and chokes on any non-ASCII byte
 *     (including a UTF-8 BOM).
 *   - .ps1 must be UTF-8 WITH BOM, because Windows PowerShell 5.1 reads a
 *     BOM-less script as ANSI/GBK and mangles every Chinese string.
 * Therefore localized messages live in the .ps1, and the .cmd is ASCII only.
 *
 * This script enforces those rules, regenerates MANIFEST.sha256 from the files
 * on disk (so the manifest can never drift), and rebuilds the ZIP.
 *
 * Usage:
 *   node scripts/package-demo.mjs
 *   node scripts/package-demo.mjs --dir <package-dir> --zip <out.zip>
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { dir: null, zip: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--zip") args.zip = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: node scripts/package-demo.mjs [--dir <package-dir>] [--zip <out.zip>]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  const defaultDir = path.resolve(repoRoot, "..", "dist-packages", "TestPilot-Demo-0.2.0-Windows");
  const dir = path.resolve(args.dir ?? defaultDir);
  const zip = path.resolve(args.zip ?? `${dir}.zip`);
  return { dir, zip };
}

/** Recursively list every file under `dir`, as forward-slash relative paths. */
function listFiles(dir) {
  const out = [];
  (function walk(rel) {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  })("");
  return out;
}

/**
 * Enforce the launcher encoding contract. Throws with an actionable message
 * instead of shipping a package that fails on the user's machine.
 */
function assertLauncherEncoding(dir) {
  const problems = [];
  const rootEntries = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile());

  for (const entry of rootEntries) {
    const abs = path.join(dir, entry.name);
    const buf = readFileSync(abs);
    const latin = buf.toString("latin1");
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const crlfCount = (latin.match(/\r\n/g) || []).length;
    const bareLfCount = (latin.match(/(?<!\r)\n/g) || []).length;
    const nonAscii = buf.some(b => b > 0x7f);

    if (/\.(cmd|bat)$/i.test(entry.name)) {
      if (nonAscii) problems.push(`${entry.name}: .cmd/.bat must be pure ASCII (cmd.exe parses it in the OEM code page). Move localized text into the .ps1.`);
      if (hasBom) problems.push(`${entry.name}: .cmd/.bat must not carry a UTF-8 BOM (it corrupts the first line).`);
      if (bareLfCount > 0) problems.push(`${entry.name}: .cmd/.bat must use CRLF; found ${bareLfCount} bare LF line ending(s).`);
      if (crlfCount === 0) problems.push(`${entry.name}: .cmd/.bat must use CRLF; found no CRLF at all.`);
    }

    if (/\.ps1$/i.test(entry.name)) {
      if (!hasBom) problems.push(`${entry.name}: .ps1 must be UTF-8 WITH BOM, otherwise Windows PowerShell 5.1 reads it as ANSI and mangles non-ASCII text.`);
      if (bareLfCount > 0) problems.push(`${entry.name}: .ps1 must use CRLF; found ${bareLfCount} bare LF line ending(s).`);
    }
  }

  if (problems.length) {
    throw new Error(`Launcher encoding check failed:\n  - ${problems.join("\n  - ")}`);
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function writeManifest(dir, files) {
  const lines = files
    .filter(f => f !== "MANIFEST.sha256")
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(f => `${sha256(readFileSync(path.join(dir, f)))}  ${f}`);
  const body = `${lines.join("\r\n")}\r\n`;
  writeFileSync(path.join(dir, "MANIFEST.sha256"), Buffer.from(body, "utf8"));
  return lines.length;
}

function buildZip(dir, zipPath, files) {
  const rootName = path.basename(dir);
  const payload = {};
  for (const rel of files.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    payload[`${rootName}/${rel}`] = new Uint8Array(readFileSync(path.join(dir, rel)));
  }
  writeFileSync(zipPath, Buffer.from(zipSync(payload, { level: 9 })));
  return Object.keys(payload).length;
}

function totalSize(dir, files) {
  return files.reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0);
}

function main() {
  const { dir, zip } = parseArgs(process.argv.slice(2));
  if (!existsSync(dir)) throw new Error(`Package directory not found: ${dir}`);

  assertLauncherEncoding(dir);
  console.log("launcher encoding: OK");

  const files = listFiles(dir);
  const manifestCount = writeManifest(dir, files);
  console.log(`manifest: ${manifestCount} entries regenerated`);

  const zipEntries = buildZip(dir, zip, listFiles(dir));
  const sizeMb = (statSync(zip).size / (1024 * 1024)).toFixed(2);
  console.log(`zip: ${zip} (${zipEntries} entries, ${sizeMb} MB)`);
  console.log(`package: ${dir} (${totalSize(dir, listFiles(dir)) / (1024 * 1024) | 0} MB)`);
}

main();
