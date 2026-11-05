import { getDocumentCaseVersion, getDocumentMaterialVersion, getDocumentTestDataVersion } from "../../../domain/documents/runs/run-scope.js";
import type { CaseComparison, CoverageSummary, DocumentProject, DocumentRun, DocumentRunMode, ExecutionJournal, LaneResult } from "../../../domain/documents/shared/test-model.js";
import { sha256Hex } from "../../../domain/shared/sha256.js";
export function createDocumentRunSnapshot(input: {
    runId: string;
    project: DocumentProject;
    journal: ExecutionJournal;
    runMode: DocumentRunMode;
    baselineRunId?: string;
    retestSelection?: string[];
    selectedCases: DocumentProject["cases"];
    caseSnapshots: DocumentProject["cases"];
    caseScope: DocumentRun["caseScope"];
    skippedCompletedCaseIds: string[];
    interruptedRetryCaseIds: string[];
    coverageSummary: CoverageSummary;
    stepGeneration?: DocumentRun["stepGeneration"];
    deterministic: LaneResult;
    computerUse: LaneResult & {
        provider?: string;
    };
    apiContract?: NonNullable<DocumentRun["apiContract"]>;
    comparisons: CaseComparison[];
    diagnostics?: NonNullable<DocumentRun["diagnostics"]>;
    finalReady: boolean;
    aborted: boolean;
    startedAt: string;
    completedAt?: string;
    retestNotes?: string;
    retestScopeNote?: string;
}): DocumentRun {
    const { project, journal } = input;
    const runParentId = journal.parentRunId;
    const snapshotProject = { ...project, cases: input.caseSnapshots };
    const caseVersions = Object.fromEntries(input.caseSnapshots.map(item => {
        const { selectedForRegression: _selection, ...caseRevision } = item;
        return [item.id, sha256Hex(JSON.stringify({ ...caseRevision, steps: item.steps ?? [] }))];
    }));
    const caseTitles = Object.fromEntries(input.caseSnapshots.map(item => [item.id, item.title]));
    const caseInventory = Object.fromEntries(project.cases.map(item => [item.id, item.title]));
    const onlyOutOfScope = input.comparisons.length > 0 && input.comparisons.every(item => item.deterministic === "not-applicable" && item.computerUse === "not-applicable" && (!item.apiContract || item.apiContract === "not-applicable"));
    const regressionFailed = input.runMode === "regression" && input.comparisons.some(item => item.deterministic === "failed" || item.apiContract === "failed");
    const regressionBlocked = input.runMode === "regression" && input.comparisons.some(item => item.resolution === "unresolved");
    const overall: DocumentRun["overall"] = input.aborted ? "cancelled"
        : onlyOutOfScope ? "partial"
            : input.runMode === "regression" ? regressionBlocked ? "unresolved" : regressionFailed ? "failed" : "passed"
                : !input.finalReady ? input.computerUse.status === "blocked" && input.deterministic.status === "passed" ? "partial" : "unresolved"
                    : input.apiContract && input.deterministic.status === "blocked" && input.computerUse.status === "blocked" && input.apiContract.status === "passed" ? "passed"
                        : input.deterministic.status === "passed" && input.computerUse.status === "passed" ? "passed" : "failed";
    return {
        targetUrlSnapshot: journal.targetUrl,
        ...(journal.checkpointRecovery ? { checkpointRecovery: structuredClone(journal.checkpointRecovery) } : {}),
        ...(journal.autonomousPlanId ? { autonomousPlanId: journal.autonomousPlanId } : {}),
        ...(journal.autonomousPlanContextDigest ? { autonomousPlanContextDigest: journal.autonomousPlanContextDigest } : {}),
        id: input.runId,
        projectId: project.id,
        ...(journal.workflowId ? { workflowId: journal.workflowId } : {}),
        runMode: input.runMode,
        ...(journal.scopePlan ? { scopePlan: structuredClone(journal.scopePlan) } : {}),
        ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(journal.siteVersionSnapshot) } : {}),
        materialVersion: journal.materialVersion ?? getDocumentMaterialVersion(project),
        sourceMaterialsSnapshot: structuredClone(journal.sourceMaterialsSnapshot ?? project.sourceMaterials ?? []),
        ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
        testDataVersion: getDocumentTestDataVersion(journal.testDataSetId, journal.parameterValues ?? {}),
        ...(journal.testDataSetId ? { testDataSetId: journal.testDataSetId } : {}),
        ...(Object.keys(journal.parameterValues ?? {}).length ? { parameterValues: { ...journal.parameterValues } } : {}),
        ...(input.caseSnapshots.length ? { caseSnapshotVersion: 1 as const, caseSnapshots: structuredClone(input.caseSnapshots), executionCaseSnapshots: structuredClone(input.selectedCases) } : {}),
        caseVersions,
        caseTitles,
        caseInventory,
        ...(runParentId ? { parentRunId: runParentId } : {}),
        caseVersion: getDocumentCaseVersion(snapshotProject),
        ...(input.retestSelection ? { retestSelection: [...input.retestSelection] } : {}),
        ...(input.retestNotes ? { retestNotes: input.retestNotes } : journal.retestNotes ? { retestNotes: journal.retestNotes } : {}),
        ...(input.retestScopeNote ? { retestScopeNote: input.retestScopeNote } : journal.retestScopeNote ? { retestScopeNote: journal.retestScopeNote } : {}),
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? new Date().toISOString(),
        caseScope: structuredClone(input.caseScope),
        caseScopeKnown: true,
        ...(journal.resumeCount ? { recovery: { resumeCount: journal.resumeCount, replayedFromBeginning: false as const, skippedCompletedCaseIds: [...input.skippedCompletedCaseIds], interruptedRetryCaseIds: [...new Set(input.interruptedRetryCaseIds)] } } : {}),
        coverageSummary: structuredClone(input.coverageSummary),
        ...(input.stepGeneration ? { stepGeneration: structuredClone(input.stepGeneration) } : {}),
        deterministic: structuredClone(input.deterministic),
        ai: structuredClone(input.computerUse),
        ...(input.apiContract ? { apiContract: structuredClone(input.apiContract) } : {}),
        comparisons: structuredClone(input.comparisons),
        ...(input.diagnostics ? { diagnostics: structuredClone(input.diagnostics) } : {}),
        finalReady: input.finalReady,
        overall,
        report: "",
        packagePath: "",
    };
}
