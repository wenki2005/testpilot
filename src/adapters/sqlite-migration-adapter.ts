import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import type { CaseResult, EvidenceItem, RunRecord, RunStatus, SqliteMigrationCheckEvidence, SqliteMigrationScenarioEvidence } from "../domain/types.js";
import { saveRun } from "../reporters/markdown-reporter.js";
import type { SqliteMigrationSuite } from "../storage/sqlite-migration-suite.js";
import { resolveMigrationFile } from "../storage/sqlite-migration-suite.js";

const maxSqlFileBytes = 512_000;
const maxSuiteFilesBytes = 5_000_000;
const maxStatementsPerFile = 200;
const maxRowsPerCheck = 500;
const scenarioTimeoutMs = 8_000;
type MigrationStatus = "passed" | "failed" | "blocked" | "error";
interface ScenarioOutcome {
  status: MigrationStatus;
  durationMs: number;
  notes: string[];
  sqliteVersion?: string;
  appliedMigrations?: string[];
  migrationEvents?: SqliteMigrationScenarioEvidence["migrationEvents"];
  checks?: SqliteMigrationCheckEvidence[];
}

export async function runSqliteMigrationSuite(options: { suite: SqliteMigrationSuite; suitePath: string; projectRoot: string; outputRoot: string }): Promise<{ record: RunRecord; recordPath: string; packagePath: string }> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const runId = randomUUID();
  const root = resolve(options.projectRoot);
  const migrations = new Map(options.suite.migrations.map((item) => [item.id, item]));
  const evidenceFiles = new Map<string, string>();
  let totalBytes = 0;
  const loadSqlFile = async (relativePath: string): Promise<string> => {
    const file = resolveMigrationFile(root, relativePath);
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`SQL input must be a regular file without links: ${relativePath}`);
    const canonicalRoot = await realpath(root);
    const canonicalFile = await realpath(file);
    const canonicalRelative = relative(canonicalRoot, canonicalFile);
    if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`)) throw new Error(`SQL input resolves outside the project root: ${relativePath}`);
    const details = await stat(file);
    if (details.size > maxSqlFileBytes) throw new Error(`SQL input exceeds ${maxSqlFileBytes} bytes: ${relativePath}`);
    const text = await readFile(file, "utf8");
    if (text.includes("\0")) throw new Error(`SQL input contains a NUL byte: ${relativePath}`);
    totalBytes += Buffer.byteLength(text, "utf8");
    if (totalBytes > maxSuiteFilesBytes) throw new Error(`SQL suite sources exceed ${maxSuiteFilesBytes} bytes in total.`);
    evidenceFiles.set(relativePath, text);
    return text;
  };

  try {
    const suitePath = resolve(options.suitePath);
    const suiteRel = relative(root, suitePath);
    if (suiteRel === ".." || suiteRel.startsWith(`..${sep}`) || suiteRel.startsWith(sep)) throw new Error("Suite file must be inside the project root.");
    const suiteInfo = await lstat(suitePath);
    if (!suiteInfo.isFile() || suiteInfo.isSymbolicLink()) throw new Error("Suite file must be a regular file without links.");
    const suiteCanonical = await realpath(suitePath);
    const suiteCanonicalRelative = relative(await realpath(root), suiteCanonical);
    if (suiteCanonicalRelative === ".." || suiteCanonicalRelative.startsWith(`..${sep}`) || isAbsolute(suiteCanonicalRelative)) throw new Error("Suite file resolves outside the project root.");
    const suiteSource = await readFile(suitePath, "utf8");
    totalBytes += Buffer.byteLength(suiteSource, "utf8");
    if (totalBytes > maxSuiteFilesBytes) throw new Error(`SQL suite sources exceed ${maxSuiteFilesBytes} bytes in total.`);
    evidenceFiles.set(suiteRel.replaceAll("\\", "/"), suiteSource);

    const baseline = options.suite.baseline ? await loadSqlFile(options.suite.baseline) : "";
    const fixtures = await Promise.all(options.suite.fixtures.map(async (file) => ({ file, sql: await loadSqlFile(file) })));
    const migrationSources = new Map<string, string>();
    for (const migration of options.suite.migrations) migrationSources.set(migration.id, await loadSqlFile(migration.file));
    const results: CaseResult[] = [];
    const scenarioEvidence: SqliteMigrationScenarioEvidence[] = [];
    let sqliteVersion = "unavailable";
    for (const scenario of options.suite.scenarios) {
      const outcome = await executeScenarioInWorker({ scenario, baseline, fixtures, migrations: Object.fromEntries(migrationSources) });
      sqliteVersion = outcome.sqliteVersion ?? sqliteVersion;
      scenarioEvidence.push({ scenarioId: scenario.id, status: outcome.status, appliedMigrations: outcome.appliedMigrations ?? [], migrationEvents: outcome.migrationEvents ?? [], checks: outcome.checks ?? [] });
      const content = outcome.notes.join("\n").slice(0, 100_000);
      const evidence: EvidenceItem[] = [{ kind: outcome.status === "passed" ? "stdout" : "stderr", content, capturedAt: new Date().toISOString() }];
      results.push({
        caseId: scenario.id,
        title: scenario.title,
        status: outcome.status,
        expectedExitCode: 0,
        actualExitCode: outcome.status === "passed" ? 0 : outcome.status === "failed" ? 1 : null,
        durationMs: outcome.durationMs,
        evidence,
        ...(outcome.status === "failed" ? { assertion: { expected: "Migrations match the declared data/schema assertions", actual: "One or more migration or post-migration checks differed" } } : {}),
      });
    }
    const status: RunStatus = results.some((item) => item.status === "error") ? "error" : results.some((item) => item.status === "failed") ? "failed" : results.some((item) => item.status === "blocked") ? "blocked" : "passed";
    const completedAt = new Date().toISOString();
    const record: RunRecord = {
      schemaVersion: 1,
      runId,
      mode: "deterministic",
      suiteName: options.suite.name,
      status,
      startedAt,
      completedAt,
      durationMs: Date.now() - started,
      results,
      scope: ["SQLite in-memory database, created fresh for each scenario", "Suite SQL files are read from the configured project root and packaged as immutable run evidence"],
      limitations: [
        "Only local SQLite SQL files run. No external database URL, network, shell, extension loading, ATTACH/DETACH, VACUUM, PRAGMA, or transaction-control statement is supported.",
        "Migration statements are applied under savepoints; expected migration failures are checked by querying the retained in-memory database after rollback.",
        "Assertions are exact row comparisons over read-only SELECT queries, capped at 500 result rows. This is not PostgreSQL/MySQL migration coverage or production-database testing.",
        `Each scenario runs in a child process with a 128 MB V8 heap limit and an ${scenarioTimeoutMs} ms hard timeout; a timed-out scenario is reported as blocked, not as a product failure.`,
      ],
      sqliteMigration: {
        suiteDigest: createHash("sha256").update([...evidenceFiles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([file, content]) => `${file}\0${content}`).join("\0")).digest("hex"),
        sqliteVersion,
        scenarios: scenarioEvidence,
      },
    };
    const recordPath = await saveRun(record, options.outputRoot);
    const runDirectory = dirname(recordPath);
    const report = await readFile(resolve(runDirectory, "report.md"), "utf8");
    const serializedRun = `${JSON.stringify(record, null, 2)}\n`;
    const readme = [
      `# ${options.suite.name} · TestPilot SQLite migration package`, "",
      "This package contains the declarative suite, SQL migration sources and normalized run evidence.", "",
      "## Isolation", "",
      "Each scenario was executed in a new in-memory SQLite database. No target database, network, shell or production environment was used.", "",
      "## Run result", "", `Status: ${record.status}`, `Run ID: ${record.runId}`, "", "Files: suite JSON, referenced SQL files, report.md, run.json.", "",
      "## Re-run without AI", "",
      "Requires Node.js 22.19 or later and TestPilot dependencies installed. From the TestPilot repository root, extract this ZIP with PowerShell:", "",
      "```powershell", "Expand-Archive -LiteralPath .\\testpilot-sqlite-migration-suite.zip -DestinationPath .\\artifacts\\imported-migrations", "npm run dev -- run-migrations --suite artifacts/imported-migrations/suite-sources/suite.json --project-root artifacts/imported-migrations/suite-sources --out artifacts/runs/sqlite-replay", "```", "",
      "On macOS/Linux, replace the extraction step with `unzip -o testpilot-sqlite-migration-suite.zip -d artifacts/imported-migrations` and run the same `npm run dev` command.", "",
      "This command executes the declarative migration checks only; it makes no model calls and uses a fresh in-memory SQLite database per scenario. A non-zero exit code means at least one scenario failed, was blocked, or errored.", "",
    ].join("\n");
    const packageFiles: Record<string, Uint8Array> = {
      "README.md": strToU8(readme),
      "report.md": strToU8(report),
      "run.json": strToU8(serializedRun),
    };
    for (const [file, source] of evidenceFiles) packageFiles[`suite-sources/${file}`] = strToU8(source);
    const packagePath = resolve(runDirectory, "testpilot-sqlite-migration-suite.zip");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(packagePath, zipSync(packageFiles));
    return { record, recordPath, packagePath };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function applyMigration(db: DatabaseSync, sql: string, migrationId: string): void {
  db.exec("SAVEPOINT testpilot_migration");
  try {
    executeSqlFile(db, sql, `migration ${migrationId}`);
    db.exec("RELEASE SAVEPOINT testpilot_migration");
  } catch (error) {
    try { db.exec("ROLLBACK TO SAVEPOINT testpilot_migration"); } finally { db.exec("RELEASE SAVEPOINT testpilot_migration"); }
    throw error;
  }
}

