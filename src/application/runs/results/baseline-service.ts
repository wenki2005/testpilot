import type { DocumentRun } from "../../../domain/documents/shared/test-model.js";
import { compareDocumentRunToBaseline } from "../../../domain/documents/runs/baseline-comparison.js";

function targetOrigin(targetUrl: string | undefined): string {
  try { return targetUrl ? new URL(targetUrl).origin.toLocaleLowerCase() : ""; }
  catch { return ""; }
}

/** Adds an immutable comparison context from the selected historical run. */
export function attachDocumentRunBaseline(current: DocumentRun, baseline: DocumentRun): void {
  current.baselineRunSnapshot = {
    runId: baseline.id,
    startedAt: baseline.startedAt,
    completedAt: baseline.completedAt,
    ...(baseline.runMode ? { runMode: baseline.runMode } : {}),
    ...(baseline.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(baseline.siteVersionSnapshot) } : {}),
    ...(baseline.caseVersion ? { caseVersion: baseline.caseVersion } : {}),
    ...(baseline.materialVersion ? { materialVersion: baseline.materialVersion } : {}),
    ...(baseline.testDataVersion ? { testDataVersion: baseline.testDataVersion } : {}),
    ...(baseline.scopePlan ? { scopePlan: structuredClone(baseline.scopePlan) } : {}),
    selectedCaseCount: baseline.caseScope.selectedCaseIds.length,
    totalCases: baseline.caseScope.totalCases,
  };
  current.baselineRunModeComparison = !current.runMode || !baseline.runMode
    ? "unknown"
    : current.runMode === baseline.runMode ? "same" : "different";
  const currentEnvironment = current.siteVersionSnapshot?.environment.trim().toLocaleLowerCase() ?? "";
  const baselineEnvironment = baseline.siteVersionSnapshot?.environment.trim().toLocaleLowerCase() ?? "";
  const currentOrigin = targetOrigin(current.siteVersionSnapshot?.targetUrl);
  const baselineOrigin = targetOrigin(baseline.siteVersionSnapshot?.targetUrl);
  current.baselineEnvironmentComparison = !currentEnvironment || !baselineEnvironment || !currentOrigin || !baselineOrigin
    ? "unknown"
    : currentEnvironment === baselineEnvironment && currentOrigin === baselineOrigin ? "same" : "different";
  current.baselineComparison = compareDocumentRunToBaseline(current, baseline);
  current.baselineMaterialChanged = Boolean(current.materialVersion && baseline.materialVersion && current.materialVersion !== baseline.materialVersion);
  current.baselineTestDataChanged = Boolean(current.testDataVersion && baseline.testDataVersion && current.testDataVersion !== baseline.testDataVersion);
}
