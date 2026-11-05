import type { BrowserCheck } from "../../domain/documents/shared/test-model.js";
import { planDocumentCaseDependencies } from "../../domain/documents/cases/dependency-plan.js";
import { sha256Hex } from "../../domain/shared/sha256.js";
export type RegressionEvidence = {
    source: "change-notes" | "case-title" | "case-expected" | "case-source" | "case-step";
    quote: string;
};
export type AutonomousRegressionAssessment = {
    outcome?: "selected" | "no-relevant-cases" | "needs-clarification";
    assessmentReason?: string;
    assessmentEvidence?: Array<{
        source: "change-notes";
        quote: string;
    }>;
    selectedCaseIds: string[];
    decisions: Array<{
        caseId: string;
        reason: string;
        evidence: RegressionEvidence[];
    }>;
};
/** Evaluator boundary for producing a reviewable regression assessment. */
export interface AutonomousRegressionEvaluatorPort {
    assess(input: {
        cases: BrowserCheck[];
        changeNotes: string;
        currentVersion: string;
    }): Promise<AutonomousRegressionAssessment>;
}
export type AutonomousRegressionPlan = {
    kind: "reviewable-regression-plan";
    projectId: string;
    changeNotesSnapshot: string;
    currentVersionSnapshot: string;
    caseDigest: string;
    outcome: "selected" | "no-relevant-cases" | "needs-clarification";
    assessmentReason?: string;
    assessmentEvidence: Array<{
        source: "change-notes";
        quote: string;
    }>;
    selectedCaseIds: string[];
    prerequisiteCaseIds: string[];
    orderedCaseIds: string[];
    dependencyChains: Record<string, string[]>;
    decisions: AutonomousRegressionAssessment["decisions"];
    execution: "not-started";
};
export class AutonomousRegressionPlanError extends Error {
    constructor(readonly code: "invalid-input" | "invalid-assessment" | "invalid-scope", message: string) { super(message); }
}
function digestCases(projectId: string, currentVersion: string, cases: BrowserCheck[]): string {
    return sha256Hex(JSON.stringify({ projectId, currentVersion, cases: cases.map(item => ({ ...item, steps: item.steps ?? [] })) }));
}
function evidenceSourceText(source: RegressionEvidence["source"], item: BrowserCheck, notes: string): string[] {
    switch (source) {
        case "change-notes": return [notes];
        case "case-title": return [item.title];
        case "case-expected": return [item.expected ?? ""];
        case "case-source": return [item.source ?? ""];
        case "case-step": return (item.steps ?? []).flatMap(step => Object.values(step).filter((value): value is string => typeof value === "string"));
    }
}
/** Re-checks a saved assessment against the current project snapshot before it can be shown as runnable. */
export function isAutonomousRegressionPlanGrounded(plan: AutonomousRegressionPlan, cases: BrowserCheck[], changeNotes: string): boolean {
    if (!plan || typeof plan !== "object" || plan.changeNotesSnapshot !== changeNotes || !Array.isArray(plan.selectedCaseIds) || !Array.isArray(plan.decisions))
        return false;
    const outcome = plan.outcome ?? "selected";
    if (outcome !== "selected") {
        return ["no-relevant-cases", "needs-clarification"].includes(outcome)
            && plan.selectedCaseIds.length === 0 && plan.decisions.length === 0
            && typeof plan.assessmentReason === "string" && Boolean(plan.assessmentReason.trim())
            && Array.isArray(plan.assessmentEvidence) && plan.assessmentEvidence.length > 0
            && plan.assessmentEvidence.every(ref => ref.source === "change-notes" && typeof ref.quote === "string"
                && Boolean(ref.quote.trim()) && changeNotes.includes(ref.quote));
    }
    if (!plan.selectedCaseIds.length || new Set(plan.selectedCaseIds).size !== plan.selectedCaseIds.length || plan.decisions.length !== plan.selectedCaseIds.length)
        return false;
    const byId = new Map(cases.map(item => [item.id, item]));
    const seen = new Set<string>();
    for (const decision of plan.decisions) {
        if (!decision || typeof decision.caseId !== "string" || seen.has(decision.caseId) || !plan.selectedCaseIds.includes(decision.caseId)
            || typeof decision.reason !== "string" || !decision.reason.trim() || !Array.isArray(decision.evidence))
            return false;
        const item = byId.get(decision.caseId);
        if (!item)
            return false;
        const verified: RegressionEvidence[] = [];
        for (const ref of decision.evidence) {
            if (!ref || typeof ref !== "object" || !(["change-notes", "case-title", "case-expected", "case-source", "case-step"] as unknown[]).includes(ref.source)
                || typeof ref.quote !== "string" || !ref.quote.trim()
                || !evidenceSourceText(ref.source as RegressionEvidence["source"], item, changeNotes).some(text => text.includes(ref.quote)))
                return false;
            verified.push(ref as RegressionEvidence);
        }
        if (!verified.some(ref => ref.source === "change-notes") || !verified.some(ref => ref.source !== "change-notes"))
            return false;
        seen.add(decision.caseId);
    }
    return plan.selectedCaseIds.every(id => seen.has(id));
}
/** Produces a reviewable plan only. It has no run, repository, or execution dependency. */
export function createAutonomousRegressionPlanner(deps: {
    evaluator: AutonomousRegressionEvaluatorPort;
}) {
    return {
        async plan(input: {
            projectId: string;
            cases: BrowserCheck[];
            changeNotes: string;
            currentVersion: string;
        }): Promise<AutonomousRegressionPlan> {
            if (!input || typeof input.projectId !== "string" || !input.projectId.trim() || !Array.isArray(input.cases) ||
                typeof input.changeNotes !== "string" || !input.changeNotes.trim() || typeof input.currentVersion !== "string" || !input.currentVersion.trim()) {
                throw new AutonomousRegressionPlanError("invalid-input", "规划需要项目 ID、用例、非空变更说明和当前版本。");
            }
            const snapshotCases: BrowserCheck[] = structuredClone(input.cases);
            if (!snapshotCases.length || snapshotCases.some(item => !item || typeof item.id !== "string" || !item.id.trim() || typeof item.title !== "string") || new Set(snapshotCases.map(item => item.id)).size !== snapshotCases.length) {
                throw new AutonomousRegressionPlanError("invalid-input", "项目用例必须非空且 ID 唯一。");
            }
            const snapshot = { projectId: input.projectId, changeNotes: input.changeNotes, currentVersion: input.currentVersion, cases: snapshotCases };
            const caseDigest = digestCases(snapshot.projectId, snapshot.currentVersion, snapshot.cases);
            // The assessor receives its own copy, so it cannot mutate the frozen plan inputs.
            const raw: unknown = await deps.evaluator.assess({ cases: structuredClone(snapshot.cases), changeNotes: snapshot.changeNotes, currentVersion: snapshot.currentVersion });
            if (!raw || typeof raw !== "object" || Array.isArray(raw))
                throw new AutonomousRegressionPlanError("invalid-assessment", "评估器返回格式无效。");
            const assessment = raw as Partial<AutonomousRegressionAssessment>;
            const ids = new Set(snapshot.cases.map(item => item.id));
            const outcome = assessment.outcome === undefined ? "selected" : assessment.outcome;
            if (!(["selected", "no-relevant-cases", "needs-clarification"] as unknown[]).includes(outcome))
                throw new AutonomousRegressionPlanError("invalid-assessment", "评估结论无效。");
            if (!Array.isArray(assessment.selectedCaseIds) || assessment.selectedCaseIds.some(id => typeof id !== "string" || !id.trim()) || new Set(assessment.selectedCaseIds).size !== assessment.selectedCaseIds.length)
                throw new AutonomousRegressionPlanError("invalid-assessment", "评估结果的用例选择格式无效。");
            if (!Array.isArray(assessment.decisions))
                throw new AutonomousRegressionPlanError("invalid-assessment", "评估结果缺少逐项理由和证据。");
            let assessmentEvidence: Array<{
                source: "change-notes";
                quote: string;
            }> = [];
            if (outcome !== "selected") {
                if (assessment.selectedCaseIds.length || assessment.decisions.length || typeof assessment.assessmentReason !== "string" || !assessment.assessmentReason.trim() || !Array.isArray(assessment.assessmentEvidence) || !assessment.assessmentEvidence.length || assessment.assessmentEvidence.some(ref => !ref || ref.source !== "change-notes" || typeof ref.quote !== "string" || !ref.quote.trim() || !snapshot.changeNotes.includes(ref.quote)))
                    throw new AutonomousRegressionPlanError("invalid-assessment", "无选择结论必须提供非空原因及匹配变更说明原文的证据，且用例选择和理由列表必须为空。");
                assessmentEvidence = assessment.assessmentEvidence.map(ref => ({ source: "change-notes", quote: ref.quote.trim() }));
                return { kind: "reviewable-regression-plan", projectId: snapshot.projectId, changeNotesSnapshot: snapshot.changeNotes, currentVersionSnapshot: snapshot.currentVersion, caseDigest, outcome, assessmentReason: assessment.assessmentReason.trim(), assessmentEvidence, selectedCaseIds: [], prerequisiteCaseIds: [], orderedCaseIds: [], dependencyChains: {}, decisions: [], execution: "not-started" };
            }
            if (!assessment.selectedCaseIds.length)
                throw new AutonomousRegressionPlanError("invalid-assessment", "selected 结论必须包含非空用例选择。");
            const byId = new Map(snapshot.cases.map(item => [item.id, item]));
            const decisionById = new Map<string, AutonomousRegressionAssessment["decisions"][number]>();
            for (const candidate of assessment.decisions as unknown[]) {
                if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
                    throw new AutonomousRegressionPlanError("invalid-assessment", "评估理由格式无效。");
                const decision = candidate as Record<string, unknown>;
                if (typeof decision.caseId !== "string" || !ids.has(decision.caseId) || decisionById.has(decision.caseId) || typeof decision.reason !== "string" || !decision.reason.trim() || !Array.isArray(decision.evidence) || !decision.evidence.length) {
                    throw new AutonomousRegressionPlanError("invalid-assessment", "每条评估理由必须对应已知用例，并提供非空理由和证据。");
                }
                const item = byId.get(decision.caseId)!;
                const evidence: RegressionEvidence[] = [];
                for (const value of decision.evidence as unknown[]) {
                    if (!value || typeof value !== "object" || Array.isArray(value))
                        throw new AutonomousRegressionPlanError("invalid-assessment", "证据必须引用变更说明或用例文本。");
                    const ref = value as Record<string, unknown>;
                    if (!(["change-notes", "case-title", "case-expected", "case-source", "case-step"] as unknown[]).includes(ref.source) || typeof ref.quote !== "string" || !ref.quote.trim() || !evidenceSourceText(ref.source as RegressionEvidence["source"], item, snapshot.changeNotes).some(text => text.includes(ref.quote as string))) {
                        throw new AutonomousRegressionPlanError("invalid-assessment", `用例 ${item.id} 的证据引用不存在或未匹配原文。`);
                    }
                    evidence.push({ source: ref.source as RegressionEvidence["source"], quote: ref.quote.trim() });
                }
                // Keep every selected case traceable to both sides of the impact
                // judgment: the reported change and the historical case it may affect.
                // The reason remains an inference for human review, never a run result.
                if (!evidence.some(ref => ref.source === "change-notes") || !evidence.some(ref => ref.source !== "change-notes")) {
                    throw new AutonomousRegressionPlanError("invalid-assessment", `用例 ${item.id} 的选择依据必须同时引用变更说明和该用例的原文。`);
                }
                decisionById.set(item.id, { caseId: item.id, reason: decision.reason.trim(), evidence });
            }
            for (const id of assessment.selectedCaseIds) {
                if (!ids.has(id))
                    throw new AutonomousRegressionPlanError("invalid-assessment", `评估选择了项目中不存在的用例：${id}`);
                if (!decisionById.has(id))
                    throw new AutonomousRegressionPlanError("invalid-assessment", `评估选择缺少理由或证据：${id}`);
            }
            let dependencyPlan;
            try {
                dependencyPlan = planDocumentCaseDependencies(snapshot.cases, assessment.selectedCaseIds);
            }
            catch (error) {
                throw new AutonomousRegressionPlanError("invalid-scope", error instanceof Error ? error.message : "用例依赖计划无效。");
            }
            return {
                kind: "reviewable-regression-plan", projectId: snapshot.projectId, changeNotesSnapshot: snapshot.changeNotes,
                currentVersionSnapshot: snapshot.currentVersion, caseDigest, outcome, assessmentEvidence: [], selectedCaseIds: [...assessment.selectedCaseIds],
                prerequisiteCaseIds: dependencyPlan.prerequisiteCaseIds, orderedCaseIds: dependencyPlan.orderedCases.map(item => item.id),
                dependencyChains: dependencyPlan.dependencyChains, decisions: assessment.selectedCaseIds.map(id => decisionById.get(id)!), execution: "not-started",
            };
        },
    };
}
