import type { ProjectProfileSummary, ProjectRunView } from "../../domain/project-profile.js";
import type { ProjectScriptVersion } from "../../domain/project-script.js";
import type { RunRecord } from "../../domain/types.js";

export type ProjectProfileExecutionOutcome = { record: RunRecord; artifactFiles: string[]; cleanupError?: unknown };

/** Owns profile-run queueing, cancellation, timeout and final status persistence. */
export function createProjectProfileRunService(input: {
  profiles: ProjectProfileSummary[];
  timeoutMs: number;
  createRunId(): string;
  now(): string;
  runDirectory(id: string): { normalized: string; artifacts: string };
  readArtifactFiles(id: string): Promise<string[]>;
  persist(run: ProjectRunView): Promise<void>;
  execute(profileId: string, runId: string, directory: { normalized: string; artifacts: string }, approvedScript: ProjectScriptVersion | undefined, signal: AbortSignal): Promise<ProjectProfileExecutionOutcome>;
  isAnyRunActive(): boolean;
  activateRun(id: string): void;
  finishRun(id: string): void;
}) {
  const runs = new Map<string, ProjectRunView>();
  const controllers = new Map<string, AbortController>();

  async function launch(profileId: string, approvedScript?: ProjectScriptVersion): Promise<ProjectRunView> {
    const summary = input.profiles.find(profile => profile.id === profileId);
    if (!summary) throw new Error("Unregistered project profile.");
    if (input.isAnyRunActive()) throw new Error("another test run is already active");
    const run: ProjectRunView = {
      id: input.createRunId(), profileId, profileName: summary.name, suiteName: approvedScript?.suite.name ?? summary.suiteName,
      ...(approvedScript ? { scriptId: approvedScript.id, scriptVersion: approvedScript.version } : {}),
      status: "queued", startedAt: input.now(), durationMs: 0, summary: "已排队，等待执行。", results: [], artifactFiles: [],
    };
    runs.set(run.id, run);
    input.activateRun(run.id);
    const controller = new AbortController();
    controllers.set(run.id, controller);
    try { await input.persist(run); }
    catch (error) { runs.delete(run.id); controllers.delete(run.id); input.finishRun(run.id); throw error; }

    void (async () => {
      const started = Date.now();
      let finalStatus: ProjectRunView["status"] = "error";
      let finalSummary = "";
      let finalDuration = 0;
      const timeout = setTimeout(() => controller.abort(new Error("Project profile exceeded the 180 second deadline")), input.timeoutMs);
      run.status = "running";
      run.startedAt = input.now();
      run.summary = "正在准备隔离副本并执行已登记测试。";
      await input.persist(run).catch(() => undefined);
      try {
        const outcome = await input.execute(profileId, run.id, input.runDirectory(run.id), approvedScript, controller.signal);
        const { record } = outcome;
        run.recordRunId = record.runId;
        run.results = record.results;
        run.artifactFiles = outcome.artifactFiles;
        const userCancelled = controller.signal.reason?.message === "cancelled";
        finalStatus = userCancelled ? "cancelled" : controller.signal.aborted ? "blocked" : record.status;
        finalSummary = userCancelled
          ? "运行已取消；未完成的检查没有判为通过。"
          : controller.signal.aborted ? "运行达到时间上限；未完成的检查没有判为通过。"
            : `${record.results.filter(result => result.status === "passed").length}/${record.results.length} 项通过，退出码 ${record.results.at(-1)?.actualExitCode ?? "—"}。`;
        finalDuration = record.durationMs;
        if (outcome.cleanupError) { finalSummary += ` 隔离副本清理错误：${String(outcome.cleanupError)}`; finalStatus = "error"; }
      } catch (error) {
        const userCancelled = controller.signal.reason?.message === "cancelled";
        finalStatus = userCancelled ? "cancelled" : controller.signal.aborted ? "blocked" : "error";
        finalSummary = controller.signal.aborted
          ? userCancelled ? "运行已取消；未完成的检查没有判为通过。" : "运行达到时间上限；未完成的检查没有判为通过。"
          : (error instanceof Error ? error.message : String(error));
        if (error && typeof error === "object" && "cleanupError" in error) finalSummary += ` 隔离副本清理错误：${String((error as { cleanupError: unknown }).cleanupError)}`;
        finalDuration = Date.now() - started;
      } finally {
        clearTimeout(timeout);
        run.artifactFiles = await input.readArtifactFiles(run.id).catch(() => run.artifactFiles);
        run.status = finalStatus;
        run.summary = finalSummary;
        run.completedAt = input.now();
        run.durationMs = finalDuration || Date.now() - started;
        input.finishRun(run.id);
        controllers.delete(run.id);
        await input.persist(run).catch(() => undefined);
      }
    })();
    return run;
  }

  return { runs, controllers, launch };
}
