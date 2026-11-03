import { createHash,randomUUID } from "node:crypto";
import { mkdir,readFile,readdir,rename,unlink,writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "playwright";
import { createDocumentRunFinalizationService } from "../application/artifacts/document-run-finalization-service.js";
import { createDocumentRunPackagingService } from "../application/artifacts/document-run-packaging-service.js";
import { createDocumentRunResultSummaryService } from "../application/artifacts/document-run-result-summary-service.js";
import { generateAlignedDocumentRunSummary } from "../application/artifacts/document-run-summary-service.js";
import { autonomousPlanContextDigest } from '../application/cases/document-autonomous-plan-service.js';
import { activeDocumentRunRegistry } from "../application/runs/active-document-run-registry.js";
import { assertCheckpointRecoveryStart,type CheckpointRecoveryRequest } from '../application/runs/document-checkpoint-start-validation.js';
import { assertResumeExecutionJournalIntegrity } from '../application/runs/document-resume-start-validation.js';
import { buildDocumentRunCancellationResults } from "../application/runs/document-run-cancellation-result-service.js";
import { createDocumentRunDifferenceAnalysisService } from "../application/runs/document-run-difference-analysis-service.js";
import { createDocumentRunExecutionPreparationService } from "../application/runs/document-run-execution-preparation-service.js";
import { createDocumentRunJournalCoordinator } from "../application/runs/document-run-journal-coordinator.js";
import { executeDocumentRunLanes } from "../application/runs/document-run-lane-execution-service.js";
import { createDocumentRunLifecycleService } from "../application/runs/document-run-lifecycle-service.js";
import { createDocumentRunOutcomeService } from "../application/runs/document-run-outcome-service.js";
import { createDocumentRunRecoveryCoordinator } from "../application/runs/document-run-recovery-coordinator.js";
import { prepareDocumentRunScope } from "../application/runs/document-run-scope-preparation-service.js";
import { createDocumentRunStepGenerationService } from "../application/runs/document-run-step-generation-service.js";
import { isDocumentBaselineEligible } from "../domain/document-baseline-comparison.js";
import { createReviewCases } from "../domain/document-case-authoring.js";
import { planCaseExecution } from "../domain/document-case-routing.js";
import { validateCases } from "../domain/document-case-validation.js";
import { getDocumentMaterialVersion } from "../domain/document-run-scope.js";
import { resolveDocumentSessionProfileKey } from "../domain/document-session-profile.js";
import type { DocumentApiLane,ImportedDocument } from "../domain/document-test-contracts.js";
import type { BrowserCheck,CaseResult,DocumentProject,DocumentRun,DocumentRunEvidence,DocumentRunMode,DocumentRunScopePlan,DocumentSiteVersion,ExecutionJournal,LaneResult,StepGenerationCaseResult } from "../domain/document-test-model.js";
import { confidenceFromExpectation,inferCaseCategory } from "../domain/document-test-types.js";
import { reportMarkdown } from "../reporters/document-test-report.js";
import { createDocumentProjectStore } from "../storage/document-project-store.js";
import { createDocumentRunArtifactStore } from "../storage/document-run-artifact-store.js";
import { createDocumentRunStore } from "../storage/document-run-store.js";
import { completeChat } from "./ai/compatible-chat.js";
import { executeApprovedApiSuite,getApiSuiteCandidate } from "./api-suite-workflow.js";
import { dispatchDocumentRunApiLane } from "./api/document-run-api-adapter.js";
import { createAuthorizedRunBinding } from './authorized-run-binding.js';
import { disconnectPersistentTestPage,getExistingPersistentTestPage,launchPersistentTestPage,navigatePersistentPage } from "./browser-runtime.js";
import { resolveDocumentField,selectDocumentOption,selectDocumentOptionByPlaceholder,selectDocumentOptionByRoleIndex } from "./browser/document-form-controls.js";
import { createDocumentProjectSessionStatusAdapter } from "./browser/document-project-session-status.js";
import { createDocumentRunBrowserSessionCoordinator } from "./browser/document-run-browser-session.js";
import { createDocumentStepProbeAdapter } from "./browser/document-step-probe.js";
import { createProjectTargetPagePreparer } from "./browser/prepare-project-target-page.js";
import { runComputerUseLane,type VisualLane } from "./computer-use.js";
import { observeDepartmentBusinessEvidence } from './department-business-evidence.js';
import { collectDocumentAgentDatabaseEvidence } from './document-agent-database.js';
import { createDocumentBrowserLaneAdapter } from "./document-browser-lane.js";
import { buildDocumentPackageInput } from "./document-package-builder.js";
import { refreshDocumentPackage } from "./document-package-refresh.js";
import { captureCurrentPageEvidence } from "./document-page-evidence.js";
import { resolveBrowserStepParameters,resolveDocumentRunParameters } from "./document-run-parameters.js";
import { redactSensitiveExportData,redactSensitiveExportText } from "./document-sensitive-data.js";
import { getDocumentWorkflow } from "./document-workflow-record.js";
import { allowBrowserRequest,clearLoginHandoff,getLoginHandoff,isLoginPage,waitForUserLogin } from "./login-handoff.js";
import { createWecomRunNotifications } from './wecom-run-notifications.js';
export { getDocumentCaseVersion,getDocumentMaterialVersion,getDocumentTestDataVersion,validateDocumentRunScopePlan } from "../domain/document-run-scope.js";
export type { BaselineDisposition,BrowserCheck,BrowserStep,CaseComparison,CaseGenerationTrace,CaseLifecycleStatus,CasePriority,ComparisonResolution,CoverageSummary,DocumentBaselineComparison,DocumentCaseTriage,DocumentCaseTriageCategory,DocumentImpactAnalysis,DocumentProject,DocumentProjectRevision,DocumentProjectRevisionKind,DocumentProjectRevisionSummary,DocumentProjectSessionStatus,DocumentRun,DocumentRunBaselineSnapshot,DocumentRunDiagnostic,DocumentRunMode,DocumentRunProgress,DocumentRunRecovery,DocumentRunScopePlan,DocumentSiteVersion,DocumentSourceMaterial,DocumentStepProbe,DocumentTestDataSet,ExecutionRoute,SideEffectRisk,StepGenerationCaseResult } from "../domain/document-test-model.js";
export { validateCases };
export { compareDocumentRunToBaseline,isDocumentBaselineEligible } from "./document-baseline-comparison.js";
export { nonBrowserCaseWithoutStimulus,planCaseExecution } from "./document-case-routing.js";
export { classifyComparison,classifyDocumentCaseTriage } from "./document-result-classification.js";
export { collectDocumentParameterNames,resolveDocumentRunParameters } from "./document-run-parameters.js";

export function unsupportedWeChatClientGateMessage(text: string): string | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (/^请在(?:企业)?微信客户端(?:内|中)?打开(?:此|该)?链接[。！!]?$/u.test(normalized)) return normalized;
  if (/^please open (?:this )?link in (?:the )?(?:wechat|wecom)(?: work)? client[.!]?$/iu.test(normalized)) return normalized;
  return undefined;
}

