import type { RunRecord } from "./types.js";

export interface ProjectProfileSummary { id: string; name: string; suiteName: string }

export interface ProjectRunView {
  id: string; profileId: string; profileName: string; suiteName: string;
  scriptId?: string; scriptVersion?: number;
  status: "queued" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "error";
  startedAt: string; completedAt?: string; durationMs: number; summary: string;
  recordRunId?: string;
  results: RunRecord["results"]; artifactFiles: string[];
}
