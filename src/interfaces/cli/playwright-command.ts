import { option } from "./arguments.js";
import { runPlaywrightTest } from "../../adapters/browser/playwright-test-adapter.js";

export async function runPlaywrightCommand(args: string[], outputRoot: string): Promise<void> {
  const projectRoot = option(args, "--project-root");
  const config = option(args, "--config");
  if (!projectRoot || !config) throw new Error("run-playwright requires --project-root and --config");
  const result = await runPlaywrightTest({ projectRoot, config, outputRoot });
  console.log(`${result.status.toUpperCase()} — ${result.reportPath}`);
  if (result.status !== "passed") process.exitCode = result.status === "failed" ? 1 : 2;
}
