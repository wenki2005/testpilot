import type { BrowserCheck, CaseResult, DocumentRunMode, ExecutionJournal, LaneResult } from '../../domain/document-test-model.js';

const cancelledReason = '运行在浏览器准备或用例执行过程中被手动停止。';

export function buildDocumentRunCancellationResults(input: {
  selectedCases: BrowserCheck[];
  journal: Pick<ExecutionJournal, 'caseResults' | 'currentCase'>;
  runMode: DocumentRunMode;
}): { deterministic: LaneResult; computerUse?: LaneResult & { provider: string } } {
  const { selectedCases, journal, runMode } = input;
  const entries = journal.caseResults ?? [];
  const cancelledLane = (lane: 'deterministic' | 'computer-use'): LaneResult => ({
    status: 'cancelled',
    summary: cancelledReason,
    results: selectedCases.map(item => {
      const saved = entries.find(result => result.lane === lane && result.id === item.id);
      if (saved) return { id: saved.id, title: saved.title, status: saved.status, detail: saved.detail, durationMs: saved.durationMs };
      const interrupted = journal.currentCase?.lane === lane && journal.currentCase.id === item.id;
      return {
        id: item.id,
        title: item.title,
        status: interrupted ? 'cancelled' as const : 'not-run' as const,
        detail: interrupted ? '运行在此用例期间被手动停止；当前结果未判定，可定向重跑。' : '运行被手动停止；此用例尚未执行，可定向重跑。',
        durationMs: 0,
      };
    }),
  });
  const deterministic = cancelledLane('deterministic');
  if (runMode !== 'compare') return { deterministic };
  const computerUse = cancelledLane('computer-use');
  return {
    deterministic,
    computerUse: {
      ...computerUse,
      provider: 'cancelled',
      results: computerUse.results.map(result => ({ ...result, actions: entries.find(saved => saved.lane === 'computer-use' && saved.id === result.id)?.actions ?? 0 })),
    },
  };
}
