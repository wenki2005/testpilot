import { planCheckpointRecovery } from "../../domain/document-checkpoint-recovery-integrity.js";
import type { CheckpointRecoveryRequest, DocumentProject, DocumentRun, DocumentRunMode, DocumentRunScopePlan, DocumentSiteVersion } from "../../domain/document-test-model.js";
import { getDocumentCaseVersion, getDocumentMaterialVersion, validateDocumentRunScopePlan } from "../../domain/document-run-scope.js";
import { planDocumentCaseDependencies } from "../../domain/document-dependency-plan.js";
import { isDocumentBaselineEligible } from "../../domain/document-baseline-comparison.js";
import type { RecoveryReadiness } from "./document-run-recovery-readiness-service.js";

export class DocumentProjectRunPreparationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface DocumentProjectRunPreparationDependencies {
  getRun(runId: string): Promise<DocumentRun | undefined>;
  isBaselineEligible(run: DocumentRun): boolean;
  resolveParameters(project: DocumentProject, selectedCaseIds: string[], testDataSetId: string | undefined, values: Record<string, string>): Record<string, string>;
  getReadiness?(runId: string): Promise<RecoveryReadiness | undefined>;
  now?(): string;
}

export type PreparedDocumentProjectRun = {
  action: "run" | "start" | "resume";
  parentRunId?: string;
  checkpointRecovery?: CheckpointRecoveryRequest;
  retestSelectedCaseIds?: string[];
  retestNotes?: string;
  retestScopeNote?: string;
  requestedRunMode: DocumentRunMode;
  runScopePlan?: DocumentRunScopePlan;
  requestedCaseIds?: string[];
  runSiteVersion?: DocumentSiteVersion;
  baselineRunId?: string;
  testDataSetId?: string;
  parameterValues: Record<string, string>;
  runProject: DocumentProject;
};

