import { resolve } from "node:path";
import { option, reportPath } from "./arguments.js";
import { loadApiSuite } from "../../storage/api-suite-loader.js";
import { runApiSuite } from "../../adapters/api-test-adapter.js";

export async function runApiCommand(args: string[], outputRoot: string): Promise<void> {
  const suitePath = option(args, "--suite");
  if (!suitePath) throw new Error("Missing --suite <file.json>");
  const suite = await loadApiSuite(resolve(suitePath));
  const { record, recordPath: savedPath } = await runApiSuite({
    suite,
    ...(option(args, "--base-url") ? { baseUrl: option(args, "--base-url")! } : {}),
    allowNetwork: args.includes("--allow-network"),
    allowMutations: args.includes("--allow-mutations"),
    allowConcurrency: args.includes("--allow-concurrency"),
    outputRoot,
  });
  console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
  console.log(`Cases: ${record.results.filter(item => item.status === "passed").length} passed / ${record.results.length} total`);
  console.log(`Report: ${reportPath(savedPath)}`);
  if (record.status !== "passed") process.exitCode = 1;
}
