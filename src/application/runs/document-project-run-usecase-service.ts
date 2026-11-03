import type { CheckpointRecoveryRequest, DocumentProject, DocumentRunMode, DocumentRunScopePlan, DocumentRun, DocumentSiteVersion } from "../../domain/document-test-model.js";
import type { DocumentExecutionStage, DocumentWorkflowStageId, DocumentWorkflowSpecialist } from "../../domain/document-workflow.js";
import { createDocumentRunWorkflowCoordinator, type DocumentRunWorkflowPorts } from "./document-run-workflow-coordinator.js";
import type { DocumentProjectRunSubmissionResult, DocumentRunWorkflowLifecycle } from "./document-project-run-submission-service.js";
import type { PreparedDocumentProjectRun } from "./document-project-run-preparation-service.js";

export interface DocumentProjectRunRecoverySnapshot {
  runId: string;
  canResume: boolean;
  workflowId?: string | undefined;
  selectedCaseIds?: string[] | undefined;
  runMode?: DocumentRunMode | undefined;
  siteVersionSnapshot?: DocumentSiteVersion | undefined;
  baselineRunId?: string | undefined;
  testDataSetId?: string | undefined;
  parameterValues?: Record<string, string> | undefined;
  parentRunId?: string | undefined;
  retestNotes?: string | undefined;
  retestScopeNote?: string | undefined;
  reason?: string | undefined;
}

export interface DocumentProjectRunExecutionContext<TOptions extends object> {
  project: DocumentProject;
  action: PreparedDocumentProjectRun["action"];
  runId: string;
  resumeRunId?: string;
  workflowId: string;
  runMode: DocumentRunMode;
  runScopePlan?: DocumentRunScopePlan;
  siteVersionSnapshot?: DocumentSiteVersion;
  baselineRunId?: string;
  testDataSetId?: string;
  parameterValues: Record<string, string>;
  selectedCaseIds: string[];
  parentRunId?: string;
  checkpointRecovery?: CheckpointRecoveryRequest;
  retestSelected: boolean;
  retestNotes?: string;
  retestScopeNote?: string;
  workflow: DocumentRunWorkflowLifecycle & { onStage(stage: DocumentExecutionStage): Promise<void> };
}

export interface DocumentProjectRunUsecaseDependencies<TOptions extends object> {
  prepare(project: DocumentProject, action: string, body: unknown): Promise<PreparedDocumentProjectRun>;
  repairNoApiAssertions(project: DocumentProject, runMode: DocumentRunMode, selectedCaseIds: string[]): Promise<{ requiresReview: boolean; repairedCaseIds: string[] }>;
  getRecovery(project: DocumentProject): Promise<DocumentProjectRunRecoverySnapshot | undefined>;
  getWorkflow(workflowId: string): Promise<{ workflowId: string } | undefined>;
  ensureWorkflow(project: DocumentProject, parentRunId?: string): Promise<{ workflowId: string }>;
  workflowPorts: DocumentRunWorkflowPorts;
  digest(value: unknown): string;
  createRunId(): string;
  buildExecutionOptions(context: DocumentProjectRunExecutionContext<TOptions>): TOptions;
  submit(input: { action: PreparedDocumentProjectRun["action"]; projectId: string; project: DocumentProject; runId: string; executionOptions: TOptions; workflow: DocumentRunWorkflowLifecycle }): Promise<DocumentProjectRunSubmissionResult>;
}

export type DocumentProjectRunUsecaseResult =
  | { kind: "review-required"; message: string; repairedCaseIds: string[]; project: DocumentProject }
  | { kind: "review-pending"; message: string }
  | { kind: "resume-unavailable"; status: 400 | 409; message: string }
  | { kind: "submitted"; result: DocumentProjectRunSubmissionResult };

