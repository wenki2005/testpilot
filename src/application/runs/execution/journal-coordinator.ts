import type { BrowserCheck, CaseResult, ExecutionJournal } from "../../../domain/documents/shared/test-model.js";
export function createDocumentRunJournalCoordinator(input: {
    journal: ExecutionJournal;
    saveJournal: (journal: ExecutionJournal) => Promise<void>;
    onStage?: (stage: ExecutionJournal["stage"]) => Promise<void>;
}) {
    const { journal } = input;
    const updateStage = async (stage: ExecutionJournal["stage"]): Promise<void> => {
        journal.stage = stage;
        journal.updatedAt = new Date().toISOString();
        await input.saveJournal(journal);
        await input.onStage?.(stage);
    };
    const persistCaseResult = async (lane: "deterministic" | "computer-use", result: CaseResult & {
        actions?: number;
    }): Promise<void> => {
        if (['failed', 'blocked', 'cancelled'].includes(result.status) && !journal.evidence?.some(item => item.caseId === result.id)) {
            journal.evidence = [...(journal.evidence ?? []), {
                    evidenceId: `unavailable-${lane}-${result.id}-${journal.resumeCount}`,
                    runId: journal.runId, caseId: result.id, attempt: journal.resumeCount + 1,
                    type: 'unavailable', createdAt: new Date().toISOString(),
                    reason: `本次 ${lane} 结果为 ${result.status}，执行路径未返回可用页面截图；请查看阻塞原因与运行日志。`,
                }];
        }
        journal.caseResults = [
            ...(journal.caseResults ?? []).filter(item => item.lane !== lane || item.id !== result.id),
            {
                lane,
                id: result.id,
                title: result.title,
                status: result.status,
                detail: result.detail.slice(0, 1200),
                durationMs: result.durationMs,
                ...(result.evidence ? { evidence: result.evidence } : {}),
                ...(result.evidenceNote ? { evidenceNote: result.evidenceNote } : {}),
                updatedAt: new Date().toISOString(),
                ...(typeof result.actions === "number" ? { actions: result.actions } : {}),
            },
        ];
        delete journal.currentCase;
        journal.updatedAt = new Date().toISOString();
        await input.saveJournal(journal);
    };
    const markCurrentCase = async (lane: "deterministic" | "computer-use", item: BrowserCheck): Promise<void> => {
        journal.currentCase = { lane, id: item.id, title: item.title };
        journal.updatedAt = new Date().toISOString();
        await input.saveJournal(journal);
    };
    const persistStep = async (caseId: string, stepIndex: number, action: string, phase: "before" | "passed" | "failed", _detail?: string): Promise<void> => {
        const at = new Date().toISOString();
        // Keep step telemetry structural: action/phase/time are useful for recovery,
        // while raw browser error text can contain user-entered values or page data.
        journal.stepLogs = [...(journal.stepLogs ?? []), { caseId, stepIndex, action, phase, at }].slice(-5000);
        journal.checkpoint = { caseId, stepIndex, nextStepIndex: phase === "passed" ? stepIndex + 1 : stepIndex, phase: phase === "passed" ? "after" : phase, at, ...(phase === "failed" ? { replayRequired: true, reason: "该动作未能确认完成；人工重试前需检查页面与副作用。" } : {}) };
        journal.updatedAt = at;
        await input.saveJournal(journal);
    };
    return { updateStage, persistCaseResult, markCurrentCase, persistStep };
}
