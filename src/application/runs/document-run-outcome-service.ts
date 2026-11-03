import { buildDocumentRunComparisons } from "../../domain/document-run-comparison.js";
import { classifyDocumentRunTriage } from "../../domain/document-run-triage.js";
import type { DocumentApiLane } from "../../domain/document-test-contracts.js";
import type { CaseComparison,DocumentProject,DocumentRun,DocumentRunMode,LaneResult } from "../../domain/document-test-model.js";
import { attachDocumentRunBaseline } from "./document-run-baseline-service.js";
import { createDocumentRunSnapshot } from "./document-run-snapshot-service.js";

type SnapshotInput = Parameters<typeof createDocumentRunSnapshot>[0];

export interface DocumentRunOutcomePorts {
  summarize(input: {
    project: DocumentProject;
    run: DocumentRun;
    comparisons: CaseComparison[];
    deterministic: LaneResult;
    computerUse: LaneResult;
    runMode: DocumentRunMode;
    finalReady: boolean;
    aborted: boolean;
    onReportStage?: (() => Promise<void>) | undefined;
  }): Promise<{ analysis: string; reportSummary: string }>;
  renderReport(project: DocumentProject, run: DocumentRun, reportSummary: string): string;
  redact(run: DocumentRun): unknown;
}

/** Coordinates immutable run outcome, triage, summary and report before packaging. */
export function createDocumentRunOutcomeService(ports: DocumentRunOutcomePorts) {
  return {
    async create(input: Omit<SnapshotInput, "comparisons" | "finalReady" | "diagnostics"> & {
      aborted: boolean;
      apiContract?: DocumentApiLane;
      baselineRun?: DocumentRun;
      onAnalysisStage?: (() => Promise<void>) | undefined;
      onReportStage?: (() => Promise<void>) | undefined;
    }): Promise<DocumentRun> {
      const comparisons = buildDocumentRunComparisons({
        cases: input.selectedCases,
        deterministic: input.deterministic,
        computerUse: input.computerUse,
        ...(input.apiContract ? { apiContract: input.apiContract } : {}),
        runMode: input.runMode,
        aborted: input.aborted,
      });
      const applicable = comparisons.filter(item => item.resolution !== "not-applicable");
      const finalReady = !input.aborted && applicable.length > 0 && applicable.every(item => item.resolution === "aligned");
      const run = createDocumentRunSnapshot({
        ...input,
        ...(input.apiContract ? { apiContract: input.apiContract } : {}),
        comparisons,
        finalReady,
      });
      if (input.baselineRun) attachDocumentRunBaseline(run, input.baselineRun);

      const classified = classifyDocumentRunTriage({
        comparisons: run.comparisons,
        deterministic: input.deterministic,
        computerUse: input.computerUse,
        ...(input.apiContract ? { apiContract: input.apiContract } : {}),
        run,
        runMode: input.runMode,
      });
      run.comparisons = classified.comparisons;
      run.diagnostics = classified.diagnostics;
      if (input.journal.testDataSetId) run.testDataSetId = input.journal.testDataSetId;
      if (Object.keys(input.journal.parameterValues ?? {}).length) run.parameterValues = { ...input.journal.parameterValues };
      if (!input.aborted) await input.onAnalysisStage?.();

      const summary = await ports.summarize({
        project: input.project,
        run,
        comparisons,
        deterministic: input.deterministic,
        computerUse: input.computerUse,
        runMode: input.runMode,
        finalReady,
        aborted: input.aborted,
        onReportStage: input.onReportStage,
      });
      run.analysis = summary.analysis;
      run.report = ports.renderReport(input.project, run, summary.reportSummary);
      Object.assign(run, ports.redact(run));
      run.reportReady = true;
      return run;
    },
  };
}
