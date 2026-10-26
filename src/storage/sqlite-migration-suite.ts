import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface SqliteMigrationSuite {
  version: 1;
  name: string;
  baseline?: string;
  fixtures: string[];
  migrations: Array<{ id: string; file: string }>;
  scenarios: Array<{
    id: string;
    title: string;
    migrations: string[];
    expectMigrationFailure?: string;
    checks: Array<{ id: string; title: string; query: string; expectedRows: Array<Record<string, unknown>> }>;
  }>;
}

export async function loadSqliteMigrationSuite(filePath: string): Promise<SqliteMigrationSuite> {
  if ((await stat(filePath)).size > 5_000_000) throw new Error("SQLite migration suite JSON exceeds 5 MB.");
  const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(value) || value.version !== 1 || typeof value.name !== "string" || !value.name.trim()) throw new Error("Invalid SQLite migration suite header.");
  const baseline = value.baseline;
  if (baseline !== undefined && !isSafeRelativeFile(baseline)) throw new Error("baseline must be a safe project-relative SQL file.");
  const fixtures = value.fixtures ?? [];
  if (!Array.isArray(fixtures) || !fixtures.every(isSafeRelativeFile)) throw new Error("fixtures must be safe project-relative SQL files.");
  if (!Array.isArray(value.migrations) || value.migrations.length < 1 || value.migrations.length > 100) throw new Error("migrations must contain 1–100 entries.");
  const migrations = value.migrations.map((migration, index) => {
    if (!isRecord(migration) || typeof migration.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(migration.id) || !isSafeRelativeFile(migration.file)) throw new Error(`Invalid migration at index ${index}.`);
    return { id: migration.id, file: migration.file };
  });
  if (new Set(migrations.map((item) => item.id)).size !== migrations.length) throw new Error("Migration IDs must be unique.");
  if (!Array.isArray(value.scenarios) || value.scenarios.length < 1 || value.scenarios.length > 100) throw new Error("scenarios must contain 1–100 entries.");
  const scenarios = value.scenarios.map((scenario, index) => {
    if (!isRecord(scenario) || typeof scenario.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(scenario.id) || typeof scenario.title !== "string" || !scenario.title.trim() || !Array.isArray(scenario.migrations) || !scenario.migrations.every((id) => typeof id === "string") || !Array.isArray(scenario.checks) || scenario.checks.length < 1 || scenario.checks.length > 100) throw new Error(`Invalid migration scenario at index ${index}.`);
    const migrationIds = scenario.migrations as string[];
    if (migrationIds.some((id) => !migrations.some((entry) => entry.id === id)) || new Set(migrationIds).size !== migrationIds.length) throw new Error(`Scenario ${scenario.id} references an unknown or repeated migration.`);
    const expectMigrationFailure = scenario.expectMigrationFailure;
    if (expectMigrationFailure !== undefined && (typeof expectMigrationFailure !== "string" || migrationIds.at(-1) !== expectMigrationFailure)) throw new Error(`Scenario ${scenario.id}: expected migration failure must name its last migration.`);
    const checks = scenario.checks.map((check, checkIndex) => {
      if (!isRecord(check) || typeof check.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(check.id) || typeof check.title !== "string" || !check.title.trim() || typeof check.query !== "string" || !Array.isArray(check.expectedRows) || !check.expectedRows.every(isRecord)) throw new Error(`Invalid check ${checkIndex} in scenario ${scenario.id}.`);
      return { id: check.id, title: check.title, query: check.query, expectedRows: check.expectedRows };
    });
    if (new Set(checks.map((check) => check.id)).size !== checks.length) throw new Error(`Scenario ${scenario.id} has duplicate check IDs.`);
    return { id: scenario.id, title: scenario.title, migrations: migrationIds, ...(typeof expectMigrationFailure === "string" ? { expectMigrationFailure } : {}), checks };
  });
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length) throw new Error("Scenario IDs must be unique.");
  return { version: 1, name: value.name, ...(typeof baseline === "string" ? { baseline } : {}), fixtures, migrations, scenarios };
}

export function isSafeRelativeFile(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.includes("\\") && !value.startsWith("/") && !/^[a-z]:/i.test(value)
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") && value.toLowerCase().endsWith(".sql");
}

export function resolveMigrationFile(projectRoot: string, relativePath: string): string {
  const root = resolve(projectRoot);
  const file = resolve(root, ...relativePath.split("/"));
  const rel = relative(root, file);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Migration file escapes the project root: ${relativePath}`);
  return file;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
