import { useEffect, useRef, useState } from 'react';

type ApiSuiteCase = { id: string; title: string; source?: string; requirementRefs?: string[]; priority?: string; concurrency?: number; accessControl?: unknown; request: { method: string; path: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number }; expect: { status: number; headers?: Record<string, string>; json?: unknown; maxDurationMs?: number } };
type ScenarioCoverage = { eligibleOperationKeys: string[]; coveredOperationKeys: string[]; uncoveredOperationKeys: string[]; checks?: Array<{ operationKey: string; requirementId: string; label: string; status: 'covered' | 'missing'; caseIds: string[] }>; manualReviewOperationKeys?: string[] };
type ApiSuite = { version: 1; name: string; description?: string; baseUrl?: string; cases: ApiSuiteCase[]; principals?: Record<string, unknown>; fixtures?: { setup: ApiSuiteCase[]; cleanup: ApiSuiteCase[] }; openApiCoverage?: { operationKeys: string[]; coveredOperationKeys: string[]; uncoveredOperationKeys: string[]; scenarios?: { success: ScenarioCoverage; error: ScenarioCoverage; authorization: ScenarioCoverage; boundary: ScenarioCoverage } } };
type Candidate = { id: string; status: 'draft' | 'approved' | 'rejected'; revision: number; digest: string; createdAt: string; reviewedAt?: string; reviewerNotes?: string; suite: ApiSuite };
type ApiResult = { caseId: string; title: string; status: 'passed' | 'failed' | 'blocked' | 'error'; durationMs: number; assertion?: { expected?: string; actual?: string }; designTrace?: { source?: string; requirementRefs?: string[]; priority?: string }; error?: string; evidence: Array<{ kind: string; content: string; capturedAt?: string }> };
type ApiDesignCheck = { category: 'success' | 'error' | 'authorization' | 'boundary' | 'manual-review'; operationKey: string; requirementId?: string; label: string; caseId?: string; expectedResponse: string; observedStatuses: number[]; resultStatus?: string; status: 'confirmed' | 'mismatch' | 'no-response' | 'partial-response' | 'not-run' | 'not-authored' | 'manual-review' };
type ApiFinding = { findingId: string; kind: 'assertion' | 'design-gap' | 'manual-review'; state: 'open' | 'resolved'; category?: ApiDesignCheck['category']; caseId?: string; operationKey?: string; requirementId?: string; title: string; summary: string; occurrences: number; firstSeenAt: string; lastSeenAt: string; lastRunId: string; resolvedAt?: string; resolvedByRunId?: string; history: Array<{ runId: string; at: string; state: 'open' | 'resolved'; summary: string }> };
type FindingHistory = { suiteId: string; updatedAt: string; findings: ApiFinding[] };
type FindingDiagnosis = { findingId: string; state: 'open' | 'resolved'; source: 'deterministic-evidence'; classification: 'resolved' | 'assertion-failure' | 'suite-design-gap' | 'manual-review' | 'blocked-or-stale'; summary: string; evidence: { runId: string; runStatus?: string; caseId?: string; caseStatus?: string; observedStatuses: number[]; suiteDigest: string }; recommendation: { action: 'none' | 'rerun-case' | 'author-or-review-case' | 'human-review'; summary: string; canRun: boolean; caseId?: string; parentRunId?: string } };
type RunRecord = { runId: string; status: string; completedAt: string; durationMs: number; results: ApiResult[]; apiDesignAssessment?: { checks: ApiDesignCheck[] }; apiRerun?: { parentRunId: string; caseIds: string[] }; apiFindingUpdates?: Array<{ findingId: string; state: 'open' | 'resolved'; kind: string; title: string; occurrences: number }>; limitations: string[]; scope: string[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) { let message = `${response.status} ${response.statusText}`; try { message = (await response.json()).error ?? message; } catch { /* retain status */ } throw new Error(message); }
  return response.json() as Promise<T>;
}