/** Keep a concrete browser-lane defect observation visible when a broader case
 * remains blocked by an API/fixture gap. This is a lead for review, not a
 * replacement for the case's unresolved overall disposition. */
export { partialUiFindingNote } from "../domain/document-run-comparison.js";
export { getDocumentProject,getDocumentProjectRevision,listDocumentProjectRevisions,loadDocumentProjects,readDocumentSource,saveDocumentProject,writeDocumentSource };
const baseDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"), "document-tests");
export const documentRunNotifications = createWecomRunNotifications(path.join(baseDir, 'notifications'));
export const projectRepository = createDocumentProjectStore(baseDir);
const { loadProjects, saveProject, listRevisions, getRevision, writeSource, readSource, getProject } = projectRepository;
const loadDocumentProjects = loadProjects;
const saveDocumentProject = saveProject;
const listDocumentProjectRevisions = listRevisions;
const getDocumentProjectRevision = getRevision;
const writeDocumentSource = writeSource;
const readDocumentSource = readSource;
const getDocumentProject = getProject;
const runsDir = path.join(baseDir, "runs");
const runRepository = createDocumentRunStore(runsDir);
const documentRunArtifacts = createDocumentRunArtifactStore(runsDir);
/** Composition-only exports consumed by bootstrap; HTTP routes use application services. */
export const documentRunRepository = runRepository;
const prepareDocumentRunExecution = createDocumentRunExecutionPreparationService({
  readJournal: runRepository.readJournal,
  getRun: documentRunArtifacts.getRun,
  isBaselineEligible: isDocumentBaselineEligible,
  materialVersion: getDocumentMaterialVersion,
  runIdExists: runId => readdir(path.join(runsDir, runId)).then(() => true, () => false),
  createRunId: randomUUID,
  now: () => new Date().toISOString(),
});
const maxCases = 200;
const saveExecutionJournal = runRepository.writeJournal;
const documentRunLifecycle = createDocumentRunLifecycleService({
  repository: runRepository,
  registry: activeDocumentRunRegistry,
  getRun: documentRunArtifacts.getRun,
  getWorkflow: async workflowId => {
    const workflow = await getDocumentWorkflow(workflowId);
    return workflow ? { status: workflow.status, stages: workflow.stages.map(stage => ({ status: stage.status, ...(stage.error ? { error: { message: stage.error.message } } : {}) })) } : undefined;
  },
  disconnectPage: disconnectPersistentTestPage,
  packageInputExists: async runId => readFile(documentPackageInputPath(runId)).then(() => true, () => false),
});
const documentRunDifferenceAnalysis = createDocumentRunDifferenceAnalysisService({ complete: completeChat });
const documentRunResultSummary = createDocumentRunResultSummaryService({
  analyzeDifferences: documentRunDifferenceAnalysis.analyze,
  summarizeAligned: (project, run) => generateAlignedDocumentRunSummary(project, run, { complete: completeChat }),
});
const documentRunOutcome = createDocumentRunOutcomeService({
  summarize: documentRunResultSummary.summarize,
  renderReport: (project, run, summary) => reportMarkdown(project, run, summary, planCaseExecution),
  redact: redactSensitiveExportData,
});
const { projectDigest, canSafelyFinalizePackage: canSafelyFinalizeDocumentRunPackage } = documentRunLifecycle;
export { canSafelyFinalizeDocumentRunPackage };
export const cancelDocumentRun = documentRunLifecycle.cancel;
export const pauseDocumentRun = documentRunLifecycle.pause;
export const continueDocumentRun = documentRunLifecycle.continueRun;
export async function readDocumentRunEvidence(runId: string, evidenceId: string): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId) || !/^[0-9a-f-]{36}$/iu.test(evidenceId)) throw new Error("证据 ID 无效。");
  const journal = await runRepository.readJournal(runId);
  const reference = journal.evidence?.find(item => item.evidenceId === evidenceId && item.runId === runId && item.type === "screenshot" && item.relativeKey === `evidence/${evidenceId}.png`);
  if (!reference) throw new Error("该运行没有这份可读取截图证据。");
  const bytes = await readFile(path.join(runsDir, runId, "evidence", `${evidenceId}.png`));
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("截图证据校验失败。");
  return bytes;
}
export const getDocumentRunRecovery = documentRunLifecycle.getRecovery;
export const getDocumentRunProgress = documentRunLifecycle.getProgress;
const documentRunPackaging = createDocumentRunPackagingService({
  repository: runRepository,
  registry: activeDocumentRunRegistry,
  getProject: getDocumentProject,
  projectDigest,
  readPackageInput: runId => readFile(documentPackageInputPath(runId)),
  packageExists: filePath => readFile(filePath).then(() => true, () => false),
  finalizePackage: finalizeDocumentRunPackage,
  saveRun: async (run, journal) => {
    await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8").catch(() => undefined);
    await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8").catch(() => undefined);
    await saveExecutionJournal(journal).catch(() => undefined);
  },
});
export const retryDocumentRunPackaging = documentRunPackaging.retry;

