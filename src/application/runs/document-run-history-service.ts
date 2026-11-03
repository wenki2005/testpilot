import type { DocumentProject, DocumentRun, ExecutionJournal } from "../../domain/document-test-model.js";
import type { DocumentRunListItem } from "../../domain/document-run-history.js";

export interface DocumentRunHistoryDependencies {
  getProject(projectId: string): Promise<DocumentProject | undefined>;
  getRun(runId: string): Promise<DocumentRun | undefined>;
  listRunIds(): Promise<string[]>;
  readJournal(runId: string): Promise<ExecutionJournal>;
  isRunActive(runId: string): boolean;
  isPackageFinalizing(runId: string): boolean;
  isBaselineEligible(run: DocumentRun): boolean;
  canSafelyFinalizePackage(project: DocumentProject | undefined, journal: ExecutionJournal): Promise<boolean>;
}

function countResults(journal: ExecutionJournal): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of journal.caseResults ?? []) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return counts;
}

function executionState(deps: DocumentRunHistoryDependencies, runId: string, status: ExecutionJournal["status"]): "running" | "interrupted" | "failed" {
  return deps.isRunActive(runId) || deps.isPackageFinalizing(runId) ? "running" : status === "failed" ? "failed" : "interrupted";
}

/** Reads finalized run facts and recoverable journals for the project history view. */
export function createDocumentRunHistoryService(deps: DocumentRunHistoryDependencies) {
  return {
    async list(projectId: string): Promise<DocumentRunListItem[]> {
      const runIds = await deps.listRunIds();
      const project = await deps.getProject(projectId);
      const runs = await Promise.all(runIds.map(runId => deps.getRun(runId)));
      const completed = await Promise.all(runs.filter((run): run is DocumentRun => run?.projectId === projectId).map(async run => {
        const scopedIds = run.scopePlan ? [...run.scopePlan.targetCaseIds, ...run.scopePlan.impactCaseIds] : [];
        const caseTitles = Object.fromEntries(scopedIds.map(id => [id, run.caseTitles?.[id] ?? id]));
        const item: DocumentRunListItem = {
          id: run.id, startedAt: run.startedAt, completedAt: run.completedAt, overall: run.overall,
          ...(run.runMode ? { runMode: run.runMode } : {}),
          ...(run.scopePlan ? { scopePlan: structuredClone(run.scopePlan), caseTitles } : {}),
          ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
          ...(run.baselineRunId ? { baselineRunId: run.baselineRunId } : {}),
          ...(run.baselineRunSnapshot?.siteVersionSnapshot ? { baselineSiteVersionSnapshot: structuredClone(run.baselineRunSnapshot.siteVersionSnapshot) } : {}),
          ...(run.baselineEnvironmentComparison ? { baselineEnvironmentComparison: run.baselineEnvironmentComparison } : {}),
          ...(run.baselineRunModeComparison ? { baselineRunModeComparison: run.baselineRunModeComparison } : {}),
          ...(run.siteVersionSnapshot ? { siteVersionSnapshot: run.siteVersionSnapshot } : {}),
          ...(run.caseVersion ? { caseVersion: run.caseVersion } : {}),
          ...(run.materialVersion ? { materialVersion: run.materialVersion } : {}),
          ...(run.testDataVersion ? { testDataVersion: run.testDataVersion } : {}),
          selectedCaseCount: run.caseScope.selectedCaseIds.length,
          totalCases: run.caseScope.totalCases,
          baselineEligible: deps.isBaselineEligible(run),
        };
        try {
          const journal = await deps.readJournal(run.id);
          if (journal.version === 1 && journal.projectId === projectId && journal.stage === "packaging" && run.packageReady !== true && ["running", "failed"].includes(journal.status)) {
            item.executionState = executionState(deps, run.id, journal.status);
            item.stage = journal.stage;
            item.recordedCaseCount = journal.caseResults?.length ?? 0;
            item.resultCounts = countResults(journal);
            if (journal.lastError) item.lastError = journal.lastError;
            if (await deps.canSafelyFinalizePackage(project, journal)) item.canFinalizePackage = true;
          }
        } catch { /* older completed runs may not have an execution journal */ }
        return item;
      }));

      const finalizedIds = new Set(completed.map(item => item.id));
      const incomplete: DocumentRunListItem[] = [];
      for (const runId of runIds) {
        if (finalizedIds.has(runId)) continue;
        try {
          const journal = await deps.readJournal(runId);
          if (journal.version !== 1 || journal.projectId !== projectId || journal.runId !== runId || !["running", "failed"].includes(journal.status)) continue;
          const finalization = journal.finalizationRun;
          const scopePlan = journal.scopePlan;
          const scopedIds = scopePlan ? [...scopePlan.targetCaseIds, ...scopePlan.impactCaseIds] : journal.selectedCaseIds;
          const titlesFromResults = Object.fromEntries((journal.caseResults ?? []).map(item => [item.id, item.title]));
          const caseTitles = Object.fromEntries(scopedIds.map(id => [id, finalization?.caseTitles?.[id] ?? titlesFromResults[id] ?? id]));
          const canFinalizePackage = await deps.canSafelyFinalizePackage(project, journal);
          incomplete.push({
            id: journal.runId, startedAt: journal.startedAt, completedAt: journal.updatedAt, overall: "unresolved",
            executionState: executionState(deps, journal.runId, journal.status),
            stage: journal.stage, recordedCaseCount: journal.caseResults?.length ?? 0, resultCounts: countResults(journal),
            ...(journal.lastError ? { lastError: journal.lastError } : {}), ...(canFinalizePackage ? { canFinalizePackage: true } : {}),
            ...(journal.runMode ? { runMode: journal.runMode } : {}), ...(scopePlan ? { scopePlan: structuredClone(scopePlan), caseTitles } : {}),
            ...(journal.parentRunId ? { parentRunId: journal.parentRunId } : {}), ...(journal.baselineRunId ? { baselineRunId: journal.baselineRunId } : {}),
            ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(journal.siteVersionSnapshot) } : {}),
            ...(finalization?.caseVersion ? { caseVersion: finalization.caseVersion } : {}),
            ...(journal.materialVersion ? { materialVersion: journal.materialVersion } : {}),
            selectedCaseCount: journal.selectedCaseIds.length,
            totalCases: finalization?.caseScope.totalCases ?? project?.cases.length ?? journal.selectedCaseIds.length,
            baselineEligible: false,
          });
        } catch { /* malformed or unrelated folders do not hide completed history */ }
      }
      return [...completed, ...incomplete].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200);
    },
  };
}
