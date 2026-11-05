import type { DocumentProject, DocumentRun, DocumentRunProgress } from '../../../domain/documents/shared/test-model.js';
import type { PreparedDocumentProjectRun } from '../preparation/project-run-preparation-service.js';
import type { RecoveryReadiness } from './recovery-readiness-service.js';
import { automaticRecoveryParentStopReason, decideAutomaticRecovery } from './automatic-recovery-policy.js';
export type AutomaticRecoveryRecord = {
    parentRunId: string;
    projectId: string;
    childRunId: string;
    adviceRecordId: string;
    runDigest: string;
    caseId: string;
    stepIndex: number;
    policyVersion: 1;
    state: 'pending' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
    overall?: DocumentRun['overall'];
    error?: 'submission-failed';
};
export type AutomaticRecoveryStatus = {
    enabled: boolean;
    policyVersion: 1;
    state: 'stopped' | 'investigating' | 'submitted' | 'uncertain' | 'completed' | 'failed';
    reason?: string;
    record?: AutomaticRecoveryRecord;
    overall?: DocumentRun['overall'];
    progress?: Pick<DocumentRunProgress, 'runId' | 'status' | 'stage' | 'currentCase' | 'progress' | 'cancelRequested'>;
};
export interface AutomaticRecoveryRepository {
    get(parentRunId: string): Promise<AutomaticRecoveryRecord | undefined>;
    createIntent(record: AutomaticRecoveryRecord): Promise<boolean>;
    save(record: AutomaticRecoveryRecord): Promise<void>;
}
/** One durable attempt per original autonomous run. A restart never replays an ambiguous intent. */
export function createDocumentAutomaticRecoveryService(deps: {
    enabled: boolean;
    repository: AutomaticRecoveryRepository;
    getRun(id: string): Promise<DocumentRun | undefined>;
    getProject(id: string): Promise<DocumentProject | undefined>;
    getReadiness(id: string): Promise<RecoveryReadiness | undefined>;
    prepare(project: DocumentProject, action: string, body: unknown): Promise<PreparedDocumentProjectRun>;
    submit(prepared: PreparedDocumentProjectRun, childRunId: string): Promise<DocumentRun>;
    getProgress?(runId: string): Promise<DocumentRunProgress | undefined>;
    createRunId(): string;
    now(): string;
    isRunActive?(id: string): boolean;
    isInvestigating?(id: string): boolean;
}) {
    const active = new Set<string>();
    const stopped = (reason: string): AutomaticRecoveryStatus => ({ enabled: deps.enabled, policyVersion: 1, state: 'stopped', reason });
    const validChild = (run: DocumentRun | undefined, record: AutomaticRecoveryRecord): run is DocumentRun => Boolean(run
        && run.id === record.childRunId && run.projectId === record.projectId && run.parentRunId === record.parentRunId
        && run.checkpointRecovery?.trigger === 'automatic-policy'
        && run.checkpointRecovery.parentRunId === record.parentRunId && run.checkpointRecovery.caseId === record.caseId
        && run.checkpointRecovery.stepIndex === record.stepIndex
        && run.checkpointRecovery.adoptedAdvice?.recordId === record.adviceRecordId
        && run.checkpointRecovery.adoptedAdvice.runDigest === record.runDigest
        && run.checkpointRecovery.adoptedAdvice.caseId === record.caseId && run.runMode === 'regression'
        && Number.isFinite(Date.parse(run.completedAt)) && Date.parse(run.completedAt) >= Date.parse(record.createdAt)
        && ['passed', 'failed', 'partial', 'unresolved', 'cancelled'].includes(run.overall));
    async function observed(record: AutomaticRecoveryRecord, returnedRun?: DocumentRun): Promise<AutomaticRecoveryStatus> {
        const child = returnedRun ?? await deps.getRun(record.childRunId);
        if (validChild(child, record))
            return { enabled: deps.enabled, policyVersion: 1, state: 'completed', record, overall: child.overall };
        const isLive = () => record.state === 'pending' && (active.has(record.childRunId) || deps.isRunActive?.(record.childRunId) === true);
        let live = isLive();
        let progress: AutomaticRecoveryStatus['progress'];
        if (live && deps.getProgress) {
            try {
                const snapshot = await deps.getProgress(record.childRunId);
                if (snapshot?.runId === record.childRunId)
                    progress = {
                        runId: snapshot.runId, status: snapshot.status, stage: snapshot.stage,
                        ...(snapshot.cancelRequested === true ? { cancelRequested: true } : {}),
                        ...(snapshot.currentCase ? { currentCase: structuredClone(snapshot.currentCase) } : {}),
                        progress: structuredClone(snapshot.progress),
                    };
            }
            catch { /* Progress is observational; a failed read does not change recovery state. */ }
            live = isLive();
            if (!live) {
                progress = undefined;
                const settled = await deps.getRun(record.childRunId);
                if (validChild(settled, record))
                    return { enabled: deps.enabled, policyVersion: 1, state: 'completed', record, overall: settled.overall };
            }
        }
        return { enabled: deps.enabled, policyVersion: 1, record,
            state: record.state === 'pending' ? live ? 'submitted' : 'uncertain'
                : record.state === 'completed' ? 'completed' : 'failed', ...(record.overall ? { overall: record.overall } : {}), ...(progress ? { progress } : {}) };
    }
    async function load(parentRunId: string) {
        const run = await deps.getRun(parentRunId);
        if (!run)
            return undefined;
        if (run.id !== parentRunId)
            throw new Error('自动恢复父运行归属无效。');
        const record = await deps.repository.get(parentRunId);
        if (record && (record.parentRunId !== run.id || record.projectId !== run.projectId))
            throw new Error('自动恢复历史记录归属无效。');
        return { run, record };
    }
    async function evaluate(run: DocumentRun) {
        const readiness = deps.enabled && !automaticRecoveryParentStopReason(run) ? await deps.getReadiness(run.id) : undefined;
        return { readiness, decision: decideAutomaticRecovery({ enabled: deps.enabled, run, readiness }) };
    }
    return {
        async get(parentRunId: string): Promise<AutomaticRecoveryStatus | undefined> {
            const loaded = await load(parentRunId);
            if (!loaded)
                return undefined;
            if (loaded.record)
                return observed(loaded.record);
            if (deps.enabled && deps.isInvestigating?.(parentRunId))
                return { enabled: true, policyVersion: 1, state: 'investigating' };
            const { decision } = await evaluate(loaded.run);
            if (decision.decision === 'retry') {
                const project = await deps.getProject(loaded.run.projectId);
                if (!project || project.id !== loaded.run.projectId || project.reviewStatus !== 'approved')
                    return stopped('project-not-approved');
                if (project.apiContract?.allowNetwork || project.apiContract?.allowMutations || project.apiContract?.allowConcurrency)
                    return stopped('api-permissions-enabled');
            }
            return stopped(decision.decision === 'retry' ? 'eligible-not-started' : decision.reason);
        },
        async handle(parentRunId: string): Promise<AutomaticRecoveryStatus | undefined> {
            const loaded = await load(parentRunId);
            if (!loaded)
                return undefined;
            if (loaded.record)
                return observed(loaded.record);
            const { readiness, decision } = await evaluate(loaded.run);
            if (decision.decision !== 'retry')
                return stopped(decision.reason);
            const project = await deps.getProject(loaded.run.projectId);
            if (!project || project.id !== loaded.run.projectId || project.reviewStatus !== 'approved')
                return stopped('project-not-approved');
            if (project.apiContract?.allowNetwork || project.apiContract?.allowMutations || project.apiContract?.allowConcurrency)
                return stopped('api-permissions-enabled');
            const candidate = readiness?.candidates.find(item => item.caseId === decision.caseId && item.stepIndex === decision.stepIndex);
            const now = deps.now();
            const record: AutomaticRecoveryRecord = { parentRunId, projectId: loaded.run.projectId, childRunId: deps.createRunId(),
                adviceRecordId: decision.adviceRecordId, runDigest: readiness!.advice.runDigest!, caseId: decision.caseId, stepIndex: decision.stepIndex,
                policyVersion: 1, state: 'pending', createdAt: now, updatedAt: now };
            if (!await deps.repository.createIntent(record)) {
                const existing = await deps.repository.get(parentRunId);
                if (!existing || existing.parentRunId !== parentRunId || existing.projectId !== loaded.run.projectId)
                    throw new Error('自动恢复意图已占用或无法核验。');
                return observed(existing);
            }
            active.add(record.childRunId);
            try {
                let run: DocumentRun;
                try {
                    const prepared = await deps.prepare(project, 'checkpoint-retry', { parentRunId, caseId: decision.caseId, stepIndex: decision.stepIndex, adviceRecordId: decision.adviceRecordId });
                    const adopted = prepared.checkpointRecovery?.adoptedAdvice;
                    if (!candidate || !adopted || adopted.recordId !== decision.adviceRecordId || adopted.runDigest !== record.runDigest
                        || prepared.parentRunId !== parentRunId || prepared.requestedRunMode !== 'regression'
                        || JSON.stringify(prepared.requestedCaseIds) !== JSON.stringify(candidate.orderedCaseIds))
                        throw new Error('preparation-changed');
                    const frozen = structuredClone(prepared);
                    frozen.checkpointRecovery!.trigger = 'automatic-policy';
                    run = await deps.submit(frozen, record.childRunId);
                }
                catch {
                    active.delete(record.childRunId);
                    const failed = { ...record, state: 'failed' as const, error: 'submission-failed' as const, updatedAt: deps.now() };
                    try {
                        await deps.repository.save(failed);
                    }
                    catch {
                        return observed(record);
                    }
                    return observed(failed);
                }
                if (!validChild(run, record)) {
                    active.delete(record.childRunId);
                    return observed(record);
                }
                const completed = { ...record, state: 'completed' as const, overall: run.overall, updatedAt: deps.now() };
                try {
                    await deps.repository.save(completed);
                }
                catch { /* The retained child result remains authoritative. */ }
                return observed(completed, run);
            }
            finally {
                active.delete(record.childRunId);
            }
        },
    };
}
