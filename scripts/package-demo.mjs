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
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, renameSync, lstatSync } from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
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
  const defaultDir = path.resolve(repoRoot, "..", "dist-packages", `TestPilot-Demo-${JSON.parse(readFileSync(path.join(repoRoot,"package.json"),"utf8")).version}-Windows`);
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

function assemblePackage(dir, releaseName) {
  const copy = (rel) => {
    const target=path.join(dir,rel);mkdirSync(path.dirname(target),{recursive:true});
    cpSync(path.join(repoRoot,rel),target,{recursive:true,filter:file=>!lstatSync(file).isSymbolicLink()});
  };
  for(const file of ['package.json','package-lock.json','tsconfig.json','README.md','PRODUCT.md','src','web/src','web/index.html','web/tsconfig.json','web/vite.config.ts','packaging/windows'])copy(file);
  for(const file of ['clean.mjs','check-architecture.mjs','package-demo.mjs','run-tests.mjs','test-browser-processes.mjs'])copy('scripts/'+file);
  for(const rel of ['examples/api-suite.sample.json','examples/sample-suite.json','examples/migrations','examples/source-test-fixture','examples/profiles/quantity-sample.json','examples/web-regression-sample'])copy(rel);
  for(const name of ['source-test-agent.test.mjs','source-test-job-service.test.mjs','source-test-candidate-adoption.integration.test.mjs','source-test-candidate-registry.integration.test.mjs','source-test-candidate-review-ssr.test.mjs','source-agent-evidence.test.mjs','source-agent-model-protocol.test.mjs','command-process-tree.test.mjs','playwright-test-adapter.test.mjs','test-runner-ownership.test.mjs','managed-edge-handoff.integration.test.mjs','document-case-exploration-adoption.integration.test.mjs','document-case-step-authoring-provenance.test.mjs','document-case-exploration-review-ssr.test.mjs','document-project-update-service.test.mjs','autonomous-regression-plans-ssr.test.mjs','document-autonomous-plan-execution-service.test.mjs','document-autonomous-execution-http.integration.test.mjs'])copy('tests/'+name);
  copy('tests/browser/document-autonomous-regression-ui.spec.ts');copy('tests/browser/text-evidence.spec.ts');copy('playwright.config.ts');
  for(const name of ['document-page-evidence.test.mjs','document-case-navigation.test.mjs','document-website-map.test.mjs','document-website-map-http-store.test.mjs','document-case-auto-preparation.test.mjs','document-agent-database.test.mjs','computer-use-regression-repairs.test.mjs','computer-use-evidence.test.mjs','document-package-refresh.test.mjs','mysql-routes.test.mjs'])copy('tests/'+name);
  copy('docs/architecture/A01-网站自主探索与导航-2026-11-03.md');
  for(const file of ['启动演示.cmd','start-demo.ps1'])cpSync(path.join(repoRoot,'packaging/windows',file),path.join(dir,file));
  for(const file of ['快速开始-中文.md','版本更新-0.3.0.md'])cpSync(path.join(repoRoot,'packaging/windows',file),path.join(dir,file));
  console.log('stage: public README');
  writeFileSync(path.join(dir,'README.md'),readFileSync(path.join(repoRoot,'packaging/windows/快速开始-中文.md')));
  console.log('stage: public config');
  writeFileSync(path.join(dir,'.env.example'),'# Optional model configuration. Settings can also be entered in the app.\r\nTESTPILOT_API_KEY=\r\nTESTPILOT_BASE_URL=https://api.openai.com/v1\r\nTESTPILOT_MODEL=gpt-4.1-mini\r\n');
  execFileSync(process.execPath,[path.join(repoRoot,'node_modules/typescript/bin/tsc'),'-p',path.join(repoRoot,'tsconfig.json'),'--outDir',path.join(dir,'dist')],{cwd:repoRoot,stdio:'inherit',windowsHide:true});
  execFileSync(process.execPath,[path.join(repoRoot,'node_modules/vite/bin/vite.js'),'build','web','--outDir',path.join(dir,'web/dist'),'--emptyOutDir'],{cwd:repoRoot,stdio:'inherit',windowsHide:true});
  const version=JSON.parse(readFileSync(path.join(repoRoot,'package.json'),'utf8')).version;
  writeFileSync(path.join(dir,'RELEASE.json'),JSON.stringify({name:'TestPilot',version,releaseName,builtAt:new Date().toISOString(),platform:'Windows',node:process.version,source:'Fresh TypeScript and Vite builds',codexRequired:false,firstRunRequiresNetwork:true},null,2));
}

function assertCleanContents(dir) {
  // Only reject private/generated directories at the package root. Source modules
  // can legitimately use names such as `src/application/artifacts`.
  const forbidden=listFiles(dir).filter(f=>/^(?:node_modules|runtime-data|artifacts|output|test-artifacts|\.git|browser-profiles)(?:\/|$)/i.test(f)||/(^|\/)\.env(?:\..*)?$/.test(f)&&f!=='.env.example'||/model-settings\.json$/i.test(f));
  if(forbidden.length)throw Error('Private or generated files in distribution: '+forbidden.join(', '));
  const settings=path.join(repoRoot,'artifacts/demo/model-settings.json');
  const secrets=[];
  if(existsSync(settings)){const v=JSON.parse(readFileSync(settings,'utf8'));if(typeof v.apiKey==='string'&&v.apiKey.length>=8)secrets.push(v.apiKey);}
  const privateEnv=path.join(repoRoot,'.env');
  if(existsSync(privateEnv))for(const line of readFileSync(privateEnv,'utf8').split(/\r?\n/)){const match=/^(?:export\s+)?[A-Z_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Z_]*\s*=\s*(.+)$/.exec(line);if(match){const value=match[1].trim().replace(/^['"]|['"]$/g,'');if(value.length>=8)secrets.push(value);}}
  for(const file of listFiles(dir)){
    const bytes=readFileSync(path.join(dir,file));
    if(secrets.some(secret=>bytes.includes(Buffer.from(secret))))throw Error('A local credential was found in '+file);
  }
}

function main() {
  const { dir, zip } = parseArgs(process.argv.slice(2));
  if(existsSync(dir)||existsSync(zip))throw Error('Refusing to overwrite an existing release; use a new --dir and --zip.');
  mkdirSync(path.dirname(dir),{recursive:true});mkdirSync(path.dirname(zip),{recursive:true});
  const stage=mkdtempSync(path.join(path.dirname(dir),'.testpilot-package-'));
  try {
    assemblePackage(stage,path.basename(dir));assertLauncherEncoding(stage);assertCleanContents(stage);
    writeManifest(stage,listFiles(stage));
    renameSync(stage,dir);
    const entries=buildZip(dir,zip,listFiles(dir));
    writeFileSync(zip+'.sha256',sha256(readFileSync(zip))+'  '+path.basename(zip)+'\r\n');
    console.log(JSON.stringify({dir,zip,entries,zipBytes:statSync(zip).size,sha256:sha256(readFileSync(zip)),launcherEncoding:'verified',privateFiles:'excluded'}));
  } catch(error) { console.error('Build artifacts retained for inspection: '+stage);throw error; }
}
main();
