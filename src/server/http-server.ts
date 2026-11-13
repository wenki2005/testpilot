import { createDifyRegressionRoutes } from "../interfaces/http/regression/regression-routes.js";
import { integratedWorkspaceConfig } from '../bootstrap/workspace-config.js';
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { json, fail, bodyJson, documentBody } from "../interfaces/http/shared/http-utils.js";
import { createHash, randomUUID } from "node:crypto";
import { containsCredentialLikeValue } from "../adapters/documents/evidence/sensitive-data.js";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { createAuthorizedBrowserWrite, validateWritePlan } from '../adapters/browser/authorized-write.js';
import { getExistingPersistentTestPage } from '../adapters/browser/browser-runtime.js';
import { resolveDocumentSessionProfileKey } from '../domain/documents/projects/session-profile.js';
import { previewDocumentCaseDependencies } from '../domain/documents/cases/dependency-plan.js';
import { captureCurrentPageEvidence } from '../adapters/documents/evidence/page-evidence.js';
import { handleDocumentWebsiteMapRoutes } from '../interfaces/http/document-projects/website-map-routes.js';
import { resolveDocumentField, selectDocumentOptionByRoleIndex } from '../adapters/browser/document-form-controls.js';
import type { DemoAssertion, DemoCheck, DemoConfig, DemoRequest, DemoRun } from "../compat/local-test-contract-exports.js";
import { executeDemo, generateDocumentBrowserCases, generateDocumentCaseSteps, generateGrammarPlaywrightCandidate, modelConfiguration, validateDraftLocatorsAgainstEvidence } from "./runtime.js";
import { availableRoutes, defaultChecks, defaultRequirements, handleSample } from "./local-sample.js";
import type { RunRecord, TestSuite } from "../domain/testing/test-contracts.js";
import type { ProjectScriptVersion } from "../domain/projects/script-contract.js";
import { createProjectScriptRegistry } from "../adapters/projects/project-script-registry.js";
import { extractDocument, type ImportedDocument } from "../adapters/documents/resources/importer.js";
import { generateTestCaseDrafts } from "../adapters/case-generation/generation-agent.js";
import { readPublicWebsiteText } from "../adapters/browser/public-page-reader.js";
import { searchTestExamples } from "../adapters/case-generation/example-search.js";
import { getLoginHandoff, isLoginPage, requestLoginContinue } from "../adapters/browser/login-handoff.js";
import { computerUseConfiguration, testComputerUseCapability } from "../adapters/browser/computer-use/computer-use-adapter.js";
import { getBrowserRuntimeStatus, testBrowserCdpConnection } from "../adapters/browser/browser-runtime.js";
import { readModelSettingsForUi, resolveModelSettings, saveModelSettings, testModelConnection } from "../adapters/ai/model-settings.js";
import { cancelDocumentRun, pauseDocumentRun, continueDocumentRun, readDocumentRunEvidence, collectDocumentParameterNames, executeDocumentRun as executeDocumentRunAdapter, getDocumentCaseVersion, getDocumentMaterialVersion, getDocumentProject, getDocumentProjectRevision, getDocumentRunProgress, getDocumentRunRecovery, isDocumentBaselineEligible, listDocumentProjectRevisions, loadDocumentProjects, makeDocumentProject, projectRepository, readDocumentSource, resolveDocumentRunParameters, retryDocumentRunPackaging, saveDocumentProject, validateDocumentRunScopePlan, validateDocumentTarget, writeDocumentSource, type BrowserCheck, type DocumentProject, type DocumentProjectRevisionKind, type DocumentRunMode, type DocumentRunScopePlan, type DocumentSiteVersion, type DocumentTestDataSet } from "../adapters/documents/execution/run-executor.js";
import { validateCases, validateCasesPreservingGenerationTrace } from "../domain/documents/cases/case-validation.js";
import { addNoApiNetworkAssertion, browserStepDraftBlockReason, canAuthorReadOnlyBrowserSteps, createReviewCases, deriveGroundedCustomerLookupSubcheck, deriveGroundedEmptyListNavigationSubcheck, deriveGroundedEmptyRequiredFieldSubcheck, deriveRelatedInvalidInputSubcheck, draftGroundedReadOnlyBrowserSteps, explainBlockedBrowserStepDraft, hasAutoRunnableSelectedCase, hasOnlyGenericShellAssertions } from "../domain/documents/cases/case-authoring.js";
import { resolveDocumentInputRoles, type DocumentInputRole } from "../adapters/documents/cases/source-roles.js";
import { closePersistentTestPages } from "../adapters/browser/browser-runtime.js";
import { autoRunReadOnlyApiSuite, createApiSuiteCandidate, diagnoseApiFinding, executeApprovedApiSuite, getApiFindingHistory, getApiRun, getApiSuiteCandidate, listApiSuiteCandidates, readApiRunArtifact, reviewApiSuiteCandidate, updateApiSuiteCandidate } from "../adapters/api/suite-workflow.js";
import { generateApiSuite } from "../adapters/api/suite-authoring.js";
import { approveDocumentWorkflowStage, cancelDocumentWorkflow, completeDocumentWorkflow, completeDocumentWorkflowStage, createDocumentWorkflow, failDocumentWorkflowStage, getDocumentWorkflow, linkDocumentWorkflowRun, listDocumentWorkflows, resumeDocumentWorkflowStage, startDocumentWorkflowStage, waitDocumentWorkflowStage, type DocumentWorkflowStageId, type DocumentWorkflowSpecialist } from "../adapters/documents/execution/workflow-record.js";
import { openApiOperationFacts, summarizeOpenApiSpecification } from "../adapters/api/openapi-summary.js";
import { createSqliteMigrationCandidate, executeApprovedSqliteMigrationSuite, getSqliteMigrationCandidate, getSqliteMigrationRun, listSqliteMigrationCandidates, readSqliteMigrationRunArtifact, reviewSqliteMigrationCandidate, updateSqliteMigrationCandidate } from "../adapters/database/sqlite/migration-workflow.js";
import { handleMysqlRoutes } from "../interfaces/http/database/mysql-routes.js";
import { createDocumentAuthoringContextReader } from '../adapters/documents/cases/authoring-context.js';
import { collectDocumentAgentDatabaseEvidence, isDepartmentDatabaseTarget } from '../adapters/documents/evidence/agent-database.js';
import { connectMysqlBrowser, disconnectMysqlBrowser, listMysqlColumns, listMysqlTables, mysqlBrowserConfig, mysqlBrowserStatus, readMysqlRows } from "../adapters/database/mysql-browser.js";
import { evaluateLocalRequestPolicy } from "../interfaces/http/shared/local-request-policy.js";
import { handleDocumentProjectRevisionRoutes } from "../interfaces/http/document-projects/project-revision-routes.js";
import { handleDocumentProjectMaterialRoutes } from "../interfaces/http/document-projects/project-material-routes.js";
import { handleSettingsRoutes } from "../interfaces/http/settings/settings-routes.js";
import { handleDocumentRunRoutes } from "../interfaces/http/document-runs/run-routes.js";
import { handleDocumentRunHandoffRoutes } from "../interfaces/http/document-runs/run-handoff-routes.js";
import { handleDocumentWorkflowRoutes } from "../interfaces/http/document-runs/workflow-routes.js";
import { handleDocumentProjectSessionRoutes } from "../interfaces/http/document-projects/project-session-routes.js";
import { handleDocumentNotificationRoutes } from '../interfaces/http/document-runs/notification-routes.js';
import { handleDocumentCaseCodeRoutes } from '../interfaces/http/document-cases/case-code-routes.js';
import { createDocumentCaseCodeSource } from '../adapters/documents/cases/case-code-source.js';
import { handleDocumentCaseMarkdownRoutes } from '../interfaces/http/document-cases/case-markdown-routes.js';
import { handleDocumentSessionProfileRoutes } from '../interfaces/http/document-projects/session-profile-routes.js';
import { handleDocumentParallelRunRoutes } from '../interfaces/http/document-runs/parallel-run-routes.js';
import { handleDocumentSessionOpenRoutes } from '../interfaces/http/document-projects/session-open-routes.js';
import { activeDocumentRunRegistry } from '../application/runs/execution/active-document-run-registry.js';
import { documentRunNotifications } from '../adapters/documents/execution/run-executor.js';
import { handleDocumentStepProbeRoute } from "../interfaces/http/document-cases/step-probe-routes.js";
import { handleDocumentCaseSelectionRoute } from "../interfaces/http/document-cases/case-selection-routes.js";
import { handleDocumentImpactReviewRoute } from "../interfaces/http/document-cases/impact-review-routes.js";
import { handleDocumentAutonomousPlanRoutes } from '../interfaces/http/document-runs/autonomous-plan-routes.js';
import { handleDocumentAutonomousExecutionRoutes } from '../interfaces/http/document-runs/autonomous-execution-routes.js';
import { handleDocumentRunInvestigationRoutes } from '../interfaces/http/document-runs/run-investigation-routes.js';
import { handleDocumentStepRevisionProposalRoutes } from '../interfaces/http/document-cases/step-revision-proposal-routes.js';
import { handleDocumentRunRecoveryReadinessRoutes } from '../interfaces/http/document-runs/run-recovery-readiness-routes.js';
import { handleDocumentAutomaticRecoveryRoutes } from '../interfaces/http/document-runs/automatic-recovery-routes.js';
import { handleDocumentSiteVersionRoute } from "../interfaces/http/document-projects/site-version-routes.js";
import { handleDocumentProjectUpdateRoute } from "../interfaces/http/document-projects/project-update-routes.js";
import { handleDocumentProjectReviewRoute } from "../interfaces/http/document-projects/project-review-routes.js";
import { handleDemoRunRoutes } from "../interfaces/http/local-tests/local-test-routes.js";
import { handleProjectRunRoutes } from "../interfaces/http/project-tests/project-run-routes.js";
import { handleProjectScriptRoutes } from "../interfaces/http/project-tests/project-script-routes.js";
import type { ProjectProfileSummary, ProjectRunView } from "../domain/projects/profile-contract.js";
import { handleProjectScriptAuthoringRoutes } from "../interfaces/http/project-tests/project-script-authoring-routes.js";
import { handleSqliteMigrationRoutes } from "../interfaces/http/database/sqlite-migration-routes.js";
import { handleSourceTestRoutes } from "../interfaces/http/source-tests/source-test-routes.js";
import { createSourceTestJobService } from "../application/source-test-job-service.js";
import { createDemoRunService } from "../application/runs/execution/demo-run-service.js";
import { handleApiSuiteRoutes } from "../interfaces/http/api-tests/api-suite-routes.js";
import { handleCaseGenerationRoutes } from "../interfaces/http/case-generation/case-generation-routes.js";
import { handleDocumentProjectPreparationRoutes } from "../interfaces/http/document-projects/project-preparation-routes.js";
import { handleDocumentCaseStepRoute } from "../interfaces/http/document-cases/case-step-route.js";
import { handleDocumentProjectCaseAuthoringRoutes } from "../interfaces/http/document-projects/project-case-authoring-routes.js";
import { handleDocumentProjectRunRoute } from "../interfaces/http/document-projects/project-run-route.js";
import { createDocumentProjectPreparationService, type DocumentPreparationStage, type DocumentPreparationTask } from "../application/projects/document-project-preparation-service.js";
import { runSourceTestAgent, loadSourceResume } from "../adapters/source-tests/source-test-agent.js";
import { draftEvidenceBoundUiCheck } from "../adapters/documents/evidence/page-evidence.js";
import { createDocumentApplicationServices } from "../bootstrap/document-application-services.js";
import { createProjectProfileRunRuntime } from "../bootstrap/project-profile-run-runtime.js";
import { restoreDemoServerState } from "../bootstrap/server-state.js";
import { handleStaticFile } from "../interfaces/http/shared/static-file-route.js";
import { mergeDocumentBrowserCases as mergeBrowserCases } from "../domain/documents/cases/case-merge.js";
import { createDemoArtifactStore } from "../storage/local-tests/demo-artifact-store.js";
import { renderDemoRunReport } from "../reporters/demo-run-report.js";
const host = process.env.TESTPILOT_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4317);
const workspaces = integratedWorkspaceConfig();
const { documentWebsiteMapService, documentAutomaticRecoveryService, documentRunRecoveryReadinessService, documentRunInvestigationService, documentRunImageAnalysisService, documentStepRevisionProposalService, documentAutonomousPlanExecutionService, documentAutonomousPlanService, documentSessionOpenService, documentParallelRunService, documentSessionProfileService, documentCaseMarkdownService, documentRunArtifacts, documentRunHistoryService, documentStepProbeAdapter, documentProjectRunUsecaseService, documentCaseStepAuthoringService, generateMissingBrowserSteps, documentProjectSessionService, documentCaseSelectionService, documentImpactReviewService, documentSiteVersionService, documentProjectUpdateService, documentProjectReviewService, documentProjectWorkflowPreparationService, documentPageEvidence } = createDocumentApplicationServices();
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, "../..");
const artifactsDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(projectRoot, "artifacts", "demo"));
const runsDir = path.join(artifactsDir, "runs");
const handleDifyRegressionRoutes = workspaces?.current === 'web-regression'
    ? async (_req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
        const owned = ['/api/system-module-regression', '/api/dify-web-modules', '/api/module-regression', '/api/dify-regression']
            .some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
        if (!owned)
            return false;
        fail(res, 409, '此入口属于 Dify 数据区，请从侧栏进入 Dify 回归工作台。');
        return true;
    }
    : createDifyRegressionRoutes({ artifactsDir, host, port, resourceDirectory: process.env.TESTPILOT_RESOURCE_DIR ?? path.join(projectRoot, 'project-resources', 'department-sample') });
