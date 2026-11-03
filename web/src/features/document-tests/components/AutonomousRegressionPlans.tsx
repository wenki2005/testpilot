import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, SiteVersion } from '../types';
import { HttpRequestError, request } from '../api/client';

type Decision = { caseId: string; reason: string; evidence: Array<{ source: string; quote: string }> };
type Plan = {
  id: string; projectId: string; siteVersionId: string; createdAt: string; targetUrlSnapshot: string;
  blockers: string[]; validation: 'current' | 'stale'; executionReadiness: 'ready' | 'blocked';
  plan: {
    selectedCaseIds: string[]; prerequisiteCaseIds: string[]; orderedCaseIds: string[]; decisions: Decision[]; execution: 'not-started';
    outcome?: 'selected' | 'no-relevant-cases' | 'needs-clarification'; assessmentReason?: string;
    assessmentEvidence?: Array<{ source: 'change-notes'; quote: string }>;
  };
};
type Execution = { planId: string; projectId: string; runId?: string; state: 'pending' | 'submitted' | 'uncertain' | 'completed' | 'failed'; overall?: string; verifiedRun?: { id?: string; overall?: string } };
type Lookup = 'loading' | 'absent' | 'present' | 'unknown';
type Props = { project: Project; version?: SiteVersion };
export function canStartAutonomousPlan(plan: Plan | null, execution: Execution | null, busy: boolean, lookup: Lookup = 'loading') {
  return !!plan && (plan.plan?.outcome === undefined || plan.plan.outcome === 'selected') && plan.validation === 'current' && plan.executionReadiness === 'ready' && !execution && !busy && lookup === 'absent';
}
export function canAutoStartCreatedPlan(plan: Plan | null, confirmationRequired = false) {
  return !confirmationRequired && !!plan && plan.validation === 'current' && plan.executionReadiness === 'ready'
    && (plan.plan?.outcome === undefined || plan.plan.outcome === 'selected')
    && plan.plan.orderedCaseIds.length > 0;
}
const isNotFound = (error: unknown) => error instanceof HttpRequestError && error.status === 404;