export function executeScenario(input: { scenario: SqliteMigrationSuite["scenarios"][number]; baseline: string; fixtures: Array<{ file: string; sql: string }>; migrations: Record<string, string> }): ScenarioOutcome {
  const started = Date.now();
  const notes: string[] = [];
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
  const sqliteVersion = String(db.prepare("SELECT sqlite_version() AS version").get()?.version ?? "unavailable");
  const appliedMigrations: string[] = [];
  const migrationEvents: SqliteMigrationScenarioEvidence["migrationEvents"] = [];
  const checks: SqliteMigrationCheckEvidence[] = [];
  let failed = false;
  let didExpectedFailure = false;
  try {
    executeSqlFile(db, input.baseline, "baseline");
    for (const fixture of input.fixtures) executeSqlFile(db, fixture.sql, `fixture ${fixture.file}`);
    for (const migrationId of input.scenario.migrations) {
      try {
        applyMigration(db, input.migrations[migrationId]!, migrationId);
        appliedMigrations.push(migrationId);
        migrationEvents.push({ migrationId, status: "applied" });
        notes.push(`Applied migration ${migrationId}.`);
        if (input.scenario.expectMigrationFailure === migrationId) {
          failed = true;
          migrationEvents.push({ migrationId, status: "expected-failure-missing", message: "Migration completed but failure was expected." });
          notes.push(`Expected migration ${migrationId} to fail, but it completed.`);
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notes.push(`Migration ${migrationId} failed: ${message}`);
        if (input.scenario.expectMigrationFailure === migrationId) {
          didExpectedFailure = true;
          migrationEvents.push({ migrationId, status: "expected-failure-rolled-back", message });
          notes.push(`Migration ${migrationId} was rolled back to its savepoint; the same in-memory database is retained for post-failure checks.`);
        } else { failed = true; migrationEvents.push({ migrationId, status: "unexpected-failure", message }); }
        break;
      }
    }
    if (input.scenario.expectMigrationFailure && !didExpectedFailure) {
      failed = true;
      if (!migrationEvents.some((event) => event.migrationId === input.scenario.expectMigrationFailure && event.status === "expected-failure-missing")) {
        migrationEvents.push({ migrationId: input.scenario.expectMigrationFailure, status: "expected-failure-missing", message: "Expected migration failure was not observed." });
      }
    }
    for (const check of input.scenario.checks) {
      try {
        const actual = readRows(db, check.query);
        const expectedJson = canonicalJson(check.expectedRows);
        const actualJson = canonicalJson(actual);
        const passed = expectedJson === actualJson;
        checks.push({ scenarioId: input.scenario.id, checkId: check.id, title: check.title, query: check.query, status: passed ? "passed" : "failed", expectedRows: check.expectedRows, actualRows: actual });
        notes.push(`${passed ? "PASS" : "FAIL"} ${check.id}: ${check.title}; expected ${expectedJson}; actual ${actualJson}`);
        if (!passed) failed = true;
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        checks.push({ scenarioId: input.scenario.id, checkId: check.id, title: check.title, query: check.query, status: "error", expectedRows: check.expectedRows, error: message });
        notes.push(`ERROR ${check.id}: ${message}`);
      }
    }
    return { status: failed ? "failed" : "passed", durationMs: Date.now() - started, notes, sqliteVersion, appliedMigrations, migrationEvents, checks };
  } catch (error) {
    return { status: "error", durationMs: Date.now() - started, notes: [...notes, `ERROR setting up scenario: ${error instanceof Error ? error.message : String(error)}`], sqliteVersion, appliedMigrations, migrationEvents, checks };
  } finally { db.close(); }
}

function executeScenarioInWorker(input: { scenario: SqliteMigrationSuite["scenarios"][number]; baseline: string; fixtures: Array<{ file: string; sql: string }>; migrations: Record<string, string> }): Promise<ScenarioOutcome> {
  return new Promise((resolveResult) => {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const entry = fileURLToPath(new URL(`./sqlite-migration-worker.${extension}`, import.meta.url));
    const child = fork(entry, [], { execArgv: ["--max-old-space-size=128", ...tsxLoaderArgs()], env: safeChildEnvironment(), stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        resolveResult({ status: "blocked", durationMs: scenarioTimeoutMs, notes: [`SQLite scenario exceeded the ${scenarioTimeoutMs} ms process limit; its isolated child process was terminated.`], appliedMigrations: [], migrationEvents: [], checks: [] });
      }
    }, scenarioTimeoutMs);
    child.once("spawn", () => child.send({ input }));
    child.once("message", (message: ScenarioOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(message);
      child.kill();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ status: "error", durationMs: 0, notes: [`SQLite child process error: ${error.message}`], appliedMigrations: [], migrationEvents: [], checks: [] });
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ status: "error", durationMs: 0, notes: [`SQLite child process exited without a result (code ${code}).`], appliedMigrations: [], migrationEvents: [], checks: [] });
    });
  });
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TESTPILOT_SQLITE_SCENARIO_CHILD: "1" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function tsxLoaderArgs(): string[] {
  const args: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const current = process.execArgv[index]!;
    const next = process.execArgv[index + 1] ?? "";
    if (current === "--import" && /(?:^|[\\/])tsx(?:[\\/]|$)/i.test(next)) args.push(current, next);
    else if (current.startsWith("--import=") && /(?:^|[\\/])tsx(?:[\\/]|$)/i.test(current.slice("--import=".length))) args.push(current);
  }
  return args;
}

