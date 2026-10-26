import type { EngineMode, RunRecord, RunRequest, TestEngine } from "../domain/types.js";
import { randomUUID } from "node:crypto";

export interface RequirementInput {
  sourceText: string;
  sourceLabel: string;
}

export interface ExplorationGoal {
  description: string;
  scope: string[];
  forbiddenActions: string[];
  maxActions: number;
  maxDurationMs: number;
}

export interface TestPlanStep {
  id: string;
  actionDescription: string;
  expectedObservation?: string;
  assertion?: string;
}

export interface TargetObservation {
  targetType: "web" | "api" | "cli" | "code" | "desktop" | "mobile" | "other";
  summary: string;
  availableActions: string[];
  evidenceRefs: string[];
}

/** Adapter actions must be validated by the adapter against its capability and target policy. */
export interface AdapterAction {
  kind: string;
  payload: Record<string, unknown>;
}

export interface AdapterActionResult {
  succeeded: boolean;
  summary: string;
  evidenceRefs: string[];
}

export interface TargetAdapter {
  readonly id: string;
  readonly capabilities: string[];
  observe(): Promise<TargetObservation>;
  perform(action: AdapterAction): Promise<AdapterActionResult>;
  verify(assertion: string): Promise<{ passed: boolean | null; evidenceRefs: string[]; explanation: string }>;
}

export interface AgentRuntime {
  plan(input: RequirementInput | ExplorationGoal, observation: TargetObservation): Promise<TestPlanStep[]>;
  chooseAction(context: {
    goal: RequirementInput | ExplorationGoal;
    plan: TestPlanStep[];
    observation: TargetObservation;
    previousActions: AdapterAction[];
  }): Promise<AdapterAction | { kind: "finish"; summary: string }>;
  analyzeEvidence(context: {
    goal: RequirementInput | ExplorationGoal;
    observations: TargetObservation[];
    actionResults: AdapterActionResult[];
  }): Promise<{ summary: string; suspectedFindings: string[]; limitations: string[] }>;
}

export class PlanningEngineScaffold implements TestEngine {
  readonly mode: EngineMode;

  constructor(mode: "requirements" | "autonomous") {
    this.mode = mode;
  }

  async run(request: RunRequest): Promise<RunRecord> {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      runId: randomUUID(),
      mode: this.mode,
      suiteName: request.suiteName,
      status: "blocked",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      results: [],
      scope: request.scope ?? [],
      limitations: [
        this.mode === "requirements"
          ? "Requirements planning is an interface scaffold; no model provider or target adapter is configured yet."
          : "Autonomous exploration is an interface scaffold; no model provider or target adapter is configured yet.",
        "No application behavior was tested and no passing result was produced.",
      ],
    };
  }
}
