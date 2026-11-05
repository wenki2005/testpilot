import type { DocumentProject, DocumentRun } from "../../../domain/documents/shared/test-model.js";

export interface DocumentRunProgressSnapshot {
  runId: string;
  projectId?: string;
  status: string;
  stage: string;
  progress: unknown;
}

export interface DocumentRunWorkflowLifecycle {
  linkRun(runId: string): Promise<unknown>;
  complete(runId: string): Promise<void>;
  fail(error: unknown): Promise<void>;
  cancel(reason: string): Promise<unknown>;
}

export interface DocumentProjectRunSubmissionPorts<TOptions extends object> {
  getRecovery(project: DocumentProject): Promise<{ isRunning?: boolean; runId: string } | undefined>;
  getProgress(runId: string): Promise<DocumentRunProgressSnapshot | undefined>;
  execute(projectId: string, options: TOptions): Promise<DocumentRun>;
  wait(milliseconds: number): Promise<void>;
}

export interface DocumentProjectRunSubmissionInput<TOptions extends object> {
  action: "run" | "start" | "resume" | "retest";
  projectId: string;
  project: DocumentProject;
  runId: string;
  executionOptions: TOptions;
  workflow: DocumentRunWorkflowLifecycle;
}

export type DocumentProjectRunSubmissionResult =
  | { kind: "accepted"; status: 202; body: Record<string, unknown> }
  | { kind: "conflict"; status: 409; message: string }
  | { kind: "unavailable"; status: 503; message: string }
  | { kind: "completed"; status: 200 | 201; run: DocumentRun };

/** Starts, observes, and settles one run while keeping HTTP response writing outside application code. */
export function createDocumentProjectRunSubmissionService<TOptions extends object>(ports: DocumentProjectRunSubmissionPorts<TOptions>) {
  return {
    async submit(input: DocumentProjectRunSubmissionInput<TOptions>): Promise<DocumentProjectRunSubmissionResult> {
      if (input.action === "start") {
        const existing = await ports.getRecovery(input.project);
        if (existing?.isRunning) {
          const progress = await ports.getProgress(existing.runId);
          if (progress) {
            return {
              kind: "accepted",
              status: 202,
              body: {
                runId: existing.runId,
                projectId: input.projectId,
                status: progress.status,
                stage: progress.stage,
                progress: progress.progress,
                reusedExistingRun: true,
              },
            };
          }
          return { kind: "conflict", status: 409, message: "该项目已有运行占用浏览器会话；请稍候再检查恢复进度，不要启动重复运行。" };
        }

        await input.workflow.linkRun(input.runId);
        let settled = false;
        let startupError: unknown;
        const execution = ports.execute(input.projectId, input.executionOptions);
        void execution.then(async run => {
          if (run.overall === "cancelled") {
            await input.workflow.cancel("文档测试运行由用户手动停止。");
            return;
          }
          await input.workflow.complete(input.runId);
        }).catch(async error => {
          await input.workflow.fail(error);
        });
        void execution.then(() => { settled = true; }, error => { startupError = error; settled = true; });

        // Long browser runs remain in the background; acknowledge once the journal is readable.
        for (let attempt = 0; attempt < 150; attempt++) {
          const progress = await ports.getProgress(input.runId);
          if (progress) {
            return {
              kind: "accepted",
              status: 202,
              body: { runId: input.runId, projectId: input.projectId, status: progress.status, stage: progress.stage, progress: progress.progress },
            };
          }
          if (settled) {
            return { kind: "conflict", status: 409, message: startupError instanceof Error ? startupError.message : "测试运行未能初始化。" };
          }
          await ports.wait(20);
        }
        return { kind: "unavailable", status: 503, message: `测试运行已提交，但启动状态日志暂不可读（runId=${input.runId}）；请使用项目恢复状态检查，勿重复提交。` };
      }

      await input.workflow.linkRun(input.runId);
      const run = await ports.execute(input.projectId, input.executionOptions);
      if (run.overall === "cancelled") {
        await input.workflow.cancel("文档测试运行由用户手动停止。");
        return { kind: "completed", status: 200, run };
      }
      await input.workflow.complete(run.id);
      return { kind: "completed", status: 201, run };
    },
  };
}
