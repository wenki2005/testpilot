import type { DocumentProject, DocumentRun, DocumentRunScopePlan, DocumentSiteVersion } from '../../../domain/documents/shared/test-model.js';
import type { PreparedDocumentProjectRun } from '../preparation/project-run-preparation-service.js';
import { isSafeReadOnlyBrowserCase } from '../../../domain/documents/cases/case-authoring.js';
export type ParallelRunGroup = {
    id: string;
    projectId: string;
    createdAt: string;
    jobs: Array<{
        runId: string;
        profileId: string;
        modulePath: string[];
        status: 'running' | 'completed' | 'failed';
        overall?: DocumentRun['overall'];
        error?: string;
    }>;
};
export class ParallelRunError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}
/** Explicit read-only module batches: each job owns a distinct authenticated profile. */
export function createDocumentParallelRunService(deps: {
    getProject(id: string): Promise<DocumentProject | undefined>;
    prepare(project: DocumentProject, action: string, body: unknown): Promise<PreparedDocumentProjectRun>;
    execute(project: DocumentProject, options: {
        runId: string;
        runMode: 'regression';
        selectedCaseIds: string[];
        sessionProfileId: string;
        allowParallelSessions: true;
        scopePlan?: DocumentRunScopePlan;
        siteVersionSnapshot?: DocumentSiteVersion;
        testDataSetId?: string;
        parameterValues: Record<string, string>;
    }): Promise<DocumentRun>;
    persist(group: ParallelRunGroup): Promise<void>;
    read(id: string): Promise<ParallelRunGroup | undefined>;
    getRun?(runId: string): Promise<DocumentRun | undefined>;
    listProjectGroups?(projectId: string): Promise<ParallelRunGroup[]>;
    createId(): string;
    now(): string;
}) {
    const active = new Map<string, ParallelRunGroup>();
    const persistTails = new Map<string, Promise<void>>();
    const isGroup = (value: unknown): value is ParallelRunGroup => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return false;
        const group = value as Partial<ParallelRunGroup>;
        return typeof group.id === 'string' && typeof group.projectId === 'string' && typeof group.createdAt === 'string' && Array.isArray(group.jobs) && group.jobs.every(job => Boolean(job) && typeof job.runId === 'string' && typeof job.profileId === 'string' && Array.isArray(job.modulePath) && ['running', 'completed', 'failed'].includes(job.status));
    };
    function persistSnapshot(group: ParallelRunGroup): Promise<void> {
        const snapshot = structuredClone(group);
        const previous = persistTails.get(group.id) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(() => deps.persist(snapshot));
        persistTails.set(group.id, next);
        void next.finally(() => {
            if (persistTails.get(group.id) === next)
                persistTails.delete(group.id);
        }).catch(() => undefined);
        return next;
    }
    async function reconcile(group: ParallelRunGroup): Promise<ParallelRunGroup> {
        for (const job of group.jobs) {
            if (job.status !== 'running')
                continue;
            if (!deps.getRun) {
                job.status = 'failed';
                job.error = '服务执行上下文已中断，未配置运行记录核验；不能计为通过。';
                continue;
            }
            const run = await deps.getRun(job.runId).catch(() => undefined);
            if (!run || run.id !== job.runId || run.projectId !== group.projectId || typeof run.completedAt !== 'string' || !run.completedAt.trim() || !Number.isFinite(Date.parse(run.completedAt)) || !['passed', 'failed', 'partial', 'unresolved', 'cancelled'].includes(run.overall)) {
                job.status = 'failed';
                job.error = '服务执行上下文已中断，且未找到匹配的已完成运行记录；不能计为通过。';
                continue;
            }
            job.overall = run.overall;
            job.status = 'completed';
        }
        return group;
    }
    return {
        async get(projectId: string, id: string) {
            const current = active.get(id);
            const group = current ?? await deps.read(id);
            if (!isGroup(group) || group.id !== id || group.projectId !== projectId)
                return undefined;
            if (current)
                return structuredClone(current);
            await reconcile(group);
            await persistSnapshot(group).catch(() => undefined);
            return structuredClone(group);
        },
        async list(projectId: string) {
            const persisted = deps.listProjectGroups ? await deps.listProjectGroups(projectId) : [];
            const byId = new Map(persisted.filter(group => isGroup(group) && group.projectId === projectId).map(group => [group.id, group]));
            for (const [id, group] of active)
                if (group.projectId === projectId)
                    byId.set(id, group);
            const groups = [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
            const results: ParallelRunGroup[] = [];
            for (const group of groups) {
                if (!active.has(group.id)) {
                    await reconcile(group);
                    await persistSnapshot(group).catch(() => undefined);
                }
                results.push(structuredClone(group));
            }
            return results;
        },
        async start(projectId: string, input: unknown) {
            const project = await deps.getProject(projectId);
            if (!project)
                throw new ParallelRunError(404, '项目不存在。');
            if (project.reviewStatus !== 'approved')
                throw new ParallelRunError(409, '项目需审核通过后才能并行运行。');
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new ParallelRunError(400, '并行配置无效。');
            const data = input as Record<string, unknown>;
            if (Object.keys(data).some(key => !['jobs', 'siteVersionId'].includes(key)) || !Array.isArray(data.jobs) || data.jobs.length < 2 || data.jobs.length > 4 || (data.siteVersionId !== undefined && typeof data.siteVersionId !== 'string'))
                throw new ParallelRunError(400, '每批需要 2–4 个独立账号档案和模块。');
            if (project.apiContract?.allowMutations || project.apiContract?.allowNetwork)
                throw new ParallelRunError(409, '并行批次仅支持无外部 API 通道的只读页面回归。');
            const profileIds = new Set<string>();
            const preparations = [];
            for (const raw of data.jobs) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                    throw new ParallelRunError(400, '模块配置无效。');
                const job = raw as Record<string, unknown>;
                if (Object.keys(job).some(key => !['profileId', 'modulePath', 'testDataSetId'].includes(key)) || typeof job.profileId !== 'string' || !Array.isArray(job.modulePath) || !job.modulePath.length || job.modulePath.some(part => typeof part !== 'string' || !part.trim()) || (job.testDataSetId !== undefined && typeof job.testDataSetId !== 'string'))
                    throw new ParallelRunError(400, '每个任务需要档案 ID 和非空模块路径。');
                if (profileIds.has(job.profileId) || !project.sessionProfiles?.some(profile => profile.id === job.profileId))
                    throw new ParallelRunError(409, '每个模块必须选择不同且属于当前项目的账号档案。');
                profileIds.add(job.profileId);
                const modulePath = job.modulePath as string[];
                const caseIds = project.cases.filter(item => item.modulePath && modulePath.every((part, index) => item.modulePath?.[index] === part)).map(item => item.id);
                if (!caseIds.length)
                    throw new ParallelRunError(422, '模块没有用例。');
                const prepared = await deps.prepare(project, 'start', { runMode: 'regression', selectedCaseIds: caseIds, ...(data.siteVersionId ? { siteVersionId: data.siteVersionId } : {}), ...(job.testDataSetId ? { testDataSetId: job.testDataSetId } : {}) });
                const ordered = prepared.runScopePlan?.orderedCaseIds ?? prepared.requestedCaseIds ?? [];
                if (!ordered.length || ordered.some(id => { const item = project.cases.find(c => c.id === id); return !item || item.sideEffectRisk !== 'none' || item.preconditions.length > 0 && !item.preconditionsConfirmed || !isSafeReadOnlyBrowserCase(item); }))
                    throw new ParallelRunError(409, '模块及其全部前置必须已确认无副作用；不自动并行提交、审批或写入。');
                preparations.push({ prepared, profileId: job.profileId, modulePath, selectedCaseIds: ordered });
            }
            const group: ParallelRunGroup = { id: deps.createId(), projectId, createdAt: deps.now(), jobs: preparations.map(job => ({ runId: deps.createId(), profileId: job.profileId, modulePath: job.modulePath, status: 'running' })) };
            await persistSnapshot(group);
            active.set(group.id, group);
            // Every preparation has passed before any target browser starts.
            let completionTail = Promise.resolve();
            void Promise.all(preparations.map(async (job, index) => {
                const state = group.jobs[index]!;
                let outcome: DocumentRun['overall'] | undefined;
                let failure: string | undefined;
                try {
                    const executionProject = { ...job.prepared.runProject, activeSessionProfileId: job.profileId };
                    delete executionProject.workflowId;
                    const run = await deps.execute(executionProject, { runId: state.runId, runMode: 'regression', selectedCaseIds: job.selectedCaseIds, sessionProfileId: job.profileId, allowParallelSessions: true, ...(job.prepared.runScopePlan ? { scopePlan: job.prepared.runScopePlan } : {}), ...(job.prepared.runSiteVersion ? { siteVersionSnapshot: job.prepared.runSiteVersion } : {}), ...(job.prepared.testDataSetId ? { testDataSetId: job.prepared.testDataSetId } : {}), parameterValues: job.prepared.parameterValues });
                    if (run.id !== state.runId || run.projectId !== projectId || typeof run.completedAt !== 'string' || !run.completedAt.trim() || !Number.isFinite(Date.parse(run.completedAt)))
                        throw new Error('执行未返回与本任务匹配的已完成运行记录。');
                    outcome = run.overall;
                }
                catch {
                    failure = '模块未正常完成；请检查对应运行的进度、日志、会话或资源冲突。';
                }
                const save = completionTail.then(async () => {
                    if (outcome !== undefined) {
                        state.overall = outcome;
                        state.status = 'completed';
                    }
                    else {
                        state.status = 'failed';
                        state.error = failure ?? '模块未正常完成；请检查对应运行的进度、日志、会话或资源冲突。';
                    }
                    try {
                        await persistSnapshot(group);
                    }
                    catch {
                        state.status = 'failed';
                        state.error = '模块结果未能持久保存；不能视为已完成。';
                        await persistSnapshot(group).catch(() => undefined);
                    }
                });
                completionTail = save.catch(() => undefined);
                await save;
            })).finally(async () => { await persistSnapshot(group).catch(() => undefined); active.delete(group.id); }).catch(() => undefined);
            return structuredClone(group);
        },
    };
}