export { createReviewCases } from "../domain/document-case-authoring.js";

/** Auto-start the safe executable subset while preserving unresolved selected cases for reporting. */
export { actionablePreconditions,addNoApiNetworkAssertion,browserStepDraftBlockReason,canAuthorReadOnlyBrowserSteps,deriveGroundedCustomerLookupSubcheck,deriveGroundedEmptyListNavigationSubcheck,deriveGroundedEmptyRequiredFieldSubcheck,deriveRelatedInvalidInputSubcheck,draftGroundedReadOnlyBrowserSteps,explainBlockedBrowserStepDraft,hasAutoRunnableSelectedCase,hasOnlyGenericShellAssertions,isSafeReadOnlyBrowserCase } from "../domain/document-case-authoring.js";

export function acquireDocumentPageLease(projectId: string): (() => void) | undefined {
  return activeDocumentRunRegistry.acquirePage(projectId);
}

/** Add deterministic fetch/XHR evidence to an existing, reviewed no-API UI flow.
 * This repairs an executable gap without asking a model to invent locators. The
 * remaining coverage note keeps the broad “no API” claim from being reported as
 * fully proven by a fetch/XHR-only observation. */
function safeTarget(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("请提供有效的应用网址。");
  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("网址仅支持 HTTP/HTTPS，且不能包含用户名或密码。");
  return url.toString();
}
export const validateDocumentTarget = safeTarget;

/** @deprecated Production composition creates the specialized browser probe adapter in bootstrap. */
export { createDocumentStepProbeAdapter };

