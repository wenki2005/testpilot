import type { BaselineDisposition, CaseComparison, DocumentBaselineComparison, DocumentRun } from "./document-test-model.js";

function stableOutcomeForBaseline(run: DocumentRun, caseId: string): CaseComparison["deterministic"] | undefined {
  if (!run.caseScope?.selectedCaseIds.includes(caseId)) return undefined;
  const comparison = run.comparisons.find(item => item.id === caseId);
  if (!comparison) return undefined;
  if (run.runMode === "regression") {
    if (comparison.deterministic === "not-applicable" && ["passed", "failed"].includes(comparison.apiContract ?? "")) return comparison.apiContract;
    return comparison.deterministic;
  }
  if (comparison.resolution === "aligned" && comparison.deterministic === comparison.computerUse && ["passed", "failed"].includes(comparison.deterministic)) return comparison.deterministic;
  if (comparison.deterministic === "not-applicable" && comparison.computerUse === "not-applicable" && ["passed", "failed"].includes(comparison.apiContract ?? "")) return comparison.apiContract;
  if (comparison.deterministic === "not-run" || comparison.deterministic === "cancelled") return comparison.deterministic;
  return "blocked";
}

/** Compare a finished run with a user-selected immutable run by case ID. A changed
 * expectation or script is explicitly separated from a product regression. */
export function compareDocumentRunToBaseline(current: DocumentRun, baseline: DocumentRun): DocumentBaselineComparison[] {
  if (current.projectId !== baseline.projectId) throw new Error("Baseline run must belong to the same test project.");
  const currentVersions = current.caseVersions;
  const baselineVersions = baseline.caseVersions;
  if (!currentVersions || !baselineVersions) throw new Error("Both runs must record per-case revisions to compare against a baseline.");
  const currentSelected = new Set(current.caseScope.selectedCaseIds);
  const baselineSelected = new Set(baseline.caseScope.selectedCaseIds);
  const currentInventory = current.caseInventory ? new Set(Object.keys(current.caseInventory)) : undefined;
  const baselineInventory = baseline.caseInventory ? new Set(Object.keys(baseline.caseInventory)) : undefined;
  const hasCompleteInventories = Boolean(currentInventory && baselineInventory);
  const ids = [...new Set([
    ...Object.keys(currentVersions),
    ...Object.keys(baselineVersions),
    ...currentSelected,
    ...baselineSelected,
    ...(currentInventory && baselineInventory ? [...currentInventory, ...baselineInventory] : []),
  ])];
  const comparisons: DocumentBaselineComparison[] = [];
  for (const caseId of ids) {
    const currentExists = currentInventory?.has(caseId) ?? currentVersions[caseId] !== undefined;
    const baselineExists = baselineInventory?.has(caseId) ?? baselineVersions[caseId] !== undefined;
    const title = current.caseTitles?.[caseId] ?? baseline.caseTitles?.[caseId]
      ?? current.caseInventory?.[caseId] ?? baseline.caseInventory?.[caseId] ?? caseId;
    const isSelectedNow = currentSelected.has(caseId);
    const wasSelectedAtBaseline = baselineSelected.has(caseId);

    // A result-scoped case snapshot cannot tell whether an absent case was removed
    // from the project or simply omitted from this run. Only classify additions or
    // removals when both runs carry a complete project inventory.
    if (hasCompleteInventories && !currentExists && baselineExists) {
      const baselineStatus = stableOutcomeForBaseline(baseline, caseId);
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus: "not-run", disposition: "removed" });
      continue;
    }
    if (hasCompleteInventories && currentExists && !baselineExists) {
      const currentStatus = isSelectedNow ? stableOutcomeForBaseline(current, caseId) : "not-run";
      comparisons.push({ caseId, title, ...(currentStatus ? { currentStatus } : {}), disposition: "added" });
      continue;
    }
    if (!isSelectedNow && !wasSelectedAtBaseline) continue;

    const caseChanged = currentVersions[caseId] !== undefined && baselineVersions[caseId] !== undefined
      ? currentVersions[caseId] !== baselineVersions[caseId]
      : undefined;
    const currentStatus = isSelectedNow ? stableOutcomeForBaseline(current, caseId) : undefined;
    const baselineStatus = wasSelectedAtBaseline ? stableOutcomeForBaseline(baseline, caseId) : undefined;
    if (!isSelectedNow) {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus: "not-run", ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "not-run" });
      continue;
    }
    if (!wasSelectedAtBaseline) {
      comparisons.push({ caseId, title, ...(currentStatus ? { currentStatus } : {}), ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "no-baseline-result" });
      continue;
    }
    if (currentStatus === "not-run" || currentStatus === "cancelled") {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus, ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "not-run" });
      continue;
    }
    if (caseChanged === undefined || !currentStatus || !baselineStatus || !["passed", "failed"].includes(currentStatus) || !["passed", "failed"].includes(baselineStatus)) {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), ...(currentStatus ? { currentStatus } : {}), ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "unresolved" });
      continue;
    }
    if (caseChanged) {
      comparisons.push({ caseId, title, baselineStatus, currentStatus, caseChanged: true, disposition: "case-changed" });
      continue;
    }
    const disposition: BaselineDisposition = baselineStatus === "passed" && currentStatus === "failed" ? "regression"
      : baselineStatus === "failed" && currentStatus === "passed" ? "fixed"
        : baselineStatus === currentStatus ? "unchanged" : "unresolved";
    comparisons.push({ caseId, title, baselineStatus, currentStatus, caseChanged: false, disposition });
  }
  return comparisons;
}

export function isDocumentBaselineEligible(run: DocumentRun): boolean {
  if (!run.caseScopeKnown || !run.caseVersion || !run.caseVersions || !run.completedAt || run.overall === "cancelled") return false;
  if (run.runMode === "regression") return ["passed", "failed"].includes(run.overall)
    && run.caseScope.selectedCaseIds.every(id => ["passed", "failed"].includes(stableOutcomeForBaseline(run, id) ?? ""));
  return run.finalReady === true && ["passed", "failed"].includes(run.overall);
}
