import type { DocumentProject } from "../../domain/document-test-model.js";
import type { DocumentWorkflowStageId, DocumentWorkflowSpecialist } from "../../domain/document-workflow.js";

type WorkflowStage = {
  stageId: DocumentWorkflowStageId;
  specialist: DocumentWorkflowSpecialist;
  attempt: number;
  status: "running" | "waiting" | "failed" | "completed" | "cancelled";
  approval: { status: "not-required" | "pending" | "approved" | "rejected" };
};
type WorkflowRecord = { workflowId: string; runId?: string | undefined; status: string; stages: WorkflowStage[] };

export interface DocumentProjectWorkflowPreparationPorts {
  getWorkflow(workflowId: string): Promise<WorkflowRecord | undefined>;
  createWorkflow(input: { projectId: string; parentRunId?: string; approvalPolicy: "automatic" | "confirm-before-execution" }): Promise<WorkflowRecord>;
  getRecovery(project: DocumentProject): Promise<{ isRunning?: boolean } | undefined>;
  startStage(workflowId: string, input: { stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist; input: unknown }): Promise<{ stage: WorkflowStage }>;
  approveStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, input: { approved: boolean; note?: string }): Promise<WorkflowRecord>;
  resumeStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number): Promise<WorkflowRecord>;
  completeStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, artifactIds: string[]): Promise<WorkflowRecord>;
  waitStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, reason: string): Promise<WorkflowRecord>;
  saveProject(project: DocumentProject): Promise<unknown>;
  digest(value: unknown): string;
}

