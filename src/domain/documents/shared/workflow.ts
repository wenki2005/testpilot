/** Stable workflow vocabulary shared by application rules and persistence adapters. */
export const DOCUMENT_WORKFLOW_STAGES = [
  "generate-cases",
  "review-cases",
  "author-steps",
  "human-approval",
  "deterministic-execution",
  "computer-use-execution",
  "analyze-results",
  "generate-report",
  "package-artifacts",
] as const;

export type DocumentWorkflowStageId = typeof DOCUMENT_WORKFLOW_STAGES[number];

export const DOCUMENT_WORKFLOW_SPECIALISTS = [
  "case-generator",
  "case-reviewer",
  "step-author",
  "human-review-gate",
  "deterministic-executor",
  "computer-use-observer",
  "result-analyst",
  "report-writer",
  "report-packager",
] as const;

export type DocumentWorkflowSpecialist = typeof DOCUMENT_WORKFLOW_SPECIALISTS[number];

export type DocumentExecutionStage = "deterministic" | "computer-use" | "analysis" | "report" | "packaging" | "awaiting-login" | "starting";