export function makeDocumentProject(input: { name: unknown; fileName: unknown; document: ImportedDocument; targetUrl: unknown; sourceFiles?: string[]; researchExamples?: Array<{ title: string; url: string; snippet: string }>; caseMode?: "existing" | "ai" | "both" }): DocumentProject {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : String(input.fileName).slice(0, 120);
  const extractedCases = input.caseMode === "ai" ? [] : input.document.testCases;
  if ((extractedCases?.length ?? 0) > maxCases) throw new Error(`资料中有 ${extractedCases!.length} 条用例，单项目上限 ${maxCases}；请拆分项目，系统不会静默截断。`);
  const cases: BrowserCheck[] = extractedCases?.length
    ? extractedCases.map((item, index) => ({ id: `xmind-${index + 1}`, title: item.title, source: item.source, ...(item.modulePath?.length ? { modulePath: item.modulePath } : {}), requirementRefs: item.requirementRefs ?? [item.source], priority: item.priority ?? "P2", category: item.category ?? inferCaseCategory(`${item.title} ${item.source}`), confidence: item.confidence ?? confidenceFromExpectation(item.expected), coverageAreas: item.coverageAreas ?? [item.category ?? inferCaseCategory(`${item.title} ${item.source}`)], lifecycleStatus: "draft" as const, selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: "unknown" as const, cleanup: "", caseOrigin: "held-out-benchmark" as const, kind: "visible" as const, expected: item.expected, steps: [] }))
    : input.caseMode === "both" || input.caseMode === "ai" ? [] : createReviewCases(input.document.text);
  for (const item of cases) {
    const plan = planCaseExecution(item);
    item.executionRoute = plan.route;
    item.executionReason = plan.reason;
    item.nextAction = plan.nextAction;
  }
  return { id: randomUUID(), name, fileName: String(input.fileName).slice(0, 200), ...(input.sourceFiles?.length ? { sourceFiles: input.sourceFiles.slice(0, 8) } : {}), ...(input.researchExamples?.length ? { researchExamples: input.researchExamples.slice(0, 8) } : {}), caseMode: input.caseMode ?? "both", workflowPlan: ["规划阶段：按网址、说明和附件确定测试范围", "资料解析阶段：读取需求文件与已有测试用例", "公开资料阶段：查找测试案例并记录来源（若联网搜索可用）", "用例整理阶段：合并候选，补充边界场景和可判定预期", "双通道验证：确定性脚本与视觉 Computer Use 顺序运行并共享本轮浏览器页面"], format: input.document.format, targetUrl: safeTarget(input.targetUrl), sourceText: input.document.text, cases, reviewStatus: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export { isDocumentFieldInvalid,resolveDocumentField,selectDocumentOption,selectDocumentOptionByPlaceholder,selectDocumentOptionByRoleIndex } from "./browser/document-form-controls.js";

/** Open/authenticate the shared project page before attempting step generation.
 * This is needed when every selected case has empty steps: the deterministic
 * lane will otherwise mark them blocked without ever visiting the target, so
 * the post-login author cannot inspect the authenticated application. */
const prepareSharedTargetPage = createProjectTargetPagePreparer({
  allowRequest: allowBrowserRequest,
  navigate: navigatePersistentPage,
  isLoginPage,
  waitForUserLogin,
});


function documentPackageInputPath(runId: string): string { return path.join(runsDir, runId, "package-input.zip"); }

/** Finish from saved inputs; the finalization use case never opens the target site. */
async function finalizeDocumentRunPackage(project: DocumentProject, run: DocumentRun, journal: ExecutionJournal, packageInput: Uint8Array): Promise<DocumentRun> {
  return documentRunFinalization.finalize(project, run, journal, packageInput);
}

const documentRunFinalization = createDocumentRunFinalizationService({
  repository: runRepository,
  async writePackage(project, run, packageInput) {
    const packagePath = path.join(runsDir, run.id, "testpilot-package.zip");
    const tempPackagePath = path.join(runsDir, run.id, `package.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPackagePath, refreshDocumentPackage(project, run, packageInput));
      await rename(tempPackagePath, packagePath);
    } finally {
      await unlink(tempPackagePath).catch(() => undefined);
    }
    return packagePath;
  },
  async persistRun(run) {
    await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8");
    await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8");
  },
  async persistFailedRun(run) {
    await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8").catch(() => undefined);
    await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8").catch(() => undefined);
  },
  removePackageInput: runId => unlink(documentPackageInputPath(runId)).then(() => undefined, () => undefined),
  notifyCompleted: run => documentRunNotifications.notify(run),
  now: () => new Date().toISOString(),
});

const runLane = createDocumentBrowserLaneAdapter({
  authorizedBinding:createAuthorizedRunBinding(path.join(baseDir,'..','authorized-browser-writes')),
  resolveDocumentField, selectDocumentOption,
  selectDocumentOptionByPlaceholder, selectDocumentOptionByRoleIndex, unsupportedWeChatClientGateMessage,
});
const documentRunBrowserSessions = createDocumentRunBrowserSessionCoordinator({
  registry: activeDocumentRunRegistry,
  userDataDirectory: projectId => path.join(baseDir, "browser-profiles", projectId),
  launch: launchPersistentTestPage,
  prepareTargetPage: prepareSharedTargetPage,
  clearLoginHandoff,
});
const documentStepProbe = createDocumentStepProbeAdapter({
  registry: activeDocumentRunRegistry,
  acquirePageLease: acquireDocumentPageLease,
  userDataDirectory: projectId => path.join(baseDir, "browser-profiles", projectId),
  getExistingPage: getExistingPersistentTestPage,
  isLoginPage,
  resolveDocumentField,
  now: () => new Date().toISOString(),
});
/** @deprecated Production routes use the probe composed in bootstrap. */
export const probeDocumentStep = documentStepProbe.probe;

export async function executeDocumentRun(project: DocumentProject, options: { captureEvidence?: boolean; onCasePrepared?: (source: BrowserCheck, page: Page) => Promise<void>; onCaseResult?: (result: CaseResult) => Promise<void>; checkpointRecovery?: CheckpointRecoveryRequest; autonomousPlanId?: string; expectedAutonomousPlanContextDigest?: string; sessionProfileId?: string; allowParallelSessions?: boolean; runId?: string; resumeRunId?: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; parentRunId?: string; selectedCaseIds?: string[]; retestNotes?: string; retestScopeNote?: string; onStage?: (stage: ExecutionJournal["stage"]) => Promise<void>; beforeDeterministic?: (page: Page, project: DocumentProject) => Promise<{ generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview?: boolean }>; afterDeterministic?: (page: Page, project: DocumentProject) => Promise<{ generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview?: boolean }> } = {}): Promise<DocumentRun> {
  options = { ...options, ...(options.checkpointRecovery !== undefined ? { checkpointRecovery: structuredClone(options.checkpointRecovery) } : {}) };
  if (options.allowParallelSessions) {
    if (!options.sessionProfileId) throw new Error("并行运行必须固定独立账号档案。");
    project = { ...project, activeSessionProfileId: options.sessionProfileId };
  }
  const { startedAt, runId, runMode, baselineRunId, baselineRun, resumedJournal } = await prepareDocumentRunExecution(project, options);
  const preparedScope = prepareDocumentRunScope({
    project,
    selectedCaseIds: options.selectedCaseIds,
    journalSelectedCaseIds: resumedJournal?.selectedCaseIds,
    scopePlan: options.scopePlan,
    journalScopePlan: resumedJournal?.scopePlan,
    isResume: Boolean(options.resumeRunId),
    isChildRetest: Boolean(options.parentRunId),
  });
  const { selectedCaseIds, scopePlan, caseScope, runCaseSnapshots, updateRunCaseSnapshots, coverageSummary } = preparedScope;
  let selectedCases = preparedScope.selectedCases;
  if(runMode==='compare' && selectedCases.some(item=>item.authorizedWriteOperationId || item.writeResultOperationId))throw new Error('授权提交整链仅允许确定性regression，不能在视觉对照中重放提交。');
  const testDataSetId = options.testDataSetId ?? resumedJournal?.testDataSetId;
  const parameterValues = resolveDocumentRunParameters(project, selectedCaseIds!, options.resumeRunId ? undefined : testDataSetId, options.resumeRunId ? resumedJournal?.parameterValues ?? {} : options.parameterValues ?? {});
  const resolveCasesForThisRun = (cases: BrowserCheck[]) => cases.map(item => ({ ...item, steps: item.steps.map(step => resolveBrowserStepParameters(step, parameterValues)) }));
  selectedCases = resolveCasesForThisRun(selectedCases);
  if (project.reviewStatus !== "approved") throw new Error("只有仍处于审核通过状态的项目才能运行或恢复。");
  let deterministic: LaneResult = { status: "cancelled", summary: "确定性通道尚未开始。", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行在确定性通道开始前被停止。", durationMs: 0 })) };
  let visual: VisualLane = runMode === "regression"
    ? { status: "not-applicable", summary: "常规回归模式未运行 AI 视觉通道。", provider: "not-run", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-applicable", detail: "常规回归仅使用已保存的确定性步骤；AI 视觉通道未运行。", durationMs: 0, actions: 0 })) }
    : { status: "cancelled", summary: "Computer Use 通道尚未开始。", provider: "not-run", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行在 Computer Use 通道开始前被停止。", durationMs: 0, actions: 0 })) };
  let apiContract: DocumentApiLane | undefined;
  let stepGeneration: DocumentRun["stepGeneration"];
  let journal: ExecutionJournal;
  if (options.resumeRunId) {
    const recovery = await getDocumentRunRecovery(project);
    if (!recovery || recovery.runId !== options.resumeRunId || !recovery.canResume) throw new Error(recovery?.reason ?? "找不到可恢复的中断运行；请启动一轮新测试。");
    journal = resumedJournal!;
    journal.resumeCount++;
  } else {
    journal = { version: 1, runId, projectId: project.id, ...(options.checkpointRecovery ? { checkpointRecovery: structuredClone(options.checkpointRecovery) } : {}), ...(options.autonomousPlanId ? { autonomousPlanId: options.autonomousPlanId } : {}), ...(options.expectedAutonomousPlanContextDigest ? { autonomousPlanContextDigest: options.expectedAutonomousPlanContextDigest } : {}), ...(options.workflowId ?? project.workflowId ? { workflowId: options.workflowId ?? project.workflowId } : {}), runMode, ...(scopePlan ? { scopePlan: structuredClone(scopePlan) } : {}), ...(options.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(options.siteVersionSnapshot) } : {}), materialVersion: getDocumentMaterialVersion(project), sourceMaterialsSnapshot: structuredClone(project.sourceMaterials ?? []), ...(options.baselineRunId ? { baselineRunId: options.baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues, projectDigest: projectDigest(project), targetUrl: project.targetUrl, selectedCaseIds: caseScope.selectedCaseIds, startedAt, updatedAt: startedAt, status: "running", stage: "starting", resumeCount: 0, ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}), ...(options.retestNotes ? { retestNotes: options.retestNotes } : {}), ...(options.retestScopeNote ? { retestScopeNote: options.retestScopeNote } : {}) };
  }
  if (!options.resumeRunId && !options.parentRunId && scopePlan?.handoffAfterPrerequisites === true && !journal.handoff) {
    journal.handoff = { status: "waiting-prerequisites", prerequisiteCaseIds: [...(scopePlan.prerequisiteCaseIds ?? [])], targetCaseIds: [...scopePlan.targetCaseIds, ...scopePlan.impactCaseIds], updatedAt: new Date().toISOString() };
  }
  const browserRunSession = documentRunBrowserSessions.begin({
    projectId: project.id,
    profileKey: resolveDocumentSessionProfileKey(project),
    browserProfileIsolation: project.browserProfileIsolation===true,
    ...(options.allowParallelSessions ? { allowParallelSessions: true } : {}),
    runId,
    targetUrl: project.targetUrl,
    ...(project.executionConfig ? { executionConfig: project.executionConfig } : {}),
    onLoginWait: waiting => updateStage(waiting ? "awaiting-login" : "starting"),
  });
  const { controller, userDataDir } = browserRunSession;
  // A profile selection may have changed after the HTTP layer loaded this project.
  // Check again while holding the browser lease, before opening either profile.
  try {
    const latestProject = await getDocumentProject(project.id);
    if (resumedJournal) assertResumeExecutionJournalIntegrity({ journal: resumedJournal, latestProject, executionProject: project,
      runMode, selectedCaseIds: caseScope.selectedCaseIds, scopePlan, baselineRunId, testDataSetId, parameterValues,
      siteVersionSnapshot: options.siteVersionSnapshot ?? resumedJournal.siteVersionSnapshot });
    const checkpointRecovery = options.checkpointRecovery ?? resumedJournal?.checkpointRecovery;
    if (checkpointRecovery) assertCheckpointRecoveryStart({ latestProject, executionProject: project, parent: await documentRunArtifacts.getRun(checkpointRecovery.parentRunId),
      request: checkpointRecovery, parentRunId: options.parentRunId ?? resumedJournal?.parentRunId, selectedCaseIds: caseScope.selectedCaseIds, runMode, targetUrl: project.targetUrl,
      siteVersionSnapshot: options.siteVersionSnapshot ?? resumedJournal?.siteVersionSnapshot, testDataSetId, parameterValues, redactText: redactSensitiveExportText });
    if (options.expectedAutonomousPlanContextDigest && (!latestProject || autonomousPlanContextDigest(latestProject) !== options.expectedAutonomousPlanContextDigest)) throw new Error('自主回归计划已过期，拒绝在项目变化后打开目标页面。');
    if (latestProject && resolveDocumentSessionProfileKey(options.sessionProfileId ? { ...latestProject, activeSessionProfileId: options.sessionProfileId } : latestProject) !== resolveDocumentSessionProfileKey(project)) throw new Error('会话档案已变化，请刷新项目后重新启动。');
  } catch (error) { browserRunSession.release(); throw error; }
  journal.status = "running"; journal.stage = "starting"; journal.updatedAt = new Date().toISOString(); delete journal.lastError;
  journal.runMode ??= runMode;
  const interruptedRetryCaseIds: string[] = [];
  const replayedDependencyCaseIds: string[] = [];
  const skippedCompletedCaseIds = [...new Set(selectedCases.filter(item => {
    const results = journal.caseResults ?? [];
    return results.some(result => result.id === item.id && result.lane === "deterministic")
      && (runMode === "regression" || results.some(result => result.id === item.id && result.lane === "computer-use"));
  }).map(item => item.id))];
  const journalCoordinator = createDocumentRunJournalCoordinator({ journal, saveJournal: saveExecutionJournal, ...(options.onStage ? { onStage: options.onStage } : {}) });
  const { updateStage, markCurrentCase, persistStep } = journalCoordinator;
  const persistCaseResult = async (lane: 'deterministic'|'computer-use', result: CaseResult & {actions?:number}) => {
    if(lane==='deterministic') await options.onCaseResult?.(result);
    await journalCoordinator.persistCaseResult(lane,result);
  };
  const captureRunEvidence = async (page: Page, item: BrowserCheck, stepIndex: number | undefined, reason: string): Promise<void> => {
    const evidenceId = randomUUID();
    const createdAt = new Date().toISOString();
    const safeReason = String(redactSensitiveExportData(reason)).slice(0, 300);
    const base = { evidenceId, runId, caseId: item.id, ...(stepIndex === undefined ? {} : { stepIndex }), attempt: journal.resumeCount + 1, reason: safeReason, createdAt };
    try {
      const directory = path.join(runsDir, runId, "evidence");
      await mkdir(directory, { recursive: true });
      if (page.isClosed()) throw new Error("browser page is closed");
      const bytes = await page.screenshot({ path: path.join(directory, `${evidenceId}.png`), type: "png", timeout: 1200, animations: "disabled" });
      const evidenceReference: DocumentRunEvidence = { ...base, type: "screenshot", relativeKey: `evidence/${evidenceId}.png`, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" };
      journal.evidence = [...(journal.evidence ?? []), evidenceReference].slice(-500);
    } catch (error) {
      const evidenceReference: DocumentRunEvidence = { ...base, type: "unavailable", reason: `${base.reason}；截图不可用：${error instanceof Error ? error.message : String(error)}`.slice(0, 500) };
      journal.evidence = [...(journal.evidence ?? []), evidenceReference].slice(-500);
    }
    journal.updatedAt = createdAt;
    await saveExecutionJournal(journal);
  };
  const stepGenerationService = createDocumentRunStepGenerationService({
    project,
    journal,
    selectedCaseIds: caseScope.selectedCaseIds,
    updateRunCaseSnapshots,
    saveJournal: saveExecutionJournal,
    projectDigest,
    resolveCases: resolveCasesForThisRun,
    now: () => new Date().toISOString(),
  });
  let businessObserver:ReturnType<typeof observeDepartmentBusinessEvidence>|undefined;
  let executionPage: Page | undefined;
  let readOnlyBusinessFacts:NonNullable<DocumentRun['readOnlyBusinessFacts']>=[];
  let databaseEvidence: import('../domain/document-database-evidence.js').DocumentDatabaseEvidence | undefined;
  let databaseEvidenceWarning: string | undefined;
  try { databaseEvidence = await collectDocumentAgentDatabaseEvidence(project, true); }
  catch { databaseEvidenceWarning = '本轮数据库读回没有取得有效证据；不能用连接状态、历史数据或页面截图代替数据库核验。'; }
  try {
    await saveExecutionJournal(journal);
    const session = await browserRunSession.initialize();
    executionPage = session.page;
    businessObserver=observeDepartmentBusinessEvidence(session.page,project.targetUrl);
    activeDocumentRunRegistry.setEvidenceCapture(runId, async () => {
      const activeCase = journal.currentCase && project.cases.find(item => item.id === journal.currentCase!.id);
      if (options.captureEvidence!==false && activeCase) await captureRunEvidence(session.page, activeCase, journal.checkpoint?.stepIndex, "中断请求：浏览器断开前短时截图");
    });
    await updateStage("deterministic");
    const runRecoverableLane = createDocumentRunRecoveryCoordinator({
      journal,
      ...(options.resumeRunId ? { resumeRunId: options.resumeRunId } : {}),
      isAborted: () => controller.signal.aborted,
      saveJournal: saveExecutionJournal,
      interruptedRetryCaseIds,
      replayedDependencyCaseIds,
    });
    // The application service sequences recovered deterministic, optional visual,
    // and reviewed API lanes; this adapter supplies the authenticated page runners.
    const laneExecution = await executeDocumentRunLanes<Page>({
      runMode,
      selectedCases,
      signal: controller.signal,
      page: session.page,
      initialVisual: visual,
      updateStage,
      runRecoverableLane,
      executeDeterministic: pending => runLane(project.targetUrl, pending, "确定性用例", project.id, runId, session!.page, waiting => updateStage(waiting ? "awaiting-login" : "deterministic"), result => persistCaseResult("deterministic", result), item => markCurrentCase("deterministic", item), controller.signal, async (item, stepIndex, phase, detail) => {
        await persistStep(item.id, stepIndex, item.steps[stepIndex]?.action ?? "unknown", phase, detail);
        if (options.captureEvidence!==false && activeDocumentRunRegistry.getRun(runId)?.pauseRequested) await captureRunEvidence(session!.page, item, stepIndex, "用户请求暂停");
        const pauseUrl=session!.page.url();
        await activeDocumentRunRegistry.waitAtStepBoundary(runId, controller.signal,()=>!session!.page.isClosed() && session!.page.url()===pauseUrl);
      }, options.captureEvidence===false ? undefined : (item, stepIndex, reason) => captureRunEvidence(session!.page, item, stepIndex, reason), project.executionConfig?.viewport,
      journal.handoff ? { prerequisiteCaseIds: journal.handoff.prerequisiteCaseIds, onPrerequisitesComplete: async () => {
        const currentHandoff = journal.handoff!;
        try {
          if (session!.page.isClosed()) throw new Error("前置结束后当前浏览器页面已关闭。");
          const sourceUrl = session!.page.url();
          const pageContextId = `${runId}:${sourceUrl}`;
          const evidence = await captureCurrentPageEvidence(session!.page, project.targetUrl);
          if (session!.page.isClosed() || session!.page.url() !== sourceUrl) throw new Error("采集证据期间页面上下文发生变化。");
          journal.handoff = { ...currentHandoff, status: "paused-for-analysis", pageContextId, evidence, updatedAt: new Date().toISOString() };
          journal.updatedAt = journal.handoff.updatedAt;
          await saveExecutionJournal(journal);
          const raw = await completeChat([
            { role: "system", content: "你是页面证据观察器。只分析给定的可见页面文字；不要浏览、执行动作、推测隐藏状态或声称看过图像像素。只返回JSON: {\"summary\":\"简短观察\",\"quote\":\"从visibleText逐字复制的一段证据\"}。若文字不足以观察，summary说明不足且quote为空。" },
            { role: "user", content: JSON.stringify({ visibleText: evidence.visibleText, title: evidence.title, sourceUrl: evidence.sourceUrl }) },
          ], { responseFormat: { type: "json_object" }, maxTokens: 300, timeoutMs: 20_000, thinking: { type: "disabled" } });
          const content = typeof raw?.content === "string" ? raw.content : "";
          const observation = JSON.parse(content) as { summary?: unknown; quote?: unknown };
          if (typeof observation.summary !== "string" || !observation.summary.trim() || typeof observation.quote !== "string" || !observation.quote || !evidence.visibleText.includes(observation.quote)) throw new Error("AI观察没有返回可追溯到页面可见文字的引用。");
          const summary = redactSensitiveExportText(observation.summary).slice(0, 600);
          journal.handoff = { ...journal.handoff, status: "ready-to-continue", analysis: { summary, citations: [{ quote: observation.quote }], imagePixelsInspected: false }, updatedAt: new Date().toISOString() };
          await saveExecutionJournal(journal);
          const result = await activeDocumentRunRegistry.waitForExternalAnalysis(runId, pageContextId, async () => {
            if (session!.page.isClosed() || session!.page.url() !== sourceUrl) return false;
            const currentEvidence = await captureCurrentPageEvidence(session!.page, project.targetUrl);
            return currentEvidence.sourceUrl === evidence.sourceUrl
              && currentEvidence.title === evidence.title
              && currentEvidence.visibleText === evidence.visibleText;
          });
          if (result !== "continued") throw new Error(result === "context-lost" ? "继续前页面或运行上下文已变化，目标未执行。" : "原运行已取消或不再活动，目标未执行。");
          return undefined;
        } catch (error) {
          const reason = redactSensitiveExportText(error instanceof Error ? error.message : String(error)).slice(0, 600);
          journal.handoff = { ...currentHandoff, status: "blocked", reason, updatedAt: new Date().toISOString() };
          journal.updatedAt = journal.handoff.updatedAt;
          await saveExecutionJournal(journal).catch(() => undefined);
          return reason;
        }
      } } : undefined, options.onCasePrepared),
      executeComputerUse: pending => runComputerUseLane(project.targetUrl, pending, project.id, runId, session!.page, waiting => updateStage(waiting ? "awaiting-login" : "computer-use"), result => persistCaseResult("computer-use", result), item => markCurrentCase("computer-use", item), controller.signal),
      dispatchApi: async cases => (await dispatchDocumentRunApiLane({ project, selectedCases: cases, signal: controller.signal, getCandidate: getApiSuiteCandidate, runApproved: executeApprovedApiSuite })).lane,
      stepGeneration: stepGenerationService,
      ...(options.beforeDeterministic ? { beforeDeterministic: page => options.beforeDeterministic!(page, project) } : {}),
      ...(options.afterDeterministic ? { afterDeterministic: page => options.afterDeterministic!(page, project) } : {}),
      setAcceptingCancel: accepting => {
        const activeControl = activeDocumentRunRegistry.getRun(runId);
        if (activeControl) activeControl.acceptingCancel = accepting;
      },
    });
    deterministic = laneExecution.deterministic;
    visual = laneExecution.visual as VisualLane;
    selectedCases = laneExecution.selectedCases;
    apiContract = laneExecution.apiContract;
    stepGeneration = laneExecution.stepGeneration;
  } catch (error) {
    if (!controller.signal.aborted) {
      journal.status = "failed"; journal.updatedAt = new Date().toISOString(); journal.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await saveExecutionJournal(journal).catch(() => undefined);
      throw error;
    }
    const cancellationResults = buildDocumentRunCancellationResults({ selectedCases, journal, runMode });
    deterministic = cancellationResults.deterministic;
    if (cancellationResults.computerUse) visual = cancellationResults.computerUse as VisualLane;
    await disconnectPersistentTestPage(userDataDir, project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined);
  } finally {
    try {
      if(businessObserver)readOnlyBusinessFacts=await businessObserver.finish();
    } finally {
      activeDocumentRunRegistry.setEvidenceCapture(runId);
      try { await executionPage?.unrouteAll({behavior:"wait"}).catch(()=>undefined); } finally { browserRunSession.release(); }
    }
  }
  const ai: LaneResult & { provider?: string } = visual;
  const completedAt = new Date().toISOString();
  const caseSnapshots = [...runCaseSnapshots.values()];
  const run = await documentRunOutcome.create({
    runId,
    project,
    journal,
    runMode,
    ...(baselineRunId ? { baselineRunId } : {}),
    ...(options.parentRunId || journal.parentRunId ? { retestSelection: [...caseScope.selectedCaseIds] } : options.selectedCaseIds ? { retestSelection: [...options.selectedCaseIds] } : {}),
    selectedCases,
    caseSnapshots,
    caseScope,
    skippedCompletedCaseIds: skippedCompletedCaseIds.filter(id => !replayedDependencyCaseIds.includes(id)),
    interruptedRetryCaseIds,
    coverageSummary,
    ...(stepGeneration ? { stepGeneration } : {}),
    deterministic,
    computerUse: ai,
    ...(apiContract ? { apiContract } : {}),
    aborted: controller.signal.aborted,
    startedAt,
    completedAt,
    ...(options.retestNotes ? { retestNotes: options.retestNotes } : {}),
    ...(options.retestScopeNote ? { retestScopeNote: options.retestScopeNote } : {}),
    ...(baselineRun ? { baselineRun } : {}),
    onAnalysisStage: () => updateStage("analysis"),
    onReportStage: () => updateStage("report"),
  });
  if (project.activeSessionProfileId) run.sessionProfileSnapshot = structuredClone(project.sessionProfiles!.find(item => item.id === project.activeSessionProfileId)!);
  if (journal.checkpoint) run.stepCheckpoint = structuredClone(journal.checkpoint);
  run.stepLogs = journal.stepLogs ? structuredClone(journal.stepLogs.slice(-500)) : [];
  run.evidence = structuredClone(journal.evidence ?? []);
  if(readOnlyBusinessFacts.length){run.readOnlyBusinessFacts=readOnlyBusinessFacts;run.report+='\n\n## 部门业务只读接口证据\n\n只记录本轮实际响应的白名单商品与公司字段，不包含请求头或登录凭证；响应事实不等于后端契约已验收。\n\n```json\n'+JSON.stringify(readOnlyBusinessFacts,null,2)+'\n```\n';}
  if (databaseEvidence) {
    run.databaseEvidence = databaseEvidence;
    run.report += '\n\n## 本轮 Agent 数据库只读证据\n\n' + databaseEvidence.limitation + '\n\n```json\n' + JSON.stringify(databaseEvidence, null, 2) + '\n```\n';
  }
  if (databaseEvidenceWarning) run.report += '\n\n## 数据库核验缺口\n\n' + databaseEvidenceWarning + '\n';
  if (run.stepLogs.length) {
    run.report += `\n\n## 确定性步骤日志与检查点\n\n${run.stepLogs.map(event => `- ${event.caseId} · 步骤 ${event.stepIndex + 1} · ${event.action} · ${event.phase} · ${event.at}`).join("\n")}\n`;
  }
  if (run.evidence.length) run.report += `\n\n## 异常与暂停证据索引\n\n${run.evidence.map(item => `- ${item.caseId}${item.stepIndex === undefined ? "" : ` · 步骤 ${item.stepIndex + 1}`} · ${item.type === "screenshot" ? `截图 ${item.evidenceId} · ZIP 附件 evidence/${item.evidenceId}.png · SHA-256 ${item.sha256}` : `不可用：${item.reason}`}`).join("\n")}\n`;
  await mkdir(path.join(runsDir, run.id), { recursive: true });
  journal.finalizationRun = structuredClone(run);
  journal.updatedAt = new Date().toISOString();
  await saveExecutionJournal(journal);
  if (!activeDocumentRunRegistry.beginPackageFinalization(run.id)) throw new Error("该运行的报告与脚本包正在重新生成；请稍后刷新运行记录。");
  try {
  if (!controller.signal.aborted) await updateStage("packaging");
  run.packagePath = "";
  run.packageReady = false;
  const evidenceFiles = await Promise.all((run.evidence ?? []).filter(item => item.type === "screenshot").map(async item => ({ evidenceId: item.evidenceId, bytes: await readFile(path.join(runsDir, runId, "evidence", `${item.evidenceId}.png`)) })));
  const packageInput = buildDocumentPackageInput(project, run, caseScope, selectedCases, evidenceFiles);
  await writeFile(documentPackageInputPath(run.id), packageInput);
  return await finalizeDocumentRunPackage(project, run, journal, packageInput);
  } catch (error) {
    await documentRunFinalization.recordPackagingFailure(run, journal, error);
    throw error;
  } finally {
    activeDocumentRunRegistry.endPackageFinalization(run.id);
  }
}

const projectSessionStatusAdapter = createDocumentProjectSessionStatusAdapter({
  registry: activeDocumentRunRegistry,
  userDataDirectory: projectId => path.join(baseDir, "browser-profiles", projectId),
  getLoginHandoff,
  isLoginPage,
  getExistingPage: getExistingPersistentTestPage,
  now: () => new Date().toISOString(),
});
/** @deprecated Production composition should create this adapter in bootstrap. */
export const getDocumentProjectSessionStatus = projectSessionStatusAdapter.getStatus;
/** @deprecated Read run artifacts through the storage adapter in production composition. */
export const readDocumentPackage = documentRunArtifacts.readPackage;
/** @deprecated Read run artifacts through the storage adapter in production composition. */
export const getDocumentRun = documentRunArtifacts.getRun;

export type { DocumentRunListItem } from "../domain/document-run-history.js";
