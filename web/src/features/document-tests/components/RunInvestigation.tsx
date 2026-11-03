import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HttpRequestError, request } from '../api/client';
import type { Step } from '../types';

export type InvestigationRecord = {
  id: string; runId: string; projectId: string; runDigest: string; createdAt: string; provisional: true;
  coverage: 'complete' | 'partial'; facts: Array<{ factId: string; caseId: string; kind: string; text: string }>;
  hypotheses: Array<{ caseId: string; category: 'product' | 'test' | 'environment' | 'unknown'; summary: string; evidence: Array<{ factId: string; quote: string }>; nextAction: string }>;
};
export type StepRevisionProposal = {
  id: string; projectId: string; runId: string; investigationId: string; runDigest: string; caseId: string;
  expected: string; currentStepsDigest: string; currentSteps: Step[]; proposedSteps: Step[];
  evidence: Array<{ factId: string; quote: string }>; changeSummary: string; impactSummary: string;
  status: 'pending-review' | 'accepted' | 'rejected' | 'stale'; createdAt: string; reviewedAt?: string;
};
type ImageAnalysis = { id: string; runId: string; projectId: string; evidenceId: string; imageSha256: string; status: 'complete' | 'blocked'; observations: string[]; uncertainty: string; provisional: true };
type ScreenshotEvidence = { evidenceId: string; type: 'screenshot' | 'unavailable'; reason: string; sha256?: string; caseId: string; stepIndex?: number };
export function stepRevisionStatusLabel(status: StepRevisionProposal['status']): string {
  return ({ 'pending-review': '待审核', accepted: '已采纳 · 待复验', rejected: '已拒绝', stale: '已过期 · 需重新生成' })[status];
}
export function ProtectedProposalExpected({ expected }: { expected: string }) {
  return <p><strong>受保护的原验收预期：</strong>{expected}</p>;
}
type Snapshot = { runId: string; record?: InvestigationRecord; state: 'loading' | 'investigating' | 'absent' | 'ready' | 'error'; error?: string; action?: 'read' | 'investigate' };
type InvestigationResponse = InvestigationRecord | { state: 'running' };
const categoryLabels = { product: '产品', test: '测试', environment: '环境', unknown: '未知' } as const;

export function RunInvestigationView({ record, overall, pendingCaseIds, busyCaseId, onPropose }: {
  record: InvestigationRecord; overall?: string; pendingCaseIds?: string[]; busyCaseId?: string; onPropose?: (caseId: string) => void;
}) {
  const facts = new Map(record.facts.map(fact => [fact.factId, fact]));
  return <section className="doc-analysis" aria-label="待验证调查假设">
    <h3>待验证调查假设</h3>
    <p>{record.provisional ? '这是基于本轮已留存证据生成的初步判断，尚待验证；不会修改原运行结果或自动重跑。' : '调查结果'}</p>
    <p>用例调查覆盖：{record.coverage === 'complete' ? '完整' : '部分'} · 可用事实 {record.facts.length} 条 · {new Date(record.createdAt).toLocaleString()}</p>
    {record.coverage === 'partial' && <p className="doc-notice">部分用例未形成有效原因假设，已标记为未知。</p>}
    {record.facts.some(fact => fact.kind === 'evidence-metadata') && <p className="doc-notice">调查仅使用截图元数据，未读取图片内容。</p>}
    {record.facts.some(fact => fact.kind === 'evidence-metadata' && fact.text.includes('Evidence unavailable')) && <p className="doc-notice">有截图证据不可用；假设仅依据可用的已存事实。</p>}
    {record.hypotheses.length ? record.hypotheses.map((hypothesis, index) => <article className="doc-comparison" key={`${hypothesis.caseId}-${index}`}>
      <strong>{categoryLabels[hypothesis.category] ?? categoryLabels.unknown} · {hypothesis.caseId}</strong>
      <p>{hypothesis.summary}</p>
      {hypothesis.evidence.length ? <ul>{hypothesis.evidence.map((citation, citationIndex) => {
        const fact = facts.get(citation.factId);
        const groundedQuote = fact?.caseId === hypothesis.caseId && fact.text.includes(citation.quote);
        return <li key={`${citation.factId}-${citationIndex}`}>{groundedQuote ? `证据（${fact.kind} · ${fact.caseId}）：${citation.quote}` : '引用的事实或原文不可用，已隐藏该引用。'}</li>;
      })}</ul> : <p className="doc-notice">该假设没有可展示的事实引用。</p>}
      <p><strong>建议核查：</strong>{hypothesis.nextAction}</p>
      {onPropose && overall !== 'passed' && overall !== undefined && ['failed', 'partial'].includes(overall) && hypothesis.category !== 'unknown' && hypothesis.evidence.length > 0 &&
        <button className="button-secondary" disabled={!!busyCaseId || pendingCaseIds?.includes(hypothesis.caseId)} onClick={() => onPropose(hypothesis.caseId)}>
          {busyCaseId === hypothesis.caseId ? '正在生成步骤提案…' : pendingCaseIds?.includes(hypothesis.caseId) ? '已有待审核提案' : '生成受控步骤修订提案'}
        </button>}
    </article>) : <p className="doc-notice">没有形成可展示的调查假设。</p>}
  </section>;
}