export function AutonomousRegressionPlans({ project, version }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [execution, setExecution] = useState<Execution | null>(null);
  const [executionLookup, setExecutionLookup] = useState<Lookup>('loading');
  const [executionBusy, setExecutionBusy] = useState(false);
  const [autoStartPlanId, setAutoStartPlanId] = useState('');
  const autoStartAttempts = useRef(new Set<string>());
  const executionGeneration = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detailGeneration = useRef(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const generation = useRef(0);
  const endpoint = `/api/document-projects/${encodeURIComponent(project.id)}/autonomous-regression-plans`;

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const rows = await request<Plan[]>(endpoint);
      if (generation.current !== current) return;
      setPlans(rows); setSelectedId(id => rows.some(row => row.id === id) ? id : rows[0]?.id ?? ''); setDetailRevision(value => value + 1);
    } catch (cause) { if (generation.current === current) setError((cause as Error).message || '读取自主回归计划失败。'); }
    finally { if (generation.current === current) setLoading(false); }
  }, [endpoint]);

  useEffect(() => { setDetail(null); setExecution(null); executionGeneration.current++; void refresh(); return () => { generation.current++; executionGeneration.current++; }; }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const current = ++detailGeneration.current;
    setDetail(null);
    request<Plan>(`${endpoint}/${encodeURIComponent(selectedId)}`).then(item => {
      if (detailGeneration.current === current) setDetail(item);
    }).catch(cause => { if (detailGeneration.current === current) setError((cause as Error).message || '读取计划明细失败。'); });
    return () => { detailGeneration.current++; };
  }, [endpoint, selectedId, detailRevision]);

  const executionEndpoint = selectedId ? `${endpoint}/${encodeURIComponent(selectedId)}/execution` : '';
  const readExecution = useCallback(async (id: string, sequence: number) => {
    const record = await request<Execution>(`${endpoint}/${encodeURIComponent(id)}/execution`);
    if (executionGeneration.current === sequence) { setExecution(record); setExecutionLookup('present'); }
    return record;
  }, [endpoint]);
  const stopPoll = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  }, []);
  const schedulePoll = useCallback((id: string, sequence: number) => {
    stopPoll();
    const poll = async () => {
      if (executionGeneration.current !== sequence) return;
      try {
        const record = await readExecution(id, sequence);
        if (executionGeneration.current === sequence && (record.state === 'pending' || record.state === 'submitted')) {
          pollTimer.current = setTimeout(() => void poll(), 1500);
        }
      } catch (cause) {
        if (executionGeneration.current !== sequence) return;
        setExecutionLookup(isNotFound(cause) ? 'absent' : 'unknown');
        setError(isNotFound(cause) ? '' : `读取执行状态失败：${(cause as Error).message}。请显式核查状态；不会重新提交。`);
      }
    };
    pollTimer.current = setTimeout(() => void poll(), 1500);
  }, [readExecution, stopPoll]);
  useEffect(() => {
    stopPoll();
    const sequence = ++executionGeneration.current;
    setExecution(null); setExecutionBusy(false); setExecutionLookup('loading');
    if (!selectedId) return;
    const initialRead = async () => {
      try {
        const record = await readExecution(selectedId, sequence);
        if (executionGeneration.current === sequence && (record.state === 'pending' || record.state === 'submitted')) schedulePoll(selectedId, sequence);
      } catch (cause) {
        if (executionGeneration.current !== sequence) return;
        setExecutionLookup(isNotFound(cause) ? 'absent' : 'unknown');
        if (!isNotFound(cause)) setError(`无法核查执行记录：${(cause as Error).message}。确认状态前不能重新启动。`);
      }
    };
    void initialRead();
    return () => { stopPoll(); executionGeneration.current++; };
  }, [selectedId, readExecution, schedulePoll, stopPoll]);

  async function startExecution(confirmBeforeStart = false) {
    if (project.confirmationRequired === true && !confirmBeforeStart) return;
    if (!canStartAutonomousPlan(detail, execution, executionBusy, executionLookup) || !selectedId) return;
    stopPoll();
    const sequence = ++executionGeneration.current;
    setExecutionBusy(true); setError('');
    try {
      await request<Execution>(executionEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmBeforeStart ? { confirmBeforeStart: true } : {}) });
    } catch (cause) {
      if (executionGeneration.current !== sequence) return;
      setError(`${(cause as Error).message || '启动请求结果未知。'} 正在核查提交状态；请勿重复启动。`);
    }
    if (executionGeneration.current !== sequence) return;
    try {
      const record = await readExecution(selectedId, sequence);
      if (executionGeneration.current !== sequence) return;
      if (record.state === 'pending' || record.state === 'submitted') schedulePoll(selectedId, sequence);
    } catch (cause) {
      if (executionGeneration.current === sequence) {
        setExecutionLookup(isNotFound(cause) ? 'absent' : 'unknown');
        setError(`启动请求后无法确认提交状态：${(cause as Error).message}。${isNotFound(cause) ? '服务端确认尚未提交，可由你再次启动。' : '提交状态待核查；确认前不能重新启动。'}`);
      }
    } finally { if (executionGeneration.current === sequence) setExecutionBusy(false); }
  }

  useEffect(() => {
    if (!autoStartPlanId || autoStartPlanId !== selectedId || detail?.id !== autoStartPlanId) return;
    if (!canAutoStartCreatedPlan(detail, project.confirmationRequired === true)) {
      setAutoStartPlanId('');
      return;
    }
    if (executionLookup === 'loading') return;
    if (executionLookup !== 'absent' || execution || executionBusy) {
      if (executionLookup === 'present' || executionLookup === 'unknown') setAutoStartPlanId('');
      return;
    }
    if (!canStartAutonomousPlan(detail, execution, executionBusy, executionLookup)) {
      setAutoStartPlanId('');
      return;
    }
    if (autoStartAttempts.current.has(autoStartPlanId)) {
      setAutoStartPlanId('');
      return;
    }
    autoStartAttempts.current.add(autoStartPlanId);
    setAutoStartPlanId('');
    void startExecution();
  }, [autoStartPlanId, selectedId, detail, execution, executionBusy, executionLookup, project.confirmationRequired]);

  async function checkExecution() {
    if (!selectedId || executionBusy) return;
    stopPoll();
    const sequence = ++executionGeneration.current;
    setExecutionBusy(true); setError('');
    try {
      const record = await readExecution(selectedId, sequence);
      if (record.state === 'pending' || record.state === 'submitted') schedulePoll(selectedId, sequence);
    }
    catch (cause) { if (executionGeneration.current === sequence) { setExecutionLookup(isNotFound(cause) ? 'absent' : 'unknown'); setError(isNotFound(cause) ? '' : `提交状态待核查：${(cause as Error).message}。不会自动重新启动。`); } }
    finally { if (executionGeneration.current === sequence) setExecutionBusy(false); }
  }

  async function controlRun(action: 'pause' | 'continue' | 'cancel') {
    if (!execution?.runId || !['pending', 'submitted'].includes(execution.state)) return;
    setError('');
    try {
      await request(`/api/document-runs/${encodeURIComponent(execution.runId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await checkExecution();
    } catch (cause) { setError(`运行控制未完成：${(cause as Error).message}`); }
  }

  async function createPlan() {
    if (!version || !version.changeNotes.trim() || creating) return;
    const current = ++generation.current;
    setCreating(true); setError(''); setDetail(null);
    try {
      const created = await request<Plan>(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteVersionId: version.id }) });
      if (generation.current !== current) return;
      const rows = await request<Plan[]>(endpoint);
      if (generation.current !== current) return;
      setPlans(rows); setSelectedId(created.id); setDetail(created);
      if (canAutoStartCreatedPlan(created, project.confirmationRequired === true)) {
        setAutoStartPlanId(created.id);
      } else {
        setAutoStartPlanId('');
      }
    } catch (cause) { if (generation.current === current) setError((cause as Error).message || '创建自主回归计划失败。'); }
    finally { if (generation.current === current) setCreating(false); }
  }

  const selectedVersion = project.siteVersions?.find(item => item.id === version?.id);
  return <React.Fragment><section className="doc-impact-card" aria-labelledby="autonomous-regression-heading">
    <div className="doc-section-head"><div><h2 id="autonomous-regression-heading">自主回归计划</h2><p>{project.confirmationRequired === true ? '根据版本变更说明自动选择历史回归范围；每次启动前由你确认本轮范围。' : '根据版本变更说明自动选择历史回归范围；新计划通过审核、只读和证据校验后会自动启动。'}</p></div><span className="table-status status-running">计划阶段</span></div>
    {!selectedVersion && <p className="doc-notice">先登记并选择一个网站版本，再创建自主回归计划。</p>}
    {selectedVersion && !selectedVersion.changeNotes.trim() && <p className="doc-notice">当前网站版本没有变更说明。补充变更说明后才能创建计划。</p>}
    <div className="doc-impact-actions"><button className="button-primary" disabled={!selectedVersion?.changeNotes.trim() || creating} onClick={() => void createPlan()}>{creating ? '正在生成计划…' : '创建自主回归计划'}</button><button className="button-secondary" disabled={loading || creating} onClick={() => void refresh()}>{loading ? '正在刷新…' : '刷新历史计划'}</button></div>
    {error && <div className="doc-notice" role="alert"><span>{error}</span> <button className="text-button" onClick={() => void refresh()}>重试</button></div>}
    {plans.length === 0 && !loading && !error && <p className="doc-notice">还没有自主回归计划。创建后，模型选择结果和依据会保存在这里。</p>}
    {plans.length > 0 && <label>历史计划<select aria-label="选择自主回归计划" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{plans.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {project.siteVersions?.find(v => v.id === item.siteVersionId)?.label ?? item.siteVersionId}</option>)}</select></label>}
    {detail && <div className="doc-impact-results">
      <div className="doc-impact-note"><strong>{project.siteVersions?.find(v => v.id === detail.siteVersionId)?.label ?? detail.siteVersionId} · {detail.validation === 'current' ? '当前有效' : '上下文已变化，计划过期'}</strong><span>目标网址：{detail.targetUrlSnapshot}</span><small>计划创建于 {new Date(detail.createdAt).toLocaleString()} · 冻结计划状态：{detail.plan.execution}</small></div>
      <PlanCaseDetails project={project} plan={detail.plan} />
      {autoStartPlanId === selectedId && <p className="doc-notice" role="status">计划已生成，正在核查提交状态；通过审核与只读安全校验后将自动启动。</p>}
      <p className="doc-notice">执行准备：{detail.executionReadiness === 'ready' ? '已满足执行条件' : '已阻塞'}</p>
      {detail.blockers.length > 0 && <ul className="doc-notice">{detail.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>}
      {autoStartPlanId !== selectedId && canStartAutonomousPlan(detail, execution, executionBusy, executionLookup) && <button className="button-primary" onClick={() => void startExecution(project.confirmationRequired === true)}>{project.confirmationRequired === true ? '确认本轮范围并启动回归' : '按此计划启动回归'}</button>}
      {execution && <ExecutionStatusView execution={execution} projectId={project.id} busy={executionBusy} onCheck={() => void checkExecution()} onControl={controlRun} />}
      {!execution && <><p className="doc-notice">{executionLookup === 'loading' ? '正在核查该计划是否已有执行记录…' : executionLookup === 'unknown' ? '提交状态待核查；查询成功前不会允许再次启动。' : '服务端确认该计划尚无执行记录。'}</p><button className="text-button" disabled={executionBusy} onClick={() => void checkExecution()}>{executionBusy ? '正在核查…' : '核查提交状态'}</button></>}
    </div>}
  </section></React.Fragment>;
}

export function PlanCaseDetails({ project, plan }: { project: Project; plan: Plan['plan'] }) {
  const outcome = plan.outcome ?? 'selected';
  return <>
    {outcome !== 'selected' && <div className="doc-impact-results" aria-label="规划结论">
      <strong>{outcome === 'no-relevant-cases' ? '未发现相关历史用例（规划判断，未执行测试）' : '信息不足，需要补充资料'}</strong>
      {plan.assessmentReason && <small>判断理由：{plan.assessmentReason}</small>}
      {plan.assessmentEvidence?.map((proof, index) => <small key={`assessment-${index}`}>依据（{proof.source}）：{proof.quote}</small>)}
    </div>}
    {!plan.orderedCaseIds.length ? <p className="doc-notice">{outcome === 'no-relevant-cases' ? '当前变更说明未匹配到可纳入本次回归的历史用例。' : outcome === 'needs-clarification' ? '补充变更范围或相关资料后，可以重新生成计划。' : '计划暂未纳入历史用例。'}</p> : <div className="doc-impact-suggestions"><strong>计划执行顺序（{plan.orderedCaseIds.length} 条，含前置）</strong>{plan.orderedCaseIds.map(id => {
    const item = plan.decisions.find(candidate => candidate.caseId === id);
    const testCase = project.cases.find(candidate => candidate.id === id);
    const prerequisite = plan.prerequisiteCaseIds.includes(id);
    return <div className="doc-impact-suggestion" key={id}><span><strong>{testCase?.title ?? id} · {id}{prerequisite ? ' · 前置用例' : ''}</strong>{item && <><small>影响推断（待人工复核）：{item.reason}</small>{item.evidence.map((proof, index) => <small key={`e${index}`}>依据（{proof.source}）：{proof.quote}</small>)}</>}{testCase?.preconditions?.map((pre, index) => <small key={`p${index}`}>前置条件：{pre}{testCase.preconditionsConfirmed ? '（已确认）' : '（未确认）'}</small>)}</span></div>;
  })}</div>}
  </>;
}

export function ExecutionStatusView({ execution, projectId, busy = false, onCheck = () => {}, onControl = () => {} }: { execution: Execution; projectId: string; busy?: boolean; onCheck?: () => void; onControl?: (action: 'pause' | 'continue' | 'cancel') => void }) {
  const runId = execution.runId ?? execution.verifiedRun?.id;
  return <div className="doc-impact-results" aria-live="polite">
    <strong>执行状态：{execution.state === 'uncertain' ? '提交状态待核查，不会自动重试' : execution.state === 'pending' ? '等待执行' : execution.state === 'submitted' ? '已提交，正在执行' : execution.state === 'completed' ? `已完成${execution.overall ?? execution.verifiedRun?.overall ? ` · ${execution.overall ?? execution.verifiedRun?.overall}` : ''}` : `执行失败${execution.overall ? ` · ${execution.overall}` : ''}`}</strong>
    <div className="doc-buttons"><button className="button-secondary" disabled={busy} onClick={onCheck}>核查提交状态</button>{['pending', 'submitted'].includes(execution.state) && <><button className="button-secondary" onClick={() => onControl('pause')}>暂停</button><button className="button-secondary" onClick={() => onControl('continue')}>继续</button><button className="button-secondary" onClick={() => onControl('cancel')}>取消</button></>}</div>
    {runId && <a className="button-secondary" href={`/?page=document-tests&documentProject=${encodeURIComponent(projectId)}&documentRun=${encodeURIComponent(runId)}`}>查看运行结果</a>}
  </div>;
}
