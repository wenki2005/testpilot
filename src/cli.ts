import { resolve } from 'node:path';
import { option } from './interfaces/cli/arguments.js';
import { runApiCommand } from './interfaces/cli/api-command.js';
import { runMigrationsCommand } from './interfaces/cli/migrations-command.js';
import { runSourceAgentCommand } from './interfaces/cli/source-agent-command.js';
import { runPlaywrightCommand } from './interfaces/cli/playwright-command.js';
import { runProjectCommand } from './interfaces/cli/run-command.js';
import { runPlanningCommand } from './interfaces/cli/planning-command.js';
import { runDocumentRunsCommand } from './interfaces/cli/document-runs-command.js';
import { TestOrchestrator } from './orchestration/orchestrator.js';
import { DeterministicEngine } from './engines/deterministic-engine.js';
import { PlanningEngineScaffold } from './engines/agent-contracts.js';

function help(): void {
  console.log(`TestPilot MVP\n\nCommands:\n  run --suite <file.json> [--project-root <path>] [--out <path>]\n  run --profile <name> [--out <path>]\n  run-api --suite <file.json> --base-url <url> [--allow-network] [--allow-mutations] [--allow-concurrency] [--out <path>]\n  run-migrations --suite <file.json> [--project-root <path>] [--out <path>]\n  test-agent --source-root <path> --goal-file <requirements.md> [--mode plan|generate|diagnose] [--timeout-ms 300000] [--out <path>]\n  run-playwright --project-root <path> --config <file> [--out <path>]\n  plan --requirements <file.md> [--out <path>]\n  explore --goal <text> [--scope <text>] [--out <path>]\n  document-runs [--server http://127.0.0.1:14420] --project <id> --action start --case <id> [--case <id> ...]\n  document-runs [--server http://127.0.0.1:14420] --project <id> --run <id> --action resume\n  document-runs [--server http://127.0.0.1:14420] (--project <id> | --run <id>) [--action status|pause|continue|cancel]\n\nNamed project profiles run existing test commands without a shell in a disposable project copy. The API runner targets one origin and requires explicit flags for non-loopback targets, mutating HTTP methods and concurrent batches. The SQLite migration runner creates a new in-memory database per scenario, rejects unsafe commands, and writes normalized reports plus a reusable source package.`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return help();

  const outputRoot = resolve(option(args, '--out') ?? 'artifacts/runs');
  if (command === 'run-playwright') { await runPlaywrightCommand(args, outputRoot); return; }
  if (command === 'test-agent') { await runSourceAgentCommand(args, outputRoot); return; }
  if (command === 'run-api') { await runApiCommand(args, outputRoot); return; }
  if (command === 'run-migrations') { await runMigrationsCommand(args, outputRoot); return; }
  if (command === 'document-runs') { await runDocumentRunsCommand(args); return; }

  const orchestrator = new TestOrchestrator([
    new DeterministicEngine(),
    new PlanningEngineScaffold('requirements'),
    new PlanningEngineScaffold('autonomous'),
  ]);
  if (command === 'run') { await runProjectCommand(args, outputRoot, orchestrator); return; }
  if ((command === 'plan' || command === 'explore') && await runPlanningCommand(command, args, outputRoot, orchestrator)) return;

  help();
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