export function StepRevisionProposalList({ runId, overall, record, onProjectChanged }: {
  runId: string; overall: string; record: InvestigationRecord; onProjectChanged?: () => void;
}) {
  const [proposals, setProposals] = useState<StepRevisionProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCaseId, setBusyCaseId] = useState('');
  const [busyProposalId, setBusyProposalId] = useState('');
  const endpoint = `/api/document-runs/${encodeURIComponent(runId)}/step-revision-proposals`;

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { setProposals(await request<StepRevisionProposal[]>(endpoint)); }
    catch (cause) { setError((cause as Error).message || '读取步骤修订提案失败。'); }
    finally { setLoading(false); }
  }, [endpoint]);

  useEffect(() => { void reload(); }, [reload, record.id]);

  async function create(caseId: string) {
    if (!['failed', 'partial'].includes(overall) || !record.provisional || busyCaseId) return;
    setBusyCaseId(caseId); setError('');
    try {
      const proposal = await request<StepRevisionProposal>(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId }) });
      setProposals(current => [proposal, ...current.filter(item => item.id !== proposal.id)]);
    } catch (cause) { setError((cause as Error).message || '生成步骤修订提案失败。'); }
    finally { setBusyCaseId(''); }
  }

  async function review(proposal: StepRevisionProposal, decision: 'accept' | 'reject') {
    if (proposal.status !== 'pending-review' || busyProposalId) return;
    if (decision === 'accept' && !window.confirm(`采纳 ${proposal.caseId} 的步骤修订提案？这会保留旧版本并将用例转为待审核、退出回归选择，不会自动运行。`)) return;
    setBusyProposalId(proposal.id); setError('');
    try {
      const result = await request<{ proposal: StepRevisionProposal; project?: unknown }>(`${endpoint}/${encodeURIComponent(proposal.id)}/review`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      setProposals(current => current.map(item => item.id === proposal.id ? result.proposal : item));
      if (decision === 'accept') onProjectChanged?.();
    } catch (cause) { const message = (cause as Error).message || '审核步骤修订提案失败。'; await reload(); setError(message); }
    finally { setBusyProposalId(''); }
  }

  if (overall === 'passed') return null;
  return <>
    <RunInvestigationView record={record} overall={overall} pendingCaseIds={proposals.filter(item => item.status === 'pending-review').map(item => item.caseId)} busyCaseId={busyCaseId} onPropose={create} />
    <section className="doc-analysis" aria-label="步骤修订提案">
      <h3>步骤修订提案</h3>
      <p>提案只针对原用例步骤，不修改预期或运行结论；采纳后会保留历史版本并转为待审核。复验需另行启动，结果作为新运行保存。</p>
      {error && <p className="doc-notice error" role="alert">{error}</p>}
      {loading ? <p role="status">正在读取步骤修订提案…</p> : proposals.length === 0 ? <p className="doc-notice">尚无步骤修订提案。</p> : proposals.map(proposal => <article className="doc-comparison" key={proposal.id}>
      <strong>{proposal.caseId} · {stepRevisionStatusLabel(proposal.status)}</strong>
      <p><strong>拟修改：</strong>{proposal.changeSummary}</p>
      <p><strong>影响说明：</strong>{proposal.impactSummary}</p>
      <ProtectedProposalExpected expected={proposal.expected} />
      <ul>{proposal.evidence.map((item, index) => <li key={`${item.factId}-${index}`}>依据 {item.factId}：{item.quote}</li>)}</ul>
      <div className="doc-revision-diff">
        <div><strong>当前步骤（提案基线）</strong><pre>{JSON.stringify(proposal.currentSteps, null, 2)}</pre></div>
        <div><strong>拟议步骤</strong><pre>{JSON.stringify(proposal.proposedSteps, null, 2)}</pre></div>
      </div>
      {proposal.status === 'pending-review' && <div className="doc-buttons">
        <button className="button-primary" disabled={!!busyProposalId} onClick={() => void review(proposal, 'accept')}>{busyProposalId === proposal.id ? '正在审核…' : '审核并采纳'}</button>
        <button className="button-secondary" disabled={!!busyProposalId} onClick={() => void review(proposal, 'reject')}>拒绝提案</button>
      </div>}
      {proposal.status === 'accepted' && <p className="doc-notice">已采纳为待审核脚本；请先复核，再用独立新运行验证。</p>}
      {proposal.status === 'stale' && <p className="doc-notice">项目步骤或调查依据已变化；此提案不可采纳，请基于最新运行重新生成。</p>}
      </article>)}
      {!loading && <button className="text-button" disabled={loading} onClick={() => void reload()}>刷新提案状态</button>}
    </section>
  </>;
}