function executeSqlFile(db: DatabaseSync, source: string, label: string): void {
  const statements = splitStatements(source);
  if (statements.length > maxStatementsPerFile) throw new Error(`${label} exceeds ${maxStatementsPerFile} SQL statements.`);
  for (const statement of statements) {
    const header = statement.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase();
    const normalized = statement.trim().replace(/^(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)|\s)+/, "").replace(/\s+/g, " ");
    if (["ATTACH", "DETACH", "VACUUM", "PRAGMA", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"].includes(header ?? "")) throw new Error(`${label} contains unsupported SQLite command ${header}.`);
    if (!/^(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|INSERT|UPDATE|DELETE)\b/i.test(normalized)) throw new Error(`${label} contains an unsupported SQL statement.`);
    db.prepare(statement).run();
  }
}

function readRows(db: DatabaseSync, query: string): Array<Record<string, unknown>> {
  if (query.length > 10_000 || splitStatements(query).length !== 1 || !/^\s*SELECT\b/i.test(query)) throw new Error("Assertion must be one read-only SELECT statement no longer than 10,000 characters.");
  const statement = db.prepare(query);
  const rows: Array<Record<string, unknown>> = [];
  for (const row of statement.iterate()) {
    if (rows.length >= maxRowsPerCheck) throw new Error(`Assertion returned more than ${maxRowsPerCheck} rows.`);
    rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)])));
  }
  return rows;
}

function splitStatements(source: string): string[] {
  const output: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | "]" | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const current = source[index]!;
    const next = source[index + 1];
    if (lineComment) { if (current === "\n") lineComment = false; continue; }
    if (blockComment) { if (current === "*" && next === "/") { blockComment = false; index++; } continue; }
    if (quote) {
      const closer = quote === "]" ? "]" : quote;
      if (current === closer) {
        if (next === closer && quote !== "]") index++;
        else quote = undefined;
      }
      continue;
    }
    if (current === "-" && next === "-") { lineComment = true; index++; continue; }
    if (current === "/" && next === "*") { blockComment = true; index++; continue; }
    if (current === "'" || current === '"' || current === "`") { quote = current; continue; }
    if (current === "[") { quote = "]"; continue; }
    if (current === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) output.push(statement);
      start = index + 1;
    }
  }
  if (quote || blockComment) throw new Error("SQL contains an unterminated quoted value or comment.");
  const tail = source.slice(start).trim();
  if (tail) output.push(tail);
  return output;
}

function normalizeSqlValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return { base64: Buffer.from(value).toString("base64") };
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
