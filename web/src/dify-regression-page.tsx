import { useEffect, useState } from 'react';
import './dify-regression.css';
import type { RegressionBaseline, RegressionVersion, RegressionRun } from '../../src/domain/dify-regression-contracts';

type State = { baselines: RegressionBaseline[]; versions: RegressionVersion[]; tasks: Array<{ id: string; createdAt: string; status: string; error?: string; difyRunId?: string; versionId?: string }>; reviews: Array<{ id: string; versionId: string; decision: string; reviewer: string; notes: string }>; runs: RegressionRun[]; configured: boolean; workflowUrl: string };
const names: Record<string, string> = { running: '正在整理', completed: '整理完成 · 待审核', error: '整理失败', approved: '已批准', rejected: '已退回', draft: '待审核', not_executed: '未执行', passed: '通过', failed: '失败', blocked: '阻塞' };
async function api<T>(action = '', data?: unknown): Promise<T> {
  const response = await fetch(`/api/dify-regression${action ? '/' + action : ''}`, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? '操作失败'); return result;
}
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export default function DifyRegressionPage({embedded=false}:{embedded?:boolean}={}) {
  const [state, setState] = useState<State | null>(null);
  const [baselineId, setBaselineId] = useState(''); const [selected, setSelected] = useState<string[]>([]);
  const [versionId, setVersionId] = useState(''); const [runId, setRunId] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState(''); const [reviewer, setReviewer] = useState(''); const [notes, setNotes] = useState('');
  const [systemVersion, setSystemVersion] = useState(''); const [databaseLabel, setDatabaseLabel] = useState('测试库 supply（快照待确认）');
  const baseline = state?.baselines.find(b => b.id === baselineId) ?? state?.baselines[0];
  const version = state?.versions.find(v => v.id === versionId) ?? state?.versions[0];
  const review = state?.reviews.find(r => r.versionId === version?.id);
  const run = state?.runs.find(r => r.id === runId) ?? state?.runs[0];
  const visibleSources = baseline?.cases.filter(c => c.source_path.join(' / ').includes(filter)) ?? [];
  const generateDisabledReason = !state ? '正在读取本地配置…' : busy ? '正在保存，请稍候。' : !state.configured ? '本地服务未加载 Dify 密钥。请配置 .env 并重启服务。' : !selected.length ? '请先勾选下方要整理的条目，按钮就会启用。' : '';
  const reviewDisabledReason = !reviewer.trim() || !notes.trim() ? '填写审核人和审核意见后，可以批准或退回此版本。' : '';
  const runDisabledReason = !version ? '请先完成至少一批用例整理。' : !reviewer.trim() || !systemVersion.trim() || !databaseLabel.trim() ? '请填写测试人、被测系统版本和数据库标识。' : '';
  async function refresh() { setState(await api<State>()); }
  useEffect(() => { void refresh().catch(e => setError(e.message)); const timer = window.setInterval(() => { void refresh().catch(e => setError(e.message)); }, 2500); return () => window.clearInterval(timer); }, []);
  async function action(work: () => Promise<unknown>, message: string) { setBusy(true); setError(''); setNotice(''); try { await work(); await refresh(); setNotice(message); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function upload(file: File) {
    if (file.size > 4 * 1024 * 1024) throw new Error('请选择不超过 4 MB 的 XMind 或来源 JSON。');
    let value: RegressionBaseline;
    if (/\.xmind$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      value = await api('xmind', { name: file.name, bytesBase64: btoa(binary) });
    } else { const input = JSON.parse(await file.text()); value = await api('import', { ...input, name: input.name ?? file.name }); }
    setBaselineId(value.id); setSelected([]);
  }
  const exportRecords = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `回归记录-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="dify-page">
    <div className="dify-heading"><div>{embedded?<h2>整理用例</h2>:<h1>Dify 回归工作台</h1>}<p>按旧版 XMind 整理用例，人工审核后记录每轮回归。</p></div><button onClick={exportRecords} disabled={!state}>导出全部记录</button></div>
    {error && <div className="dify-alert error" role="alert">{error}</div>}
    {notice && <div className="dify-alert" role="status">{notice}</div>}
    <div className="dify-summary"><span>Dify {state?.configured ? '密钥已配置' : '未配置 API Key'}</span><span>{state?.versions.length ?? 0} 个用例版本</span><span>{state?.runs.length ?? 0} 轮人工回归</span>{state?.workflowUrl && <a href={state.workflowUrl} target="_blank" rel="noreferrer">打开 Dify 工作流 ↗</a>}</div>
    <section className="dify-card"><div className="dify-section-heading"><h2>1. 选择原有条目</h2><label className="dify-upload">导入 XMind / 来源 JSON<input aria-label="导入 XMind 或来源 JSON" type="file" accept=".xmind,.json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void action(() => upload(file), '基线已保存，请选择本轮要整理的条目。'); e.target.value = ''; }}/></label></div>
      <p>叶子条目需核对是否属于本期回归；原文勾叉不代表本次结果。每批最多整理 12 条。</p>
      {baseline ? <><label>来源基线<select value={baseline.id} onChange={e => { setBaselineId(e.target.value); setSelected([]); }}>{state?.baselines.map(b => <option key={b.id} value={b.id}>{b.name} · {b.cases.length} 条来源</option>)}</select></label><small className="dify-hash">SHA256 {baseline.baseline_sha256}</small><input aria-label="筛选来源条目" placeholder="按模块、路径或预期筛选…" value={filter} onChange={e => setFilter(e.target.value)}/><div className="dify-actions"><button disabled={busy || !visibleSources.length} onClick={() => setSelected(visibleSources.slice(0,12).map(c => c.case_id))}>选中筛选结果（最多 12 条）</button><button disabled={busy || !selected.length} onClick={() => setSelected([])}>清空勾选</button><small>筛选出 {visibleSources.length} 条 · 已选 {selected.length} 条</small></div><div className="dify-source-list">{visibleSources.map(c => <label className="dify-source" key={c.case_id}><input type="checkbox" checked={selected.includes(c.case_id)} disabled={busy || (!selected.includes(c.case_id) && selected.length >= 12)} onChange={e => setSelected(ids => e.target.checked ? [...ids, c.case_id] : ids.filter(id => id !== c.case_id))}/><span><small>{c.source_path.slice(1,-1).join(' / ')}</small><strong>{c.source_expected_verbatim}</strong></span></label>)}</div><p id="dify-generate-reason" className="dify-action-hint" role="status">{generateDisabledReason || '已选好，可以开始整理；这不会执行被测系统。'}</p><button className="dify-primary" aria-describedby="dify-generate-reason" title={generateDisabledReason || '发起整理任务'} disabled={!!generateDisabledReason} onClick={() => void action(() => api('generate', { baselineId: baseline.id, sourceIds: selected, requestId: crypto.randomUUID() }), '整理任务已保存。完成后会出现待审核版本。')}>用 Dify 整理选中 {selected.length} 条</button></> : <p className="dify-empty">尚无基线。请导入你们第一版人工用例的 XMind 文件。</p>}
    </section>
    <section className="dify-card"><h2>2. 审核整理后的版本</h2><p>这里展示的是提议步骤。请核对原文、账号权限和数据准备，再批准本轮使用。</p>
      {version ? <><label>用例版本<select value={version.id} onChange={e => setVersionId(e.target.value)}>{state?.versions.map((v, i, all) => <option key={v.id} value={v.id}>版本 {all.length-i} · {date(v.createdAt)} · {v.cases.length} 条</option>)}</select></label><div className="dify-meta">{names[review?.decision ?? 'draft']} · 内容指纹 {version.digest.slice(0,16)} · 全部未执行</div>{version.cases.map(c => <details key={c.case_id} className="dify-case"><summary>{c.title}<span>未执行</span></summary><small>{c.source_path.join(' / ')}</small><h3>原文预期</h3><p>{c.expected_result}</p><h3>准备条件（提议）</h3><ul>{c.preconditions_proposed.map((s,i) => <li key={i}>{s}</li>)}</ul><h3>操作步骤（提议）</h3><ol>{c.steps_proposed.map((s,i) => <li key={i}>{s}</li>)}</ol><h3>待确认</h3><ul>{c.needs_confirmation.map((s,i) => <li key={i}>{s}</li>)}</ul></details>)}<div className="dify-form"><label>审核人 / 测试人<input value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="填写自己的姓名或代号"/></label><label>审核意见<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="记录范围、步骤和数据准备的核对结论" rows={2}/></label></div><p className="dify-action-hint">{reviewDisabledReason}</p><div className="dify-actions"><button className="dify-primary" disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void action(() => api('review', {versionId:version.id,decision:'approved',reviewer,notes}), '人工审核记录已保存。')}>批准此版本</button><button disabled={busy || !reviewer.trim() || !notes.trim()} onClick={() => void action(() => api('review', {versionId:version.id,decision:'rejected',reviewer,notes}), '退回意见已保存。')}>退回待修改</button></div>{review && <p>{review.reviewer}：{review.notes}</p>}</> : <p className="dify-empty">Dify 整理完成后，在这里查看用例原文和提议步骤。</p>}
    </section>
    <section className="dify-card"><h2>3. 保存每轮人工回归</h2><p>此按钮创建记录，不会操作被测系统。版本、审核记录和测试环境会固定在本轮中。</p><div className="dify-form"><label>被测系统版本<input value={systemVersion} onChange={e => setSystemVersion(e.target.value)} placeholder="例如：2026-10-28 测试环境发布版"/></label><label>数据库 / 数据快照标识<input value={databaseLabel} onChange={e => setDatabaseLabel(e.target.value)}/></label></div><p className="dify-action-hint">{runDisabledReason}</p><button title={runDisabledReason || '创建未执行的回归记录'} disabled={busy || !!runDisabledReason} onClick={() => void action(async () => { const next = await api<RegressionRun>('runs', {versionId:version!.id,systemVersion,databaseLabel,tester:reviewer}); setRunId(next.id); }, '本轮记录已保存，所有用例初始为未执行。')}>新建一轮回归记录</button>
      {run && <><label>历史回归<select value={run.id} onChange={e => setRunId(e.target.value)}>{state?.runs.map(r => <option key={r.id} value={r.id}>{date(r.createdAt)} · {r.systemVersion} · {r.tester}</option>)}</select></label><p>{run.databaseLabel} · {run.reviewId ? '已绑定批准版本' : '未绑定批准版本，只可记阻塞或未执行'}</p>{run.results.map(result => <ResultEditor key={`${run.id}-${result.caseId}`} result={result} busy={busy} approved={!!run.reviewId} save={(status,actual,evidence) => action(() => api('result', {runId:run.id,caseId:result.caseId,status,actual,evidence}), '实际结果已保存，变更日志已留档。')}/>)}</>}
    </section>
    <section className="dify-card"><h2>整理任务记录</h2>{!state?.tasks.length ? <p className="dify-empty">尚未发起整理。</p> : state.tasks.map(t => <div className="dify-task" key={t.id}><strong>{names[t.status] ?? t.status}</strong><span>{date(t.createdAt)}</span><small>{t.error ?? `任务 ${t.id}${t.difyRunId ? ' · Dify ' + t.difyRunId : ''}`}</small></div>)}</section>
  </div>;
}
function ResultEditor({ result, busy, approved, save }: { result: RegressionRun['results'][number]; busy: boolean; approved: boolean; save: (status: string, actual: string, evidence: string) => Promise<void> }) {
  const [status,setStatus] = useState(result.status); const [actual,setActual] = useState(result.actual); const [evidence,setEvidence] = useState(result.evidence);
  return <details className="dify-case"><summary>{result.title}<span>{names[result.status]}</span></summary><label>实际状态<select value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="not_executed">未执行</option><option value="blocked">阻塞</option><option value="passed" disabled={!approved}>通过</option><option value="failed" disabled={!approved}>失败</option></select></label><label>实际结果 / 阻塞原因<textarea value={actual} onChange={e => setActual(e.target.value)} rows={2}/></label><label>证据位置 / 操作记录<textarea value={evidence} onChange={e => setEvidence(e.target.value)} rows={2} placeholder="例如截图文件路径、缺陷链接和实际操作记录"/></label><button disabled={busy} onClick={() => void save(status,actual,evidence)}>保存此条结果</button></details>;
}
