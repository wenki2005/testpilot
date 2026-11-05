import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { option } from "./arguments.js";
import { loadSourceResume, runSourceTestAgent } from "../../adapters/source-tests/source-test-agent.js";

export async function runSourceAgentCommand(args: string[], outputRoot: string): Promise<void> {
  const resumeFile = option(args, "--resume-run");
  const resumed = resumeFile ? await loadSourceResume(resolve(resumeFile)) : undefined;
  const sourceRoot = option(args, "--source-root") ?? resumed?.sourceRoot;
  const goalFile = option(args, "--goal-file");
  const goal = goalFile ? await readFile(resolve(goalFile), "utf8") : option(args, "--goal") ?? resumed?.goal;
  if (!sourceRoot || !goal) throw new Error("test-agent requires --source-root and --goal or --goal-file");
  const mode = option(args, "--mode") ?? resumed?.mode ?? "diagnose";
  if (!["plan", "generate", "diagnose"].includes(mode)) throw new Error("--mode must be plan, generate or diagnose");
  const candidateFile = option(args, "--candidate-file");
  const run = await runSourceTestAgent({
    sourceRoot,
    goal,
    candidateFiles: [...(resumed?.candidateFiles ?? []), ...(candidateFile ? [candidateFile] : [])],
    mode: mode as "plan" | "generate" | "diagnose",
    outputRoot,
    ...(option(args, "--timeout-ms") ? { timeoutMs: Number(option(args, "--timeout-ms")) } : {}),
    onProgress: event => console.log(JSON.stringify(event)),
  });
  console.log(`${run.status.toUpperCase()} — ${run.reportPath}`);
  if (run.status === "blocked") process.exitCode = 2;
}
