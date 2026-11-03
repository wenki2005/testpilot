import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserCheck, DocumentProject, DocumentProjectRevision, StepGenerationCaseResult } from "../../domain/document-test-model.js";
import { documentBody, fail, json } from "./http-utils.js";

export interface DocumentProjectCaseAuthoringRouteDependencies {
  getProject(id: string): Promise<DocumentProject | undefined>;
  getRevision(projectId: string, revisionId: string): Promise<DocumentProjectRevision | undefined>;
  mutateProject(projectId: string, update: (project: DocumentProject) => void): Promise<DocumentProject | undefined>;
  validateCases(cases: unknown[]): BrowserCheck[];
  saveProject(project: DocumentProject): Promise<void>;
  modelAvailable(): boolean;
  prepareSelectedBrowserCases?(project: DocumentProject, caseIds: string[]): Promise<unknown>;
  generateSelectedBrowserSteps(project: DocumentProject, caseIds: string[]): Promise<{
    generatedCaseIds: string[]; blockedCaseIds: string[]; blockedReasons: Array<{ caseId: string; reason: string }>;
    caseResults: StepGenerationCaseResult[]; warning: string;
  }>;
  repairBlockedBrowserSteps(project: DocumentProject, caseIds: string[]): Promise<{
    attemptedCaseIds: string[]; repairedCaseIds: string[]; blockedCaseIds: string[]; caseResults: StepGenerationCaseResult[]; warning: string; regressionStarted: false;
  }>;
  generateBrowserCaseSet(project: DocumentProject): Promise<DocumentProject>;
}

/** HTTP contracts for document project case and browser-step authoring actions. */
export async function handleDocumentProjectCaseAuthoringRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentProjectCaseAuthoringRouteDependencies): Promise<boolean> {
  if (req.method !== "POST") return false;
  const restoreMatch = pathname.match(/^\/api\/document-projects\/([^/]+)\/cases\/([^/]+)\/restore-steps$/);
  if (restoreMatch) {
    const projectId = decodeURIComponent(restoreMatch[1]!);
    const caseId = decodeURIComponent(restoreMatch[2]!);
    let data: any;
    try { data = await documentBody(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => key !== "revisionId") || typeof data.revisionId !== "string" || !/^[0-9a-f-]{36}$/iu.test(data.revisionId)) {
      fail(res, 400, "恢复步骤版本需要提供有效的 revisionId。"); return true;
    }
    try {
      const revision = await deps.getRevision(projectId, data.revisionId);
      if (!revision || revision.id !== data.revisionId || revision.projectId !== projectId || revision.kind !== "steps" || revision.entityId !== caseId) { fail(res, 404, "步骤修订不存在或不属于该项目和用例。"); return true; }
      let restoredVersion = revision.version;
      const project = await deps.mutateProject(projectId, current => {
        const index = current.cases.findIndex(item => item.id === caseId);
        if (index < 0) throw new Error("目标用例不属于当前项目。");
        if (!Array.isArray(revision.snapshot)) throw new Error("步骤修订快照格式无效；未修改当前用例。");
        const item = current.cases[index]!;
        const validated = deps.validateCases([{ ...item, steps: revision.snapshot }])[0];
        if (!validated) throw new Error("步骤修订快照未通过当前 BrowserStep 校验；未修改当前用例。");
        current.cases[index] = { ...item, steps: validated.steps, lifecycleStatus: "draft", selectedForRegression: false };
        current.reviewStatus = "draft";
        current.reviewNotes = `已恢复用例 ${caseId} 的步骤历史版本 v${revision.version}；请重新审核，恢复操作没有启动测试。`;
        if (current.stepAuthoring) {
          const results = current.stepAuthoring.results.filter(result => result.caseId !== caseId);
          if (results.length) current.stepAuthoring = { ...current.stepAuthoring, results };
          else delete current.stepAuthoring;
        }
        current.updatedAt = new Date().toISOString();
      });
      if (!project) { fail(res, 404, "文档测试项目不存在。"); return true; }
      json(res, 200, { project, restoredCaseId: caseId, restoredFromRevisionId: revision.id, restoredRevisionVersion: restoredVersion, requiresReview: true, regressionStarted: false });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "恢复步骤历史版本失败。"); }
    return true;
  }
  const match = pathname.match(/^\/api\/document-projects\/([^/]+)\/(generate-steps|repair-steps|generate-cases|prepare-execution)$/);
  if (!match) return false;
  const projectId = decodeURIComponent(match[1]!);
  const action = match[2]!;
  const project = await deps.getProject(projectId);
  if (!project) { fail(res, 404, "文档测试项目不存在。"); return true; }
  let data: any;
  try { data = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }

  if (action === "generate-cases") {
    if (!deps.modelAvailable()) { fail(res, 409, "AI 候选用例生成需要先配置模型 API Key。现有手工维护流程仍可使用。"); return true; }
    try {
      await deps.generateBrowserCaseSet(project);
      await deps.saveProject(project);
      json(res, 200, project);
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
    return true;
  }

  if (action === "generate-steps" || action === "prepare-execution") {
    if (!deps.modelAvailable()) { fail(res, 409, "AI 步骤草稿需要先配置兼容模型 API。现有手动编辑流程仍可使用。"); return true; }
    if (!Array.isArray(data?.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || caseId.length > 80)) { fail(res, 400, "批量生成需要提供 1–200 个 caseIds。"); return true; }
    const caseIds = [...new Set<string>(data.caseIds)];
    if (caseIds.some(caseId => !project.cases.some(item => item.id === caseId))) { fail(res, 404, "待生成列表中存在不属于该项目的用例 ID。"); return true; }
    try {
      if (action === 'prepare-execution' && !deps.prepareSelectedBrowserCases) { fail(res, 409, '当前运行器没有自动准备能力。'); return true; }
      const outcome = action === 'prepare-execution'
        ? await deps.prepareSelectedBrowserCases!(project, caseIds)
        : await deps.generateSelectedBrowserSteps(project, caseIds);
      await deps.saveProject(project);
      json(res, 200, { projectId: project.id, requested: caseIds.length, ...(outcome as object) });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
    return true;
  }

  if (!deps.modelAvailable()) { fail(res, 409, "Agent 修订需要先配置兼容模型 API。现有手动编辑流程仍可使用。"); return true; }
  if (!Array.isArray(data?.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 50 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || caseId.length > 80)) { fail(res, 400, "复查需要提供 1–50 个阻塞用例 ID。"); return true; }
  const caseIds = [...new Set<string>(data.caseIds)];
  if (caseIds.some(caseId => !project.cases.some(item => item.id === caseId))) { fail(res, 404, "复查列表中存在不属于该项目的用例 ID。"); return true; }
  try {
    const outcome = await deps.repairBlockedBrowserSteps(project, caseIds);
    await deps.saveProject(project);
    json(res, 200, { project, requested: caseIds.length, ...outcome });
  } catch (error) {
    fail(res, 422, error instanceof Error ? error.message : String(error));
  }
  return true;
}
