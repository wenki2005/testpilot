import { executeScenario } from "./sqlite-migration-adapter.js";
import type { SqliteMigrationSuite } from "../storage/sqlite-migration-suite.js";

interface ScenarioInput {
  scenario: SqliteMigrationSuite["scenarios"][number];
  baseline: string;
  fixtures: Array<{ file: string; sql: string }>;
  migrations: Record<string, string>;
}

interface SqliteChildProcess extends NodeJS.Process {
  send?: (message: unknown) => boolean;
}

const childProcess = process as SqliteChildProcess;
if (process.env.TESTPILOT_SQLITE_SCENARIO_CHILD !== "1" || !childProcess.send) process.exit(2);
process.on("message", (message: { input: ScenarioInput }) => {
  try { childProcess.send?.(executeScenario(message.input)); }
  catch (error) { childProcess.send?.({ status: "error", durationMs: 0, notes: [error instanceof Error ? error.message : String(error)] }); }
});