function ApiCaseCard({ item, index, stage }: { item: ApiSuiteCase; index: number; stage: string }) {
  const requestDetails = { headers: item.request.headers, body: item.request.body, timeoutMs: item.request.timeoutMs, concurrency: item.concurrency, roleMatrix: item.accessControl, expectedHeaders: item.expect.headers, maximumDurationMs: item.expect.maxDurationMs };
  return <article className="api-case-card" key={item.id}>
    <div className="api-case-title"><span>{String(index + 1).padStart(2, '0')}</span>{stage && <small className="api-stage-tag">{stage}</small>}<strong>{item.title}</strong><small>{item.priority ?? 'P2'}</small></div>
    <div className="api-case-request"><code>{item.request.method}</code><code>{item.request.path}</code><span>预期 HTTP {item.expect.status}</span></div>
    {(item.source || item.requirementRefs?.length) && <p className="api-case-source">{item.requirementRefs?.length ? <>需求：{item.requirementRefs.join('、')}　</> : null}{item.source ? <>来源：{item.source}</> : null}</p>}
    {(item.expect.json !== undefined || Object.values(requestDetails).some(value => value !== undefined)) && <details><summary>请求数据、身份矩阵和断言详情</summary><pre>{JSON.stringify({ ...(item.expect.json !== undefined ? { expectedJson: item.expect.json } : {}), ...Object.fromEntries(Object.entries(requestDetails).filter(([, value]) => value !== undefined)) }, null, 2)}</pre></details>}
  </article>;
}

function ApiCoverageSummary({ coverage }: { coverage: NonNullable<ApiSuite['openApiCoverage']> }) {
  const scenarios = coverage.scenarios;
  return <div className="api-suite-description">
    <p>OpenAPI 操作追溯：{coverage.coveredOperationKeys.length}/{coverage.operationKeys.length} · 表示存在对应来源用例，不等同于业务语义全覆盖</p>
    {scenarios && <>
      <p>场景证据：成功 {scenarios.success.coveredOperationKeys.length}/{scenarios.success.eligibleOperationKeys.length} · 错误响应 {scenarios.error.coveredOperationKeys.length}/{scenarios.error.eligibleOperationKeys.length} · 鉴权拒绝 {scenarios.authorization.coveredOperationKeys.length}/{scenarios.authorization.eligibleOperationKeys.length} · 输入边界 {scenarios.boundary.coveredOperationKeys.length}/{scenarios.boundary.eligibleOperationKeys.length}</p>
      <details><summary>查看场景缺口与边界核对项</summary><ul>
        {(['success', 'error', 'authorization'] as const).map(name => <li key={name}>{name === 'success' ? '成功响应' : name === 'error' ? '错误响应' : '鉴权拒绝'}：{scenarios[name].uncoveredOperationKeys.length ? scenarios[name].uncoveredOperationKeys.join('；') : '无缺口'}</li>)}
        <li>边界值：{scenarios.boundary.checks?.length ? <ul>{scenarios.boundary.checks.map(check => <li key={check.requirementId}>{check.status === 'covered' ? '已命中' : '缺用例'} · {check.operationKey} · {check.label}{check.caseIds.length ? ` · ${check.caseIds.join('、')}` : ''}</li>)}</ul> : '没有可自动核验的枚举值或数值上下界。'}</li>
        {!!scenarios.boundary.manualReviewOperationKeys?.length && <li>需人工核对复杂约束（正则、组合 schema、复杂数组序列化等）：{scenarios.boundary.manualReviewOperationKeys.join('；')}</li>}
      </ul></details>
    </>}
    {coverage.uncoveredOperationKeys.length > 0 && <details><summary>未被用例引用的操作</summary><pre>{coverage.uncoveredOperationKeys.join('\n')}</pre></details>}
  </div>;
}

const apiStatusText: Record<ApiResult['status'], string> = { passed: '通过', failed: '失败', blocked: '阻止', error: '错误' };

