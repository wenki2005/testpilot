import { configureDocumentPagePlatform } from '../adapters/browser/document-page-platform.js';
import { createDocumentAuthoringContextReader } from '../adapters/documents/cases/authoring-context.js';
import { collectDocumentAgentDatabaseEvidence, bindDepartmentDatabaseFixture, missingDepartmentDatabaseFixtureAssertion } from '../adapters/documents/evidence/agent-database.js';
import { createDocumentWebsiteMapService } from '../application/projects/document-website-map-service.js';
import { createDocumentCaseNavigationAdapter } from '../adapters/ai/document-case-navigation.js';
import { createDocumentWebsiteMapStore } from '../storage/document-projects/website-map-store.js';
import { mysqlBrowserStatus } from '../adapters/database/mysql-browser.js';
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from "node:url";
import { modelConfiguration, generateDocumentBrowserCases, generateDocumentCaseSteps, validateDraftLocatorsAgainstEvidence } from "../server/runtime.js";
import { acquireDocumentPageLease, cancelDocumentRun, executeDocumentRun as executeDocumentRunAdapter, getDocumentCaseVersion, getDocumentMaterialVersion, getDocumentProject, getDocumentProjectRevision, getDocumentRun, getDocumentRunProgress, getDocumentRunRecovery, readDocumentRunEvidence, isDocumentBaselineEligible, listDocumentProjectRevisions, makeDocumentProject, projectRepository, resolveDocumentRunParameters, saveDocumentProject, documentRunRepository, canSafelyFinalizeDocumentRunPackage, unsupportedWeChatClientGateMessage, validateDocumentTarget, type DocumentProject, } from "../adapters/documents/execution/run-executor.js";
import { getExistingPersistentTestPage, launchPersistentTestPage, promotePersistentTestPage, navigatePersistentPage } from "../adapters/browser/browser-runtime.js";
import { getLoginHandoff, isLoginPage, allowBrowserRequest, browserRequestAllowed, waitForUserLogin, clearLoginHandoff } from "../adapters/browser/login-handoff.js";
import { createProjectTargetPagePreparer } from '../adapters/browser/prepare-project-target-page.js';
import { createDocumentSessionOpenService } from '../application/projects/document-session-open-service.js';
import { createDocumentProjectSessionStatusAdapter } from "../adapters/browser/document-project-session-status.js";
import { createDocumentStepProbeAdapter } from "../adapters/browser/document-step-probe.js";
import { resolveDocumentField } from "../adapters/browser/document-form-controls.js";
import { analyzeDocumentCaseImpact } from "../adapters/documents/cases/impact-analysis.js";
import { createDocumentPageEvidenceAdapter, createDocumentPageExplorationAdapter, draftEvidenceBoundUiCheck, type DocumentPageEvidenceDependencies } from "../adapters/documents/evidence/page-evidence.js";
import { createDocumentExplorationDecisionAdapter } from "../adapters/ai/document-exploration-decision-adapter.js";
import { addNoApiNetworkAssertion, browserStepDraftBlockReason, canAuthorReadOnlyBrowserSteps, createReviewCases, deriveGroundedCustomerLookupSubcheck, deriveGroundedEmptyListNavigationSubcheck, deriveGroundedEmptyRequiredFieldSubcheck, deriveRelatedInvalidInputSubcheck, draftGroundedReadOnlyBrowserSteps, explainBlockedBrowserStepDraft, hasAutoRunnableSelectedCase, hasOnlyGenericShellAssertions, } from "../domain/documents/cases/case-authoring.js";
import { resolveDocumentInputRoles } from "../adapters/documents/cases/source-roles.js";
import { validateCases, validateCasesPreservingGenerationTrace } from "../domain/documents/cases/case-validation.js";
import { mergeDocumentBrowserCases } from "../domain/documents/cases/case-merge.js";
import { getDocumentCaseVersion as caseVersion } from "../domain/documents/runs/run-scope.js";
import { createDocumentRunApplicationService } from "../application/runs/execution/service.js";
import { createDocumentRunHistoryService } from "../application/runs/results/history-service.js";
import { createDocumentRunArtifactStore } from "../storage/document-runs/run-artifact-store.js";
import { activeDocumentRunRegistry } from "../application/runs/execution/active-document-run-registry.js";
import { createDocumentProjectSessionService } from "../application/projects/document-project-session-service.js";
import { createDocumentSessionProfileService } from '../application/projects/document-session-profile-service.js';
import { createDocumentCaseMarkdownService } from '../application/cases/document-case-markdown-service.js';
import { createDocumentParallelRunService } from '../application/runs/execution/parallel-run-service.js';
import { createDocumentCaseSelectionService } from "../application/cases/document-case-selection-service.js";
import { createDocumentImpactReviewService } from "../application/cases/document-impact-review-service.js";
import { createDocumentSiteVersionService } from "../application/projects/document-site-version-service.js";
import { createDocumentProjectUpdateService } from "../application/projects/document-project-update-service.js";
import { createDocumentProjectReviewService } from "../application/projects/document-project-review-service.js";
import { createDocumentCaseStepAuthoringService } from "../application/cases/document-case-step-authoring-service.js";
import { createDocumentProjectRunPreparationService } from "../application/runs/preparation/project-run-preparation-service.js";
import { createDocumentProjectRunSubmissionService } from "../application/runs/execution/project-run-submission-service.js";
import { createDocumentProjectWorkflowPreparationService } from "../application/runs/preparation/project-workflow-preparation-service.js";
import { createDocumentProjectRunUsecaseService } from "../application/runs/execution/project-run-usecase-service.js";
import { approveDocumentWorkflowStage, cancelDocumentWorkflow, completeDocumentWorkflow, completeDocumentWorkflowStage, createDocumentWorkflow, failDocumentWorkflowStage, getDocumentWorkflow, linkDocumentWorkflowRun, resumeDocumentWorkflowStage, startDocumentWorkflowStage, waitDocumentWorkflowStage, } from "../adapters/documents/execution/workflow-record.js";
import { containsCredentialLikeValue, redactSensitiveExportText } from "../adapters/documents/evidence/sensitive-data.js";
import { createDocumentRunInvestigationService } from '../application/runs/results/investigation-service.js';
import { createDocumentRunInvestigationEvaluator } from '../adapters/ai/document-run-investigation-evaluator.js';
import { createDocumentRunInvestigationStore } from '../storage/document-runs/run-investigation-store.js';
import { createDocumentRunImageAnalysisService } from '../application/runs/results/image-analysis-service.js';
import { createDocumentRunImageAnalysisEvaluator } from '../adapters/ai/document-run-image-analysis-evaluator.js';
import { createDocumentRunImageAnalysisStore } from '../storage/document-runs/run-image-analysis-store.js';
import { createDocumentStepRevisionProposalService } from '../application/runs/execution/step-revision-proposal-service.js';
import { createDocumentStepRevisionProposalEvaluator } from '../adapters/ai/document-step-revision-proposal-evaluator.js';
import { createDocumentStepRevisionProposalStore } from '../storage/document-runs/step-revision-proposal-store.js';
import { createDocumentRunRecoveryReadinessService } from '../application/runs/recovery/recovery-readiness-service.js';
import { createDocumentAutomaticRecoveryService } from '../application/runs/recovery/automatic-recovery-service.js';
import { createDocumentAutomaticRecoveryStore } from '../storage/document-runs/automatic-recovery-store.js';
import { compatibleChatModelProvider } from '../adapters/ai/compatible-chat.js';
import { createDocumentAutonomousRegressionEvaluator } from '../adapters/ai/document-autonomous-regression-evaluator.js';
import { createAutonomousRegressionPlanner } from '../application/cases/document-autonomous-regression-planner.js';
import { createDocumentAutonomousPlanService } from '../application/cases/document-autonomous-plan-service.js';
import { createDocumentAutonomousPlanStore } from '../storage/document-runs/autonomous-plan-store.js';
import { createDocumentAutonomousExecutionStore } from '../storage/document-runs/autonomous-execution-store.js';
import { createDocumentAutonomousPlanExecutionService } from '../application/runs/execution/autonomous-plan-execution-service.js';
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, "../..");
const artifactsDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(projectRoot, "artifacts", "demo"));
const documentRunArtifacts = createDocumentRunArtifactStore(path.join(artifactsDir, "document-tests", "runs"));
function requiresManualApiContractReview(project: {
    apiContract?: {
        allowNetwork?: boolean;
        allowMutations?: boolean;
        allowConcurrency?: boolean;
    };
}): boolean {
    return project.apiContract?.allowNetwork === true || project.apiContract?.allowMutations === true || project.apiContract?.allowConcurrency === true;
}
function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** Production composition for document-test application services. */
export function createDocumentApplicationServices() {
    const documentRunInvestigationService = createDocumentRunInvestigationService({
        loadRun: async (id) => await documentRunArtifacts.getRun(id) ?? null,
        evaluator: createDocumentRunInvestigationEvaluator({ model: compatibleChatModelProvider }),
        repository: createDocumentRunInvestigationStore(path.join(artifactsDir, 'document-tests', 'investigations')),
        redactText: redactSensitiveExportText,
    });
    const documentRunImageAnalysisService = createDocumentRunImageAnalysisService({
        getRun: async (id) => await documentRunArtifacts.getRun(id),
        readEvidence: readDocumentRunEvidence,
        evaluate: createDocumentRunImageAnalysisEvaluator({ model: compatibleChatModelProvider }),
        repository: createDocumentRunImageAnalysisStore(path.join(artifactsDir, 'document-tests', 'image-analyses')),
        redactText: redactSensitiveExportText,
    });
    const documentStepRevisionProposalService = createDocumentStepRevisionProposalService({
        getRun: documentRunArtifacts.getRun,
        getProject: projectRepository.getProject,
        getInvestigation: documentRunInvestigationService.get,
        evaluate: createDocumentStepRevisionProposalEvaluator({ model: compatibleChatModelProvider }).evaluate,
        validateCases,
        redactText: redactSensitiveExportText,
        repository: createDocumentStepRevisionProposalStore(path.join(artifactsDir, 'document-tests', 'step-revision-proposals')),
        mutateProject: projectRepository.mutateProject,
    });
    const documentRunRecoveryReadinessService = createDocumentRunRecoveryReadinessService({
        getRun: documentRunArtifacts.getRun,
        getProject: projectRepository.getProject,
        getInvestigation: documentRunInvestigationService.get,
        redactText: redactSensitiveExportText,
        async validateInputs(project, parent, orderedCaseIds) {
            if (parent.baselineRunId) {
                const baseline = await documentRunArtifacts.getRun(parent.baselineRunId);
                if (!baseline || baseline.projectId !== project.id || !isDocumentBaselineEligible(baseline))
                    throw new Error('父运行关联的历史基线缺失或不可用，无法按原输入恢复。');
            }
            resolveDocumentRunParameters(project, orderedCaseIds, parent.testDataSetId, parent.parameterValues ?? {});
        },
    });
    const autonomousPlans = createDocumentAutonomousPlanStore(path.join(artifactsDir, 'document-tests', 'autonomous-plans'));
    const autonomousExecutions = createDocumentAutonomousExecutionStore(path.join(artifactsDir, 'document-tests', 'autonomous-executions'));
    const documentAutonomousPlanService = createDocumentAutonomousPlanService({
        getProject: projectRepository.getProject,
        planner: createAutonomousRegressionPlanner({ evaluator: createDocumentAutonomousRegressionEvaluator({ model: compatibleChatModelProvider }) }),
        repository: autonomousPlans,
        createId: randomUUID,
        now: () => new Date().toISOString(),
    });
    const documentAutonomousPlanExecutionService = createDocumentAutonomousPlanExecutionService({
        getProject: projectRepository.getProject,
        getPlan: autonomousPlans.get,
        saveExecution: autonomousExecutions.save,
        getExecution: autonomousExecutions.get,
        createIntent: autonomousExecutions.createIntent,
        isRunActive: id => activeDocumentRunRegistry.isRunActive(id),
        onCompleted: async (run) => {
            if (run.overall !== 'passed') {
                await documentRunInvestigationService.investigate(run.id);
                await documentAutomaticRecoveryService.handle(run.id);
            }
        },
        createRunId: randomUUID,
        now: () => new Date().toISOString(),
        getRun: documentRunArtifacts.getRun,
        getProgress: getDocumentRunProgress,
        submit: (project, options) => executeDocumentRunAdapter({ ...project, targetUrl: options.siteVersionSnapshot.targetUrl }, { ...options, runMode: 'regression' }),
    });
    const prepareSessionTarget = createProjectTargetPagePreparer({
        allowRequest: allowBrowserRequest,
        navigate: navigatePersistentPage,
        isLoginPage,
        waitForUserLogin,
    });
    const documentSessionOpenService = createDocumentSessionOpenService({
        projects: projectRepository,
        onSettled: clearLoginHandoff,
        acquirePage: id => activeDocumentRunRegistry.acquirePage(id),
        createId: randomUUID, now: () => new Date().toISOString(),
        openSession: async ({ project, profileKey }) => { const session = await launchPersistentTestPage(path.join(artifactsDir, 'document-tests', 'browser-profiles', profileKey), { ...(project.executionConfig?.browser ? { browser: project.executionConfig.browser } : {}) }); await configureDocumentPagePlatform(session.page, project.executionConfig); return session; },
        prepareTargetPage: ({ project, requestId, targetUrl, session, onLoginWait }) => prepareSessionTarget(targetUrl, project.id, requestId, session.page, onLoginWait),
    });
    const documentSessionProfileService = createDocumentSessionProfileService({
        projects: projectRepository,
        mutateProject: projectRepository.mutateProject,
        acquirePage: id => activeDocumentRunRegistry.acquirePage(id),
        now: () => new Date().toISOString(), createId: randomUUID,
    });
    const documentCaseMarkdownService = createDocumentCaseMarkdownService({
        getCases: async (id) => (await projectRepository.getProject(id))?.cases,
        importCasesIfDigest: projectRepository.importCasesIfDigest,
    });
    const projectSessionStatusAdapter = createDocumentProjectSessionStatusAdapter({
        registry: activeDocumentRunRegistry,
        userDataDirectory: projectId => path.join(artifactsDir, "document-tests", "browser-profiles", projectId),
        getLoginHandoff,
        isLoginPage,
        getExistingPage: getExistingPersistentTestPage,
        now: () => new Date().toISOString(),
    });
    const documentStepProbeAdapter = createDocumentStepProbeAdapter({
        registry: activeDocumentRunRegistry,
        acquirePageLease: projectId => activeDocumentRunRegistry.acquirePage(projectId),
        userDataDirectory: projectId => path.join(artifactsDir, "document-tests", "browser-profiles", projectId),
        getExistingPage: getExistingPersistentTestPage,
        isLoginPage,
        resolveDocumentField,
        now: () => new Date().toISOString(),
    });
    const documentRunHistoryService = createDocumentRunHistoryService({
        getProject: projectRepository.getProject,
        getRun: documentRunArtifacts.getRun,
        listRunIds: documentRunRepository.listJournalIds,
        readJournal: documentRunRepository.readJournal,
        isRunActive: id => activeDocumentRunRegistry.isRunActive(id),
        isPackageFinalizing: id => activeDocumentRunRegistry.isPackageFinalizing(id),
        isBaselineEligible: isDocumentBaselineEligible,
        canSafelyFinalizePackage: canSafelyFinalizeDocumentRunPackage,
    });
    const pageEvidenceDependencies: DocumentPageEvidenceDependencies = {
        acquirePageLease: acquireDocumentPageLease,
        launchPersistentTestPage,
        promotePersistentTestPage,
        navigatePersistentPage,
        isLoginPage,
        unsupportedClientGateMessage: unsupportedWeChatClientGateMessage,
        profileDirectory: projectId => path.join(artifactsDir, "document-tests", "browser-profiles", projectId),
    };
    const pageEvidence = createDocumentPageEvidenceAdapter(pageEvidenceDependencies);
    const pageExploration = createDocumentPageExplorationAdapter({ ...pageEvidenceDependencies,
        allowReadRequest: (method, url, resourceType, targetOrigin) => /^(GET|HEAD)$/u.test(method) && browserRequestAllowed(method, url, { targetOrigin, resourceType, loginHandoffActive: false }),
    });
    const explorationDecision = createDocumentExplorationDecisionAdapter(compatibleChatModelProvider);
    const documentWebsiteMapService = createDocumentWebsiteMapService({
        getProject: projectRepository.getProject, exploration: pageExploration, decisions: explorationDecision,
        caseNavigation: createDocumentCaseNavigationAdapter(compatibleChatModelProvider),
        repository: createDocumentWebsiteMapStore(path.join(artifactsDir, 'document-tests', 'website-maps')),
        createId: randomUUID, now: () => new Date().toISOString(),
    });
    const documentRunApplicationService = createDocumentRunApplicationService<NonNullable<Parameters<typeof executeDocumentRunAdapter>[1]>>({ getProject: projectRepository.getProject, executor: executeDocumentRunAdapter });
    const documentProjectRunSubmissionService = createDocumentProjectRunSubmissionService<NonNullable<Parameters<typeof executeDocumentRunAdapter>[1]>>({
        getRecovery: getDocumentRunRecovery,
        getProgress: getDocumentRunProgress,
        execute: (projectId, options) => documentRunApplicationService.execute(projectId, options),
        wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    });
    const documentProjectRunPreparationService = createDocumentProjectRunPreparationService({
        getRun: documentRunArtifacts.getRun,
        getReadiness: documentRunRecoveryReadinessService.get,
        isBaselineEligible: isDocumentBaselineEligible,
        resolveParameters: resolveDocumentRunParameters,
    });
    const documentAutomaticRecoveryService = createDocumentAutomaticRecoveryService({
        enabled: process.env.TESTPILOT_AUTOMATIC_RECOVERY === 'readonly-once',
        repository: createDocumentAutomaticRecoveryStore(path.join(artifactsDir, 'document-tests', 'automatic-recovery')),
        isInvestigating: documentRunInvestigationService.isInvestigating,
        getProgress: getDocumentRunProgress,
        getRun: documentRunArtifacts.getRun, getProject: projectRepository.getProject,
        getReadiness: documentRunRecoveryReadinessService.get, prepare: documentProjectRunPreparationService,
        createRunId: randomUUID, now: () => new Date().toISOString(),
        isRunActive: id => activeDocumentRunRegistry.isRunActive(id),
        submit: async (prepared, runId) => {
            const project = structuredClone(prepared.runProject);
            delete project.workflowId;
            if (prepared.runSiteVersion)
                project.targetUrl = prepared.runSiteVersion.targetUrl;
            return executeDocumentRunAdapter(project, { runId, runMode: 'regression', parentRunId: prepared.parentRunId!,
                checkpointRecovery: prepared.checkpointRecovery!, selectedCaseIds: prepared.requestedCaseIds!,
                ...(prepared.runScopePlan ? { scopePlan: prepared.runScopePlan } : {}),
                ...(prepared.runSiteVersion ? { siteVersionSnapshot: prepared.runSiteVersion } : {}),
                ...(prepared.baselineRunId ? { baselineRunId: prepared.baselineRunId } : {}),
                ...(prepared.testDataSetId ? { testDataSetId: prepared.testDataSetId } : {}), parameterValues: prepared.parameterValues,
                retestNotes: '自动恢复策略 v1：原始自主回归的环境类失败，仅重建当前只读用例及前置一次；不自动修订脚本。' });
        },
    });
    const parallelDirectory = path.join(artifactsDir, 'document-tests', 'parallel-runs');
    const documentParallelRunService = createDocumentParallelRunService({
        getProject: projectRepository.getProject,
        getRun: documentRunArtifacts.getRun,
        async listProjectGroups(projectId) {
            const names = await readdir(parallelDirectory).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return [];
                throw error;
            });
            const groups = [];
            for (const name of names) {
                if (!/^[0-9a-f-]{36}\.json$/u.test(name))
                    continue;
                try {
                    const group = JSON.parse(await readFile(path.join(parallelDirectory, name), 'utf8'));
                    if (group.projectId === projectId && typeof group.createdAt === 'string' && Array.isArray(group.jobs) && group.id === name.slice(0, -5))
                        groups.push(group);
                }
                catch { /* Ignore incomplete records, preserving their files for diagnosis. */ }
            }
            return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
        },
        prepare: documentProjectRunPreparationService,
        execute: executeDocumentRunAdapter,
        createId: randomUUID, now: () => new Date().toISOString(),
        async persist(group) {
            await mkdir(parallelDirectory, { recursive: true });
            const temporary = path.join(parallelDirectory, `${group.id}.${randomUUID()}.tmp`);
            await writeFile(temporary, JSON.stringify(group), 'utf8');
            await rename(temporary, path.join(parallelDirectory, `${group.id}.json`));
        },
        async read(id) {
            if (!/^[0-9a-f-]{36}$/u.test(id))
                return undefined;
            try {
                return JSON.parse(await readFile(path.join(parallelDirectory, `${id}.json`), 'utf8'));
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return undefined;
                throw error;
            }
        },
    });
    const documentProjectWorkflowPreparationService = createDocumentProjectWorkflowPreparationService({
        getWorkflow: getDocumentWorkflow,
        createWorkflow: createDocumentWorkflow,
        getRecovery: getDocumentRunRecovery,
        startStage: startDocumentWorkflowStage,
        approveStage: approveDocumentWorkflowStage,
        resumeStage: resumeDocumentWorkflowStage,
        completeStage: completeDocumentWorkflowStage,
        waitStage: waitDocumentWorkflowStage,
        saveProject: saveDocumentProject,
        digest,
    });
    const documentCaseStepAuthoringService = createDocumentCaseStepAuthoringService({
        deriveGroundedEmptyListNavigationSubcheck,
        deriveGroundedCustomerLookupSubcheck,
        deriveGroundedEmptyRequiredFieldSubcheck,
        deriveRelatedInvalidInputSubcheck,
        addNoApiNetworkAssertion,
        hasOnlyGenericShellAssertions,
        browserStepDraftBlockReason,
        explainBlockedBrowserStepDraft,
        canAuthorReadOnlyBrowserSteps,
        draftGroundedReadOnlyBrowserSteps,
        validateCases,
        saveProject: saveDocumentProject,
        collectPageEvidence: pageEvidence.collect,
        async resolveNavigationEvidence(project, item) {
            const evidence = await documentWebsiteMapService.evidenceForCase(project, item);
            if (evidence)
                return evidence;
            const map = await documentWebsiteMapService.latest(project.id);
            if (map && ['completed', 'partial'].includes(map.state))
                throw Error(`用例页面尚未确认：${map.caseBindings?.filter(binding => binding.caseId === item.id).at(-1)?.reason ?? '当前地图没有唯一或有充分证据的目标页面；未退回首页编写本例。'}`);
            return undefined;
        },
        openPageExploration: pageExploration.open,
        decidePageExploration: explorationDecision.decide,
        modelAvailable: () => modelConfiguration().modelAvailable,
        draftEvidenceBoundUiCheck,
        validateDraftLocatorsAgainstEvidence,
        collectAuthoringContext: createDocumentAuthoringContextReader({
            manifestPath: process.env.TESTPILOT_AUTHORING_SOURCES_FILE ?? path.resolve('config/document-authoring-sources.json'),
            databaseStatus: mysqlBrowserStatus,
            databaseEvidence: collectDocumentAgentDatabaseEvidence,
        }),
        generateSteps: generateDocumentCaseSteps,
        bindDatabaseFixture: bindDepartmentDatabaseFixture,
        databaseFixtureAssertionGap: missingDepartmentDatabaseFixtureAssertion,
        generateBrowserCases: generateDocumentBrowserCases,
        mergeBrowserCases: mergeDocumentBrowserCases,
        validateCasesPreservingGenerationTrace,
        requiresManualReview: requiresManualApiContractReview,
        hasAutoRunnableSelectedCase,
    });
    const { generateMissingBrowserSteps } = documentCaseStepAuthoringService;
    const documentProjectRunUsecaseService = createDocumentProjectRunUsecaseService<NonNullable<Parameters<typeof executeDocumentRunAdapter>[1]>>({
        prepare: documentProjectRunPreparationService,
        repairNoApiAssertions: documentCaseStepAuthoringService.ensureNoApiRunAssertions,
        getRecovery: getDocumentRunRecovery,
        getWorkflow: getDocumentWorkflow,
        ensureWorkflow: documentProjectWorkflowPreparationService.ensureProjectWorkflow,
        workflowPorts: {
            getWorkflow: getDocumentWorkflow,
            linkRun: linkDocumentWorkflowRun,
            startStage: startDocumentWorkflowStage,
            waitStage: waitDocumentWorkflowStage,
            resumeStage: resumeDocumentWorkflowStage,
            completeStage: completeDocumentWorkflowStage,
            failStage: failDocumentWorkflowStage,
            cancelWorkflow: cancelDocumentWorkflow,
            completeWorkflow: completeDocumentWorkflow,
        },
        digest,
        createRunId: randomUUID,
        buildExecutionOptions: context => ({
            runId: context.runId,
            ...(context.checkpointRecovery ? { checkpointRecovery: structuredClone(context.checkpointRecovery) } : {}),
            ...(context.resumeRunId ? { resumeRunId: context.resumeRunId } : {}),
            workflowId: context.workflowId,
            ...(!context.resumeRunId ? { runMode: context.runMode } : {}),
            ...(!context.resumeRunId && context.runScopePlan ? { scopePlan: context.runScopePlan } : {}),
            ...(context.siteVersionSnapshot ? { siteVersionSnapshot: context.siteVersionSnapshot } : {}),
            ...(context.baselineRunId ? { baselineRunId: context.baselineRunId } : {}),
            ...(context.testDataSetId ? { testDataSetId: context.testDataSetId } : {}),
            parameterValues: context.parameterValues,
            selectedCaseIds: context.selectedCaseIds,
            ...(context.parentRunId && context.retestSelected ? { parentRunId: context.parentRunId, ...(context.retestNotes ? { retestNotes: context.retestNotes } : {}), ...(context.retestScopeNote ? { retestScopeNote: context.retestScopeNote } : {}) } : {}),
            onStage: context.workflow.onStage,
            beforeDeterministic: (page, executionProject) => documentCaseStepAuthoringService.prepareCompareRun(executionProject, context.selectedCaseIds, () => pageEvidence.collect(executionProject, page)),
        }),
        submit: input => documentProjectRunSubmissionService.submit(input),
    });
    const documentProjectSessionService = createDocumentProjectSessionService({
        projects: projectRepository,
        getSessionStatus: projectSessionStatusAdapter.getStatus,
        containsCredentialLikeValue,
        now: () => new Date().toISOString(),
    });
    const documentCaseSelectionService = createDocumentCaseSelectionService({
        projects: projectRepository,
        requiresManualReview: requiresManualApiContractReview,
        hasAutoRunnableSelectedCase,
        now: () => new Date().toISOString(),
    });
    const documentImpactReviewService = createDocumentImpactReviewService({
        projects: projectRepository,
        analyze: analyzeDocumentCaseImpact,
        getCaseVersion: caseVersion,
        newId: randomUUID,
        now: () => new Date().toISOString(),
    });
    const documentSiteVersionService = createDocumentSiteVersionService({ projects: projectRepository, validateTarget: validateDocumentTarget, newId: randomUUID, now: () => new Date().toISOString() });
    const documentProjectUpdateService = createDocumentProjectUpdateService({
        projects: projectRepository,
        validateTarget: validateDocumentTarget,
        validateCases: validateCasesPreservingGenerationTrace,
        containsCredentialLikeValue,
        requiresManualReview: requiresManualApiContractReview,
        hasAutoRunnableSelectedCase,
        now: () => new Date().toISOString(),
    });
    const documentProjectReviewService = createDocumentProjectReviewService({
        projects: projectRepository,
        validateCases: cases => validateCasesPreservingGenerationTrace(cases, cases),
        ensureWorkflow: documentProjectWorkflowPreparationService.ensureProjectWorkflow,
        completeApprovalGate: documentProjectWorkflowPreparationService.completeApprovalGate,
        now: () => new Date().toISOString(),
    });
    return {
        documentWebsiteMapService,
        documentAutomaticRecoveryService,
        documentRunRecoveryReadinessService,
        documentRunInvestigationService,
        documentRunImageAnalysisService,
        documentStepRevisionProposalService,
        documentAutonomousPlanExecutionService,
        documentAutonomousPlanService,
        documentSessionOpenService,
        documentParallelRunService,
        documentSessionProfileService,
        documentCaseMarkdownService,
        documentRunArtifacts,
        documentRunHistoryService,
        documentStepProbeAdapter,
        documentProjectRunUsecaseService,
        documentCaseStepAuthoringService,
        generateMissingBrowserSteps,
        documentProjectSessionService,
        documentCaseSelectionService,
        documentImpactReviewService,
        documentSiteVersionService,
        documentProjectUpdateService,
        documentProjectReviewService,
        documentProjectWorkflowPreparationService,
        documentPageEvidence: pageEvidence,
    };
}
