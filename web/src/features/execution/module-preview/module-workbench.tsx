import { useEffect, useRef, useState } from 'react';
import type { WebModuleJobView } from '../../../../../src/domain/regression/module-execution-contract';
import './module-workbench.css';
type Module = {
    id: string;
    name: string;
    fileName: string;
    targetUrl: string;
    caseCount: number;
    digest: string;
};
type Job = WebModuleJobView;
type State = {
    modules: Module[];
    jobs: Job[];
    configured: {
        prepare: boolean;
        execution: boolean;
    };
};
const names: Record<string, string> = { queued: '等待开始', preflight: '连接测试窗口', 'awaiting-login': '等待登录', preparing: 'AI 整理用例', dispatching: 'AI 派发测试', executing: '正在测试', reporting: 'Dify 汇总结果', completed: '本轮完成', blocked: '已阻塞', error: '流程未完成', cancelled: '已取消', interrupted: '服务已中断', passed: '通过', failed: '失败', not_executed: '未执行' };
const active = new Set(['queued', 'preflight', 'awaiting-login', 'preparing', 'dispatching', 'executing', 'reporting']);
async function api<T>(path = '', data?: unknown): Promise<T> {
    const response = await fetch(`/api/dify-web-modules${path}`, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const value = await response.json();
    if (!response.ok)
        throw new Error(value.error ?? '操作失败。');
    return value;
}
export default function DifyModuleWorkbench() {
    const [state, setState] = useState<State | null>(null);
    const [moduleId, setModuleId] = useState<string | null>(() => new URLSearchParams(location.search).get('module'));
    const [jobId, setJobId] = useState(() => new URLSearchParams(location.search).get('job') ?? '');
    const [job, setJob] = useState<Job | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [target, setTarget] = useState('https://cdn.yibentushu.com/test-sample-apply/index.html');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');
    const [detailId, setDetailId] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const lock = useRef(false);
    const module = state?.modules.find(m => m.id === moduleId);
    const running = !!job && active.has(job.phase);
    const rows = job?.results.filter(r => filter === 'all' || (filter === 'out_of_scope' ? r.outOfScope : r.status === filter && !r.outOfScope)) ?? [];
    async function refresh(isCurrent: () => boolean = () => true) {
        const next = await api<State>();
        if (!isCurrent())
            return;
        setState(next);
        const found = jobId ? next.jobs.find(j => j.id === jobId) : moduleId !== null ? next.jobs.find(j => j.moduleId === moduleId) : next.jobs[0];
        if (found) {
            const full = await api<Job>(`/jobs/${found.id}`);
            if (!isCurrent())
                return;
            setJob(full);
            if (moduleId === null)
                setModuleId(full.moduleId);
            if (!file) {
                const m = next.modules.find(m => m.id === full.moduleId);
                if (m)
                    setTarget(m.targetUrl);
            }
        }
        else
            setJob(null);
    }
    useEffect(() => {
        let alive = true;
        const poll = async () => {
            try {
                if (alive)
                    await refresh(() => alive);
            }
            catch (e) {
                if (alive)
                    setError((e as Error).message);
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), 2000);
        return () => { alive = false; clearInterval(timer); };
    }, [jobId, moduleId, !!file]);
    useEffect(() => {
        const url = new URL(location.href);
        url.searchParams.set('page', 'dify-regression');
        url.searchParams.delete('tab');
        if (moduleId)
            url.searchParams.set('module', moduleId);
        else
            url.searchParams.delete('module');
        if (jobId)
            url.searchParams.set('job', jobId);
        else
            url.searchParams.delete('job');
        history.replaceState(history.state, '', url);
    }, [jobId, moduleId]);
    async function perform(work: () => Promise<unknown>) {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        setError('');
        try {
            await work();
            setState(await api<State>());
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function start() {
        let key = moduleId;
        if (file) {
            const bytesBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = reject; reader.readAsDataURL(file); });
            const imported = await api<{
                id: string;
            }>('/import', { fileName: file.name, bytesBase64, targetUrl: target });
            key = imported.id;
            setModuleId(key);
            setFile(null);
        }
        if (!key)
            throw new Error('请先上传模块用例包。');
        const created = await api<Job>('/jobs', { moduleId: key, requestId: crypto.randomUUID() });
        setJob(created);
        setJobId(created.id);
        setSelected([]);
    }
    async function control(action: string, data: unknown = {}) {
        if (!job)
            return;
        const next = await api<Job>(`/jobs/${job.id}/${action}`, data);
        setJob(next);
        setJobId(next.id);
        setSelected([]);
    }
    const detail = job?.results.find(row => row.caseId === detailId);
    const counts = { passed: 0, failed: 0, blocked: 0, error: 0, not_executed: 0, outside: 0 };
    for (const r of job?.results ?? [])
        if (r.outOfScope)
            counts.outside++;
        else
            counts[r.status]++;
    return <div className="dm-workbench">
    <header className="dm-header"><h1>TestPilot 模块测试</h1>{!!state?.modules.length && <select aria-label="选择已保存模块" value={file ? '' : moduleId ?? ''} onChange={e => {
                const key = e.target.value;
                setModuleId(key);
                setJobId('');
                setFile(null);
                setSelected([]);
                const m = state.modules.find(m => m.id === key);
                if (m)
                    setTarget(m.targetUrl);
            }}><option value="">新建模块</option>{state.modules.map(m => <option key={m.id} value={m.id}>{m.name}（{m.caseCount} 条）</option>)}</select>}</header>
    {error && <div className="dm-error" role="alert">{error}<button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}
    <section className="dm-import" aria-label="模块测试设置">
      <label className="dm-file"><input type="file" accept=".csv,text/csv" aria-label="上传模块用例包" disabled={busy || running} onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }}/><span aria-hidden="true">＋</span><strong>{file?.name ?? module?.fileName ?? '上传模块包'}</strong></label>
      <label className="dm-target">被测系统网址<input type="url" value={target} readOnly={!file && !!module} onChange={e => setTarget(e.target.value)} placeholder="https://测试环境/"/></label>
      <button className="dm-primary" disabled={busy || running || (!file && !moduleId)} onClick={() => void perform(start)}>{busy ? '处理中…' : '开始测试'}</button>
    </section>
    {job ? <>
      {job.phase !== 'completed' && <section className="dm-progress" aria-live="polite"><div><strong>{names[job.phase]}</strong><span>{job.message}</span></div><div className="dm-progress-actions">{job.phase === 'awaiting-login' && <button className="dm-primary" disabled={busy} onClick={() => void perform(() => control('continue'))}>我已登录</button>}{running && <button disabled={busy} onClick={() => void perform(() => control('cancel'))}>取消</button>}{['error', 'blocked', 'interrupted'].includes(job.phase) && <button disabled={busy} onClick={() => void perform(() => control('retry'))}>{job.executionFinished ? '重试汇总' : '重试当前阶段'}</button>}</div>{running && <progress aria-label="测试进度" max={job.progress?.total ?? job.results.length} {...(job.progress ? { value: job.progress.completed } : {})}/>}</section>}
      <section className="dm-results"><div className="dm-result-heading"><h2>{job.moduleName}</h2><div className="dm-result-counts"><span className="dm-passed">{counts.passed} 通过</span><span className="dm-failed">{counts.failed} 失败</span><span>{counts.blocked} 阻塞</span><span>{counts.not_executed + counts.error} 未完成</span>{counts.outside > 0 && <span>{counts.outside} 范围外</span>}</div></div>
        <div className="dm-toolbar"><select aria-label="筛选用例结果" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部用例（{job.results.length}）</option><option value="failed">失败</option><option value="blocked">阻塞</option><option value="passed">通过</option><option value="not_executed">未执行</option><option value="out_of_scope">范围外</option></select><div>{selected.length > 0 && <button disabled={busy || running} onClick={() => void perform(() => control('retest', { selectedCaseIds: selected, requestId: crypto.randomUUID() }))}>重测选中 {selected.length} 条</button>}<button disabled={busy || running || !counts.failed} onClick={() => void perform(() => control('retest', { selectedCaseIds: job.results.filter(r => r.status === 'failed').map(r => r.caseId), requestId: crypto.randomUUID() }))}>重测失败项</button><a href={`/api/dify-web-modules/jobs/${job.id}/report`}>下载报告</a></div></div>
        <div className="dm-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="选择当前筛选的用例" checked={rows.length > 0 && rows.every(r => selected.includes(r.caseId))} onChange={e => setSelected(e.target.checked ? rows.map(r => r.caseId) : [])}/></th><th>用例</th><th>状态</th><th>证据</th></tr></thead><tbody>{rows.map(row => <tr key={row.caseId}><td><input type="checkbox" aria-label={`选择 ${row.title}`} checked={selected.includes(row.caseId)} onChange={e => setSelected(ids => e.target.checked ? [...ids, row.caseId] : ids.filter(id => id !== row.caseId))}/></td><td>{row.title}</td><td><span className={`dm-status dm-${row.status}`}>{row.outOfScope ? '范围外' : names[row.status]}</span></td><td><button className="dm-link" aria-expanded={detailId === row.caseId} aria-controls="dm-case-detail" onClick={() => setDetailId(value => value === row.caseId ? '' : row.caseId)}>查看</button></td></tr>)}</tbody></table></div>
        {detail && <section id="dm-case-detail" className="dm-detail-panel"><header><h3>{detail.title}</h3><button aria-label="关闭证据详情" onClick={() => setDetailId('')}>关闭</button></header><h3>预期</h3><p>{detail.expected}</p><h3>实际</h3><p>{detail.detail}</p>{detail.evidence && <a href={`/api/dify-web-modules/jobs/${job.id}/evidence/${detail.evidence}`} target="_blank" rel="noreferrer"><img alt={`${detail.title} 的实际页面证据`} src={`/api/dify-web-modules/jobs/${job.id}/evidence/${detail.evidence}`}/></a>}{detail.needsConfirmation && !running && <button disabled={busy} onClick={() => void perform(() => control('retest', { selectedCaseIds: [detail.caseId], confirmedCaseIds: [detail.caseId], requestId: crypto.randomUUID() }))}>前置数据已准备，重测此项</button>}{detail.proposal && <details><summary>AI 执行建议</summary><ol>{detail.proposal.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>{detail.proposal.questions.length > 0 && <p>待确认：{detail.proposal.questions.join('；')}</p>}</details>}</section>}

      </section>
      <div className="dm-footer"><label>历史运行<select aria-label="选择历史运行" value={job.id} onChange={e => { setJobId(e.target.value); setSelected([]); }}>{state?.jobs.filter(j => j.moduleId === job.moduleId).map(j => <option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString('zh-CN')}　{names[j.phase]} / {names[j.outcome]}</option>)}</select></label><details><summary>流程记录</summary><div className="dm-flow-log"><p>任务：{job.id}</p>{job.documentRunId && <p>网页运行：{job.documentRunId}</p>}{job.difyRuns.map((r, index) => <p key={index}>{r.phase} 第 {r.batch + 1} 批 · {r.status === 'succeeded' ? '完成' : '失败'} · {r.id ?? '未取得编号'}</p>)}{job.events.map((event, index) => <p key={index}>{new Date(event.at).toLocaleTimeString('zh-CN')}　{event.message}</p>)}</div></details></div>
    </> : <section className="dm-empty"><h2>选择一个模块，开始测试</h2><p>上传 CSV 用例包并填写网址。</p></section>}
  </div>;
}
