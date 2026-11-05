import type { DocumentRun } from "../../../domain/documents/shared/test-model.js";
import type { RecoveryReadiness } from "./recovery-readiness-service.js";
export type AutomaticRecoveryDecision = {
    decision: "retry";
    reason: string;
    caseId: string;
    stepIndex: number;
    adviceRecordId: string;
    policyVersion: 1;
} | {
    decision: "stop";
    reason: string;
    policyVersion: 1;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;
const AUTH_TEXT = /登录|认证|权限|扫码|login|auth|session|credential|permission/iu;
/** Shared eligibility gate for services that need to validate a parent before acquiring a lease. */
export function automaticRecoveryParentStopReason(run: DocumentRun): string | undefined {
    const completed = Date.parse(run.completedAt);
    if (!run.completedAt || !Number.isFinite(completed) || !/^\d{4}-\d{2}-\d{2}T/u.test(run.completedAt) || completed > Date.now())
        return "invalid_completion_date";
    if (!["failed", "unresolved", "partial"].includes(run.overall))
        return "run_outcome_not_recoverable";
    if (run.parentRunId || run.checkpointRecovery)
        return "child_or_checkpoint_recovery";
    if (!run.autonomousPlanId?.trim())
        return "missing_autonomous_plan";
    if (run.runMode !== "regression")
        return "run_mode_not_regression";
    for (const lane of [run.deterministic, run.ai]) {
        for (const result of lane.results) {
            if (result.status === "blocked" || result.status === "not-run" || result.status === "cancelled" || result.blockKind === "dependency-blocked" || AUTH_TEXT.test(result.detail ?? ""))
                return "authentication_or_blocking_result";
        }
    }
    for (const result of run.apiContract?.results ?? []) {
        if (result.status === "blocked" || result.status === "not-run" || result.status === "cancelled" || AUTH_TEXT.test(result.detail ?? ""))
            return "authentication_or_blocking_result";
    }
    return undefined;
}
/** Pure, conservative decision gate. It never starts an executor or changes a test. */
export function decideAutomaticRecovery(input: {
    enabled: boolean;
    run: DocumentRun;
    readiness: RecoveryReadiness | undefined;
}): AutomaticRecoveryDecision {
    const stop = (reason: string): AutomaticRecoveryDecision => ({ decision: "stop", reason, policyVersion: 1 });
    const { run, readiness } = input;
    if (!input.enabled)
        return stop("disabled");
    const parentStopReason = automaticRecoveryParentStopReason(run);
    if (parentStopReason)
        return stop(parentStopReason);
    if (!readiness || readiness.status !== "ready" || readiness.parentRunId !== run.id || readiness.projectId !== run.projectId)
        return stop("readiness_missing_blocked_or_mismatched");
    const candidates = readiness.candidates;
    if (candidates.length !== 1)
        return stop("candidate_count_not_exactly_one");
    const candidate = candidates[0]!;
    if (!candidate.caseId.trim() || !Number.isInteger(candidate.stepIndex) || candidate.stepIndex < 0 || candidate.semantics !== "rebuild-current-case")
        return stop("candidate_invalid");
    if (candidate.selectedCaseIds.length !== 1 || candidate.selectedCaseIds[0] !== candidate.caseId || !candidate.orderedCaseIds.includes(candidate.caseId))
        return stop("candidate_scope_not_single_case");
    if (candidate.orderedCaseIds.some(id => id !== candidate.caseId && !candidate.prerequisiteCaseIds.includes(id)))
        return stop("candidate_scope_has_unapproved_case");
    const advice = readiness.advice;
    if (advice.state !== "available" || advice.provisional !== true || !advice.recordId || !UUID.test(advice.recordId) || !advice.runDigest || !SHA256.test(advice.runDigest))
        return stop("advice_unavailable_or_invalid");
    const hypotheses = advice.recommendations.filter(item => item.caseId === candidate.caseId);
    if (!hypotheses.length || hypotheses.some(item => item.category !== "environment" || item.strategy !== "rebuild-readonly-case" || !item.summary.trim() || !item.evidence.length || item.evidence.some(ref => !ref.factId.trim() || !ref.quote.trim())))
        return stop("advice_not_exclusively_environmental_or_evidenced");
    return { decision: "retry", reason: "verified_single_case_environment_recovery", caseId: candidate.caseId, stepIndex: candidate.stepIndex, adviceRecordId: advice.recordId, policyVersion: 1 };
}
