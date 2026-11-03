import type { DocumentRun } from './document-test-model.js';

/** A terminal run has lost its live execution stack. Rebuild the current case
 * and its prerequisites in a child run; never skip preceding assertions. */
export function checkpointRetrySelection(parent: DocumentRun, caseId: string, stepIndex: number): string[] {
  if (!parent.completedAt || !['failed', 'cancelled', 'unresolved', 'partial'].includes(parent.overall)) throw new Error('仅允许恢复已经结束的失败、中断或未验证运行。');
  const point = [...(parent.stepLogs ?? [])].reverse().find(item => item.caseId === caseId && item.phase === "failed") ?? parent.stepCheckpoint;
  if (!point || point.caseId !== caseId || point.stepIndex !== stepIndex) throw new Error('检查点与历史运行不匹配，请刷新结果后重试。');
  const outcome = parent.comparisons.find(item => item.id === caseId);
  if (!outcome || ![outcome.deterministic, outcome.apiContract].some(status => ['failed', 'blocked', 'cancelled', 'not-run'].includes(status ?? ''))) throw new Error('此用例已经完成通过，没有需要恢复的失败检查点。');
  const snapshot = parent.executionCaseSnapshots?.find(item => item.id === caseId);
  if (!snapshot || !Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= snapshot.steps.length) throw new Error('历史步骤快照缺失或检查点步骤无效。');
  const ordered = parent.scopePlan?.orderedCaseIds ?? parent.caseScope.selectedCaseIds;
  const offset = ordered.indexOf(caseId);
  if (offset < 0) throw new Error('检查点不属于父运行范围。');
  return ordered.slice(offset).filter(id => id === caseId || parent.comparisons.some(item => item.id === id && [item.deterministic, item.apiContract, item.computerUse].some(status => status === 'not-run' || status === 'cancelled')));
}