export function RunInvestigationStateView({ state, overall, error, action, onRead, onInvestigate }: {
  state: Snapshot['state']; overall: string; error?: string; action?: Snapshot['action'];
  onRead: () => void; onInvestigate: () => void;
}) {
  return <React.Fragment>
    {state === 'loading' && <p role="status">{action === 'investigate' ? '正在生成调查假设…' : '正在读取调查记录…'}</p>}
    {state === 'investigating' && <p role="status">Agent 正在依据已保存证据调查</p>}
    {state === 'absent' && <><p>尚无调查记录。调查只会整理本轮已保存的证据，不会更改结果或自动重跑。</p>{overall !== 'passed' && <button className="button-secondary" onClick={onInvestigate}>生成待验证调查假设</button>}</>}
    {state === 'error' && <div role="alert"><p>{action === 'read' ? '读取调查记录失败' : '调查请求失败'}：{error}</p>{action === 'read' ? <button className="button-secondary" onClick={onRead}>重试读取</button> : overall !== 'passed' && <button className="button-secondary" onClick={onInvestigate}>重新发起调查</button>}</div>}
  </React.Fragment>;
}

export function RunInvestigation({ runId, overall, evidence = [], onProjectChanged }: { runId: string; overall: string; evidence?: ScreenshotEvidence[]; onProjectChanged?: () => void }) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>({ runId, state: 'loading' });
  const sequence = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endpoint = `/api/document-runs/${encodeURIComponent(runId)}/investigation`;

  const stopPoll = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  const read = useCallback(async (action: 'initial' | 'retry' = 'initial') => {
    stopPoll();
    const current = ++sequence.current;
    setSnapshot({ runId, state: 'loading', action: action === 'retry' ? 'read' : undefined });
    const poll = async () => {
      try {
        const value = await request<InvestigationResponse>(endpoint);
        if (sequence.current !== current) return;
        if ('state' in value && value.state === 'running') {
          setSnapshot({ runId, state: 'investigating', action: 'read' });
          pollTimer.current = setTimeout(() => void poll(), 1500);
        } else if ('id' in value) setSnapshot({ runId, state: 'ready', record: value });
        else setSnapshot({ runId, state: 'error', error: '调查状态响应格式无法识别。', action: 'read' });
      } catch (cause) {
        if (sequence.current !== current) return;
        if (cause instanceof HttpRequestError && cause.status === 404) setSnapshot({ runId, state: 'absent' });
        else setSnapshot({ runId, state: 'error', error: (cause as Error).message || '读取调查记录失败。', action: 'read' });
      }
    };
    await poll();
  }, [endpoint, runId, stopPoll]);

  useEffect(() => { void read(); return () => { stopPoll(); sequence.current++; }; }, [read, revision, stopPoll]);

  async function investigate() {
    if (overall === 'passed' || snapshot.state === 'loading' || snapshot.action === 'investigate') return;
    stopPoll();
    const current = ++sequence.current;
    setSnapshot({ runId, state: 'loading', action: 'investigate' });
    try {
      const record = await request<InvestigationRecord>(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (sequence.current === current) setSnapshot({ runId, state: 'ready', record });
    } catch (cause) {
      if (sequence.current === current) setSnapshot({ runId, state: 'error', error: (cause as Error).message || '调查请求失败。', action: 'investigate' });
    }
  }

  const current = snapshot.runId === runId ? snapshot : { runId, state: 'loading' as const };
  return <section className="doc-analysis" aria-label="运行调查">
    <h3>运行调查</h3>
    <RunInvestigationStateView state={current.state} overall={overall} error={current.error} action={current.action} onRead={() => setRevision(value => value + 1)} onInvestigate={() => void investigate()} />
    {current.record && <StepRevisionProposalList key={`${runId}:${current.record.id}`} runId={runId} overall={overall} record={current.record} onProjectChanged={onProjectChanged} />}
    {current.record && <a className="button-secondary" href={`${endpoint}/report`} download>下载调查报告（Markdown）</a>}
    <ScreenshotImageAnalysis runId={runId} evidence={evidence.filter(item => item.type === 'screenshot')} />
  </section>;
}

