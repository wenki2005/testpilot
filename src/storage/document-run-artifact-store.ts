import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentRun } from "../domain/document-test-model.js";

/** File-backed reader for retained run projections and downloadable packages. */
export function createDocumentRunArtifactStore(runsDirectory: string) {
  return {
    async readPackage(runId: string): Promise<Buffer> {
      return readFile(path.join(runsDirectory, runId, "testpilot-package.zip"));
    },

    async getRun(runId: string): Promise<DocumentRun | undefined> {
      try {
        const stored = JSON.parse(await readFile(path.join(runsDirectory, runId, "run.json"), "utf8")) as Partial<DocumentRun>;
        if (!stored || typeof stored.id !== "string" || !Array.isArray(stored.comparisons)) return undefined;
        const comparisonIds = stored.comparisons.map(item => item?.id).filter((id): id is string => typeof id === "string");
        const caseScopeKnown = Boolean(stored.caseScope && Array.isArray(stored.caseScope.selectedCaseIds) && Array.isArray(stored.caseScope.excludedCaseIds) && Number.isFinite(stored.caseScope.totalCases));
        const selectedCaseIds = caseScopeKnown ? stored.caseScope!.selectedCaseIds : comparisonIds;
        return {
          ...stored,
          id: stored.id,
          projectId: typeof stored.projectId === "string" ? stored.projectId : "legacy",
          startedAt: typeof stored.startedAt === "string" ? stored.startedAt : "未知",
          completedAt: typeof stored.completedAt === "string" ? stored.completedAt : "未知",
          caseScope: caseScopeKnown ? stored.caseScope! : { selectedCaseIds, excludedCaseIds: [], totalCases: selectedCaseIds.length },
          caseScopeKnown,
          deterministic: stored.deterministic ?? { status: "blocked", summary: "历史记录没有确定性通道记录。", results: [] },
          ai: stored.ai ?? { status: "blocked", summary: "历史记录没有 Computer Use 通道记录。", results: [] },
          comparisons: stored.comparisons,
          finalReady: stored.finalReady === true,
          reportReady: stored.reportReady === true || Boolean(stored.report),
          packageReady: stored.packageReady === true,
          overall: stored.overall ?? "unresolved",
          report: typeof stored.report === "string" ? stored.report : "",
          packagePath: typeof stored.packagePath === "string" ? stored.packagePath : "",
        };
      } catch {
        return undefined;
      }
    },
  };
}