function ApiResultCard({ item }: { item: ApiResult }) {
  const expected = item.assertion?.expected;
  const actual = item.assertion?.actual ?? item.error ?? '没有 HTTP 响应';
  const trace = item.designTrace;
  return <article className={`api-result ${item.status}`}>
    <span>{apiStatusText[item.status]}</span>
    <div className="api-result-main">
      <strong>{item.title}</strong>
      {(trace?.requirementRefs?.length || trace?.source || trace?.priority) && <small className="api-result-trace">{trace.requirementRefs?.length ? `需求 ${trace.requirementRefs.join('、')}` : ''}{trace?.source ? `${trace.requirementRefs?.length ? ' · ' : ''}来源 ${trace.source}` : ''}{trace?.priority ? ` · ${trace.priority}` : ''}</small>}
      <div className="api-result-comparison"><div><small>预期</small><code>{expected ?? '未记录'}</code></div><div><small>实际</small><code>{actual}</code></div></div>
      {item.error && <p className="api-result-error">{item.error}</p>}
      {item.evidence.length > 0 && <details className="api-result-evidence"><summary>查看请求与响应证据（{item.evidence.length}）</summary>{item.evidence.map((evidence, index) => <section key={`${evidence.kind}-${index}`}><small>{evidence.kind}{evidence.capturedAt ? ` · ${evidence.capturedAt}` : ''}</small><pre>{evidence.content}</pre></section>)}</details>}
    </div>
    <small className="api-result-duration">{Math.round(item.durationMs)} ms</small>
  </article>;
}

const assessmentStatusText: Record<ApiDesignCheck['status'], string> = { confirmed: '响应类别符合', mismatch: '响应类别不符', 'no-response': '没有响应', 'partial-response': '仅部分请求有响应', 'not-run': '本次未执行', 'not-authored': '尚无用例', 'manual-review': '需人工核对' };
const assessmentCategoryText: Record<ApiDesignCheck['category'], string> = { success: '成功响应', error: '错误响应', authorization: '鉴权拒绝', boundary: '输入边界', 'manual-review': '边界复核' };

function ApiDesignAssessment({ checks }: { checks: ApiDesignCheck[] }) {
  const importantCount = checks.filter(check => check.status === 'mismatch' || check.status === 'no-response' || check.status === 'partial-response' || check.status === 'not-authored').length;
  const confirmedCount = checks.filter(check => check.status === 'confirmed').length;
  return <details className={`api-design-assessment ${importantCount ? 'has-gaps' : ''}`}>
    <summary><strong>设计目标与实际响应</strong><span>{confirmedCount} 项状态类别符合</span>{importantCount > 0 && <em>{importantCount} 项需关注</em>}</summary>
    <p>这里只核对 HTTP 响应类别；用例整体通过/失败还会校验 JSON、响应头和耗时。</p>
    <div className="api-design-checks">{checks.map((check, index) => <article className={`api-design-check ${check.status}`} key={`${check.category}-${check.requirementId ?? check.operationKey}-${check.caseId ?? index}`}>
      <div><strong>{assessmentCategoryText[check.category]}</strong><small>{check.operationKey}{check.requirementId ? ` · ${check.requirementId}` : ''}{check.caseId ? ` · ${check.caseId}` : ''}</small><small>{check.label}</small></div>
      <div><small>预期 {check.expectedResponse}</small><small>实际 {check.observedStatuses.length ? [...new Set(check.observedStatuses)].map(code => `HTTP ${code}`).join('、') : '—'}</small></div>
      <b>{assessmentStatusText[check.status]}{check.resultStatus ? ` · 用例 ${apiStatusText[check.resultStatus as ApiResult['status']] ?? check.resultStatus}` : ''}</b>
    </article>)}</div>
  </details>;
}

function ApiDifferenceDiagnosis({ run, onRerun, busy }: { run: RunRecord; onRerun: (caseIds: string[]) => void; busy: boolean }) {
  const failedCases = run.results.filter(item => item.status === 'failed' || item.status === 'error');
  const caseIds = [...new Set(failedCases.map(item => item.caseId).filter(id => id !== '__runner__'))];
  if (!failedCases.length) return <section className="api-diagnosis"><h4>差异诊断</h4><p>本轮没有失败或运行错误的 case，无需定向重测。</p></section>;
  return <section className="api-diagnosis">
    <header><div><h4>差异诊断</h4><p>依据实际状态码、断言结果和运行错误整理；不会自动修改用例。</p></div>{caseIds.length > 0 && <button className="button-secondary" disabled={busy} onClick={() => onRerun(caseIds)}>{busy ? '正在重测…' : `仅重测 ${caseIds.length} 条失败/错误用例`}</button>}</header>
    <div className="api-diagnosis-list">{failedCases.map((item, index) => {
      const checks = run.apiDesignAssessment?.checks.filter(check => check.caseId === item.caseId && ['mismatch', 'no-response', 'partial-response'].includes(check.status)) ?? [];
      const detail = checks.length ? checks.map(check => `${check.operationKey} · 预期 ${check.expectedResponse}，实际 ${check.observedStatuses.length ? check.observedStatuses.map(status => `HTTP ${status}`).join('、') : '无 HTTP 响应'} (${assessmentStatusText[check.status]})`).join('；') : item.error ?? `完整断言未通过。预期：${item.assertion?.expected ?? '—'}；实际：${item.assertion?.actual ?? '—'}`;
      return <article key={`${item.caseId}-${index}`}><strong>{item.title}</strong><small>{detail}</small>{item.error && <small>运行错误：{item.error}</small>}</article>;
    })}</div>
    {caseIds.length > 0 && <p>定向重测会使用同一个已审核套件版本，只发送上述用例；如果套件声明了 setup/cleanup，仍会按原流程执行。外网、写请求和并发门禁保持生效。</p>}
  </section>;
}

