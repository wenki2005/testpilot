import { randomUUID } from "node:crypto";
import { executeCommand } from "../adapters/command-adapter.js";
import type { RunRecord, RunRequest, TestEngine } from "../domain/types.js";

export class DeterministicEngine implements TestEngine {
  readonly mode = "deterministic" as const;

  async run(request: RunRequest): Promise<RunRecord> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const results = [];
    for (const testCase of request.cases) {
      results.push(await executeCommand(testCase, request.projectRoot, request.signal));
    }
    const completedAt = new Date().toISOString();
    const status = results.some((item) => item.status === "error")
      ? "error"
      : results.some((item) => item.status === "failed")
        ? "failed"
        : results.some((item) => item.status === "blocked") || results.length === 0
          ? "blocked"
          : "passed";

    return {
      schemaVersion: 1,
      runId: randomUUID(),
      mode: this.mode,
      suiteName: request.suiteName,
      status,
      startedAt,
      completedAt,
      durationMs: Date.now() - started,
      results,
      scope: request.scope ?? request.cases.map((item) => item.id),
      limitations: request.limitations ?? [],
    };
  }
}
