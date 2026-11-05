import type { TestSuite } from "../testing/test-contracts.js";

export interface SourceScriptProvenance {
  runId: string;
  candidateDigest: string;
  runtimeConclusion: string;
  assessmentSummary: string;
  blockers: string[];
  executions: Array<{ id: string; status: string; files: string[]; counts: Record<string, number>; durationMs: number; evidenceId: string }>;
  evidenceIds: string[];
  findings: Array<{ caseId: string; status: string; evidenceDescription: string; evidenceRefs: string[]; evidenceLinkStatus: "linked" | "unlinked-pending-review" }>;
}

export interface ProjectScriptVersion {
  id: string;
  profileId: string;
  profileName: string;
  suiteName: string;
  version: number;
  status: "candidate" | "approved" | "rejected";
  origin: "registered-profile-snapshot" | "ai-requirement-candidate" | "source-agent-candidate";
  createdAt: string;
  reviewedAt?: string;
  reviewDecision?: "approve" | "reject";
  reviewerNotes?: string;
  digest: string;
  suite: TestSuite;
  files: Record<string, string>;
  requirement?: string;
  generationSummary?: string;
  sourceRunId?: string;
  sourceCandidateDigest?: string;
  sourceRuntimeConclusion?: string;
  sourceProvenance?: SourceScriptProvenance;
}

export interface ProjectScriptView extends Omit<ProjectScriptVersion, "suite" | "files"> {
  cases: Array<{ id: string; title: string; bin: string; args: string[]; cwd?: string; timeoutMs?: number; expectedExitCode: number }>;
  previousApprovedVersion?: number;
  diff: string[];
  files: Array<{ path: string; content: string }>;
}
