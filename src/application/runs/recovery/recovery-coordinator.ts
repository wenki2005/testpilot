import type { BrowserCheck, CaseResult, ExecutionJournal, LaneResult } from "../../../domain/documents/shared/test-model.js";
type RecoverableResult = CaseResult & {
    actions?: number;
};
type RecoverableLane<T extends RecoverableResult> = {
    status: LaneResult["status"];
    summary: string;
    results: T[];
    diagnostics?: string[];
    provider?: string;
};
/** Reconciles saved per-case facts with the cases still eligible for execution. */
export function createDocumentRunRecoveryCoordinator(input: {
    journal: ExecutionJournal;
    resumeRunId?: string;
    isAborted: () => boolean;
    saveJournal: (journal: ExecutionJournal) => Promise<void>;
    interruptedRetryCaseIds: string[];
    replayedDependencyCaseIds: string[];
}) {
    const { journal } = input;
    const recoveredResults = journal.caseResults ?? [];
    return async function runRecoverableLane<T extends RecoverableResult>(lane: "deterministic" | "computer-use", cases: BrowserCheck[], runner: (pending: BrowserCheck[]) => Promise<RecoverableLane<T>>): Promise<RecoverableLane<T>> {
        const prior = new Map(recoveredResults
            .filter(result => result.lane === lane && cases.some(item => item.id === result.id))
            .map(result => [result.id, result]));
        const active = input.resumeRunId && journal.currentCase?.lane === lane
            ? cases.find(item => item.id === journal.currentCase!.id)
            : undefined;
        const unsafeInterrupted = active && !prior.has(active.id) && (active.sideEffectRisk !== "none" || active.authorizedWriteOperationId) ? active : undefined;
        const retryableInterrupted = active && !prior.has(active.id) && active.sideEffectRisk === "none" && !active.authorizedWriteOperationId ? active : undefined;
        if (retryableInterrupted)
            input.interruptedRetryCaseIds.push(retryableInterrupted.id);
        const blocked = unsafeInterrupted ? [{
                id: unsafeInterrupted.id,
                title: unsafeInterrupted.title,
                status: "blocked" as const,
                detail: `进程在此用例中断，执行结果和副作用无法确认；风险标记为 ${unsafeInterrupted.sideEffectRisk}，为避免重放未自动重试。先核对目标状态并重新审核。`,
                durationMs: 0,
            }] as T[] : [];
        const pendingIds = new Set(cases.filter(item => !prior.has(item.id) && item.id !== unsafeInterrupted?.id).map(item => item.id));
        const byCaseId = new Map(cases.map(item => [item.id, item]));
        const replayedDependencies = new Set<string>();
        const unsafePending = new Map<string, string>();
        if (input.resumeRunId) {
            const visitDependency = (caseId: string, seen: Set<string>): string | undefined => {
                if (seen.has(caseId))
                    return;
                seen.add(caseId);
                const item = byCaseId.get(caseId);
                if (item?.authorizedWriteOperationId || item?.sideEffectRisk !== 'none')
                    return caseId;
                for (const dependencyId of item?.dependsOnCaseIds ?? []) {
                    const unsafe = visitDependency(dependencyId, seen);
                    if (unsafe)
                        return unsafe;
                    if (prior.get(dependencyId)?.status === "passed")
                        replayedDependencies.add(dependencyId);
                }
            };
            for (const id of pendingIds) {
                const unsafe = visitDependency(id, new Set());
                if (unsafe) {
                    pendingIds.delete(id);
                    unsafePending.set(id, unsafe);
                }
            }
        }
        for (const id of replayedDependencies)
            if (!input.replayedDependencyCaseIds.includes(id))
                input.replayedDependencyCaseIds.push(id);
        const executeIds = new Set([...pendingIds, ...replayedDependencies]);
        const pending = cases.filter(item => executeIds.has(item.id) && item.id !== unsafeInterrupted?.id);
        const fresh = pending.length ? await runner(pending) : undefined;
        const byId = new Map<string, T>();
        for (const item of cases) {
            const saved = prior.get(item.id);
            if (saved)
                byId.set(item.id, {
                    id: saved.id,
                    title: saved.title,
                    status: saved.status,
                    detail: saved.detail,
                    durationMs: saved.durationMs,
                    ...(lane === "computer-use" ? { actions: saved.actions ?? 0 } : {}),
                } as T);
        }
        for (const item of blocked)
            byId.set(item.id, item);
        for (const [id, dependencyId] of unsafePending) {
            const item = byCaseId.get(id)!;
            byId.set(id, { id, title: item.title, status: 'blocked', blockKind: 'dependency-blocked', detail: `恢复需要重建包含写入或风险未确认的前置 ${dependencyId}；原结果保留，禁止自动重放提交。请核验既有操作后显式建立只读结果检查。`, durationMs: 0 } as T);
        }
        for (const result of fresh?.results ?? [])
            byId.set(result.id, result);
        if (unsafeInterrupted && journal.currentCase?.id === unsafeInterrupted.id && journal.currentCase.lane === lane) {
            delete journal.currentCase;
            journal.updatedAt = new Date().toISOString();
            await input.saveJournal(journal);
        }
        const results = cases.map(item => byId.get(item.id) ?? ({
            id: item.id,
            title: item.title,
            status: "blocked" as const,
            detail: "恢复时未得到该用例结果；保留为未验证。",
            durationMs: 0,
        } as T));
        const applicable = results.filter(result => result.status !== "not-applicable");
        const passed = applicable.filter(result => result.status === "passed").length;
        const failed = applicable.filter(result => result.status === "failed").length;
        const blockedCount = applicable.filter(result => result.status === "blocked").length;
        const status = input.isAborted() ? "cancelled"
            : !applicable.length ? "not-applicable"
                : blockedCount ? "blocked"
                    : failed ? "failed"
                        : passed === applicable.length ? "passed" : "failed";
        const cancelledCount = results.filter(result => result.status === "cancelled").length;
        const notRunCount = results.filter(result => result.status === "not-run").length;
        const summary = input.isAborted()
            ? `运行被手动停止：${cancelledCount} 条取消、${notRunCount} 条未运行，${passed} 条已完成通过、${failed} 条已完成失败。`
            : `${passed}/${applicable.length} 条适用用例通过 · ${failed} 失败 · ${blockedCount} 阻塞 · ${results.length - applicable.length} N/A`;
        return {
            ...(fresh?.provider ? { provider: fresh.provider } : {}),
            ...(fresh?.diagnostics?.length ? { diagnostics: fresh.diagnostics } : {}),
            status,
            summary,
            results,
        };
    };
}
