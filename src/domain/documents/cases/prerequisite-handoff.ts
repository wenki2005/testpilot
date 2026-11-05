/** Explicit opt-in policy for stopping between prerequisite execution and target execution. */
export type PrerequisiteHandoffState = {
    status: "waiting-prerequisites";
    prerequisiteIds: string[];
    targetIds: string[];
} | {
    status: "paused-for-analysis";
    prerequisiteIds: string[];
    targetIds: string[];
    runId: string;
    pageSessionId: string;
    evidence: HandoffEvidence[];
} | {
    status: "ready-to-continue";
    prerequisiteIds: string[];
    targetIds: string[];
    runId: string;
    pageSessionId: string;
    evidence: HandoffEvidence[];
    analysis: HandoffAnalysis;
} | {
    status: "blocked";
    prerequisiteIds: string[];
    targetIds: string[];
    reason: string;
};
export type HandoffEvidence = {
    id: string;
    kind: string;
    text?: string;
    imagePixelsInspected: false;
};
export type HandoffAnalysis = {
    summary: string;
    citations: Array<{
        evidenceId: string;
        quote: string;
    }>;
    imagePixelsInspected: false;
};
/** IDs are derived from an already validated dependency plan. Targets are excluded from prerequisites. */
export function createPrerequisiteHandoff(prerequisiteIds: string[], targetIds: string[]): PrerequisiteHandoffState {
    if (!prerequisiteIds.length || !targetIds.length || new Set([...prerequisiteIds, ...targetIds]).size !== prerequisiteIds.length + targetIds.length)
        throw new Error("显式前置交接需要互不重复的前置与目标用例。");
    return { status: "waiting-prerequisites", prerequisiteIds: [...prerequisiteIds], targetIds: [...targetIds] };
}
export function pauseForPrerequisiteAnalysis(state: PrerequisiteHandoffState, input: {
    completedPrerequisiteIds: string[];
    runId?: string;
    pageSessionId?: string;
    evidence?: HandoffEvidence[];
}): PrerequisiteHandoffState {
    if (state.status !== "waiting-prerequisites")
        throw new Error("当前交接状态不允许暂停。");
    if (state.prerequisiteIds.some(id => !input.completedPrerequisiteIds.includes(id)))
        throw new Error("前置用例尚未全部完成，不能进入分析暂停。");
    if (!input.runId || !input.pageSessionId)
        return { ...state, status: "blocked", reason: "前置已结束，但运行或页面会话上下文缺失；目标用例未执行。" };
    return { ...state, status: "paused-for-analysis", runId: input.runId, pageSessionId: input.pageSessionId, evidence: (input.evidence ?? []).map(item => ({ ...item, imagePixelsInspected: false })) };
}
export function recordPrerequisiteAnalysis(state: PrerequisiteHandoffState, input: {
    runId: string;
    pageSessionId: string;
    analysis: HandoffAnalysis;
}): PrerequisiteHandoffState {
    if (state.status !== "paused-for-analysis")
        throw new Error("交接未处于分析暂停状态。");
    if (input.runId !== state.runId || input.pageSessionId !== state.pageSessionId)
        return { status: "blocked", prerequisiteIds: state.prerequisiteIds, targetIds: state.targetIds, reason: "运行或页面会话已变化；禁止伪装续跑。" };
    const available = new Map(state.evidence.map(item => [item.id, item.text ?? ""]));
    const citations = input.analysis.citations.filter(item => available.has(item.evidenceId) && available.get(item.evidenceId)!.includes(item.quote));
    return { ...state, status: "ready-to-continue", analysis: { ...input.analysis, citations, imagePixelsInspected: false } };
}
/** Continue only the selected targets; prerequisites are intentionally never part of this list. */
export function continuePrerequisiteHandoff(state: PrerequisiteHandoffState, current: {
    runId: string;
    pageSessionId: string;
}): string[] {
    if (state.status !== "ready-to-continue")
        throw new Error("目标用例尚未获准继续。");
    if (current.runId !== state.runId || current.pageSessionId !== state.pageSessionId)
        throw new Error("运行或页面会话上下文丢失；已阻断，目标用例未执行。");
    return [...state.targetIds];
}
