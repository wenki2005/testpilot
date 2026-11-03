import type { CaseComparison, CaseResult, DocumentRun, DocumentRunDiagnostic, DocumentRunMode, LaneResult } from './document-test-model.js';
import { classifyDocumentCaseTriage } from './document-result-classification.js';

type BaselineContext = Pick<DocumentRun,
  'baselineComparison' | 'baselineMaterialChanged' | 'baselineTestDataChanged' |
  'baselineEnvironmentComparison' | 'baselineRunModeComparison'>;

/** Attach evidence-based triage without changing any lane outcome or resolution. */
export function classifyDocumentRunTriage(input: {
  comparisons: CaseComparison[];
  deterministic: LaneResult;
  computerUse: LaneResult;
  apiContract?: { results: Array<Pick<CaseResult, 'id' | 'detail' | 'status'>> };
  run: BaselineContext;
  runMode: DocumentRunMode;
}): { comparisons: CaseComparison[]; diagnostics: DocumentRunDiagnostic[] } {
  const comparisons = input.comparisons.map(comparison => {
    const evidence = [
      input.apiContract?.results.find(item => item.id === comparison.id),
      input.deterministic.results.find(item => item.id === comparison.id),
      input.computerUse.results.find(item => item.id === comparison.id),
    ].filter((item): item is CaseResult => Boolean(item));
    const relevant = evidence.find(item => item.status === 'failed') ?? evidence.find(item => item.status === 'blocked');
    if (!relevant) return comparison;
    const baseline = input.run.baselineComparison?.find(item => item.caseId === comparison.id);
    const triage = classifyDocumentCaseTriage({
      status: relevant.status,
      detail: relevant.detail,
      ...(baseline ? { baselineDisposition: baseline.disposition } : {}),
      ...(baseline?.caseChanged !== undefined ? { caseChanged: baseline.caseChanged } : {}),
      ...(input.run.baselineMaterialChanged !== undefined ? { materialChanged: input.run.baselineMaterialChanged } : {}),
      ...(input.run.baselineTestDataChanged !== undefined ? { testDataChanged: input.run.baselineTestDataChanged } : {}),
      ...(input.run.baselineEnvironmentComparison ? { baselineEnvironmentComparison: input.run.baselineEnvironmentComparison } : {}),
      ...(input.run.baselineRunModeComparison ? { baselineRunModeComparison: input.run.baselineRunModeComparison } : {}),
      regressionMode: input.runMode === 'regression',
    });
    return triage ? { ...comparison, triage } : comparison;
  });

  const diagnostics = comparisons.map(comparison => {
    const deterministicResult = input.deterministic.results.find(result => result.id === comparison.id);
    const computerUseResult = input.computerUse.results.find(result => result.id === comparison.id);
    const apiResult = input.apiContract?.results.find(result => result.id === comparison.id);
    const resolution = comparison.resolution ?? 'unresolved';
    return {
      caseId: comparison.id,
      classification: resolution === 'mismatch' ? 'mismatch' as const : resolution === 'unresolved' ? 'unverified' as const : resolution,
      resolution,
      deterministicEvidence: deterministicResult?.detail ?? '该通道没有结果。',
      computerUseEvidence: computerUseResult?.detail ?? (input.runMode === 'regression' ? '常规回归模式未运行 Computer Use。' : '该通道没有结果。'),
      ...(apiResult ? { apiEvidence: apiResult.detail } : {}),
    };
  });
  return { comparisons, diagnostics };
}
