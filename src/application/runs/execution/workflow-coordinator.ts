import type { DocumentExecutionStage, DocumentWorkflowStageId, DocumentWorkflowSpecialist } from "../../../domain/documents/shared/workflow.js";

type WorkflowApprovalStatus = "not-required" | "pending" | "approved" | "rejected";
type WorkflowStage = {
  stageId: DocumentWorkflowStageId;
  attempt: number;
  status: "running" | "waiting" | "failed" | "completed" | "cancelled";
  approval: { status: WorkflowApprovalStatus };
};
type ActiveStage = Pick<WorkflowStage, "stageId" | "attempt">;
type WorkflowSnapshot = { stages: WorkflowStage[] };

export interface DocumentRunWorkflowPorts {
  getWorkflow(workflowId: string): Promise<WorkflowSnapshot | undefined>;
  linkRun(workflowId: string, input: { runId: string; parentRunId?: string }): Promise<unknown>;
  startStage(workflowId: string, input: { stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist; input: unknown }): Promise<{ stage: WorkflowStage }>;
  waitStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, reason: string): Promise<unknown>;
  resumeStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number): Promise<WorkflowSnapshot>;
  completeStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, outputArtifactIds: string[]): Promise<unknown>;
  failStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, error: { message: string; code: string }): Promise<unknown>;
  cancelWorkflow(workflowId: string, reason: string): Promise<unknown>;
  completeWorkflow(workflowId: string): Promise<unknown>;
}

export interface DocumentRunWorkflowExecutionContext {
  workflowId: string;
  runId: string;
  projectId: string;
  projectDigest: string;
  selectedCaseIds: string[];
  runMode: "compare" | "regression";
  siteVersionSnapshot?: unknown;
  parentRunId?: string;
  retestNotes?: string;
  retestScopeNote?: string;
}

const stageForExecution: Partial<Record<DocumentExecutionStage, { stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist }>> = {
  deterministic: { stageId: "deterministic-execution", specialist: "deterministic-executor" },
  "computer-use": { stageId: "computer-use-execution", specialist: "computer-use-observer" },
  analysis: { stageId: "analyze-results", specialist: "result-analyst" },
  report: { stageId: "generate-report", specialist: "report-writer" },
  packaging: { stageId: "package-artifacts", specialist: "report-packager" },
};

