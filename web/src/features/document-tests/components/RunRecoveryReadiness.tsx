import React, { useEffect, useState } from 'react';
export type RecoveryCandidate = {
    caseId: string;
    stepIndex: number;
    selectedCaseIds: string[];
    prerequisiteCaseIds: string[];
    orderedCaseIds: string[];
    semantics: 'rebuild-current-case';
};
export type RecoveryAdvice = {
    state: 'available' | 'unavailable';
    provisional: true;
    recordId?: string;
    runDigest?: string;
    reason?: string;
    recommendations: Array<{
        caseId: string;
        category: 'product' | 'test' | 'environment' | 'unknown';
        strategy: 'human-review' | 'rebuild-readonly-case';
        summary: string;
        evidence: Array<{
            factId: string;
            quote: string;
        }>;
    }>;
};
export type RecoveryReadiness = {
    parentRunId: string;
    projectId: string;
    status: string;
    blockers: string[];
    candidates: RecoveryCandidate[];
    explanation: string;
    advice?: RecoveryAdvice;
};
type ReadState = {
    runId: string;
    kind: 'loading';
} | {
    runId: string;
    kind: 'error';
    message: string;
} | {
    runId: string;
    kind: 'ready';
    value: RecoveryReadiness;
};
export function RunRecoveryReadinessView({ readiness, busy, onRetryCheckpoint, onRefresh }: {
    readiness?: RecoveryReadiness;
    busy: boolean;
    onRetryCheckpoint?: (caseId: string, stepIndex: number, adviceRecordId?: string) => void;
    onRefresh?: () => void;
}) {
    if (!readiness)
        return <div className="doc-notice">正在读取恢复就绪情况…</div>;
    if (readiness.status !== 'ready' && readiness.status !== 'blocked')
        return <div className="doc-notice">恢复就绪状态未知，无法恢复。{readiness.explanation}</div>;
    return <section className="doc-checkpoint-retry" aria-label="恢复就绪检查">
    <p><strong>恢复就绪检查：{readiness.status === 'ready' ? '可恢复' : '暂不可恢复'}</strong></p>
    {onRefresh && <button className="button-secondary" disabled={busy} onClick={onRefresh}>刷新恢复条件与建议</button>}
    <p>{readiness.explanation}</p>
    {readiness.advice && <RecoveryAdviceView advice={readiness.advice}/>}
    {readiness.blockers.length > 0 && <ul>{readiness.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>}
    {readiness.status === 'ready' && readiness.candidates.map(candidate => <div key={`${candidate.caseId}-${candidate.stepIndex}`}>
      <p>用例 {candidate.caseId} · 检查点步骤 {candidate.stepIndex + 1}</p>
      <small>恢复语义：重建只读前置，并从当前用例起点重新验证（{candidate.orderedCaseIds.join(' → ')}）。</small>
      {onRetryCheckpoint && <button className="button-secondary" disabled={busy} onClick={() => onRetryCheckpoint(candidate.caseId, candidate.stepIndex, adviceForCandidate(readiness, candidate))}>{adviceForCandidate(readiness, candidate) ? '按调查建议重建并留档' : '重建当前用例并恢复'}</button>}
    </div>)}
    {readiness.status === 'ready' && readiness.candidates.length === 0 && <p>当前没有可执行的恢复候选。</p>}
  </section>;
}
function adviceForCandidate(readiness: RecoveryReadiness, candidate: RecoveryCandidate): string | undefined {
    const advice = readiness.advice;
    return readiness.status === 'ready' && advice?.state === 'available' && advice.provisional === true
        && advice.recommendations.some(item => item.caseId === candidate.caseId && item.category === 'environment' && item.strategy === 'rebuild-readonly-case')
        ? advice.recordId : undefined;
}
function RecoveryAdviceView({ advice }: {
    advice: RecoveryAdvice;
}) {
    if (advice.state !== 'available' || advice.provisional !== true)
        return <p>调查建议暂不可用：{advice.reason ?? '尚无可核验的调查记录。'} 恢复条件仍单独核对。</p>;
    const categories = { product: '产品问题', test: '测试问题', environment: '环境问题', unknown: '原因不明' };
    return <section className="doc-recovery-advice" aria-label="待验证恢复建议">
    <p><strong>调查关联建议（待验证）</strong></p>
    <p>建议依据已保存的调查事实，仍需人工判断和触发恢复。</p>
    {advice.recommendations.map((item, index) => <article key={`${item.caseId}-${index}`}>
      <p><strong>用例 {item.caseId} · {categories[item.category] ?? '原因不明'}</strong></p>
      <p>{item.summary}</p>
      <p>建议动作：{item.strategy === 'rebuild-readonly-case' ? '核查环境后，可人工重建只读前置与当前用例。' : '先人工复核原因与证据。'}</p>
      <details><summary>查看同用例事实引用</summary><ul>{item.evidence.map((ref, refIndex) => <li key={`${ref.factId}-${refIndex}`}><span>{ref.factId}：</span><q>{ref.quote}</q></li>)}</ul></details>
    </article>)}
    <details><summary>查看调查记录标识</summary><p>记录：{advice.recordId}</p><p>事实摘要：{advice.runDigest}</p></details>
  </section>;
}
export function RunRecoveryReadinessStateView({ state, busy, onRetryCheckpoint, onRefresh }: {
    state: ReadState;
    busy: boolean;
    onRetryCheckpoint?: (caseId: string, stepIndex: number, adviceRecordId?: string) => void;
    onRefresh?: () => void;
}) {
    return <div className="doc-recovery-readiness">
    {state.kind === 'loading' ? <div className="doc-notice">正在读取恢复就绪情况…</div>
            : state.kind === 'error' ? <div className="doc-notice">读取恢复就绪情况失败：{state.message} {onRefresh && <button className="button-secondary" onClick={onRefresh}>重新读取</button>}</div>
                : <RunRecoveryReadinessView readiness={state.value} busy={busy} onRetryCheckpoint={onRetryCheckpoint} onRefresh={onRefresh}/>}
  </div>;
}
export function RunRecoveryReadiness({ runId, overall, busy, onRetryCheckpoint }: {
    runId: string;
    overall: string;
    busy: boolean;
    onRetryCheckpoint?: (caseId: string, stepIndex: number, adviceRecordId?: string) => void;
}) {
    const [state, setState] = useState<ReadState>({ runId, kind: 'loading' });
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (overall === 'passed')
            return;
        const controller = new AbortController();
        setState({ runId, kind: 'loading' });
        fetch(`/api/document-runs/${encodeURIComponent(runId)}/recovery-readiness`, { signal: controller.signal })
            .then(async (response) => {
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return response.json() as Promise<RecoveryReadiness>;
        })
            .then(value => {
            if (!controller.signal.aborted && value.parentRunId === runId)
                setState({ runId, kind: 'ready', value });
            else if (!controller.signal.aborted)
                setState({ runId, kind: 'error', message: '响应运行标识不匹配。' });
        })
            .catch(error => {
            if (!controller.signal.aborted)
                setState({ runId, kind: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return () => controller.abort();
    }, [runId, overall, refresh]);
    if (overall === 'passed')
        return null;
    const current = state.runId === runId ? state : { runId, kind: 'loading' as const };
    return React.createElement(RunRecoveryReadinessStateView, { state: current, busy, onRetryCheckpoint, onRefresh: () => setRefresh(value => value + 1) });
}