/** Complete run/start/resume/retest use case; HTTP remains responsible for parsing and response mapping. */
export function createDocumentProjectRunUsecaseService<TOptions extends object>(deps: DocumentProjectRunUsecaseDependencies<TOptions>) {
  return {
    async execute(project: DocumentProject, requestedAction: string, body: unknown): Promise<DocumentProjectRunUsecaseResult> {
      const prepared = await deps.prepare(project, requestedAction, body);
      let action = prepared.action;
      let {
        parentRunId, checkpointRecovery, retestSelectedCaseIds, retestNotes, retestScopeNote,
        requestedRunMode, runScopePlan, requestedCaseIds, runSiteVersion,
        baselineRunId, testDataSetId, parameterValues, runProject,
      } = prepared;

      if ((action === "run" || action === "start") && requestedCaseIds) {
        const repair = await deps.repairNoApiAssertions(project, requestedRunMode, requestedCaseIds);
        if (repair.requiresReview) {
          return {
            kind: "review-required",
            message: "已为选中用例自动补上 fetch/XHR 断言。请复核新增步骤和 coverage gap 后再运行。",
            repairedCaseIds: repair.repairedCaseIds,
            project,
          };
        }
      }
      if (project.reviewStatus !== "approved") return { kind: "review-pending", message: "请先编辑并人工审核通过用例，再启动执行。" };

      const resumeRunId = action === "resume" && typeof body === "object" && body !== null ? (body as Record<string, unknown>).runId : undefined;
      if (action === "resume" && (typeof resumeRunId !== "string" || !resumeRunId || resumeRunId.length > 80)) {
        return { kind: "resume-unavailable", status: 400, message: "恢复运行需要提供有效的 runId。" };
      }

      let recoveryWorkflowId: string | undefined;
      let resumeSelectedCaseIds: string[] | undefined;
      if (action === "resume") {
        const recovery = await deps.getRecovery(project);
        if (!recovery || recovery.runId !== resumeRunId || !recovery.canResume) {
          return { kind: "resume-unavailable", status: 409, message: recovery?.reason ?? "找不到可恢复的中断运行；请启动一轮新测试。" };
        }
        runSiteVersion = recovery.siteVersionSnapshot;
        runProject = runSiteVersion ? { ...project, targetUrl: runSiteVersion.targetUrl } : project;
        recoveryWorkflowId = recovery.workflowId;
        requestedRunMode = recovery.runMode ?? "compare";
        resumeSelectedCaseIds = recovery.selectedCaseIds;
        baselineRunId = recovery.baselineRunId;
        testDataSetId = recovery.testDataSetId;
        parameterValues = recovery.parameterValues ?? {};
        parentRunId = recovery.parentRunId ?? parentRunId;
        retestNotes = recovery.retestNotes ?? retestNotes;
        retestScopeNote = recovery.retestScopeNote ?? retestScopeNote;
      }

      const workflow = recoveryWorkflowId
        ? await deps.getWorkflow(recoveryWorkflowId)
        : await deps.ensureWorkflow(project, parentRunId);
      if (!workflow) throw new Error(`当前运行关联的 workflow ${recoveryWorkflowId ?? "unknown"} 无法读取。`);

      const runId = typeof resumeRunId === "string" ? resumeRunId : deps.createRunId();
      const selectedCaseIds = resumeSelectedCaseIds ?? requestedCaseIds;
      if (!selectedCaseIds?.length) throw new Error("运行范围缺少已固定的用例 ID；拒绝回退到项目全量选择。");
      const nonRunnableIds = selectedCaseIds.filter(caseId => !project.cases.some(item => item.id === caseId && item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled"));
      if (nonRunnableIds.length) throw new Error(`本轮范围包含不存在、草稿或已停用用例：${nonRunnableIds.join(", ")}`);

      const coordinator = createDocumentRunWorkflowCoordinator(deps.workflowPorts, {
        workflowId: workflow.workflowId,
        runId,
        projectId: project.id,
        projectDigest: deps.digest({ project: runProject, siteVersionSnapshot: runSiteVersion }),
        selectedCaseIds,
        runMode: requestedRunMode,
        ...(runSiteVersion ? { siteVersionSnapshot: runSiteVersion } : {}),
        ...(parentRunId ? { parentRunId } : {}),
        ...(retestNotes ? { retestNotes } : {}),
        ...(retestScopeNote ? { retestScopeNote } : {}),
      });
      if (typeof resumeRunId === "string") await coordinator.linkRun(resumeRunId);

      const executionOptions = deps.buildExecutionOptions({
        project: runProject,
        action,
        runId,
        ...(typeof resumeRunId === "string" ? { resumeRunId } : {}),
        workflowId: workflow.workflowId,
        runMode: requestedRunMode,
        ...(!resumeRunId && runScopePlan ? { runScopePlan } : {}),
        ...(runSiteVersion ? { siteVersionSnapshot: runSiteVersion } : {}),
        ...(baselineRunId ? { baselineRunId } : {}),
        ...(testDataSetId ? { testDataSetId } : {}),
        parameterValues,
        selectedCaseIds,
        ...(parentRunId && (retestSelectedCaseIds || resumeSelectedCaseIds) ? { parentRunId } : {}),
        ...(checkpointRecovery ? { checkpointRecovery: structuredClone(checkpointRecovery) } : {}),
        retestSelected: Boolean(retestSelectedCaseIds || resumeSelectedCaseIds),
        ...(retestNotes ? { retestNotes } : {}),
        ...(retestScopeNote ? { retestScopeNote } : {}),
        workflow: coordinator,
      });
      const result = await deps.submit({ action, projectId: project.id, project, runId, executionOptions, workflow: coordinator });
      return { kind: "submitted", result };
    },
  };
}
