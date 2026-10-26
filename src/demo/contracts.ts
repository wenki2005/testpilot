export type DemoMode = "deterministic" | "requirements" | "autonomous";
export type DemoStatus = "queued" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "error";
export interface DemoRequest {
  mode: DemoMode;
  provider: "offline" | "model";
  requirements: string;
  maxActions: number;
  target: "sample";
}
export interface DemoCheck {
  id: string;
  title: string;
  source: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  expect: { status: number; json?: Record<string, unknown> };
}
export interface DemoEvidence {
  id: string;
  method: string;
  path: string;
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
  status: number;
  body: unknown;
  durationMs: number;
  capturedAt: string;
}
export interface DemoAssertion {
  id: string;
  title: string;
  source: string;
  status: "passed" | "failed" | "inconclusive";
  expected: unknown;
  actual: unknown;
  evidenceId: string;
  reproduction: { method: string; path: string; body?: unknown; headers?: Record<string, string> };
}
export interface DemoEvent {
  id: string;
  at: string;
  kind: "plan" | "tool" | "observation" | "assertion" | "info" | "error";
  title: string;
  detail: string;
}
export interface DemoRun {
  id: string;
  framework?: string;
  modelLabel?: string;
  input?: { requirements: string; target: "sample" };
  mode: DemoMode;
  provider: "offline" | "model";
  status: DemoStatus;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  maxActions: number;
  actionCount: number;
  plan: string[];
  events: DemoEvent[];
  evidence: DemoEvidence[];
  assertions: DemoAssertion[];
  coverage: { visited: string[]; available: string[]; untested: string[] };
  limitations: string[];
  summary: string;
  error?: string;
  fixedTarget: boolean;
}
export interface DemoConfig {
  framework: string;
  modelAvailable: boolean;
  modelLabel: string;
  computerUseAvailable?: boolean;
  computerUseReason?: string;
  computerUseModel?: string;
  fixedTarget: boolean;
  targetLabel: string;
  defaultRequirements: string;
}
export interface RunContext {
  run: DemoRun;
  signal: AbortSignal;
  baseUrl: string;
  emit(kind: DemoEvent["kind"], title: string, detail: string): void;
}