/** Validate and freeze the selected input for run, resume and targeted-retest use cases. */
export function createDocumentProjectRunPreparationService(deps: DocumentProjectRunPreparationDependencies) {
  return async function prepare(project: DocumentProject, requestedAction: string, data: any): Promise<PreparedDocumentProjectRun> {
    if (requestedAction !== "checkpoint-retry" && data && typeof data === "object" && (Object.hasOwn(data, "adviceRecordId") || Object.hasOwn(data, "adoptedAdvice") || Object.hasOwn(data, "checkpointRecovery"))) throw new DocumentProjectRunPreparationError(400, "调查建议采纳字段仅允许 checkpoint-retry，审计正文由服务器生成。");
    let action = requestedAction as PreparedDocumentProjectRun["action"] | "retest";
    let parentRunId: string | undefined;
    let retestSelectedCaseIds: string[] | undefined;
    let retestNotes: string | undefined;
    let retestScopeNote: string | undefined;
    let requestedRunMode: DocumentRunMode = "regression";
    let runScopePlan: DocumentRunScopePlan | undefined;
    let requestedCaseIds: string[] | undefined;
    let runSiteVersion: DocumentSiteVersion | undefined;
    let baselineRunId: string | undefined;
    let testDataSetId: string | undefined;
    let parameterValues: Record<string, string> = {};
    let checkpointRecovery = false;
    let frozenCheckpointRecovery: PreparedDocumentProjectRun["checkpointRecovery"];
    const runProject = project;

    if (requestedAction === "checkpoint-retry") {
      checkpointRecovery = true;
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["parentRunId", "caseId", "stepIndex", "adviceRecordId"].includes(key)) || Object.hasOwn(data, "adoptedAdvice") || Object.hasOwn(data, "checkpointRecovery") || typeof data.parentRunId !== "string" || typeof data.caseId !== "string" || !Number.isInteger(data.stepIndex) || data.adviceRecordId !== undefined && (typeof data.adviceRecordId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(data.adviceRecordId))) throw new DocumentProjectRunPreparationError(400, "恢复需要父运行、用例 ID、整数步骤编号和可选有效 adviceRecordId；不得提交审计正文。");
      const parent = await deps.getRun(data.parentRunId);
      if (!parent || parent.projectId !== project.id) throw new DocumentProjectRunPreparationError(404, "父运行不存在或不属于当前项目。");
      let recoveryPlan: ReturnType<typeof planCheckpointRecovery>;
      try { recoveryPlan = planCheckpointRecovery(project, parent, data.caseId, data.stepIndex); }
      catch (error) { throw new DocumentProjectRunPreparationError(409, (error as Error).message); }
      frozenCheckpointRecovery = { parentRunId: parent.id, caseId: data.caseId, stepIndex: data.stepIndex };
      if (data.adviceRecordId !== undefined) {
        if (!deps.getReadiness) throw new DocumentProjectRunPreparationError(409, "当前服务未提供可验证的恢复调查建议。");
        let readiness: RecoveryReadiness | undefined;
        try { readiness = await deps.getReadiness(parent.id); }
        catch { throw new DocumentProjectRunPreparationError(503, "暂时无法核对调查建议，请刷新恢复条件后重试。"); }
        const recommendation = readiness?.advice.recommendations.find(item => item.caseId === data.caseId && item.category === "environment" && item.strategy === "rebuild-readonly-case");
        const candidate = readiness?.candidates.find(item => item.caseId === data.caseId && item.stepIndex === data.stepIndex);
        if (!readiness || readiness.status !== "ready" || readiness.parentRunId !== parent.id || readiness.projectId !== project.id || readiness.advice.state !== "available" || readiness.advice.provisional !== true || readiness.advice.recordId !== data.adviceRecordId || typeof readiness.advice.runDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(readiness.advice.runDigest) || !recommendation || !candidate) throw new DocumentProjectRunPreparationError(409, "调查建议已不可验证、与父运行/项目不符，或不匹配该用例与检查点。");
        frozenCheckpointRecovery.adoptedAdvice = { recordId: readiness.advice.recordId!, runDigest: readiness.advice.runDigest!, caseId: recommendation.caseId, category: recommendation.category, strategy: recommendation.strategy, summary: recommendation.summary, evidence: recommendation.evidence, adoptedAt: deps.now?.() ?? new Date().toISOString() };
        frozenCheckpointRecovery = structuredClone(frozenCheckpointRecovery);
      }
      data = { parentRunId: parent.id, caseIds: recoveryPlan.selectedCaseIds, notes: `人工从检查点恢复：${data.caseId} 第 ${data.stepIndex + 1} 步。原执行栈已结束；新运行重建只读前置并从当前用例第一步验证，不跳过断言；原运行保持不变。` };
      action = "retest";
    }

    if (action === "retest") {
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["parentRunId", "caseIds", "notes", "runMode"].includes(key)) || typeof data.parentRunId !== "string" || !Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) || new Set(data.caseIds).size !== data.caseIds.length || data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 2000) || data.runMode !== undefined && data.runMode !== "regression" && data.runMode !== "compare") {
        throw new DocumentProjectRunPreparationError(400, "重测需要 parentRunId、1–200 个唯一 caseIds、可选 runMode 和不超过 2000 字的说明。");
      }
      const parent = await deps.getRun(data.parentRunId);
      if (!parent || parent.projectId !== project.id) throw new DocumentProjectRunPreparationError(404, "父运行不存在或不属于当前项目。");
      if ((parent.sessionProfileSnapshot?.id ?? null) !== (project.activeSessionProfileId ?? null)) throw new DocumentProjectRunPreparationError(409, "当前账号档案与父运行不同；请先选择原档案或启动新运行。");
      runSiteVersion = parent.siteVersionSnapshot;
      baselineRunId = parent.baselineRunId;
      testDataSetId = parent.testDataSetId;
      parameterValues = parent.parameterValues ?? {};
      if ((project.siteVersions?.length ?? 0) > 0 && !runSiteVersion) throw new DocumentProjectRunPreparationError(409, "父运行没有网站版本快照；为避免把新版本误当作原基线，不能从该历史运行自动重测。请手动运行并明确选择版本。");
      requestedRunMode = parent.runMode ?? "compare";
      if (data.runMode !== undefined && data.runMode !== requestedRunMode) throw new DocumentProjectRunPreparationError(409, "定向重测必须沿用父运行的执行模式；如需切换模式，请启动一轮新运行。");
      if (parent.materialVersion && parent.materialVersion !== getDocumentMaterialVersion(project)) throw new DocumentProjectRunPreparationError(409, "项目需求/测试资料版本已变化；为避免在不同测试依据上改写旧结果，不能从该运行创建定向重测。请启动一轮新运行并选择历史基线。");
      if (!checkpointRecovery && (!parent.caseVersion || parent.caseVersion !== getDocumentCaseVersion(project))) throw new DocumentProjectRunPreparationError(409, "项目用例、预期、步骤或执行配置已变化；为避免改写旧基线，不允许从该运行创建定向重测。请重新审核并启动新运行。");
      if (project.apiContract?.allowMutations === true) throw new DocumentProjectRunPreparationError(409, "当前项目允许 API 写请求；无法确认重测副作用是否幂等，禁止自动重放。请撤销写授权并重新审核后再选安全用例重测。");
      const parentScope = new Set(parent.caseScope.selectedCaseIds);
      const currentCaseIds = new Set(project.cases.map(item => item.id));
      const invalid = data.caseIds.filter((caseId: string) => !parentScope.has(caseId) || !currentCaseIds.has(caseId));
      if (invalid.length) throw new DocumentProjectRunPreparationError(422, `重测用例必须属于父运行的原始选中范围且仍存在：${invalid.join(", ")}`);
      const unsafe = project.cases.filter(item => data.caseIds.includes(item.id) && (item.sideEffectRisk !== "none" || (item.preconditions?.length ?? 0) > 0 && item.preconditionsConfirmed !== true));
      if (unsafe.length) throw new DocumentProjectRunPreparationError(409, `定向自动重测仅接受已确认前置条件且标记为无副作用的用例；请先核对并审核：${unsafe.map(item => item.id).join(", ")}`);
      const retestIds = [...data.caseIds] as string[];
      const retestTargetIds = parent.scopePlan?.targetCaseIds.filter(caseId => retestIds.includes(caseId)) ?? [];
      const retestImpactIds = parent.scopePlan?.impactCaseIds.filter(caseId => retestIds.includes(caseId)) ?? [];
      const parentScopeKnown = Boolean(parent.scopePlan && retestIds.every(caseId => parent.scopePlan!.targetCaseIds.includes(caseId) || parent.scopePlan!.impactCaseIds.includes(caseId)));
      const currentTargetIds = parentScopeKnown ? retestTargetIds : retestIds;
      const currentImpactIds = parentScopeKnown ? retestImpactIds : [];
      const impactReasons = Object.fromEntries(currentImpactIds.flatMap(caseId => {
        const reasons = parent.scopePlan?.impactReasons?.[caseId];
        return reasons?.length ? [[caseId, reasons]] : [];
      }));
      runScopePlan = { mode: currentImpactIds.length ? "impact" : currentTargetIds.length === 1 ? "single" : "custom", targetCaseIds: currentTargetIds, impactCaseIds: currentImpactIds, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) };
      const parentImpactSummary = retestImpactIds.slice(0, 5).map(caseId => {
        const title = parent.caseTitles?.[caseId] ?? caseId;
        const reasons = parent.scopePlan?.impactReasons?.[caseId];
        return `${title}（${caseId}）${reasons?.length ? `：${reasons.slice(0, 3).join("；")}` : ""}`;
      }).join("；");
      const parentImpactMissingReasonCount = retestImpactIds.filter(caseId => !parent.scopePlan?.impactReasons?.[caseId]?.length).length;
      const parentScopeNote = parentScopeKnown
        ? `父运行 ${parent.id} 的本次重测来源：原直接目标 ${retestTargetIds.length} 条，原关联影响 ${retestImpactIds.length} 条${parentImpactSummary ? `；原关联影响依据：${parentImpactSummary}` : ""}${retestImpactIds.length > 5 ? `；另有 ${retestImpactIds.length - 5} 条关联影响用例` : ""}${parentImpactMissingReasonCount ? `；${parentImpactMissingReasonCount} 条关联影响用例的历史依据未留存，本次保留原分类并标明依据缺失` : ""}。`
        : `父运行 ${parent.id} 未记录可核对的直接目标/关联影响分类；本次按定向重测目标留档。`;
      parentRunId = data.parentRunId;
      retestSelectedCaseIds = [...data.caseIds];
      requestedCaseIds = [...data.caseIds];
      retestNotes = (typeof data.notes === "string" ? data.notes.trim() : "定向重测父运行失败或未验证用例。").slice(0, 2000);
      retestScopeNote = parentScopeNote.slice(0, 1000);
      action = "start";
    }

    if ((action === "start" || action === "run") && !requestedCaseIds) {
      if (project.platform && (project.platform.type === "unknown" || project.platform.status !== "confirmed")) throw new DocumentProjectRunPreparationError(409, "项目端类型尚未确认；请先明确选择 PC 网页、移动网页或企微工作台，并按对应模板复核后再运行。");
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["runMode", "selectedCaseIds", "siteVersionId", "baselineRunId", "testDataSetId", "parameterValues", "scopePlan"].includes(key)) || data.runMode !== undefined && data.runMode !== "regression" && data.runMode !== "compare" || data.siteVersionId !== undefined && (typeof data.siteVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.siteVersionId)) || data.baselineRunId !== undefined && (typeof data.baselineRunId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(data.baselineRunId)) || data.testDataSetId !== undefined && (typeof data.testDataSetId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.testDataSetId)) || data.parameterValues !== undefined && (!data.parameterValues || typeof data.parameterValues !== "object" || Array.isArray(data.parameterValues) || Object.keys(data.parameterValues).length > 100 || Object.entries(data.parameterValues).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u.test(key) || typeof value !== "string" || value.length > 500)) || !Array.isArray(data.selectedCaseIds) || data.selectedCaseIds.length < 1 || data.selectedCaseIds.length > 200 || data.selectedCaseIds.some((caseId: unknown) => typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) || new Set(data.selectedCaseIds).size !== data.selectedCaseIds.length) {
        throw new DocumentProjectRunPreparationError(400, "运行需要显式提供 runMode、1–200 个唯一 selectedCaseIds，以及可选网站版本、历史基线、测试数据组和参数值；不会退回项目全量用例。");
      }
      requestedRunMode = data.runMode ?? "regression";
      requestedCaseIds = [...data.selectedCaseIds];
      try { runScopePlan = validateDocumentRunScopePlan(data.scopePlan, requestedCaseIds); }
      catch (error) { throw new DocumentProjectRunPreparationError(400, error instanceof Error ? error.message : "本轮测试范围说明无效。"); }
      if (runScopePlan?.impactCaseIds.length) {
        const missingReasons = runScopePlan.impactCaseIds.filter(caseId => !runScopePlan!.impactReasons?.[caseId]?.length);
        if (missingReasons.length) throw new DocumentProjectRunPreparationError(400, `每条关联影响用例都要有可追溯依据后才能启动：${missingReasons.join(", ")}。请重新分析或逐条确认关联关系。`);
      }
      const directIds = [...requestedCaseIds];
      let dependencyPlan;
      try { dependencyPlan = planDocumentCaseDependencies(project.cases, directIds); }
      catch (error) { throw new DocumentProjectRunPreparationError(422, error instanceof Error ? error.message : "依赖范围尚未就绪。"); }
      requestedCaseIds = dependencyPlan.orderedCases.map(item => item.id);
      runScopePlan ??= {
        mode: directIds.length === 1 ? "single" : "custom",
        targetCaseIds: directIds,
        impactCaseIds: [],
      };
      runScopePlan = {
        ...runScopePlan,
        prerequisiteCaseIds: dependencyPlan.prerequisiteCaseIds,
        orderedCaseIds: requestedCaseIds,
      };
      if (runScopePlan.handoffAfterPrerequisites === true) {
        if (dependencyPlan.prerequisiteCaseIds.length === 0) throw new DocumentProjectRunPreparationError(422, "前置完成后接管仅适用于本轮确有自动前置用例的范围。");
        const unsafePrerequisites = dependencyPlan.orderedCases.filter(item => dependencyPlan.prerequisiteCaseIds.includes(item.id)
          && (item.sideEffectRisk !== "none" || (item.preconditions.length > 0 && !item.preconditionsConfirmed)));
        if (unsafePrerequisites.length) throw new DocumentProjectRunPreparationError(422, `前置完成后接管仅允许已确认的只读前置用例：${unsafePrerequisites.map(item => item.id).join(", ")}`);
      }
      baselineRunId = data.baselineRunId;
      testDataSetId = data.testDataSetId;
      parameterValues = data.parameterValues ?? {};
    }

    if (retestSelectedCaseIds?.length) {
      let dependencyPlan;
      try { dependencyPlan = planDocumentCaseDependencies(project.cases, retestSelectedCaseIds); }
      catch (error) { throw new DocumentProjectRunPreparationError(422, error instanceof Error ? error.message : "依赖范围尚未就绪。"); }
      requestedCaseIds = dependencyPlan.orderedCases.map(item => item.id);
      const unsafe = dependencyPlan.orderedCases.filter(item => item.sideEffectRisk !== "none" || (item.preconditions.length > 0 && !item.preconditionsConfirmed));
      if (unsafe.length) throw new DocumentProjectRunPreparationError(409, `恢复前置仅接受已确认的只读用例：${unsafe.map(item => item.id).join(", ")}`);
      runScopePlan = { ...runScopePlan!, prerequisiteCaseIds: dependencyPlan.prerequisiteCaseIds, orderedCaseIds: requestedCaseIds };
    }

    if (action === "start" || action === "run") {
      if (baselineRunId) {
        const baseline = await deps.getRun(baselineRunId);
        if (!baseline || baseline.projectId !== project.id || !deps.isBaselineEligible(baseline)) throw new DocumentProjectRunPreparationError(422, "历史基线必须属于当前项目，并且是已完成、范围明确且所选用例均有确定结果的运行。");
      }
      const allowedIds = new Set(project.cases.filter(item => item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled" && (item.selectedForRegression !== false || runScopePlan?.prerequisiteCaseIds?.includes(item.id))).map(item => item.id));
      const invalidIds = requestedCaseIds!.filter(caseId => !allowedIds.has(caseId));
      testDataSetId = data.testDataSetId ?? testDataSetId;
      try { parameterValues = deps.resolveParameters(project, requestedCaseIds!, testDataSetId, retestSelectedCaseIds ? parameterValues : data.parameterValues ?? {}); }
      catch (error) { throw new DocumentProjectRunPreparationError(422, error instanceof Error ? error.message : "本轮测试参数无效。"); }
      if (invalidIds.length) throw new DocumentProjectRunPreparationError(422, `本轮用例必须属于当前项目、处于可运行状态且已纳入回归选择；请先启用被取消选择的用例：${invalidIds.join(", ")}`);
      if (project.siteVersions?.length) {
        const versionId = runSiteVersion?.id ?? data.siteVersionId ?? project.activeSiteVersionId;
        runSiteVersion ??= project.siteVersions.find(item => item.id === versionId);
        if (!runSiteVersion || !project.siteVersions.some(item => item.id === runSiteVersion!.id)) throw new DocumentProjectRunPreparationError(422, "本轮必须选择一个属于当前项目的网站版本。");
      } else if (data.siteVersionId !== undefined) throw new DocumentProjectRunPreparationError(422, "该项目尚未登记网站版本；先登记版本后再用版本 ID 运行。");
    }

    return {
      action: action as PreparedDocumentProjectRun["action"],
      ...(parentRunId ? { parentRunId } : {}), ...(frozenCheckpointRecovery ? { checkpointRecovery: frozenCheckpointRecovery } : {}), ...(retestSelectedCaseIds ? { retestSelectedCaseIds } : {}), ...(retestNotes ? { retestNotes } : {}), ...(retestScopeNote ? { retestScopeNote } : {}),
      requestedRunMode, ...(runScopePlan ? { runScopePlan } : {}), ...(requestedCaseIds ? { requestedCaseIds } : {}), ...(runSiteVersion ? { runSiteVersion } : {}), ...(baselineRunId ? { baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues,
      runProject: runSiteVersion ? { ...runProject, targetUrl: runSiteVersion.targetUrl } : runProject,
    };
  };
}