function ApiRerunComparison({ previousRun, run }: { previousRun: RunRecord | null; run: RunRecord }) {
  if (!run.apiRerun || !previousRun || previousRun.runId !== run.apiRerun.parentRunId) return null;
  return <section className="api-rerun-comparison"><h4>定向重测前后对照</h4><p>父运行 {previousRun.runId} → 本次运行 {run.runId}</p>{run.apiRerun.caseIds.map(caseId => {
    const before = previousRun.results.find(item => item.caseId === caseId);
    const after = run.results.find(item => item.caseId === caseId);
    if (!before || !after) return <article key={caseId}><strong>{caseId}</strong><span>运行记录缺少对应结果，不能判定是否修复。</span></article>;
    const beforeActual = before.assertion?.actual ?? before.error ?? '无响应';
    const afterActual = after.assertion?.actual ?? after.error ?? '无响应';
    const resolved = ['passed'].includes(after.status) && before.status !== 'passed';
    return <article key={caseId}><strong>{after.title}</strong><span>{apiStatusText[before.status]} → {apiStatusText[after.status]}{resolved ? ' · 此次重测通过' : after.status === 'passed' ? '' : ' · 问题仍存在'}</span><small>实际结果：{beforeActual} → {afterActual}</small></article>;
  })}</section>;
}