function ScreenshotImageAnalysis({ runId, evidence }: { runId: string; evidence: ScreenshotEvidence[] }) {
  const [results, setResults] = useState<Record<string, ImageAnalysis>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const endpoint = (id: string) => `/api/document-runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(id)}/image-analysis`;
  useEffect(() => {
    let active = true;
    for (const item of evidence) void request<ImageAnalysis>(endpoint(item.evidenceId)).then(result => {
      if (active) setResults(current => ({ ...current, [item.evidenceId]: result }));
    }).catch(() => {});
    return () => { active = false; };
  // GET reads persisted analysis only; it never sends image bytes to a model.
  }, [runId, evidence.map(item => item.evidenceId).join('|')]);
  async function analyze(item: ScreenshotEvidence) {
    if (results[item.evidenceId]?.status === 'complete') {
      try { const result = await request<ImageAnalysis>(endpoint(item.evidenceId)); setResults(current => ({ ...current, [item.evidenceId]: result })); }
      catch (cause) { setError((cause as Error).message || '读取已保存分析失败。'); }
      return;
    }
    const isRetry = results[item.evidenceId]?.status === 'blocked';
    if (!window.confirm(`${isRetry ? '重试会再次发送' : '此操作会发送'}所选已保存截图的图像字节给当前配置的视觉模型进行只读观察。结果仅为待验证的视觉观察，不会修改用例、预期或脚本，也不会启动测试。${isRetry ? '继续重试？' : '继续发送？'}`)) return;
    setBusy(item.evidenceId); setError('');
    try {
      const result = await request<ImageAnalysis>(endpoint(item.evidenceId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      setResults(current => ({ ...current, [item.evidenceId]: result }));
    } catch (cause) { setError((cause as Error).message || '图片分析失败或被阻断。'); }
    finally { setBusy(''); }
  }
  if (!evidence.length) return null;
  return <div className="doc-image-analysis"><h4>截图像素分析（可选）</h4><p>默认不发送截图。仅点击下方操作并确认后，所选截图才会发送至当前配置的视觉模型。</p>
    {evidence.map(item => <div key={item.evidenceId} className="doc-image-analysis-item"><div>用例 {item.caseId} · {item.reason} · SHA-256 {item.sha256?.slice(0, 12) ?? '缺失'}</div>
      <button className="button-secondary" disabled={!!busy} onClick={() => void analyze(item)}>{busy === item.evidenceId ? '分析中…' : results[item.evidenceId]?.status === 'complete' ? '读取已保存的分析' : results[item.evidenceId]?.status === 'blocked' ? '重试分析（会再次发送截图）' : '发送所选截图并分析'}</button>
      {results[item.evidenceId] && <div className="doc-image-analysis-result"><strong>{results[item.evidenceId]!.status === 'complete' ? '待验证视觉观察' : '视觉分析受阻'}</strong>{results[item.evidenceId]!.observations.map((text, index) => <p key={index}>{text}</p>)}<p>不确定性：{results[item.evidenceId]!.uncertainty}</p><small>截图摘要 {results[item.evidenceId]!.imageSha256} · 本结果不代表用例通过或失败。</small></div>}
    </div>)}{error && <p className="doc-notice">{error}</p>}
  </div>;
}
