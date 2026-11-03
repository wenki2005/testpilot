import type { DocumentRun, DocumentRunMode, DocumentRunScopePlan, DocumentSiteVersion, ExecutionJournal } from "./document-test-model.js";

/** Stable projection shown by run-history readers, including recoverable journals. */
export type DocumentRunListItem = {
  id: string;
  startedAt: string;
  completedAt: string;
  overall: DocumentRun["overall"];
  executionState?: "running" | "interrupted" | "failed";
  stage?: ExecutionJournal["stage"];
  recordedCaseCount?: number;
  resultCounts?: Record<string, number>;
  lastError?: string;
  canFinalizePackage?: boolean;
  runMode?: DocumentRunMode;
  scopePlan?: DocumentRunScopePlan;
  parentRunId?: string;
  baselineRunId?: string;
  baselineSiteVersionSnapshot?: DocumentSiteVersion;
  baselineEnvironmentComparison?: DocumentRun["baselineEnvironmentComparison"];
  baselineRunModeComparison?: DocumentRun["baselineRunModeComparison"];
  caseTitles?: Record<string, string>;
  siteVersionSnapshot?: DocumentSiteVersion;
  caseVersion?: string;
  materialVersion?: string;
  testDataVersion?: string;
  selectedCaseCount: number;
  totalCases: number;
  baselineEligible: boolean;
};