/** Prepares the durable workflow snapshot and approval gate for a document project. */
export function createDocumentProjectWorkflowPreparationService(ports: DocumentProjectWorkflowPreparationPorts) {
  async function completeApprovalGate(workflowId: string, project: DocumentProject, note: string): Promise<void> {
    let workflow = await ports.getWorkflow(workflowId);
    if (!workflow) throw new Error(`workflow ${workflowId} is unavailable.`);
    let gate = [...workflow.stages].reverse().find(stage => stage.stageId === "human-approval");
    if (!gate || gate.status === "failed") {
      const started = await ports.startStage(workflowId, {
        stageId: "human-approval",
        specialist: "human-review-gate",
        input: { projectId: project.id, decision: "approved", caseDigest: ports.digest(project.cases) },
      });
      gate = started.stage;
      workflow = await ports.getWorkflow(workflowId) ?? workflow;
    }
    if (gate.status === "waiting" && gate.approval.status === "pending") {
      workflow = await ports.approveStage(workflowId, "human-approval", gate.attempt, { approved: true, note });
      gate = workflow.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
    } else if (gate.status === "waiting") {
      workflow = await ports.resumeStage(workflowId, "human-approval", gate.attempt);
      gate = workflow.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
    }
    if (gate.status === "running") {
      await ports.completeStage(workflowId, "human-approval", gate.attempt, [`project:${project.id}:approved:${ports.digest(project.reviewNotes ?? note)}`]);
    }
  }

  async function ensureProjectWorkflow(project: DocumentProject, parentRunId?: string): Promise<WorkflowRecord> {
    let workflow: WorkflowRecord | undefined;
    if (project.workflowId) {
      const existing = await ports.getWorkflow(project.workflowId);
      if (!existing) throw new Error(`项目关联的 workflow ${project.workflowId} 缺失或校验失败；拒绝另建一条不连贯记录。`);
      if (existing.runId && (existing.status === "running" || existing.status === "waiting")) {
        const activeRecovery = await ports.getRecovery(project);
        if (activeRecovery?.isRunning) return existing;
      }
      if (!existing.runId && (existing.status === "running" || existing.status === "waiting")) workflow = existing;
    }
    if (!workflow) {
      workflow = await ports.createWorkflow({
        projectId: project.id,
        ...(parentRunId ? { parentRunId } : {}),
        approvalPolicy: project.confirmationRequired === true ? "confirm-before-execution" : "automatic",
      });
    }
    project.workflowId = workflow.workflowId;

    const caseDigest = ports.digest(project.cases);
    const generationInput = project.caseGeneration ? {
      projectId: project.id,
      artifactId: project.caseGeneration.artifactId,
      version: project.caseGeneration.version,
      generationDigest: project.caseGeneration.digest,
      requirementsDigest: ports.digest(project.caseGeneration.requirements),
      sourceRoles: project.sourceRoles ?? [],
    } : { projectId: project.id, sourceText: project.sourceText, caseMode: project.caseMode };
    const generationOutput = project.caseGeneration
      ? `case-generation:${project.caseGeneration.artifactId}:v${project.caseGeneration.version}:${project.caseGeneration.digest}`
      : `project:${project.id}:case-snapshot:${caseDigest}`;
    const snapshots: Array<{ stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist; input: unknown; artifact: string }> = [
      { stageId: "generate-cases", specialist: "case-generator", input: generationInput, artifact: generationOutput },
      { stageId: "review-cases", specialist: "case-reviewer", input: { cases: project.cases, caseGenerationDigest: project.caseGeneration?.digest }, artifact: `project:${project.id}:validated-case-snapshot:${caseDigest}` },
      { stageId: "author-steps", specialist: "step-author", input: { caseIds: project.cases.map(item => item.id), steps: project.cases.map(item => ({ id: item.id, steps: item.steps })) }, artifact: `project:${project.id}:step-snapshot:${ports.digest(project.cases.map(item => ({ id: item.id, steps: item.steps })))}` },
    ];
    let current = await ports.getWorkflow(workflow.workflowId);
    const activeStage = [...(current?.stages ?? [])].reverse().find(stage => stage.status === "running" || stage.status === "waiting");
    if (!activeStage) {
      for (const snapshot of snapshots) {
        const started = await ports.startStage(workflow.workflowId, { stageId: snapshot.stageId, specialist: snapshot.specialist, input: snapshot.input });
        if (started.stage.status === "running") {
          await ports.completeStage(workflow.workflowId, snapshot.stageId, started.stage.attempt, [snapshot.artifact]);
        }
      }
    }

    current = await ports.getWorkflow(workflow.workflowId);
    let gate = [...(current?.stages ?? [])].reverse().find(stage => stage.stageId === "human-approval" && (stage.status === "running" || stage.status === "waiting"));
    if (!gate && !activeStage) {
      const started = await ports.startStage(workflow.workflowId, {
        stageId: "human-approval",
        specialist: "human-review-gate",
        input: { projectId: project.id, reviewStatus: project.reviewStatus ?? "draft", caseDigest },
      });
      gate = started.stage;
    }
    if (gate?.status === "waiting" && gate.approval.status === "pending" && project.reviewStatus === "approved") {
      await ports.approveStage(workflow.workflowId, "human-approval", gate.attempt, { approved: true, note: project.reviewNotes ?? "Existing project approval." });
      current = await ports.getWorkflow(workflow.workflowId);
      gate = current?.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt);
    }
    if (gate?.status === "waiting" && gate.approval.status !== "pending") {
      await ports.resumeStage(workflow.workflowId, "human-approval", gate.attempt);
      current = await ports.getWorkflow(workflow.workflowId);
      gate = current?.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt);
    }
    if (gate?.status === "running" && project.reviewStatus === "approved") {
      await ports.completeStage(workflow.workflowId, "human-approval", gate.attempt, [`project:${project.id}:approval:${ports.digest(project.reviewNotes ?? "")}`]);
    } else if (gate?.status === "running") {
      await ports.waitStage(workflow.workflowId, "human-approval", gate.attempt, "项目尚未通过审核；等待用户确认或补充测试范围。");
    }
    await ports.saveProject(project);
    const result = await ports.getWorkflow(workflow.workflowId);
    if (!result) throw new Error(`项目关联的 workflow ${workflow.workflowId} 完成阶段准备后无法读取。`);
    return result;
  }

  return { ensureProjectWorkflow, completeApprovalGate };
}
