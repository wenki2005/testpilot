export type EngineMode = "deterministic" | "requirements" | "autonomous";
export type RunStatus = "passed" | "failed" | "blocked" | "error";
export type CaseStatus = "passed" | "failed" | "blocked" | "error";

export interface CommandSpec {
  bin: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  expectedExitCode?: number;
  cleanEnvironment?: boolean;
}

export interface SuiteCase {
  id: string;
  title: string;
  command: CommandSpec;
}

export interface TestSuite {
  version: 1;
  name: string;
  description?: string;
  cases: SuiteCase[];
}

export interface ProjectProfile {
  version: 1;
  name: string;
  sourceRoot: string;
  service?: { bin: string; args: string[]; env?: Record<string, string>; healthUrl: string; startupTimeoutMs?: number };
  suite: TestSuite;
  scriptFiles?: string[];
  optionalScriptFiles?: string[];
  /** Exact project-relative paths omitted from the disposable copy (for private data or deployment tooling). */
  excludePaths?: string[];
  preserveArtifacts?: string[];
}

export interface EvidenceItem {
  kind: "stdout" | "stderr" | "exit_code" | "timeout" | "note";
  content: string;
  capturedAt: string;
}

export interface CaseResult {
  caseId: string;
  title: string;
  status: CaseStatus;
  expectedExitCode?: number;
  actualExitCode?: number | null;
  durationMs: number;
  error?: string;
  assertion?: { expected: string; actual: string };
  /** Trace links from the authored test case back to its source requirements. */
  designTrace?: { source?: string; requirementRefs?: string[]; priority?: string };
  /** HTTP observations are kept separately from process exit codes for API runs. */
  apiObservations?: Array<{ identity?: string; expectedStatus: number; actualStatus: number | null }>;
  evidence: EvidenceItem[];
}

export interface ApiDesignAssessmentCheck {
  category: "success" | "error" | "authorization" | "boundary" | "manual-review";
  operationKey: string;
  requirementId?: string;
  label: string;
  caseId?: string;
  expectedResponse: "2xx" | "4xx" | "401/403" | "manual review";
  observedStatuses: number[];
  resultStatus?: CaseStatus;
  status: "confirmed" | "mismatch" | "no-response" | "partial-response" | "not-run" | "not-authored" | "manual-review";
}

export interface SqliteMigrationCheckEvidence {
  scenarioId: string;
  checkId: string;
  title: string;
  query: string;
  status: "passed" | "failed" | "error";
  expectedRows: Array<Record<string, unknown>>;
  actualRows?: Array<Record<string, unknown>>;
  error?: string;
}

export interface SqliteMigrationScenarioEvidence {
  scenarioId: string;
  status: "passed" | "failed" | "blocked" | "error";
  appliedMigrations: string[];
  migrationEvents: Array<{ migrationId: string; status: "applied" | "expected-failure-rolled-back" | "unexpected-failure" | "expected-failure-missing"; message?: string }>;
  checks: SqliteMigrationCheckEvidence[];
}

export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  mode: EngineMode;
  suiteName: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: CaseResult[];
  /** Contract-derived design targets compared with observed API response status and test outcome. */
  apiDesignAssessment?: { checks: ApiDesignAssessmentCheck[] };
  /** A targeted rerun always links to its parent run and the approved case IDs it reran. */
  apiRerun?: { parentRunId: string; caseIds: string[] };
  /** Persistent cross-run finding events produced from this run's own evidence. */
  apiFindingUpdates?: Array<{ findingId: string; state: "open" | "resolved"; kind: "assertion" | "design-gap" | "manual-review"; caseId?: string; operationKey?: string; requirementId?: string; title: string; occurrences: number; firstSeenAt: string; lastSeenAt: string; resolvedAt?: string }>;
  /** Structured, machine-readable data/schema and rollback evidence for SQLite migration runs. */
  sqliteMigration?: { suiteDigest: string; sqliteVersion: string; scenarios: SqliteMigrationScenarioEvidence[] };
  scope: string[];
  limitations: string[];
  approvedScript?: { id: string; version: number; digest: string };
}

export interface RunRequest {
  mode: EngineMode;
  suiteName: string;
  cases: SuiteCase[];
  projectRoot: string;
  outputRoot: string;
  scope?: string[];
  limitations?: string[];
  signal?: AbortSignal;
}

export interface TestEngine {
  readonly mode: EngineMode;
  run(request: RunRequest): Promise<RunRecord>;
}
