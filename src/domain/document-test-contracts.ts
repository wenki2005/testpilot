import type { CaseCategory, CaseConfidence } from "./document-test-types.js";

/** Shared authoring data. Providers may produce this shape; the domain owns it. */
export type GeneratedTestCase = {
  id: string;
  origin: "existing" | "ai-draft";
  title: string;
  requirementIds: string[];
  sourceRefs: string[];
  scenarioType: string;
  priority: "P0" | "P1" | "P2" | "P3";
  preconditions: string[];
  testData: string[];
  actions: string[];
  expectedResult: string;
  confidence: "high" | "medium" | "low";
  clarificationNeeded: string[];
};

/** Extracted source data, independent of the PDF/XMind parsing adapter. */
export interface ImportedDocument {
  format: "xmind" | "pdf" | "markdown" | "text";
  text: string;
  nodeCount?: number;
  testCases?: Array<{
    title: string;
    source: string;
    modulePath?: string[];
    expected: string;
    priority?: "P0" | "P1" | "P2" | "P3";
    requirementRefs?: string[];
    category?: CaseCategory;
    confidence?: CaseConfidence;
    coverageAreas?: CaseCategory[];
  }>;
}

/** Explicit mapping between reviewed document cases and approved API cases. */
export type DocumentApiMapping = { documentCaseId: string; apiCaseIds: string[] };
export type DocumentApiResult = {
  id: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "cancelled" | "not-run";
  detail: string;
  apiCaseResults: Array<{ caseId: string; status: "passed" | "failed" | "blocked" | "error"; detail?: string }>;
};
export type DocumentApiLane = {
  status: "passed" | "failed" | "blocked" | "cancelled";
  summary: string;
  results: DocumentApiResult[];
  provider: string;
  scope?: string[];
  limitations?: string[];
};

export type DocumentImpactSuggestion = {
  caseId: string;
  title: string;
  score: number;
  matchedTerms: string[];
  evidence: string[];
};
