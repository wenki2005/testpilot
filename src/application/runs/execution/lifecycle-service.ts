import { createHash } from 'node:crypto';
import { getDocumentMaterialVersion } from '../../../domain/documents/runs/run-scope.js';
import type { DocumentProject, DocumentRun, DocumentRunProgress, DocumentRunRecovery, ExecutionJournal } from '../../../domain/documents/shared/test-model.js';
import type { DocumentRunRepository } from '../../ports/document-run-repository.js';
import type { ActiveDocumentRunRegistry } from './active-document-run-registry.js';
export interface DocumentWorkflowState {
    status: string;
    stages: Array<{
        status: string;
        error?: {
            message?: string;
        };
    }>;
}
export interface DocumentRunLifecycleDependencies {
    repository: DocumentRunRepository;
    registry: ActiveDocumentRunRegistry;
    getRun(runId: string): Promise<DocumentRun | undefined>;
    getWorkflow(workflowId: string): Promise<DocumentWorkflowState | undefined>;
    disconnectPage(userDataDir: string, options?: {
        browser?: 'chromium' | 'edge';
    }): Promise<void>;
    packageInputExists(runId: string): Promise<boolean>;
}
export function projectDigest(project: DocumentProject): string {
    const baseline = {
        activeSessionProfileId: project.activeSessionProfileId, id: project.id, targetUrl: project.targetUrl, reviewStatus: project.reviewStatus, caseGeneration: project.caseGeneration,
        materialVersion: getDocumentMaterialVersion(project),
        apiContract: project.apiContract,
        cases: project.cases.map(item => ({ ...item, steps: item.steps ?? [] })),
    };
    return createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
}
export function projectMatchesExecutionJournal(project: DocumentProject, journal: ExecutionJournal): boolean {
    if (project.reviewStatus !== 'approved')
        return false;
    const recoveredVersion = journal.siteVersionSnapshot;
    const recoveryProject = recoveredVersion ? { ...project, targetUrl: recoveredVersion.targetUrl } : project;
    const hasRegisteredVersions = (project.siteVersions?.length ?? 0) > 0;
    const selectedVersionStillExists = recoveredVersion
        ? project.siteVersions?.some(item => item.id === recoveredVersion.id && JSON.stringify(item) === JSON.stringify(recoveredVersion)) === true
        : !hasRegisteredVersions;
    return selectedVersionStillExists
        && projectDigest(recoveryProject) === journal.projectDigest
        && journal.targetUrl === recoveryProject.targetUrl;
}
export function createDocumentRunLifecycleService(deps: DocumentRunLifecycleDependencies) {
    const canSafelyFinalizePackage = async (project: DocumentProject | undefined, journal: ExecutionJournal): Promise<boolean> => {
        if (!project || journal.version !== 1 || journal.projectId !== project.id || journal.stage !== 'packaging'
            || !['running', 'failed'].includes(journal.status) || deps.registry.isProjectRunActive(project.id)
            || deps.registry.isPackageFinalizing(journal.runId) || project.apiContract?.allowMutations === true
            || !projectMatchesExecutionJournal(project, journal))
            return false;
        const run = journal.finalizationRun;
        return Boolean(run?.id === journal.runId && run.projectId === project.id && run.reportReady === true && run.report
            && await deps.packageInputExists(journal.runId));
    };
    const getProgress = async (runId: string): Promise<DocumentRunProgress | undefined> => {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId))
            return undefined;
        let journal: ExecutionJournal;
        try {
            journal = await deps.repository.readJournal(runId);
            if (journal.version !== 1 || journal.runId !== runId || !Array.isArray(journal.selectedCaseIds))
                return undefined;
        }
        catch {
            return undefined;
        }
        const results = journal.caseResults ?? [];
        const counts: Record<string, number> = {};
        for (const result of results)
            counts[result.status] = (counts[result.status] ?? 0) + 1;
        const run = journal.status === 'completed' || journal.status === 'cancelled' ? await deps.getRun(runId) : undefined;
        let workflowStatus: DocumentRunProgress['workflowStatus'];
        const activeControl = deps.registry.getRun(runId);
        let status: DocumentRunProgress['status'] = activeControl?.paused ? 'paused' : activeControl?.pauseRequested ? 'pause-requested' : journal.status;
        let lastError = journal.lastError;
        let exposeRun = Boolean(run);
        if ((journal.status === 'completed' || journal.status === 'cancelled') && !run) {
            status = 'failed';
            lastError = '执行 journal 已标记终态，但最终 run 产物缺失或无效。';
        }
        else if (run?.workflowId) {
            const workflow = await deps.getWorkflow(run.workflowId);
            workflowStatus = workflow?.status as DocumentRunProgress['workflowStatus'];
            if (!workflow) {
                status = 'failed';
                lastError = `运行已生成，但关联 workflow ${run.workflowId} 不存在或无法校验。`;
                exposeRun = false;
            }
            else if (workflow.status === 'failed') {
                status = 'failed';
                lastError = workflow.stages.find(stage => stage.status === 'failed')?.error?.message ?? '运行产物已生成，但 workflow 阶段失败。';
                exposeRun = false;
            }
            else if (workflow.status === 'cancelled') {
                status = 'cancelled';
                exposeRun = true;
            }
            else if (workflow.status !== 'completed') {
                status = 'running';
                exposeRun = false;
            }
        }
        return {
            runId,
            ...(activeControl?.controller.signal.aborted ? { cancelRequested: true } : {}),
            ...(journal.workflowId ? { workflowId: journal.workflowId } : {}),
            status,
            stage: status === 'running' && (journal.status === 'completed' || journal.status === 'cancelled') ? 'packaging' : journal.stage,
            ...(workflowStatus ? { workflowStatus } : {}),
            startedAt: journal.startedAt,
            updatedAt: journal.updatedAt,
            resumeCount: journal.resumeCount,
            ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: journal.siteVersionSnapshot } : {}),
            ...(journal.currentCase ? { currentCase: journal.currentCase } : {}),
            ...(journal.checkpoint ? { checkpoint: journal.checkpoint } : {}),
            ...(journal.stepLogs ? { stepLogs: journal.stepLogs.slice(-500) } : {}),
            ...(journal.handoff ? { handoff: structuredClone(journal.handoff) } : {}),
            ...(journal.stepGeneration ? { stepGeneration: journal.stepGeneration } : {}),
            progress: { completed: results.length, total: journal.selectedCaseIds.length * (journal.runMode === 'regression' ? 1 : 2), counts },
            results,
            ...(run && exposeRun ? { run } : {}),
            ...(lastError ? { lastError } : {}),
        };
    };
    const getRecovery = async (project: DocumentProject): Promise<DocumentRunRecovery | undefined> => {
        const runIds = await deps.repository.listJournalIds();
        const journals: ExecutionJournal[] = [];
        for (const runId of runIds) {
            try {
                const journal = await deps.repository.readJournal(runId);
                const savedRun = await deps.getRun(journal.runId);
                const hasFinalRun = Boolean(savedRun);
                const packageStillIncomplete = journal.stage === 'packaging' && journal.finalizationRun?.id === journal.runId && savedRun?.packageReady !== true;
                if (journal.version === 1 && journal.projectId === project.id && ['running', 'failed'].includes(journal.status) && (!hasFinalRun || packageStillIncomplete))
                    journals.push(journal);
            }
            catch { /* Ignore incomplete or malformed journal files. */ }
        }
        const journal = journals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (!journal)
            return undefined;
        const isRunning = deps.registry.isRunActive(journal.runId) || deps.registry.isBrowserActive(project.id) || deps.registry.isPackageFinalizing(journal.runId);
        const sameBaseline = !isRunning && projectMatchesExecutionJournal(project, journal);
        const mutationRecoveryBlocked = project.apiContract?.allowMutations === true;
        const canFinalizePackageValue = await canSafelyFinalizePackage(project, journal);
        const counts: Record<string, number> = { passed: 0, failed: 0, blocked: 0 };
        for (const result of journal.caseResults ?? [])
            counts[result.status] = (counts[result.status] ?? 0) + 1;
        return {
            runId: journal.runId, ...(journal.workflowId ? { workflowId: journal.workflowId } : {}), ...(journal.runMode ? { runMode: journal.runMode } : {}), ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: journal.siteVersionSnapshot } : {}), ...(journal.baselineRunId ? { baselineRunId: journal.baselineRunId } : {}), ...(journal.testDataSetId ? { testDataSetId: journal.testDataSetId } : {}), ...(journal.parameterValues ? { parameterValues: { ...journal.parameterValues } } : {}), ...(journal.parentRunId ? { parentRunId: journal.parentRunId, retestSelection: [...journal.selectedCaseIds] } : {}), ...(journal.retestNotes ? { retestNotes: journal.retestNotes } : {}), ...(journal.retestScopeNote ? { retestScopeNote: journal.retestScopeNote } : {}), selectedCaseIds: [...journal.selectedCaseIds], startedAt: journal.startedAt, updatedAt: journal.updatedAt, stage: journal.stage, resumeCount: journal.resumeCount,
            isRunning,
            progress: { completed: journal.caseResults?.length ?? 0, total: journal.selectedCaseIds.length * (journal.runMode === 'regression' ? 1 : 2), ...(journal.currentCase ? { currentCase: journal.currentCase } : {}), counts },
            recordedResultCount: journal.caseResults?.length ?? 0,
            recordedResults: (journal.caseResults ?? []).slice(-100).map(({ lane, id, title, status, durationMs, updatedAt, actions }) => ({ lane, id, title, status, durationMs, updatedAt, ...(actions !== undefined ? { actions } : {}) })),
            canResume: sameBaseline && !mutationRecoveryBlocked && journal.stage !== 'packaging',
            canFinalizePackage: canFinalizePackageValue,
            ...(journal.lastError ? { lastError: journal.lastError } : {}),
            reason: isRunning ? '测试仍在执行；这里显示已完成的用例进度，不需要重新登录或重启运行。'
                : journal.stage === 'packaging' ? canFinalizePackageValue
                    ? '用例结果和报告快照已保存；重试只会完成报告/脚本包打包，不会再次访问目标网站或重跑用例。'
                    : `用例已到报告/打包阶段，但缺少可安全复用的打包快照；为避免重跑旧用例，系统不会再次打开目标网站。${journal.lastError ? ` 上次错误：${journal.lastError}` : ''}`
                    : mutationRecoveryBlocked ? '该项目允许 API 写请求；崩溃后无法证明外部副作用是否已提交，系统禁止自动重放。请先核对目标数据，再按新的审核运行启动重测。'
                        : sameBaseline ? '原项目仍保持审核通过、网站版本和用例未变；恢复会跳过 journal 已完成的用例，仅运行未完成的只读检查；中断用例仅在副作用风险为 none 时重试。'
                            : '项目网址、网站版本、审核状态或用例已变化；为避免误跑旧用例，不能恢复此运行，请重新审核并启动新运行。',
        };
    };
    const cancel = async (runId: string): Promise<'requested' | 'not-running' | 'already-terminal'> => {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId))
            return 'not-running';
        const active = deps.registry.getRun(runId);
        if (!active) {
            const progress = await getProgress(runId);
            return progress && progress.status !== 'running' ? 'already-terminal' : 'not-running';
        }
        if (!active.acceptingCancel)
            return 'already-terminal';
        await active.captureBeforeCancel?.().catch(() => undefined);
        if (!active.controller.signal.aborted)
            active.controller.abort(new Error('cancelled by user'));
        await deps.disconnectPage(active.userDataDir, active.browserChoice ? { browser: active.browserChoice } : undefined);
        return 'requested';
    };
    const pause = async (runId: string): Promise<string> => deps.registry.requestPause(runId);
    const continueRun = async (runId: string): Promise<string> => deps.registry.continueRun(runId);
    return { cancel, pause, continueRun, getRecovery, getProgress, projectDigest, projectMatchesExecutionJournal, canSafelyFinalizePackage };
}
