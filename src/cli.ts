import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveProjectRoot } from "./storage/suite-loader.js";
import { TestOrchestrator } from "./orchestration/orchestrator.js";
import { DeterministicEngine } from "./engines/deterministic-engine.js";
import { PlanningEngineScaffold } from "./engines/agent-contracts.js";
import { loadProjectProfile, loadSuite } from "./storage/suite-loader.js";
import { prepareProfile, preserveProfileArtifacts } from "./adapters/project-profile-adapter.js";
import { dirname, join } from "node:path";
import { loadApiSuite } from "./storage/api-suite-loader.js";
import { runApiSuite } from "./adapters/api-test-adapter.js";
import { loadSqliteMigrationSuite } from "./storage/sqlite-migration-suite.js";
import { runSqliteMigrationSuite } from "./adapters/sqlite-migration-adapter.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function help(): void {
  console.log(`TestPilot MVP\n\nCommands:\n  run --suite <file.json> [--project-root <path>] [--out <path>]\n  run --profile <name> [--out <path>]\n  run-api --suite <file.json> --base-url <url> [--allow-network] [--allow-mutations] [--allow-concurrency] [--out <path>]\n  run-migrations --suite <file.json> [--project-root <path>] [--out <path>]\n  plan --requirements <file.md> [--out <path>]\n  explore --goal <text> [--scope <text>] [--out <path>]\n\nNamed project profiles run existing test commands without a shell in a disposable project copy. The API runner targets one origin and requires explicit flags for non-loopback targets, mutating HTTP methods and concurrent batches. The SQLite migration runner creates a new in-memory database per scenario, rejects unsafe commands, and writes normalized reports plus a reusable source package.`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") return help();

  const outputRoot = resolve(option(args, "--out") ?? "artifacts/runs");
  const orchestrator = new TestOrchestrator([
    new DeterministicEngine(),
    new PlanningEngineScaffold("requirements"),
    new PlanningEngineScaffold("autonomous"),
  ]);

  if (command === "run") {
    const profileName = option(args, "--profile");
    if (profileName) {
      if (!/^[a-z0-9-]+$/i.test(profileName)) throw new Error("Profile name may contain only letters, digits and hyphens.");
      const profile = await loadProjectProfile(join(process.cwd(), "examples", "profiles", `${profileName}.json`));
      const prepared = await prepareProfile(profile);
      try {
        const cases = profile.suite.cases.map((testCase) => ({
          ...testCase,
          command: {
            ...testCase.command,
            cleanEnvironment: true,
            env: Object.fromEntries(Object.entries({ ...testCase.command.env, ...prepared.env }).map(([key, value]) => [key, value.replaceAll("{DEMO_URL}", prepared.env.DEMO_URL ?? "")])),
          },
        }));
        const { record, recordPath } = await orchestrator.execute({
          mode: "deterministic",
          suiteName: profile.suite.name,
          cases,
          projectRoot: prepared.projectRoot,
          outputRoot,
          scope: [`Existing suite in ${profile.name}`, "Disposable snapshot of the configured local project"],
          limitations: ["This profile executes the project's pre-existing tests; it does not generate or heal tests.", "Project files and generated test artifacts run in an isolated temporary copy."],
        });
        await preserveProfileArtifacts(profile, prepared.projectRoot, dirname(recordPath));
        console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
        console.log(`Cases: ${record.results.filter((item) => item.status === "passed").length} passed / ${record.results.length} total`);
        console.log(`Report: ${reportPath(recordPath)}`);
        if (record.status !== "passed") process.exitCode = 1;
      } finally { await prepared.close(); }
      return;
    }
    const suitePath = option(args, "--suite");
    if (!suitePath) throw new Error("Missing --suite <file.json>");
    const suite = await loadSuite(resolve(suitePath));
    const { record, recordPath } = await orchestrator.execute({
      mode: "deterministic",
      suiteName: suite.name,
      cases: suite.cases,
      projectRoot: resolveProjectRoot(option(args, "--project-root")),
      outputRoot,
    });
    console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
    console.log(`Cases: ${record.results.filter((item) => item.status === "passed").length} passed / ${record.results.length} total`);
    console.log(`Report: ${reportPath(recordPath)}`);
    if (record.status !== "passed") process.exitCode = 1;
    return;
  }

  if (command === "run-api") {
    const suitePath = option(args, "--suite");
    if (!suitePath) throw new Error("Missing --suite <file.json>");
    const suite = await loadApiSuite(resolve(suitePath));
    const { record, recordPath } = await runApiSuite({
      suite,
      ...(option(args, "--base-url") ? { baseUrl: option(args, "--base-url")! } : {}),
      allowNetwork: args.includes("--allow-network"),
      allowMutations: args.includes("--allow-mutations"),
      allowConcurrency: args.includes("--allow-concurrency"),
      outputRoot,
    });
    console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
    console.log(`Cases: ${record.results.filter((item) => item.status === "passed").length} passed / ${record.results.length} total`);
    console.log(`Report: ${reportPath(recordPath)}`);
    if (record.status !== "passed") process.exitCode = 1;
    return;
  }

  if (command === "run-migrations") {
    const suiteOption = option(args, "--suite");
    if (!suiteOption) throw new Error("Missing --suite <file.json>");
    const suitePath = resolve(suiteOption);
    const projectRoot = resolve(option(args, "--project-root") ?? process.cwd());
    const suite = await loadSqliteMigrationSuite(suitePath);
    const { record, recordPath, packagePath } = await runSqliteMigrationSuite({ suite, suitePath, projectRoot, outputRoot });
    console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
    console.log(`Scenarios: ${record.results.filter((item) => item.status === "passed").length} passed / ${record.results.length} total`);
    console.log(`Report: ${reportPath(recordPath)}`);
    console.log(`Package: ${packagePath}`);
    if (record.status !== "passed") process.exitCode = 1;
    return;
  }

  if (command === "plan") {
    const requirementsPath = option(args, "--requirements");
    if (!requirementsPath) throw new Error("Missing --requirements <file.md>");
    const absolutePath = resolve(requirementsPath);
    const sourceText = await readFile(absolutePath, "utf8");
    const { record, recordPath } = await orchestrator.execute({
      mode: "requirements",
      suiteName: `Requirements: ${absolutePath.split(/[\\/]/).pop() ?? "input"}`,
      cases: [],
      projectRoot: process.cwd(),
      outputRoot,
      scope: ["requirements-driven test planning"],
      limitations: [`Loaded ${sourceText.length} characters from ${absolutePath}; planning provider is not configured.`],
    });
    console.log(`BLOCKED — ${record.limitations[0]}`);
    console.log(`Report: ${reportPath(recordPath)}`);
    process.exitCode = 2;
    return;
  }

  if (command === "explore") {
    const goal = option(args, "--goal");
    if (!goal) throw new Error("Missing --goal <text>");
    const scope = option(args, "--scope");
    const { record, recordPath } = await orchestrator.execute({
      mode: "autonomous",
      suiteName: goal,
      cases: [],
      projectRoot: process.cwd(),
      outputRoot,
      ...(scope ? { scope: [scope] } : {}),
    });
    console.log(`BLOCKED — ${record.limitations[0]}`);
    console.log(`Report: ${reportPath(recordPath)}`);
    process.exitCode = 2;
    return;
  }

  help();
  process.exitCode = 2;
}

function reportPath(recordPath: string): string {
  return recordPath.replaceAll("\\", "/").replace(/run\.json$/, "report.md");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