const authorizedBrowserWrites = createAuthorizedBrowserWrite(path.join(artifactsDir, 'authorized-browser-writes'));
const regressionsFile = path.join(artifactsDir, "regressions.json");
const distDir = path.join(projectRoot, "web", "dist");
const RUN_TIMEOUT_MS = 90000;
const PROJECT_RUN_TIMEOUT_MS = 180000;
const PROJECT_RUNS_DIR = path.join(artifactsDir, "project-runs");
const demoArtifactStore = createDemoArtifactStore({
    demoRunsDirectory: runsDir,
    regressionsFile,
    projectRunsDirectory: PROJECT_RUNS_DIR,
    renderDemoReport: renderDemoRunReport,
});
const mysqlRoutes = {
    connect: connectMysqlBrowser,
    disconnect: disconnectMysqlBrowser,
    listColumns: listMysqlColumns,
    listTables: listMysqlTables,
    config: mysqlBrowserConfig,
    status: mysqlBrowserStatus,
    readRows: readMysqlRows,
};
const PROJECT_SCRIPTS_FILE = path.join(artifactsDir, "project-scripts.json");
const sourceTestJobs = createSourceTestJobService({
    outputRoot: path.join(artifactsDir, "source-test-jobs"),
    createId: randomUUID,
    now: () => new Date().toISOString(),
    run: request => runSourceTestAgent(request),
    onFailure: name => console.error("Source test job failed:", name),
});
let savedChecks: DemoCheck[] = [];
let fixedTarget = false;
const demoRunService = createDemoRunService({
    fixedTarget: () => fixedTarget,
    availableRoutes,
    defaultRequirements,
    baseUrl: `http://${host}:${port}`,
    timeoutMs: RUN_TIMEOUT_MS,
    framework: "@earendil-works/pi-agent-core 1.2.0",
    createId: randomUUID,
    now: () => new Date().toISOString(),
    modelLabel: request => request.mode === "deterministic" ? "固定断言 runner（不调用模型）" : request.provider === "offline" ? "Pi faux provider（脚本决策，无模型推理）" : modelConfiguration().modelLabel,
    persist: run => demoArtifactStore.saveDemoRun(run),
    execute: executeDemo,
});
function requiresManualApiContractReview(project: {
    apiContract?: {
        allowNetwork?: boolean;
        allowMutations?: boolean;
        allowConcurrency?: boolean;
    };
}): boolean {
    return project.apiContract?.allowNetwork === true || project.apiContract?.allowMutations === true || project.apiContract?.allowConcurrency === true;
}
const registeredProfiles: ProjectProfileSummary[] = process.env.TESTPILOT_DISTRIBUTION_DEMO === "1" ? [{ id: "quantity-sample", name: "数量校验样例（内置测试缺陷）", suiteName: "随包数量规则回归" }] : [
    { id: "grammar-lab", name: "Grammar Lab · D:/work/grammar-lab-demo", suiteName: "Grammar Lab existing tests (model + browser)" },
    { id: "plural-runner", name: "Plural Runner · D:/work/plural-runner-demo", suiteName: "Plural Runner deterministic engine tests" },
    { id: "book-companion", name: "Book Companion · D:/work/book-companion-service-demo", suiteName: "Book Companion domain + local service browser tests" },
    { id: "word-runner", name: "Word Runner · D:/work/word-runner-demo", suiteName: "Word Runner deterministic engine + canvas browser tests" },
    { id: "demo-hub", name: "Demo Hub · D:/work/demo-hub", suiteName: "Demo Hub local API, SQLite migration, and backup/restore tests" },
];
const projectScriptRegistry = createProjectScriptRegistry({
    projectRoot,
    profilesDir: path.join(projectRoot, "examples", "profiles"),
    artifactDir: artifactsDir,
    registryFile: PROJECT_SCRIPTS_FILE,
    profiles: registeredProfiles,
    distributionDemo: process.env.TESTPILOT_DISTRIBUTION_DEMO === "1",
});
const { scripts: projectScripts } = projectScriptRegistry;
const profileRunService = createProjectProfileRunRuntime({
    profiles: registeredProfiles,
    timeoutMs: PROJECT_RUN_TIMEOUT_MS,
    createRunId: randomUUID,
    now: () => new Date().toISOString(),
    runsDirectory: PROJECT_RUNS_DIR,
    scripts: projectScriptRegistry,
    readArtifactFiles: readProjectRunFiles,
    persist: persistProjectRun,
    isAnyRunActive: () => demoRunService.isRunActive(),
    activateRun: id => demoRunService.activateRun(id),
    finishRun: id => demoRunService.finishRun(id),
});
const { runs: projectRuns, controllers: projectControllers, launch: launchProjectProfile } = profileRunService;
const documentPreparationTasks = new Map<string, DocumentPreparationTask>();
const documentPreparationDir = path.join(artifactsDir, "document-preparation");
async function recordDocumentPreparation(task: DocumentPreparationTask, stage: DocumentPreparationStage, state: "running" | "completed" | "warning" | "failed", message: string): Promise<void> {
    task.stage = stage;
    task.updatedAt = new Date().toISOString();
    task.events.push({ stage, status: state, message, at: task.updatedAt });
    await mkdir(documentPreparationDir, { recursive: true });
    await writeFile(path.join(documentPreparationDir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
}
function getModelDetails(): {
    available: boolean;
    label: string;
} {
    try {
        const config: any = modelConfiguration();
        return { available: Boolean(config?.modelAvailable), label: String(config?.modelLabel ?? "Pi Agent Core 1.2") };
    }
    catch {
        return { available: false, label: "Pi Agent Core 1.2" };
    }
}
function config(): DemoConfig {
    const model = getModelDetails();
    const computer = computerUseConfiguration();
    return {
        framework: "Pi Agent Core 1.2",
        storage: { dataDirectory: artifactsDir, artifactsDirectory: process.env.TESTPILOT_ARTIFACTS_DIR ?? path.join(artifactsDir, 'document-tests'), external: path.relative(projectRoot, artifactsDir).startsWith('..') || path.isAbsolute(path.relative(projectRoot, artifactsDir)) },
        ...(workspaces ? { workspaces } : {}),
        modelAvailable: model.available,
        modelLabel: model.label,
        computerUseAvailable: computer.available,
        computerUseReason: computer.reason,
        computerUseModel: computer.model,
        fixedTarget,
        targetLabel: fixedTarget ? "订单样例 API（预置修复）" : "订单样例 API（预置缺陷）",
        defaultRequirements,
    };
}
async function collectDocumentPageEvidence(project: NonNullable<Awaited<ReturnType<typeof getDocumentProject>>>, existingPage?: Page): Promise<string> {
    return documentPageEvidence.collect(project, existingPage);
}
/** Apply source-grounded, assertion-only repairs before any browser evidence
 * collection. These repairs use cases already present in the same approved
 * suite and do not infer a selector, record, identity, or backend result. */
function validRequest(value: any): value is DemoRequest {
    return value && typeof value === "object" && !Array.isArray(value)
        && ["deterministic", "requirements", "autonomous"].includes(value.mode)
        && ["offline", "model"].includes(value.provider)
        && typeof value.requirements === "string" && value.requirements.length <= 20000
        && Number.isInteger(value.maxActions) && value.maxActions >= 1 && value.maxActions <= 40
        && value.target === "sample";
}
async function persistRegressions(): Promise<void> {
    await demoArtifactStore.saveRegressionChecks(savedChecks);
}
function persistProjectRun(run: ProjectRunView): Promise<void> {
    return demoArtifactStore.saveProfileRun(run);
}
async function readProjectRunFiles(id: string): Promise<string[]> {
    return demoArtifactStore.listProfileRunFiles(id);
}
const { loadProfile: loadRegisteredProfile, view: projectScriptView, persist: persistProjectScripts, load: loadProjectScripts, createCandidate: createProjectScriptCandidate } = projectScriptRegistry;
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const policy = evaluateLocalRequestPolicy(req, `http://${req.headers.host ?? `${host}:${port}`}`);
    if ("status" in policy) {
        fail(res, policy.status, policy.message);
        return;
    }
    const url = policy.url;
    const api = url.pathname.startsWith("/api/");
    // Notification configuration uses PUT. Dispatch its method-aware routes before
    // the legacy GET/POST-only fallback, retaining the local host/origin policy.
    if (await handleDocumentNotificationRoutes(req, res, url, documentRunNotifications, { getRun: documentRunArtifacts.getRun }))
        return;
    if (api && req.method !== "GET" && req.method !== "POST") {
        fail(res, 405, "method not allowed");
        return;
    }
    if (await handleDocumentCaseCodeRoutes(req, res, url.pathname, { getProject: getDocumentProject, getRun: documentRunArtifacts.getRun, readSources: createDocumentCaseCodeSource(projectRoot) }))
        return;
    if (await handleMysqlRoutes(req, res, url, mysqlRoutes))
        return;
    if (await handleDocumentProjectRevisionRoutes(req, res, url, { getDocumentProject, getDocumentProjectRevision, listDocumentProjectRevisions }))
        return;
    if (req.method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true });
        return;
    }
    if (await handleDifyRegressionRoutes(req, res, url))
        return;
    if (req.method === "GET" && url.pathname === "/api/config") {
        json(res, 200, config());
        return;
    }
    if (await handleSourceTestRoutes(req, res, url.pathname, {
        jobs: sourceTestJobs, profiles: registeredProfiles,
        loadProfile: loadRegisteredProfile, loadResume: loadSourceResume,
        containsCredentialLikeValue, outputRoot: path.join(artifactsDir, "source-test-jobs"),
        importCandidate: (profileId, candidate) => projectScriptRegistry.importSourceCandidate(profileId, candidate),
    }))
        return;
    if (await handleSettingsRoutes(req, res, url.pathname, { readModelSettingsForUi, resolveModelSettings, saveModelSettings, testModelConnection, computerUseConfiguration, testComputerUseCapability, testBrowserCdpConnection, getBrowserRuntimeStatus }))
        return;
    if (req.method === "GET" && url.pathname === "/api/document-projects") {
        json(res, 200, await loadDocumentProjects());
        return;
    }
    const dependencyPreview = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/dependency-plan$/u);
    if (req.method === 'GET' && dependencyPreview) {
        const project = await getDocumentProject(dependencyPreview[1]!);
        if (!project) {
            fail(res, 404, '项目不存在');
            return;
        }
        try {
            json(res, 200, previewDocumentCaseDependencies(project.cases, url.searchParams.getAll('caseId')));
        }
        catch (error) {
            fail(res, 422, error instanceof Error ? error.message : '依赖预览失败');
        }
        return;
    }
    const sessionAction = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/session\/action$/u);
    if (req.method === 'POST' && sessionAction) {
        const project = await getDocumentProject(sessionAction[1]!);
        if (!project) {
            fail(res, 404, '项目不存在');
            return;
        }
        const release = activeDocumentRunRegistry.acquirePage(project.id);
        if (!release) {
            fail(res, 409, '项目页面被占用');
            return;
        }
        try {
            const session = await getExistingPersistentTestPage(path.join(artifactsDir, 'document-tests', 'browser-profiles', resolveDocumentSessionProfileKey(project)), project.executionConfig?.browser ? { browser: project.executionConfig.browser } : {});
            if (!session || new URL(session.page.url()).origin !== new URL(project.targetUrl).origin)
                throw new Error('目标会话不可用');
            const step = await bodyJson(req) as any;
            if (!step || typeof step !== 'object' || Object.keys(step).some(k => !['action', 'label', 'value', 'index', 'placeholder', 'text', 'rowIndex'].includes(k)) || (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 99)))
                throw new Error('无效观察/表单步骤');
            const page = session.page;
            if (step.action === 'fillByPlaceholder' && typeof step.placeholder === 'string' && typeof step.value === 'string')
                await page.getByPlaceholder(step.placeholder, { exact: true }).fill(step.value);
            else if (step.action === 'fillByRoleIndex' && Number.isInteger(step.index) && step.index >= 0 && typeof step.value === 'string')
                await page.getByRole('combobox').nth(step.index).fill(step.value);
            else if (step.action === 'fillByLabel' && typeof step.label === 'string' && typeof step.value === 'string')
                await (await resolveDocumentField(page, step.label, step.rowIndex)).fill(step.value);
            else if (step.action === 'blurByPlaceholder' && typeof step.placeholder === 'string')
                await page.getByPlaceholder(step.placeholder, { exact: true }).blur();
            else if (step.action === 'blurByLabel' && typeof step.label === 'string')
                await (await resolveDocumentField(page, step.label, step.rowIndex)).blur();
            else if (step.action === 'selectByRoleIndex' && Number.isInteger(step.index) && step.index >= 0 && typeof step.value === 'string')
                await selectDocumentOptionByRoleIndex(page, step.index, step.value);
            else if (step.action === 'clickExactText' && typeof step.text === 'string' && !/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|撤回|取消|submit|save|delete|pay|confirm|send|reset|cancel/i.test(step.text)) {
                const locator = page.getByText(step.text, { exact: true });
                if (await locator.count() !== 1)
                    throw new Error('文本定位不唯一');
                const unsafe = await locator.evaluate(el => { const node = el.closest('button,input,a,[role=button]') ?? el; return /提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|撤回|取消|submit|save|delete|pay|confirm|send|reset|cancel/i.test([node.textContent, node.getAttribute('type'), node.getAttribute('aria-label')].join(' ')); });
                if (unsafe)
                    throw new Error('业务写入必须走单次授权接口');
                await locator.click();
            }
            else if (step.action !== 'observe')
                throw new Error('不支持的表单步骤');
            json(res, 200, await captureCurrentPageEvidence(page, project.targetUrl));
        }
        catch (error) {
            fail(res, 422, error instanceof Error ? error.message : '表单操作失败');
        }
        finally {
            release();
        }
        return;
    }
    const authorizedWriteRoute = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/authorized-writes(?:\/([A-Za-z0-9_-]{1,80})(?:\/(execute))?)?$/u);
    if (authorizedWriteRoute) {
        const projectId = authorizedWriteRoute[1]!;
        const project = await getDocumentProject(projectId);
        if (!project) {
            fail(res, 404, '项目不存在。');
            return;
        }
        let release: (() => void) | undefined;
        try {
            const operationId = authorizedWriteRoute[2];
            if (req.method === 'POST' && !operationId) {
                const plan = validateWritePlan(await bodyJson(req));
                if (plan.projectId !== projectId || new URL(plan.targetUrl).origin !== new URL(project.targetUrl).origin)
                    throw new Error('授权必须属于当前项目目标。');
                json(res, 201, await authorizedBrowserWrites.authorize(plan));
                return;
            }
            if (!operationId) {
                fail(res, 405, 'method not allowed');
                return;
            }
            const record = await authorizedBrowserWrites.read(operationId);
            if (record.plan.projectId !== projectId) {
                fail(res, 404, '操作不存在。');
                return;
            }
            if (req.method === 'GET' && !authorizedWriteRoute[3]) {
                json(res, 200, record);
                return;
            }
            if (req.method !== 'POST' || !authorizedWriteRoute[3]) {
                fail(res, 405, 'method not allowed');
                return;
            }
            const input = await bodyJson(req);
            if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
                throw new Error('执行仅接受空对象，不能覆盖授权计划。');
            release = activeDocumentRunRegistry.acquirePage(projectId);
            if (!release)
                throw new Error('项目浏览器正在使用中。');
            const session = await getExistingPersistentTestPage(path.join(artifactsDir, 'document-tests', 'browser-profiles', resolveDocumentSessionProfileKey(project)), project.executionConfig?.browser ? { browser: project.executionConfig.browser } : {});
            if (!session)
                throw new Error('请先打开项目浏览器并完成登录。');
            if (new URL(project.targetUrl).origin !== new URL(record.plan.targetUrl).origin)
                throw new Error('项目目标已改变，原授权失效。');
            json(res, 200, await authorizedBrowserWrites.execute(operationId, projectId, record.plan.targetUrl, session.page));
        }
        catch (error) {
            fail(res, 409, error instanceof Error ? error.message : '授权写入失败。');
        }
        finally {
            release?.();
        }
        return;
    }
    const sessionInspect = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/session\/inspect$/u);
    const databaseEvidenceRoute = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/database-evidence$/u);
    if (databaseEvidenceRoute) {
        if (req.method !== 'POST') {
            fail(res, 405, 'method not allowed');
            return;
        }
        const input = await bodyJson(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
            fail(res, 400, '数据库证据查询只接受空对象；不能提供 SQL、地址或凭据。');
            return;
        }
        const project = await getDocumentProject(databaseEvidenceRoute[1]!);
        if (!project || !isDepartmentDatabaseTarget(project)) {
            fail(res, 404, '此项目没有已绑定的数据库只读查询。');
            return;
        }
        try {
            json(res, 200, { evidence: await collectDocumentAgentDatabaseEvidence(project, true) });
        }
        catch (error) {
            fail(res, 409, error instanceof Error && error.message.includes('未连接') ? error.message : '本次数据库只读查询未取得证据。');
        }
        return;
    }
    if (await handleDocumentWebsiteMapRoutes(req, res, url.pathname, documentWebsiteMapService, () => modelConfiguration().modelAvailable))
        return;
    if (req.method === "POST" && sessionInspect) {
        const project = await getDocumentProject(sessionInspect[1]!);
        if (!project) {
            fail(res, 404, "文档测试项目不存在。");
            return;
        }
        const input = await bodyJson(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
            fail(res, 400, "页面观察仅接受空对象。");
            return;
        }
        try {
            json(res, 200, { projectId: project.id, evidence: await collectDocumentPageEvidence(project) });
        }
        catch (error) {
            fail(res, 422, error instanceof Error ? error.message : "页面观察失败。");
        }
        return;
    }
    if (await handleDocumentProjectMaterialRoutes(req, res, url.pathname, {
        getProject: getDocumentProject, extractDocument, readSource: readDocumentSource,
        writeSource: writeDocumentSource, saveProject: saveDocumentProject, getMaterialVersion: getDocumentMaterialVersion,
    }))
        return;
    if (await handleCaseGenerationRoutes(req, res, url.pathname, {
        extractDocument, generateDrafts: generateTestCaseDrafts, readPublicWebsiteText, searchExamples: searchTestExamples,
        publicSearchDisabled: () => process.env.TESTPILOT_DISABLE_PUBLIC_SEARCH === "1",
        ensureProjectWorkflow: documentProjectWorkflowPreparationService.ensureProjectWorkflow,
    }))
        return;
    if (await handleSqliteMigrationRoutes(req, res, url.pathname, {
        listCandidates: listSqliteMigrationCandidates,
        createCandidate: createSqliteMigrationCandidate,
        updateCandidate: updateSqliteMigrationCandidate,
        reviewCandidate: reviewSqliteMigrationCandidate,
        executeApproved: executeApprovedSqliteMigrationSuite,
        readArtifact: readSqliteMigrationRunArtifact,
        getRun: getSqliteMigrationRun,
        getCandidate: getSqliteMigrationCandidate,
    }))
        return;
    if (await handleApiSuiteRoutes(req, res, url.pathname, {
        listCandidates: listApiSuiteCandidates, createCandidate: createApiSuiteCandidate,
        updateCandidate: updateApiSuiteCandidate, reviewCandidate: reviewApiSuiteCandidate,
        getCandidate: getApiSuiteCandidate, getFindingHistory: getApiFindingHistory,
        diagnoseFinding: diagnoseApiFinding, executeApproved: executeApprovedApiSuite,
        autoRunReadOnly: autoRunReadOnlyApiSuite, readRunArtifact: readApiRunArtifact, getRun: getApiRun,
        generateSuite: generateApiSuite, extractDocument,
        searchExamples: searchTestExamples, summarizeOpenApi: summarizeOpenApiSpecification,
        openApiOperationFacts, publicSearchDisabled: () => process.env.TESTPILOT_DISABLE_PUBLIC_SEARCH === '1',
    }))
        return;
    if (await handleDocumentRunHandoffRoutes(req, res, url.pathname, {
        getProject: getDocumentProject, getRecovery: getDocumentRunRecovery,
        getHandoff: getLoginHandoff, continueLogin: requestLoginContinue,
        runSessionKey: id => { const run = activeDocumentRunRegistry.getRun(id); return run ? run.isolatedProfileKey ?? run.projectId : undefined; },
    }))
        return;
    if (await handleDocumentRunRoutes(req, res, url.pathname, {
        getRun: documentRunArtifacts.getRun,
        getProgress: getDocumentRunProgress,
        cancelRun: cancelDocumentRun,
        pauseRun: pauseDocumentRun,
        continueRun: continueDocumentRun,
        cancelWorkflow: cancelDocumentWorkflow,
        retryPackaging: retryDocumentRunPackaging,
        readPackage: documentRunArtifacts.readPackage,
        readEvidence: readDocumentRunEvidence,
    }))
        return;
    if (await handleDocumentWorkflowRoutes(req, res, url, { list: listDocumentWorkflows, get: getDocumentWorkflow }))
        return;
    if (await handleDocumentProjectPreparationRoutes(req, res, url.pathname, {
        start: documentProjectPreparationService.start,
        getTask: async (id) => documentPreparationTasks.get(id) ?? await readFile(path.join(documentPreparationDir, `${id}.json`), "utf8").then(text => JSON.parse(text) as DocumentPreparationTask, () => undefined),
    }))
        return;
    if (await handleDocumentImpactReviewRoute(req, res, url.pathname, documentImpactReviewService.execute))
        return;
    if (await handleDocumentAutonomousPlanRoutes(req, res, url, documentAutonomousPlanService))
        return;
    if (await handleDocumentAutonomousExecutionRoutes(req, res, url, documentAutonomousPlanExecutionService))
        return;
    if (await handleDocumentRunInvestigationRoutes(req, res, url, { ...documentRunInvestigationService, imageAnalysis: documentRunImageAnalysisService }))
        return;
    if (await handleDocumentStepRevisionProposalRoutes(req, res, url, documentStepRevisionProposalService, documentRunArtifacts.getRun))
        return;
    if (await handleDocumentRunRecoveryReadinessRoutes(req, res, url, documentRunRecoveryReadinessService))
        return;
    if (await handleDocumentAutomaticRecoveryRoutes(req, res, url, documentAutomaticRecoveryService))
        return;
    if (await handleDocumentSiteVersionRoute(req, res, url.pathname, documentSiteVersionService.register))
        return;
    if (await handleDocumentSessionOpenRoutes(req, res, url, documentSessionOpenService))
        return;
    if (await handleDocumentParallelRunRoutes(req, res, url, documentParallelRunService))
        return;
    if (await handleDocumentSessionProfileRoutes(req, res, url, documentSessionProfileService))
        return;
    if (await handleDocumentCaseMarkdownRoutes(req, res, url.pathname, {
        getCases: async (id) => (await getDocumentProject(id))?.cases,
        preview: documentCaseMarkdownService.preview,
        import: documentCaseMarkdownService.import.bind(documentCaseMarkdownService),
    }))
        return;
    if (await handleDocumentProjectSessionRoutes(req, res, url, {
        getProject: getDocumentProject,
        getStatus: documentProjectSessionService.getStatus,
        saveIdentity: documentProjectSessionService.saveIdentity,
        listRuns: documentRunHistoryService.list,
    }))
        return;
    if (await handleDocumentStepProbeRoute(req, res, url.pathname, { getProject: getDocumentProject, probe: documentStepProbeAdapter.probe }))
        return;
    if (await handleDocumentCaseSelectionRoute(req, res, url.pathname, documentCaseSelectionService.select))
        return;
    if (await handleDocumentProjectUpdateRoute(req, res, url.pathname, { getProject: getDocumentProject, update: documentProjectUpdateService.update }))
        return;
    if (await handleDocumentProjectReviewRoute(req, res, url.pathname, { getProject: getDocumentProject, approve: documentProjectReviewService.approve }))
        return;
    if (await handleDocumentCaseStepRoute(req, res, url.pathname, {
        getProject: getDocumentProject,
        saveProject: saveDocumentProject,
        modelAvailable: () => modelConfiguration().modelAvailable,
        collectPageEvidence: collectDocumentPageEvidence,
        collectAuthoringContext: createDocumentAuthoringContextReader({
            manifestPath: process.env.TESTPILOT_AUTHORING_SOURCES_FILE ?? path.resolve('config/document-authoring-sources.json'),
            databaseStatus: mysqlBrowserStatus,
            databaseEvidence: collectDocumentAgentDatabaseEvidence,
        }),
        generateSteps: generateDocumentCaseSteps,
        draftEvidenceBoundUiCheck,
        validateCases,
    }))
        return;
    if (await handleDocumentProjectCaseAuthoringRoutes(req, res, url.pathname, {
        getProject: getDocumentProject,
        saveProject: saveDocumentProject,
        getRevision: getDocumentProjectRevision,
        mutateProject: projectRepository.mutateProject,
        validateCases,
        modelAvailable: () => modelConfiguration().modelAvailable,
        generateSelectedBrowserSteps: documentCaseStepAuthoringService.generateSelectedBrowserSteps,
        prepareSelectedBrowserCases: documentCaseStepAuthoringService.prepareSelectedBrowserCases,
        repairBlockedBrowserSteps: documentCaseStepAuthoringService.repairBlockedBrowserSteps,
        generateBrowserCaseSet: documentCaseStepAuthoringService.generateBrowserCaseSet,
    }))
        return;
    if (await handleDocumentProjectRunRoute(req, res, url.pathname, { getProject: getDocumentProject, execute: documentProjectRunUsecaseService.execute }))
        return;
    if (await handleDemoRunRoutes(req, res, url.pathname, url.searchParams, {
        service: demoRunService, regressions: savedChecks, defaultRequirements,
        validRequest, modelAvailable: () => getModelDetails().available,
        persistRegressions, renderMarkdown: renderDemoRunReport,
    }))
        return;
    if (await handleProjectScriptAuthoringRoutes(req, res, url.pathname, {
        profiles: registeredProfiles, scripts: projectScripts, modelAvailable: () => modelConfiguration().modelAvailable,
        extractDocument, generateCandidate: generateGrammarPlaywrightCandidate, createCandidate: createProjectScriptCandidate,
    }))
        return;
    if (await handleProjectScriptRoutes(req, res, url.pathname, {
        scripts: projectScripts, view: projectScriptView, persist: persistProjectScripts,
        isRunActive: () => demoRunService.isRunActive(), launchApproved: script => launchProjectProfile(script.profileId, script),
    }))
        return;
    if (await handleProjectRunRoutes(req, res, url.pathname, url.searchParams, {
        runs: projectRuns, controllers: projectControllers, profiles: registeredProfiles,
        isRunActive: () => demoRunService.isRunActive(), launch: profileId => launchProjectProfile(profileId), persist: persistProjectRun,
        readArtifact: demoArtifactStore.readProfileRunArtifact,
        readReport: demoArtifactStore.readProfileRunReport,
    }))
        return;
    if (req.method === "POST" && url.pathname === "/api/target") {
        let data: any;
        try {
            data = await bodyJson(req);
        }
        catch (error) {
            fail(res, 400, String((error as Error).message));
            return;
        }
        if (!data || typeof data.fixed !== "boolean") {
            fail(res, 400, "fixed must be a boolean");
            return;
        }
        if (demoRunService.isRunActive()) {
            fail(res, 409, "target cannot change while a run is active");
            return;
        }
        fixedTarget = data.fixed;
        json(res, 200, config());
        return;
    }
    if (url.pathname.startsWith("/api/")) {
        fail(res, 404, "not found");
        return;
    }
    if (await handleSample(req, res, fixedTarget))
        return;
    if (req.method === "GET" && await handleStaticFile(url.pathname, res, distDir))
        return;
    fail(res, 404, "not found");
}
const documentProjectPreparationService = createDocumentProjectPreparationService({
    tasks: documentPreparationTasks, recordTask: recordDocumentPreparation,
    extractDocument, createReviewCases, searchExamples: searchTestExamples, readPublicWebsiteText,
    resolveInputRoles: resolveDocumentInputRoles, makeProject: makeDocumentProject,
    createWorkflow: createDocumentWorkflow, startWorkflowStage: startDocumentWorkflowStage,
    completeWorkflowStage: completeDocumentWorkflowStage, waitWorkflowStage: waitDocumentWorkflowStage,
    failWorkflowStage: failDocumentWorkflowStage, getWorkflow: getDocumentWorkflow,
    saveProject: saveDocumentProject, writeSource: writeDocumentSource,
    generateBrowserCases: generateDocumentBrowserCases, modelAvailable: () => modelConfiguration().modelAvailable,
    validateCases, validateCasesPreservingTrace: validateCasesPreservingGenerationTrace, mergeBrowserCases,
    generateMissingSteps: generateMissingBrowserSteps, requiresManualReview: requiresManualApiContractReview,
    hasAutoRunnableSelectedCase, newId: randomUUID, now: () => new Date().toISOString(),
});
savedChecks = await restoreDemoServerState({
    runsDirectory: runsDir,
    artifactStore: demoArtifactStore,
    demoRunService,
    projectRuns,
    profiles: registeredProfiles,
    loadProjectScripts,
    now: () => new Date().toISOString(),
});
const server = createServer((req, res) => {
    void handle(req, res).catch(error => {
        console.error("Demo server request failed", error);
        if (!res.headersSent)
            fail(res, 500, "internal server error");
        else
            res.destroy();
    });
});
server.listen(port, host, () => console.log(`TestPilot Demo: http://${host}:${port}`));
let shuttingDown = false;
const shutdown = () => {
    if (shuttingDown)
        return;
    shuttingDown = true;
    server.close(() => { void Promise.all([closePersistentTestPages(), disconnectMysqlBrowser()]).finally(() => process.exit(0)); });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
