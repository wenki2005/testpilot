import { resolve } from "node:path";
import { option, reportPath } from "./arguments.js";
import { loadSqliteMigrationSuite } from "../../storage/sqlite-migration-suite.js";
import { runSqliteMigrationSuite } from "../../adapters/sqlite-migration-adapter.js";

export async function runMigrationsCommand(args: string[], outputRoot: string): Promise<void> {
  const suiteOption = option(args, "--suite");
  if (!suiteOption) throw new Error("Missing --suite <file.json>");
  const suitePath = resolve(suiteOption);
  const projectRoot = resolve(option(args, "--project-root") ?? process.cwd());
  const suite = await loadSqliteMigrationSuite(suitePath);
  const { record, recordPath: savedPath, packagePath } = await runSqliteMigrationSuite({ suite, suitePath, projectRoot, outputRoot });
  console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
  console.log(`Scenarios: ${record.results.filter(item => item.status === "passed").length} passed / ${record.results.length} total`);
  console.log(`Report: ${reportPath(savedPath)}`);
  console.log(`Package: ${packagePath}`);
  if (record.status !== "passed") process.exitCode = 1;
}