function ApiFindingDiagnosisCard({ suiteId, item, busy, onRerun }: { suiteId: string; item: ApiFinding; busy: boolean; onRerun: (caseId: string, parentRunId: string) => void }) {
  const [diagnosis, setDiagnosis] = useState<FindingDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inspect = async () => {
    setLoading(true); setError('');
    try { setDiagnosis(await api<FindingDiagnosis>(`/api/api-suites/${suiteId}/findings/${item.findingId}/diagnosis`)); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  return <div className="api-finding-diagnosis">
    {!diagnosis && <button className="text-button" disabled={loading} onClick={() => void inspect()}>{loading ? '正在核对关联运行…' : '查看证据诊断建议'}</button>}
    {error && <small className="api-finding-diagnosis-error">诊断读取失败：{error}</small>}
    {diagnosis && <div><strong>证据诊断 · {diagnosis.classification === 'assertion-failure' ? '断言失败' : diagnosis.classification === 'suite-design-gap' ? '用例设计缺口' : diagnosis.classification === 'manual-review' ? '需要人工核对' : diagnosis.classification === 'resolved' ? '已解决' : '证据不足'}</strong><p>{diagnosis.summary}</p><p>{diagnosis.recommendation.summary}</p><small>来源：运行 {diagnosis.evidence.runId}{diagnosis.evidence.caseStatus ? ` · case ${diagnosis.evidence.caseStatus}` : ''}{diagnosis.evidence.observedStatuses.length ? ` · HTTP ${diagnosis.evidence.observedStatuses.join(', ')}` : ''} · 基于确定性证据规则生成，未调用模型或修改用例。</small>{diagnosis.recommendation.canRun && diagnosis.recommendation.caseId && diagnosis.recommendation.parentRunId && <button className="button-secondary" disabled={busy} onClick={() => onRerun(diagnosis.recommendation.caseId!, diagnosis.recommendation.parentRunId!)}>{busy ? '正在重测…' : '仅重测此失败用例'}</button>}</div>}
  </div>;
}

function ApiFindingHistoryPanel({ history, suiteId, busy, onRerun }: { history: FindingHistory | null; suiteId: string; busy: boolean; onRerun: (caseId: string, parentRunId: string) => void }) {
  if (!history) return null;
  const open = history.findings.filter(item => item.state === 'open');
  const resolved = history.findings.filter(item => item.state === 'resolved');
  const kindName = (item: ApiFinding) => item.kind === 'design-gap' ? '用例缺口' : item.kind === 'manual-review' ? '人工复核' : '运行问题';
  return <details className={`api-finding-history ${open.length ? 'has-open' : ''}`} open={open.length > 0}>
    <summary><strong>跨运行问题历史</strong><span>{open.length} 项待处理</span><span>{resolved.length} 项已解决</span></summary>
    {open.length ? <div className="api-finding-list">{open.map(item => <article key={item.findingId}><header><strong>{item.title}</strong><em>{kindName(item)}</em></header><p>{item.summary}</p><small>{item.caseId ? `用例 ${item.caseId} · ` : ''}出现 {item.occurrences} 次 · 首次 {new Date(item.firstSeenAt).toLocaleString('zh-CN')} · 最近运行 {item.lastRunId}</small><details><summary>查看本问题的运行轨迹（{item.history.length}）</summary>{item.history.map((entry, index) => <p key={`${entry.runId}-${index}`}>{entry.state === 'open' ? '记录' : '解决'} · {new Date(entry.at).toLocaleString('zh-CN')} · {entry.runId} · {entry.summary}</p>)}</details><ApiFindingDiagnosisCard suiteId={suiteId} item={item} busy={busy} onRerun={onRerun} /></article>)}</div> : <p className="api-finding-empty">当前没有未解决的问题记录。</p>}
    {resolved.length > 0 && <details className="api-resolved-findings"><summary>已解决问题（{resolved.length}）</summary>{resolved.map(item => <article key={item.findingId}><strong>{item.title}</strong><small>{item.occurrences} 次出现 · {item.resolvedAt ? `解决于 ${new Date(item.resolvedAt).toLocaleString('zh-CN')}` : ''}</small></article>)}</details>}
    <small className="api-finding-updated">历史更新时间：{new Date(history.updatedAt).toLocaleString('zh-CN')}</small>
  </details>;
}

export default function ApiTestsPage({ suiteId, autoRun, allowNetwork }: { suiteId: string; autoRun: boolean; allowNetwork: boolean }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [previousRun, setPreviousRun] = useState<RunRecord | null>(null);
  const [findingHistory, setFindingHistory] = useState<FindingHistory | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [suiteJson, setSuiteJson] = useState('');
  const [editing, setEditing] = useState(false);
  const [allowMutations, setAllowMutations] = useState(false);
  const [allowConcurrency, setAllowConcurrency] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const autoRequested = useRef(false);

  useEffect(() => { let live = true; Promise.all([api<Candidate>(`/api/api-suites/${suiteId}`), api<FindingHistory>(`/api/api-suites/${suiteId}/findings`)]).then(([value, history]) => { if (live) { setCandidate(value); setSuiteJson(JSON.stringify(value.suite, null, 2)); setFindingHistory(history); } }).catch(error => { if (live) setNotice({ kind: 'error', text: (error as Error).message }); }); return () => { live = false; }; }, [suiteId]);

  useEffect(() => {
    if (!autoRun || !candidate || candidate.status !== 'draft' || autoRequested.current) return;
    autoRequested.current = true; setBusy(true); setNotice({ kind: 'info', text: '检查只读范围与目标权限，正在尝试自动运行…' });
    api<{ candidate: Candidate; run: RunRecord }>(`/api/api-suites/${suiteId}/auto-run`, { method: 'POST', body: JSON.stringify({ allowNetwork }) })
      .then(value => { setCandidate(value.candidate); setSuiteJson(JSON.stringify(value.candidate.suite, null, 2)); setRun(value.run); setNotice({ kind: 'info', text: '只读 API 测试已自动审核并运行。' }); void api<FindingHistory>(`/api/api-suites/${suiteId}/findings`).then(setFindingHistory).catch(() => setNotice({ kind: 'error', text: '自动测试已完成，但跨运行问题历史刷新失败。' })); })
      .catch(error => setNotice({ kind: 'info', text: `自动运行门禁：${(error as Error).message} 请检查套件后决定是否审核运行。` }))
      .finally(() => setBusy(false));
  }, [autoRun, allowNetwork, candidate, suiteId]);

  const review = async (decision: 'approve' | 'reject') => {
    setBusy(true); setNotice(null);
    try { const value = await api<Candidate>(`/api/api-suites/${suiteId}/review`, { method: 'POST', body: JSON.stringify({ decision, notes: reviewNotes }) }); setCandidate(value); setNotice({ kind: 'info', text: decision === 'approve' ? '套件已审核通过。' : '套件已拒绝；如需修改请重新生成候选。' }); }
    catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
    finally { setBusy(false); }
  };

  const saveRevision = async () => {
    setBusy(true); setNotice(null);
    try {
      const suite = JSON.parse(suiteJson);
      const value = await api<Candidate>(`/api/api-suites/${suiteId}/update`, { method: 'POST', body: JSON.stringify({ suite }) });
      setCandidate(value); setSuiteJson(JSON.stringify(value.suite, null, 2)); setEditing(false);
      setNotice({ kind: 'info', text: `修订 v${value.revision} 已保存；请重新检查并审核。` });
    } catch (error) { setNotice({ kind: 'error', text: `修订无效或无法保存：${(error as Error).message}` }); }
    finally { setBusy(false); }
  };

  const execute = async (selection?: { caseIds: string[]; rerunOf: string }) => {
    setBusy(true); setNotice(null);
    try { const parentRun = selection ? (run?.runId === selection.rerunOf ? run : await api<RunRecord>(`/api/api-runs/${selection.rerunOf}`)) : null; setPreviousRun(parentRun); const value = await api<RunRecord>(`/api/api-suites/${suiteId}/run`, { method: 'POST', body: JSON.stringify({ allowNetwork, allowMutations, allowConcurrency, ...(selection ? { caseIds: selection.caseIds, rerunOf: selection.rerunOf } : {}) }) }); setRun(value); setNotice({ kind: 'info', text: selection ? `已完成定向重测：${value.status}` : `运行结束：${value.status}` }); void api<FindingHistory>(`/api/api-suites/${suiteId}/findings`).then(setFindingHistory).catch(() => setNotice({ kind: 'error', text: '本轮测试已完成，但跨运行问题历史刷新失败。' })); }
    catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
    finally { setBusy(false); }
  };

  if (!candidate) return <section className="api-session"><p>{notice?.text ?? '读取 API 套件…'}</p></section>;
  const allCases = [...(candidate.suite.fixtures?.setup ?? []), ...candidate.suite.cases, ...(candidate.suite.fixtures?.cleanup ?? [])];
  const writeCount = allCases.filter(item => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(item.request.method)).length;
  const concurrentCount = allCases.filter(item => (item.concurrency ?? 1) > 1).length;
  const counts = run ? Object.fromEntries(['passed', 'failed', 'blocked', 'error'].map(status => [status, run.results.filter(item => item.status === status).length])) : null;

  return <section className="api-session">
    {notice && <div className={`api-session-notice ${notice.kind}`} role="status">{notice.text}</div>}
    <header className="api-suite-head"><div><span className={`api-suite-status ${candidate.status}`}>{candidate.status === 'draft' ? `待审核 · v${candidate.revision}` : candidate.status === 'approved' ? `已审核 · v${candidate.revision}` : `已拒绝 · v${candidate.revision}`}</span><h2>{candidate.suite.name}</h2><p>{candidate.suite.baseUrl} · {candidate.suite.cases.length} 条测试 · SHA-256 {candidate.digest.slice(0, 16)}…</p>{candidate.suite.openApiCoverage && <ApiCoverageSummary coverage={candidate.suite.openApiCoverage} />}{candidate.suite.description && <p className="api-suite-description">{candidate.suite.description}</p>}</div><div className="api-downloads">{run && <><a href={`/api/api-runs/${run.runId}/report`} download>下载报告</a><a href={`/api/api-runs/${run.runId}/package`} download>下载可复用 ZIP</a></>}</div></header>
    {candidate.suite.principals && <details className="api-principals"><summary>身份与凭证引用</summary><pre>{JSON.stringify(candidate.suite.principals, null, 2)}</pre></details>}
    <ApiFindingHistoryPanel history={findingHistory} suiteId={suiteId} busy={busy} onRerun={(caseId, parentRunId) => void execute({ caseIds: [caseId], rerunOf: parentRunId })} />
    <div className="api-safety-summary"><span>{writeCount ? `${writeCount} 条写请求` : '无写请求'}</span><span>{candidate.suite.principals ? `${Object.keys(candidate.suite.principals).length} 个身份` : '无角色矩阵'}</span><span>{concurrentCount ? `${concurrentCount} 条并发用例` : '无并发请求'}</span><span>{candidate.suite.fixtures ? '含 setup/cleanup' : '无数据 fixture'}</span></div>
    <div className="api-cases-list">{[...(candidate.suite.fixtures?.setup ?? []).map(item => ({ item, stage: '前置数据 setup' })), ...candidate.suite.cases.map(item => ({ item, stage: '' })), ...(candidate.suite.fixtures?.cleanup ?? []).map(item => ({ item, stage: '清理 cleanup' }))].map(({ item, stage }, index) => <ApiCaseCard key={`${stage}-${item.id}`} item={item} index={index} stage={stage} />)}</div>
    {candidate.status === 'draft' && <div className="api-suite-editor"><button className="text-button" onClick={() => setEditing(value => !value)}>{editing ? '收起 JSON 编辑器' : '修订测试用例 JSON'}</button>{editing && <><p>保存修订会递增版本并重新计算摘要；必须重新审核后才能运行。</p><textarea aria-label="API suite JSON editor" value={suiteJson} onChange={event => setSuiteJson(event.target.value)} rows={14} spellCheck={false}/><div className="api-review-actions"><button className="button-secondary" disabled={busy} onClick={() => { setSuiteJson(JSON.stringify(candidate.suite, null, 2)); setEditing(false); }}>取消</button><button className="button-primary" disabled={busy} onClick={() => void saveRevision()}>{busy ? '正在保存…' : '保存修订并重新审核'}</button></div></>}</div>}
    {candidate.status === 'draft' && <div className="api-review-panel"><label>审核备注（可选）<textarea value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} placeholder="确认目标环境、接口范围和预期；指出需要修订的内容。" rows={2}/></label><div className="api-review-actions"><button className="button-secondary" disabled={busy} onClick={() => void review('reject')}>拒绝候选</button><button className="button-primary" disabled={busy} onClick={() => void review('approve')}>{busy ? '处理中…' : '审核通过'}</button></div></div>}
    {candidate.status === 'approved' && !run && <div className="api-review-panel"><p>审核版本已锁定。外网访问：{allowNetwork ? '已允许' : '未允许'}；写请求和并发仍默认关闭。</p>{writeCount > 0 && <label className="api-run-option"><input type="checkbox" checked={allowMutations} onChange={event => setAllowMutations(event.target.checked)}/> 允许隔离测试环境中的写请求（套件包含 run-id cleanup）</label>}{concurrentCount > 0 && <label className="api-run-option"><input type="checkbox" checked={allowConcurrency} onChange={event => setAllowConcurrency(event.target.checked)}/> 允许并发请求批次</label>}<button className="button-primary" disabled={busy} onClick={() => void execute()}>{busy ? '正在运行…' : '运行已审核 API 套件'}</button></div>}
    {run && <div className="api-run-panel"><header><div><h3>运行结果 · {apiStatusText[run.status as ApiResult['status']] ?? run.status}</h3><p>{new Date(run.completedAt).toLocaleString('zh-CN')} · {Math.round(run.durationMs)} ms · {run.runId}{run.apiRerun && ` · 定向重测自 ${run.apiRerun.parentRunId}`}</p></div><div className="api-run-counts">{Object.entries(counts ?? {}).map(([status, value]) => <span key={status}>{apiStatusText[status as ApiResult['status']] ?? status} <b>{value}</b></span>)}</div></header>{run.apiDesignAssessment && <ApiDesignAssessment checks={run.apiDesignAssessment.checks} />}<ApiDifferenceDiagnosis run={run} busy={busy} onRerun={caseIds => void execute({ caseIds, rerunOf: run.runId })} /><ApiRerunComparison previousRun={previousRun} run={run} /><div className="api-results-list">{run.results.map((item, index) => <ApiResultCard key={`${item.caseId}-${index}`} item={item} />)}</div>{run.limitations.map(item => <p className="api-run-limit" key={item}>{item}</p>)}</div>}
  </section>;
}
