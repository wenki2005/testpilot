import spawn from "cross-spawn";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CaseResult, EvidenceItem, SuiteCase } from "../domain/types.js";

const MAX_CAPTURE_BYTES = 1_000_000;

function appendCapped(current: string, chunk: Buffer): string {
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) return current;
  return current + chunk.subarray(0, remaining).toString("utf8");
}

export async function executeCommand(testCase: SuiteCase, projectRoot: string, signal?: AbortSignal): Promise<CaseResult> {
  const started = Date.now();
  const expectedExitCode = testCase.command.expectedExitCode ?? 0;
  const root = resolve(projectRoot);
  const workingDirectory = resolve(root, testCase.command.cwd ?? ".");
  const relativeWorkingDirectory = relative(root, workingDirectory);
  const outsideRoot = relativeWorkingDirectory === ".."
    || relativeWorkingDirectory.startsWith(`..${sep}`)
    || isAbsolute(relativeWorkingDirectory);

  if (outsideRoot) {
    const capturedAt = new Date().toISOString();
    return {
      caseId: testCase.id,
      title: testCase.title,
      status: "blocked",
      expectedExitCode,
      actualExitCode: null,
      durationMs: Date.now() - started,
      error: "Configured working directory is outside the project root.",
      evidence: [{ kind: "note", content: "Command was not started.", capturedAt }],
    };
  }
  if (signal?.aborted) {
    const capturedAt = new Date().toISOString();
    return { caseId: testCase.id, title: testCase.title, status: "blocked", expectedExitCode, actualExitCode: null, durationMs: Date.now() - started, error: "Command was cancelled before it started.", evidence: [{ kind: "note", content: "Command was not started.", capturedAt }] };
  }

  return await new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const evidence: EvidenceItem[] = [];
    const timeoutMs = testCase.command.timeoutMs ?? 120_000;

    const child = spawn(testCase.command.bin, testCase.command.args, {
      cwd: workingDirectory,
      env: testCase.command.cleanEnvironment
        ? safeEnvironment(testCase.command.env ?? {})
        : { ...process.env, ...testCase.command.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 3_000);
      forceKill.unref();
    }, timeoutMs);
    const abortChild = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abortChild, { once: true });
    if (signal?.aborted) abortChild();

    child.stdout?.on("data", (chunk: Buffer) => { stdout = appendCapped(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = appendCapped(stderr, chunk); });

    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortChild);
      const capturedAt = new Date().toISOString();
      if (stdout) evidence.push({ kind: "stdout", content: stdout, capturedAt });
      if (stderr) evidence.push({ kind: "stderr", content: stderr, capturedAt });
      if (timedOut) evidence.push({ kind: "timeout", content: `Command exceeded ${timeoutMs} ms`, capturedAt });
      if (exitCode !== null) evidence.push({ kind: "exit_code", content: String(exitCode), capturedAt });

      const status = signal?.aborted ? "blocked" : timedOut ? "failed" : error ? "error" : exitCode === expectedExitCode ? "passed" : "failed";
      if (signal?.aborted) evidence.push({ kind: "note", content: "Command stopped after cancellation was requested.", capturedAt });
      resolveResult({
        caseId: testCase.id,
        title: testCase.title,
        status,
        expectedExitCode,
        actualExitCode: exitCode,
        durationMs: Date.now() - started,
        ...(error ? { error } : {}),
        evidence,
      });
    };

    child.once("error", (error) => finish(null, error.message));
    child.once("close", (code) => finish(code));
  });
}

function safeEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, overrides);
  return env;
}