/** Coordinates durable workflow stages around one execution without owning HTTP or the runner. */
export function createDocumentRunWorkflowCoordinator(ports: DocumentRunWorkflowPorts, context: DocumentRunWorkflowExecutionContext) {
  let activeStage: ActiveStage | undefined;

  const stageInput = (runId = context.runId) => ({
    runId,
    projectId: context.projectId,
    projectDigest: context.projectDigest,
    selectedCaseIds: context.selectedCaseIds,
    ...(context.siteVersionSnapshot ? { siteVersionSnapshot: context.siteVersionSnapshot } : {}),
    ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
    ...(context.retestNotes ? { retestNotes: context.retestNotes } : {}),
    ...(context.retestScopeNote ? { retestScopeNote: context.retestScopeNote } : {}),
  });

  async function resumeApproved(stage: WorkflowStage | undefined): Promise<void> {
    if (stage?.status === "waiting" && stage.approval.status !== "pending") {
      await ports.resumeStage(context.workflowId, stage.stageId, stage.attempt);
    }
  }

  async function onStage(stage: DocumentExecutionStage): Promise<void> {
    if (stage === "awaiting-login") {
      if (!activeStage) {
        const started = await ports.startStage(context.workflowId, {
          stageId: "deterministic-execution",
          specialist: "deterministic-executor",
          input: stageInput(),
        });
        activeStage = { stageId: started.stage.stageId, attempt: started.stage.attempt };
      }
      const current = await ports.getWorkflow(context.workflowId);
      const persisted = current?.stages.find(item => item.stageId === activeStage!.stageId && item.attempt === activeStage!.attempt);
      if (persisted?.status === "running") {
        await ports.waitStage(context.workflowId, persisted.stageId, persisted.attempt, "浏览器已复用当前登录窗口，等待用户完成登录；登录成功后会从当前用例继续。");
      }
      return;
    }

    if (stage === "starting") {
      const current = activeStage ? await ports.getWorkflow(context.workflowId) : undefined;
      const persisted = current?.stages.find(item => item.stageId === activeStage!.stageId && item.attempt === activeStage!.attempt);
      await resumeApproved(persisted);
      return;
    }

    const target = stageForExecution[stage];
    if (!target) return;
    if (activeStage?.stageId === target.stageId) {
      const current = await ports.getWorkflow(context.workflowId);
      await resumeApproved(current?.stages.find(item => item.stageId === activeStage!.stageId && item.attempt === activeStage!.attempt));
      return;
    }

    if (activeStage) {
      let current = await ports.getWorkflow(context.workflowId);
      let persisted = current?.stages.find(item => item.stageId === activeStage!.stageId && item.attempt === activeStage!.attempt);
      if (persisted?.status === "waiting" && persisted.approval.status !== "pending") {
        current = await ports.resumeStage(context.workflowId, persisted.stageId, persisted.attempt);
        persisted = current.stages.find(item => item.stageId === activeStage!.stageId && item.attempt === activeStage!.attempt);
      }
      if (persisted?.status === "running") {
        await ports.completeStage(context.workflowId, persisted.stageId, persisted.attempt, [`run:${context.runId}:${persisted.stageId}`]);
      }
    }

    if (stage === "analysis" && context.runMode === "regression") {
      const workflowState = await ports.getWorkflow(context.workflowId);
      const visualStage = [...(workflowState?.stages ?? [])].reverse().find(item => item.stageId === "computer-use-execution");
      if (!visualStage) {
        const skipped = await ports.startStage(context.workflowId, {
          stageId: "computer-use-execution",
          specialist: "computer-use-observer",
          input: { runId: context.runId, projectId: context.projectId, runMode: "regression", disposition: "not-applicable", reason: "常规回归模式不运行视觉 Computer Use。" },
        });
        if (skipped.stage.status === "waiting" && skipped.stage.approval.status === "pending") {
          throw new Error("Workflow computer-use-execution is waiting for approval; approve the human gate before finalizing the regression run.");
        }
        if (skipped.stage.status === "running") {
          await ports.completeStage(context.workflowId, skipped.stage.stageId, skipped.stage.attempt, [`run:${context.runId}:computer-use:not-applicable:regression`]);
        }
      }
    }

    const current = await ports.getWorkflow(context.workflowId);
    const existing = [...(current?.stages ?? [])].reverse().find(item => item.stageId === target.stageId && (item.status === "running" || item.status === "waiting"));
    if (existing) {
      await resumeApproved(existing);
      activeStage = { stageId: existing.stageId, attempt: existing.attempt };
      return;
    }
    const started = await ports.startStage(context.workflowId, { ...target, input: stageInput() });
    if (started.stage.status === "waiting" && started.stage.approval.status === "pending") {
      throw new Error(`Workflow ${target.stageId} is waiting for approval; approve the human gate before execution.`);
    }
    activeStage = { stageId: started.stage.stageId, attempt: started.stage.attempt };
  }

  return {
    onStage,
    linkRun: (runId: string, parentRunId = context.parentRunId) => ports.linkRun(context.workflowId, { runId, ...(parentRunId ? { parentRunId } : {}) }),
    async complete(runId: string): Promise<void> {
      if (activeStage) await ports.completeStage(context.workflowId, activeStage.stageId, activeStage.attempt, [`run:${runId}:${activeStage.stageId}`]);
      await ports.completeWorkflow(context.workflowId);
    },
    async fail(error: unknown): Promise<void> {
      if (!activeStage) return;
      await ports.failStage(context.workflowId, activeStage.stageId, activeStage.attempt, {
        message: error instanceof Error ? error.message : String(error),
        code: "execution-failed",
      }).catch(() => undefined);
    },
    cancel: (reason: string) => ports.cancelWorkflow(context.workflowId, reason),
  };
}
