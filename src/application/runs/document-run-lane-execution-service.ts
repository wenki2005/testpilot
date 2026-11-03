import type { BrowserCheck, CaseResult, DocumentRun, DocumentRunMode, LaneResult, StepGenerationCaseResult } from '../../domain/document-test-model.js';
import type { DocumentApiLane } from '../../domain/document-test-contracts.js';

export type PreparedDocumentSteps = {
  generatedCaseIds: string[];
  caseResults?: StepGenerationCaseResult[];
  warning?: string;
  requiresReview?: boolean;
};

type RecoverableResult = CaseResult & { actions?: number };
type RecoverableLane = { status: LaneResult['status']; summary: string; results: RecoverableResult[]; provider?: string; diagnostics?: string[] };

export interface DocumentRunLaneExecutionPorts<TPage> {
  runMode: DocumentRunMode;
  selectedCases: BrowserCheck[];
  signal: AbortSignal;
  page: TPage;
  initialVisual: DocumentRun['ai'];
  updateStage(stage: 'deterministic' | 'computer-use' | 'awaiting-login'): Promise<void>;
  runRecoverableLane<T extends RecoverableResult>(lane: 'deterministic' | 'computer-use', cases: BrowserCheck[], runner: (pending: BrowserCheck[]) => Promise<{ status: LaneResult['status']; summary: string; results: T[]; provider?: string; diagnostics?: string[] }>): Promise<{ status: LaneResult['status']; summary: string; results: T[]; provider?: string; diagnostics?: string[] }>;
  executeDeterministic(cases: BrowserCheck[], signal: AbortSignal): Promise<LaneResult>;
  executeComputerUse(cases: BrowserCheck[], signal: AbortSignal): Promise<DocumentRun['ai']>;
  dispatchApi(cases: BrowserCheck[], signal: AbortSignal): Promise<DocumentApiLane | undefined>;
  stepGeneration: {
    apply(prepared: PreparedDocumentSteps, previousCases: BrowserCheck[]): Promise<{ selectedCases: BrowserCheck[]; stepGeneration?: DocumentRun['stepGeneration'] }>;
    failed(prefix: string, error: unknown): Promise<DocumentRun['stepGeneration']>;
  };
  beforeDeterministic?(page: TPage): Promise<PreparedDocumentSteps>;
  afterDeterministic?(page: TPage): Promise<PreparedDocumentSteps>;
  setAcceptingCancel(value: boolean): void;
}

/** Runs document lanes in their product order while keeping execution mechanics behind ports. */
export async function executeDocumentRunLanes<TPage>(ports: DocumentRunLaneExecutionPorts<TPage>): Promise<{
  selectedCases: BrowserCheck[];
  deterministic: LaneResult;
  visual: DocumentRun['ai'];
  apiContract?: DocumentApiLane;
  stepGeneration?: DocumentRun['stepGeneration'];
}> {
  let selectedCases = ports.selectedCases;
  let stepGeneration: DocumentRun['stepGeneration'];
  let deterministic: LaneResult;
  let visual = ports.initialVisual;

  if (ports.beforeDeterministic && !ports.signal.aborted) {
    try {
      const prepared = await ports.beforeDeterministic(ports.page);
      const result = await ports.stepGeneration.apply(prepared, selectedCases);
      stepGeneration = result.stepGeneration;
      selectedCases = result.selectedCases;
    } catch (error) {
      stepGeneration = await ports.stepGeneration.failed('执行前步骤生成失败：', error);
    }
  }

  deterministic = await ports.runRecoverableLane('deterministic', selectedCases, pending => ports.executeDeterministic(pending, ports.signal));
  if (!ports.signal.aborted && ports.runMode === 'compare' && ports.afterDeterministic) {
    try {
      const prepared = await ports.afterDeterministic(ports.page);
      const result = await ports.stepGeneration.apply(prepared, selectedCases);
      stepGeneration = result.stepGeneration;
      selectedCases = result.selectedCases;
      if (prepared.generatedCaseIds.length && prepared.requiresReview !== true) {
        const generated = selectedCases.filter(item => prepared.generatedCaseIds.includes(item.id));
        const repairedLane = await ports.executeDeterministic(generated, ports.signal);
        const byId = new Map(deterministic.results.map(item => [item.id, item]));
        for (const result of repairedLane.results) byId.set(result.id, result);
        const results = selectedCases.map(item => byId.get(item.id) ?? { id: item.id, title: item.title, status: 'blocked' as const, detail: '本轮未得到确定性结果。', durationMs: 0 });
        const passed = results.filter(item => item.status === 'passed').length;
        deterministic = { ...deterministic, status: passed === results.length ? 'passed' : 'failed', summary: `${passed}/${results.length} 条通过`, results };
      }
    } catch (error) {
      stepGeneration = await ports.stepGeneration.failed('登录后步骤生成失败：', error);
    }
  }

  if (ports.runMode === 'compare') {
    await ports.updateStage('computer-use');
    visual = await ports.runRecoverableLane('computer-use', selectedCases, pending => ports.executeComputerUse(pending, ports.signal)) as DocumentRun['ai'];
  }

  const apiContract = await ports.dispatchApi(selectedCases, ports.signal);
  ports.setAcceptingCancel(false);
  return { selectedCases, deterministic, visual, ...(apiContract ? { apiContract } : {}), ...(stepGeneration ? { stepGeneration } : {}) };
}
