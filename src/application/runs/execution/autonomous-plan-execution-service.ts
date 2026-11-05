import type { DocumentProject, DocumentRun, DocumentRunProgress, DocumentRunScopePlan } from '../../../domain/documents/shared/test-model.js';
import { isSafeReadOnlyBrowserCase } from '../../../domain/documents/cases/case-authoring.js';
import { autonomousPlanContextDigest, type SavedAutonomousPlan } from '../../cases/document-autonomous-plan-service.js';
import { validateDocumentRunScopePlan } from '../../../domain/documents/runs/run-scope.js';
import { planDocumentCaseDependencies } from '../../../domain/documents/cases/dependency-plan.js';
import { isAutonomousRegressionPlanGrounded } from '../../cases/document-autonomous-regression-planner.js';
export type AutonomousPlanExecutionRecord = {
    planId: string;
    projectId: string;
    runId: string;
    state: 'pending' | 'submitted' | 'uncertain' | 'completed' | 'failed';
    contextDigest: string;
    frozenCaseIds: string[];
    createdAt: string;
    updatedAt: string;
    error?: string;
};
export type AutonomousPlanExecutionStatus = AutonomousPlanExecutionRecord & {
    run?: DocumentRun | undefined;
    progress?: DocumentRunProgress | undefined;
    overall?: DocumentRun['overall'];
};
export class AutonomousPlanExecutionError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
/** Bridges a persisted model-selected plan to the regular document run executor. */
export function createDocumentAutonomousPlanExecutionService(deps: {
    getProject(id: string): Promise<DocumentProject | undefined>;
    getPlan(id: string): Promise<SavedAutonomousPlan | undefined>;
    saveExecution(record: AutonomousPlanExecutionRecord): Promise<void>;
    getExecution(planId: string): Promise<AutonomousPlanExecutionRecord | undefined>;
    createRunId(): string;
    now(): string;
    getRun(runId: string): Promise<DocumentRun | undefined>;
    getProgress?(runId: string): Promise<DocumentRunProgress | undefined>;
    isRunActive?(runId: string): boolean;
    onCompleted?(run: DocumentRun): Promise<void>;
    submit(project: DocumentProject, options: {
        runId: string;
        autonomousPlanId: string;
        expectedAutonomousPlanContextDigest: string;
        selectedCaseIds: string[];
        scopePlan: DocumentRunScopePlan;
        siteVersionSnapshot: NonNullable<DocumentProject['siteVersions']>[number];
    }): Promise<DocumentRun>;
    /** Atomically creates the first intent for a plan; false means another caller already owns it. */
    createIntent(planId: string, record: AutonomousPlanExecutionRecord): Promise<boolean>;
}) {
    const active = new Map<string, true>();
    const stateFromRun = (run: DocumentRun | undefined, record: AutonomousPlanExecutionRecord): AutonomousPlanExecutionRecord['state'] | undefined => {
        if (!run || run.id !== record.runId || run.projectId !== record.projectId || !Number.isFinite(Date.parse(run.completedAt)) || !['passed', 'failed', 'partial', 'unresolved', 'cancelled'].includes(run.overall))
            return undefined;
        return 'completed';
    };
    const observedStatus = (record: AutonomousPlanExecutionRecord, run: DocumentRun | undefined, live: boolean): AutonomousPlanExecutionStatus => {
        const observed = stateFromRun(run, record);
        if (observed)
            return { ...record, state: 'completed', ...(run ? { run, overall: run.overall } : {}) };
        if (['pending', 'submitted'].includes(record.state)) {
            return { ...record, state: live ? 'submitted' : 'uncertain' };
        }
        return { ...record };
    };
    return {
        async start(projectId: string, planId: string, options: {
            confirmBeforeStart?: boolean;
        } = {}): Promise<AutonomousPlanExecutionStatus> {
            const existing = await deps.getExecution(planId);
            if (existing) {
                if (existing.planId !== planId || existing.projectId !== projectId)
                    throw new AutonomousPlanExecutionError(404, '自主回归计划不存在。');
                const run = await deps.getRun(existing.runId);
                if (stateFromRun(run, existing) && existing.state !== 'completed') {
                    const completed = { ...existing, state: 'completed' as const, updatedAt: deps.now() };
                    await deps.saveExecution(completed);
                    return { ...completed, run, overall: run!.overall };
                }
                return observedStatus(existing, run, active.has(planId) || Boolean(deps.isRunActive?.(existing.runId)));
            }
            const plan = await deps.getPlan(planId);
            if (!plan || plan.projectId !== projectId)
                throw new AutonomousPlanExecutionError(404, '自主回归计划不存在。');
            if ((plan.plan.outcome === undefined ? 'selected' : plan.plan.outcome) !== 'selected')
                throw new AutonomousPlanExecutionError(422, '该计划未选择可执行范围；请先补充资料或重新规划，不能将规划结论作为测试通过。');
            const project = await deps.getProject(plan.projectId);
            if (!project)
                throw new AutonomousPlanExecutionError(404, '项目不存在。');
            if (project.confirmationRequired === true && options.confirmBeforeStart !== true)
                throw new AutonomousPlanExecutionError(422, '该项目要求每次运行前由用户确认；请确认本轮范围后再启动。');
            if (plan.contextDigest !== autonomousPlanContextDigest(project))
                throw new AutonomousPlanExecutionError(409, '自主回归计划已过期，请重新规划。');
            if (plan.blockers.length)
                throw new AutonomousPlanExecutionError(422, '自主回归计划仍有阻塞项，不能启动执行。');
            if (project.reviewStatus !== 'approved')
                throw new AutonomousPlanExecutionError(422, '项目尚未审核通过，不能启动执行。');
            if (project.apiContract?.allowNetwork || project.apiContract?.allowMutations || project.apiContract?.allowConcurrency)
                throw new AutonomousPlanExecutionError(422, 'API 网络、写入或并发权限未关闭，不能启动只读回归。');
            const selected = plan.plan.selectedCaseIds;
            const ordered = plan.plan.orderedCaseIds;
            const version = project.siteVersions?.find(item => item.id === plan.siteVersionId);
            if (!version || version.targetUrl !== plan.targetUrlSnapshot || !selected.length || new Set(ordered).size !== ordered.length || ordered.some(id => !selected.includes(id) && !plan.plan.prerequisiteCaseIds.includes(id)))
                throw new AutonomousPlanExecutionError(422, '自主回归计划范围或网站版本快照无效。');
            if (!isAutonomousRegressionPlanGrounded(plan.plan, project.cases, version.changeNotes))
                throw new AutonomousPlanExecutionError(422, '自主回归计划缺少可核验的变更说明与用例原文双向引用，请重新规划。');
            const frozenIds = [...ordered];
            let recomputed;
            try {
                recomputed = planDocumentCaseDependencies(project.cases, selected);
            }
            catch {
                throw new AutonomousPlanExecutionError(422, '保存计划的依赖范围无效，不能启动执行。');
            }
            if (JSON.stringify(recomputed.orderedCases.map(item => item.id)) !== JSON.stringify(frozenIds)
                || JSON.stringify(recomputed.prerequisiteCaseIds) !== JSON.stringify(plan.plan.prerequisiteCaseIds)) {
                throw new AutonomousPlanExecutionError(422, '保存计划的依赖顺序与当前用例关系不一致，不能启动执行。');
            }
            for (const id of frozenIds) {
                const item = project.cases.find(candidate => candidate.id === id);
                if (!item || item.lifecycleStatus !== 'runnable' || item.sideEffectRisk !== 'none' || (item.preconditions?.length && item.preconditionsConfirmed !== true) || !isSafeReadOnlyBrowserCase(item))
                    throw new AutonomousPlanExecutionError(422, `用例 ${id} 不满足只读安全执行条件。`);
            }
            const impactReasons = Object.fromEntries(selected.map(id => {
                const decision = plan.plan.decisions.find(item => item.caseId === id)!;
                return [id, [decision.reason, ...decision.evidence.map(proof => `${proof.source}: ${proof.quote}`)].filter(text => text.trim()).slice(0, 10).map(text => text.slice(0, 300))];
            }));
            const scopePlan = validateDocumentRunScopePlan({ mode: 'impact', targetCaseIds: [], impactCaseIds: selected, impactReasons, prerequisiteCaseIds: plan.plan.prerequisiteCaseIds, orderedCaseIds: frozenIds }, frozenIds)!;
            const record: AutonomousPlanExecutionRecord = { planId, projectId: project.id, runId: deps.createRunId(), state: 'pending', contextDigest: plan.contextDigest, frozenCaseIds: frozenIds, createdAt: deps.now(), updatedAt: deps.now() };
            {
                if (!await deps.createIntent(planId, record)) {
                    const raced = await deps.getExecution(planId);
                    if (!raced || raced.planId !== planId || raced.projectId !== projectId)
                        throw new AutonomousPlanExecutionError(503, '执行意图已被其他请求占用，请查询执行状态。');
                    const run = await deps.getRun(raced.runId);
                    const verified = stateFromRun(run, raced);
                    const resolved = observedStatus(raced, run, active.has(planId) || Boolean(deps.isRunActive?.(raced.runId)));
                    return { ...resolved, ...(verified && raced.state !== 'completed' ? { updatedAt: deps.now() } : {}) };
                }
            }
            // Invoke the executor after the durable intent; don't hold the HTTP request
            // open for the full run. A crash before status persistence leaves pending,
            // which is deliberately treated as uncertain on the next request.
            const executionProject = structuredClone(project);
            delete executionProject.workflowId;
            active.set(planId, true);
            try {
                let submission: Promise<DocumentRun>;
                try {
                    submission = deps.submit(executionProject, { runId: record.runId, autonomousPlanId: plan.id, expectedAutonomousPlanContextDigest: plan.contextDigest, selectedCaseIds: frozenIds, scopePlan, siteVersionSnapshot: structuredClone(version) });
                }
                catch {
                    submission = Promise.reject(new Error('submit'));
                }
                void submission.then(async (run) => {
                    const next = stateFromRun(run, record) ? { ...record, state: 'completed' as const, updatedAt: deps.now() } : record;
                    try {
                        await deps.saveExecution(next);
                    }
                    catch { /* Durable pending is safer than claiming an unrecorded outcome. */ }
                    if (stateFromRun(run, record)) {
                        try {
                            await deps.onCompleted?.(structuredClone(run));
                        }
                        catch { /* Investigation cannot change the saved run result. */ }
                    }
                }, async () => {
                    try {
                        await deps.saveExecution({ ...record, state: 'failed', error: 'executor-submit-failed', updatedAt: deps.now() });
                    }
                    catch { /* Keep pending when persistence is unavailable. */ }
                }).finally(() => active.delete(planId));
                return { ...record, state: 'submitted', updatedAt: deps.now() };
            }
            catch (error) {
                active.delete(planId);
                throw error;
            }
        },
        async get(projectId: string, planId: string): Promise<AutonomousPlanExecutionStatus | undefined> {
            const record = await deps.getExecution(planId);
            if (!record)
                return undefined;
            if (record.planId !== planId || record.projectId !== projectId)
                return undefined;
            const [run, progress] = await Promise.all([deps.getRun(record.runId), deps.getProgress?.(record.runId)]);
            const observedState = stateFromRun(run, record);
            const reconciled = observedState && observedState !== record.state ? { ...record, state: observedState, updatedAt: deps.now() } : record;
            if (reconciled !== record)
                await deps.saveExecution(reconciled);
            const live = active.has(planId) || Boolean(deps.isRunActive?.(record.runId));
            const status = observedStatus(reconciled, run, live);
            return { ...structuredClone(status), ...(progress?.runId === record.runId ? { progress } : {}) };
        },
    };
}
