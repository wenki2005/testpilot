export type SourceTestMode = 'plan' | 'generate' | 'diagnose';
export type SourceTestFinding = { caseId: string; status: 'observed' | 'failed' | 'blocked'; expected: string; actual: string; evidence: string };
export type SourceTestAssessment = {
  summary: string;
  findings: SourceTestFinding[];
  blockers: string[];
  proposedTests: Array<{ id: string; title: string; bin: string; args: string[] }>;
};

/** Persisted source-test result contract shared by the application and adapters. */
export type SourceTestRun = {
  id: string;
  goal: string;
  candidateFiles: string[];
  status: 'candidate' | 'blocked';
  executionState: 'running' | 'completed';
  mode: SourceTestMode;
  startedAt: string;
  completedAt: string;
  reportPath: string;
  workspacePath: string;
  assessment?: SourceTestAssessment;
  error?: string;
  changedFiles: string[];
  protectedChanges: string[];
  toolCalls: number;
  modelRequests: number;
  usage: { input: number; output: number };
  runtimeStatus: 'not-run' | 'passed' | 'failed' | 'blocked';
  executions: Array<{ id: string; files: string[]; status: string; durationMs: number; counts: Record<string, number>; evidenceId: string }>;
  commandCount: number;
  successfulCommands: number;
  candidateDigest?: string;
  candidateFilesDigest?: string;
  candidateFileDigests?: Record<string, string>;
  evidenceIds: string[];
  limitations: string[];
};

export type SourceTestJob = {
  id: string;
  profileId: string;
  mode: SourceTestMode;
  status: 'running' | 'candidate' | 'blocked' | 'cancelled';
  startedAt: string;
  events: Array<{ type: string; itemType?: string; exitCode?: number }>;
  result?: SourceTestRun;
  error?: string;
};
