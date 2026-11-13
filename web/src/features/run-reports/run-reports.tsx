import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RunReport, RunReportCatalog, RunReportDetail, ReportMetadata, ReportCounts, ReportStatus } from '../../../../src/domain/reports/run-report-contract';
import type { CoreRun } from '../../../../src/domain/regression/core-chain-definitions';
import type { ReportFormat } from './report-export';
type DownloadFormat = ReportFormat | 'archive';
import { sidebarProjectEvents } from '../../shared/project-selection';
import './run-reports.css';
const root = '/api/system-module-regression', scopes = { all: '全部用例', custom: '自选用例', core: '核心用例' };
const phases: Record<string, string> = { completed: '已结束', cancelled: '已取消', interrupted: '未完成', running: '运行中', queued: '等待开始', 'awaiting-login': '等待登录' };
const statuses: Record<ReportStatus, string> = { passed: '通过', failed: '失败', blocked: '阻塞', error: '异常', not_executed: '未执行', outside: '范围外' };
const date = (v: string) => new Date(v).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function cleanDetail(value?: string): string {
    let text = String(value ?? '');
    text = text.replace(/^断言失败[:：]\s*/, '').replace(/^失败[:：]\s*/, '');
    text = text.replace(/[；;]\s*(当前页|页面)=[^；;]*/g, '').replace(/[；;]\s*页内其他 iframe=[^；;]*/g, '').replace(/[；;]\s*frames=[^；;]*/g, '');
    return text.trim();
}
const active = (r: RunReport) => ['queued', 'running', 'awaiting-login'].includes(r.phase);
const defaultName = (r: RunReport) => r.kind === 'core' ? '核心链路回归' : r.parentBatchId ? '用例复测' : r.scope === 'all' ? '模块回归' : '自选用例回归';
function Icon({ name }: {
    name: 'star' | 'more' | 'search' | 'back';
}) { const shapes: Record<string, ReactNode> = { star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>, back: <path d="m14 6-6 6 6 6"/> }; return <svg className="rp-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>; }
function Badge({ status, n }: {
    status: ReportStatus;
    n?: number;
}) { return <span className={'rp-badge rp-' + status}>{statuses[status]}{n === undefined ? '' : ' ' + n}</span>; }
function Counts({ counts }: {
    counts: ReportCounts;
}) { const keys = (Object.keys(statuses) as ReportStatus[]).filter(s => counts[s] > 0); return <div className="rp-counts">{keys.length ? keys.map(s => <Badge key={s} status={s} n={counts[s]}/>) : <span className="rp-badge rp-not_executed">暂无结果</span>}</div>; }
async function request<T>(path: string, data?: unknown): Promise<T> {
    const r = await fetch(root + path, data === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(20000) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const value = await r.json();
    if (!r.ok)
        throw Error(value.error ?? '操作未完成，请重试。');
    return value;
}
function Format({ value, onChange, disabled }: {
    value: DownloadFormat;
    onChange: (v: DownloadFormat) => void;
    disabled: boolean;
}) { return <select aria-label="报告格式" value={value} disabled={disabled} onChange={e => onChange(e.target.value as DownloadFormat)}><option value="xlsx">Excel</option><option value="xmind">XMind</option><option value="archive">离线报告包</option></select>; }
function EditReport({ report, busy, error, onClose, onSave }: {
    report: RunReport;
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (name: string, note: string) => Promise<void>;
}) {
    const ref = useRef<HTMLDialogElement>(null), [name, setName] = useState(report.name), [note, setNote] = useState(report.metadata.note);
    useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close(); }, []);
    return <dialog ref={ref} className="rp-dialog" aria-labelledby="rp-edit-title" onCancel={e => {
            e.preventDefault();
            if (!busy)
                onClose();
        }}><form onSubmit={e => { e.preventDefault(); void onSave(name.trim(), note.trim()); }}><h2 id="rp-edit-title">编辑报告</h2><label htmlFor="rp-name">名称</label><input id="rp-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={busy}/><label htmlFor="rp-note">备注</label><textarea id="rp-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3} disabled={busy}/>{error && <p className="rp-edit-error" role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存'}</button></footer></form></dialog>;
}
export default function RunReports() {
    const initial = useRef(new URLSearchParams(location.search));
    const [catalog, setCatalog] = useState<RunReportCatalog>(), [detail, setDetail] = useState<RunReportDetail>(), [selectedKey, setSelectedKey] = useState(initial.current.get('report') ?? '');
    const [scope, setScope] = useState(''), [result, setResult] = useState(''), [period, setPeriod] = useState(''), [keyword, setKeyword] = useState(''), [importantOnly, setImportantOnly] = useState(false), [page, setPage] = useState(1), [format, setFormat] = useState<DownloadFormat>('xlsx'), [chosen, setChosen] = useState<Set<string>>(new Set()), [expanded, setExpanded] = useState('');
    const [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [edit, setEdit] = useState<RunReport>(), [editError, setEditError] = useState('');
    const serial = useRef(0), detailSerial = useRef(0), mounted = useRef(true), selectedRef = useRef(selectedKey), busyRef = useRef(busy);
    selectedRef.current = selectedKey;
    busyRef.current = busy;
    const load = useCallback(async (systemId?: string, quiet = false) => {
        const ticket = ++serial.current;
        if (!quiet)
            setLoading(true);
        setError('');
        try {
            const next = await request<RunReportCatalog>('/reports' + (systemId ? '?systemId=' + encodeURIComponent(systemId) : ''));
            if (!mounted.current || ticket !== serial.current)
                return;
            setCatalog(next);
            setChosen(old => new Set([...old].filter(k => next.reports.some(r => r.key === k && !active(r)))));
        }
        catch (e) {
            if (mounted.current && ticket === serial.current)
                setError((e as Error).message);
        }
        finally {
            if (mounted.current && ticket === serial.current)
                setLoading(false);
        }
    }, []);
    const loadDetail = useCallback(async (key: string, systemId: string) => {
        const ticket = ++detailSerial.current;
        setDetailLoading(true);
        setDetail(undefined);
        setError('');
        try {
            const [kind, id] = key.split(':');
            if (!['batch', 'core'].includes(kind ?? '') || !/^[0-9a-f-]{36}$/i.test(id ?? ''))
                throw Error('报告编号无效。');
            const next = await request<RunReportDetail>(`/reports/${kind}/${id}?systemId=${encodeURIComponent(systemId)}`);
            if (mounted.current && ticket === detailSerial.current)
                setDetail(next);
        }
        catch (e) {
            if (mounted.current && ticket === detailSerial.current)
                setError((e as Error).message);
        }
        finally {
            if (mounted.current && ticket === detailSerial.current)
                setDetailLoading(false);
        }
    }, []);
    useEffect(() => { mounted.current = true; void load(initial.current.get('system') || undefined); return () => { mounted.current = false; serial.current++; detailSerial.current++; }; }, [load]);
    useEffect(() => {
        setExpanded('');
        if (selectedKey && catalog?.systemId)
            void loadDetail(selectedKey, catalog.systemId);
        else {
            detailSerial.current++;
            setDetail(undefined);
            setDetailLoading(false);
        }
    }, [selectedKey, catalog?.systemId, loadDetail]);
    useEffect(() => {
        if (!catalog)
            return;
        const publish = () => window.dispatchEvent(new CustomEvent(sidebarProjectEvents.state, { detail: { systems: catalog.systems, systemId: catalog.systemId, disabled: busy || loading || !!edit } }));
        const select = (e: Event) => {
            const id = (e as CustomEvent<string>).detail;
            if (id === catalog.systemId || busy || edit)
                return;
            setSelectedKey('');
            setChosen(new Set());
            setPage(1);
            void load(id);
        };
        publish();
        window.addEventListener(sidebarProjectEvents.request, publish);
        window.addEventListener(sidebarProjectEvents.select, select);
        return () => { window.removeEventListener(sidebarProjectEvents.request, publish); window.removeEventListener(sidebarProjectEvents.select, select); };
    }, [catalog, busy, loading, edit, load]);
    useEffect(() => {
        if (!catalog?.systemId)
            return;
        const timer = setInterval(() => {
            if (!busyRef.current)
                void load(catalog.systemId, true);
        }, 30000);
        return () => clearInterval(timer);
    }, [catalog?.systemId, load]);
    useEffect(() => {
        if (!detail || !active(detail.report))
            return;
        const report = detail.report;
        const timer = setInterval(() => {
            if (!busyRef.current)
                void loadDetail(report.key, report.systemId);
        }, 15000);
        return () => clearInterval(timer);
    }, [detail?.report.key, detail?.report.phase, loadDetail]);
    useEffect(() => {
        if (!notice)
            return;
        const t = setTimeout(() => setNotice(''), 5000);
        return () => clearTimeout(t);
    }, [notice]);
    useEffect(() => {
        const u = new URL(location.href);
        u.searchParams.set('page', 'run-reports');
        if (catalog?.systemId)
            u.searchParams.set('system', catalog.systemId);
        selectedKey ? u.searchParams.set('report', selectedKey) : u.searchParams.delete('report');
        for (const k of ['batch', 'coreRun', 'scope', 'case', 'caseScope', 'module', 'draft'])
            u.searchParams.delete(k);
        history.replaceState(null, '', u);
    }, [catalog?.systemId, selectedKey]);
    const rows = useMemo(() => catalog?.reports.filter(r => (!scope || r.scope === scope) && (!importantOnly || r.metadata.important) && (!keyword || (r.name + ' ' + r.id + ' ' + r.metadata.note).toLowerCase().includes(keyword.toLowerCase())) && (!period || Date.now() - Date.parse(r.createdAt) <= Number(period) * 86400000) && (!result || result === 'failed' && r.counts.failed + r.counts.error > 0 || result === 'blocked' && r.counts.blocked > 0 || result === 'passed' && r.size > 0 && r.counts.passed === r.size || result === 'unfinished' && r.phase !== 'completed')) ?? [], [catalog, scope, importantOnly, keyword, period, result]);
    const pages = Math.max(1, Math.ceil(rows.length / 8)), currentPage = Math.min(page, pages), visible = rows.slice((currentPage - 1) * 8, currentPage * 8), selectable = visible.filter(r => !active(r)), allSelected = selectable.length > 0 && selectable.every(r => chosen.has(r.key));
    const toggleChosen = (key: string, on: boolean) => setChosen(old => {
        const next = new Set(old);
        if (on && next.size >= 10 && !next.has(key)) {
            setNotice('每次最多选择 10 份报告');
            return old;
        }
        on ? next.add(key) : next.delete(key);
        return next;
    });
    const saveMetadata = async (row: RunReport, value: Pick<ReportMetadata, 'name' | 'note' | 'important'>) => { const saved = await request<ReportMetadata>(`/reports/${row.kind}/${row.id}/metadata`, { systemId: row.systemId, revision: row.metadata.revision, ...value }); serial.current++; setLoading(false); const updated = { ...row, metadata: saved, name: saved.name || defaultName(row) }; setCatalog(c => c ? { ...c, reports: c.reports.map(r => r.key === row.key ? updated : r) } : c); setDetail(d => d?.report.key === row.key ? { ...d, report: updated } : d); };
    const mark = async (row: RunReport) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await saveMetadata(row, { name: row.metadata.name, note: row.metadata.note, important: !row.metadata.important });
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const beginEdit = (row: RunReport) => { setEditError(''); setEdit(row); };
    const saveEdit = async (name: string, note: string) => {
        if (!edit || busy)
            return;
        setBusy(true);
        setEditError('');
        try {
            await saveMetadata(edit, { name, note, important: edit.metadata.important });
            setEdit(undefined);
            setNotice('已保存');
        }
        catch (e) {
            setEditError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const download = async (reports: RunReport[]) => {
        if (busy || !reports.length)
            return;
        if (reports.length > 10) {
            setError('每次最多下载 10 份报告。');
            return;
        }
        if (reports.some(active)) {
            setError('请等待所选批次结束后下载。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const helpers = await import('./report-export');
            const files: Record<string, Uint8Array> = {};
            let size = 0;
            for (let i = 0; i < reports.length; i++) {
                const r = reports[i]!;
                setNotice(`正在生成报告 ${i + 1} / ${reports.length}`);
                let file;
                if (format === 'archive') {
                    const response = await fetch(root + '/reports/' + r.kind + '/' + r.id + '/archive?systemId=' + encodeURIComponent(r.systemId));
                    if (!response.ok) { const value = await response.json().catch(() => ({})); throw Error(value.error ?? '归档失败'); }
                    file = { fileName: 'TestPilot-' + r.id + '.zip', mime: 'application/zip', bytes: new Uint8Array(await response.arrayBuffer()) };
                }
                else if (r.kind === 'core') {
                    const run = await request<CoreRun>('/core-chains/runs/' + r.id);
                    if (run.systemId !== r.systemId || ['queued', 'running', 'awaiting-login'].includes(run.phase))
                        throw Error('报告所属项目或执行状态已变化，请刷新。');
                    file = await helpers.buildCoreRegressionReportFile(run, format);
                }
                else
                    file = await helpers.buildRegressionReportFile(r.id, format);
                size += file.bytes.byteLength;
                if (size > 128 * 1024 * 1024)
                    throw Error('所选报告超过 128MB，请分批下载。');
                if (reports.length === 1) {
                    helpers.saveReportFile(file);
                    setNotice('已下载报告');
                    return;
                }
                files[r.id + '-' + file.fileName] = file.bytes;
            }
            const { zipSync } = await import('fflate');
            const system = catalog?.systems.find(s => s.id === catalog.systemId)?.name ?? 'TestPilot';
            helpers.saveReportFile({ fileName: (system + '-运行报告-' + new Date().toISOString().slice(0, 10)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.zip', mime: 'application/zip', bytes: zipSync(files, { level: 0 }) });
            setNotice('已下载报告包');
        }
        catch (e) {
            setError((e as Error).message);
            setNotice('');
        }
        finally {
            setBusy(false);
        }
    };
    const refresh = () => {
        void load(catalog?.systemId);
        if (selectedKey && catalog?.systemId)
            void loadDetail(selectedKey, catalog.systemId);
    };
    const cell = (counts: ReportCounts, status: ReportStatus) => <td><span className={'rp-badge ' + (counts[status] ? 'rp-' + status : 'rp-zero')}>{counts[status]}</span></td>;
    const evidence = (path: string) => (location.pathname.startsWith('/dify/') ? '/dify' : '') + path;
    const failedSteps = (detail?.groups ?? []).flatMap(group => (group.steps ?? []).filter(step => ['failed', 'error', 'blocked'].includes(step.status)).map(step => ({ group: group.title, step })));
    const r = detail?.report, extraError = detail?.groups.some(g => g.counts.error > 0), extraOutside = detail?.groups.some(g => g.counts.outside > 0);
    return <section className="run-reports" aria-label="运行报告" aria-busy={loading || busy || detailLoading}>
  {error && <div className="rp-error" role="alert"><span>{error}</span><button type="button" disabled={busy || loading} onClick={refresh}>重试</button></div>}
  {selectedKey ? <><div className="rp-back-row"><button className="rp-back" type="button" disabled={busy} onClick={() => setSelectedKey('')}><Icon name="back"/>报告列表</button></div>{detailLoading ? <p className="rp-loading">正在读取报告…</p> : r && detail ? <>
   <header className="rp-heading rp-detail-heading"><h1>{r.name}</h1><div className="rp-actions"><button type="button" className={'rp-star' + (r.metadata.important ? ' active' : '')} aria-label={r.metadata.important ? '取消重要' : '标记重要'} aria-pressed={r.metadata.important} disabled={busy} onClick={() => void mark(r)}><Icon name="star"/></button><Format value={format} onChange={setFormat} disabled={busy}/><button type="button" disabled={busy || active(r)} onClick={() => void download([r])}>下载报告</button></div></header>
   <div className="rp-detail-meta"><span>{date(r.createdAt)}</span><span>{scopes[r.scope]}</span><span>{r.groupCount} {r.kind === 'core' ? '条链路' : '个模块'} · {r.size} {r.kind === 'core' ? '步骤' : '用例'}</span><span>{phases[r.phase] ?? r.phase}</span></div>
   <div className="rp-detail-subheading"><h2>本批次结果</h2><Counts counts={r.counts}/></div>
   {failedSteps.length > 0 && <section className="rp-fail-panel" aria-label="失败与阻塞">
    <h2>失败与阻塞（{failedSteps.length}）</h2>
    <div className="rp-fail-list">
        {failedSteps.map(item => <article className="rp-fail-item" key={item.group + ':' + item.step.id}>
            <header><b>{item.step.id}</b><span className={'rp-fail-badge ' + item.step.status}>{statuses[item.step.status]}</span><span className="rp-fail-group">{item.group}</span></header>
            <p>{cleanDetail(item.step.actual) || item.step.title}</p>
            {item.step.evidencePath ? <a className="rp-fail-shot" href={evidence(item.step.evidencePath)} target="_blank" rel="noreferrer"><img src={evidence(item.step.evidencePath)} alt={'截图 ' + item.step.id}/></a> : <span className="rp-fail-noimg">无截图</span>}
        </article>)}
    </div>
</section>}<div className="rp-table-wrap"><table className="rp-table rp-detail-table"><thead><tr><th>{r.kind === 'core' ? '链路' : '模块'}</th><th>{r.kind === 'core' ? '步骤' : '用例'}</th><th>通过</th><th>失败</th><th>阻塞</th><th>未执行</th>{extraError && <th>异常</th>}{extraOutside && <th>范围外</th>}<th>操作</th></tr></thead><tbody>{detail.groups.map(g => <GroupRows key={g.id} title={g.title} version={g.version} size={g.size} expanded={expanded === g.id} onToggle={() => setExpanded(expanded === g.id ? '' : g.id)} countCells={<>{cell(g.counts, 'passed')}{cell(g.counts, 'failed')}{cell(g.counts, 'blocked')}{cell(g.counts, 'not_executed')}{extraError && cell(g.counts, 'error')}{extraOutside && cell(g.counts, 'outside')}</>} columns={7 + Number(extraError) + Number(extraOutside)}>{g.steps.length ? <div className="rp-step-list">{g.steps.map((s, i) => <div className="rp-step" key={s.id}><details className="rp-step-proof"><summary>{r.kind === 'core' ? (i + 1) + '. ' : s.id + ' · '}{s.title}{r.kind === 'core' && s.caseIds.length > 0 && <p>{s.caseIds.join('、')}</p>}</summary><div className="rp-proof-body"><strong>预期</strong><p>{s.expected || '本批次未记录预期。'}</p><strong>实际</strong><p>{cleanDetail(s.actual) || '本批次尚未返回结果。'}</p>{s.evidenceNote && <p>{s.evidenceNote}</p>}{s.nextAction && <p>{s.nextAction}</p>}{s.evidencePath && <a href={evidence(s.evidencePath)} target="_blank" rel="noreferrer">执行截图</a>}</div></details><Badge status={s.status}/></div>)}</div> : <p className="rp-no-steps">本批次尚未返回逐条结果。</p>}</GroupRows>)}</tbody></table></div>
   <details className="rp-run-info"><summary>批次信息</summary><dl><dt>批次编号</dt><dd>{r.id}</dd><dt>项目</dt><dd>{r.systemName}</dd><dt>环境</dt><dd>{detail.environment}</dd><dt>账号</dt><dd>{detail.account}</dd>{r.parentBatchId && <><dt>来源批次</dt><dd>{r.parentBatchId}</dd></>}<dt>版本</dt><dd>{detail.groups.map(g => g.title + '：' + g.version).join('\n')}</dd><dt>执行记录</dt><dd>{detail.message}</dd><dt>原始批次</dt><dd><a href={(() => { const u = new URL(location.href); u.search = ''; u.searchParams.set('page', 'dify-regression'); u.searchParams.set('system', r.systemId); u.searchParams.set('scope', r.kind === 'core' ? 'chains' : r.scope); u.searchParams.set(r.kind === 'core' ? 'coreRun' : 'batch', r.id); return u.href; })()}>在执行测试中查看</a></dd></dl></details>
   <div className="rp-detail-note"><span>{r.metadata.note || '暂无备注'}</span><button type="button" disabled={busy} onClick={() => beginEdit(r)}>编辑备注</button></div>
  </> : !error ? <p className="rp-loading">没有该报告。</p> : null}</> : <>
   <header className="rp-heading"><h1>运行报告</h1><div className="rp-actions"><Format value={format} onChange={setFormat} disabled={busy}/><button type="button" disabled={busy || !chosen.size} onClick={() => void download(catalog?.reports.filter(r => chosen.has(r.key)) ?? [])}>下载选中{chosen.size ? ' ' + chosen.size : ''}</button></div></header>
   <div className="rp-filters"><label className="rp-search"><Icon name="search"/><input aria-label="搜索报告" placeholder="名称 / 批次编号" value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }}/></label><select aria-label="执行范围" value={scope} onChange={e => { setScope(e.target.value); setPage(1); }}><option value="">全部范围</option>{Object.entries(scopes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="结果筛选" value={result} onChange={e => { setResult(e.target.value); setPage(1); }}><option value="">全部结果</option><option value="failed">含失败</option><option value="blocked">含阻塞</option><option value="passed">全部通过</option><option value="unfinished">未完成</option></select><select aria-label="运行时间" value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }}><option value="">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select><label className="rp-important-filter"><input type="checkbox" checked={importantOnly} onChange={e => { setImportantOnly(e.target.checked); setPage(1); }}/>仅重要</label><button type="button" onClick={() => { setKeyword(''); setScope(''); setResult(''); setPeriod(''); setImportantOnly(false); setPage(1); }}>重置</button></div>
   <div className="rp-table-wrap"><table className="rp-table"><thead><tr><th><input type="checkbox" aria-label="选择本页报告" checked={allSelected} disabled={busy || !selectable.length} onChange={e => {
                const on = e.target.checked;
                setChosen(old => {
                    const next = new Set(old);
                    for (const r of selectable) {
                        if (!on)
                            next.delete(r.key);
                        else if (next.size < 10)
                            next.add(r.key);
                    }
                    return next;
                });
            }}/></th><th aria-label="重要标记"/><th>名称</th><th>范围</th><th>运行时间</th><th>规模</th><th>本批次结果</th><th>操作</th></tr></thead><tbody>{loading && !catalog ? <tr><td colSpan={8} className="rp-empty">正在读取报告…</td></tr> : !visible.length ? <tr><td colSpan={8} className="rp-empty">没有匹配的报告</td></tr> : visible.map(row => <tr key={row.key} className={chosen.has(row.key) ? 'rp-selected' : ''}><td><input type="checkbox" aria-label={'选择 ' + row.name + ' ' + row.id.slice(0, 8)} checked={chosen.has(row.key)} disabled={busy || active(row)} onChange={e => toggleChosen(row.key, e.target.checked)}/></td><td><button type="button" className={'rp-star' + (row.metadata.important ? ' active' : '')} aria-label={row.metadata.important ? '取消重要' : '标记重要'} aria-pressed={row.metadata.important} disabled={busy} onClick={() => void mark(row)}><Icon name="star"/></button></td><td><div className="rp-name">{row.name}</div><div className="rp-id"><span title={row.id}>{row.id.slice(0, 8)}</span>{row.phase !== 'completed' && <span className="rp-phase">{phases[row.phase] ?? row.phase}</span>}</div>{row.metadata.note && <div className="rp-note" title={row.metadata.note}>{row.metadata.note}</div>}</td><td>{scopes[row.scope]}</td><td className="rp-date">{date(row.createdAt)}</td><td>{row.size} {row.unit}</td><td><Counts counts={row.counts}/></td><td><div className="rp-row-actions"><button type="button" disabled={busy} onClick={() => setSelectedKey(row.key)}>查看</button><button type="button" disabled={busy || active(row)} onClick={() => void download([row])}>下载</button><button type="button" className="rp-more" aria-label="编辑名称和备注" disabled={busy} onClick={() => beginEdit(row)}><Icon name="more"/></button></div></td></tr>)}</tbody></table></div>
   <footer className="rp-pagination"><span>共 {rows.length} 条{chosen.size ? ' · 已选 ' + chosen.size + ' 条' : ''}</span><div><button type="button" disabled={busy || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages}</span><button type="button" disabled={busy || currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></footer>
  </>}
  {edit && <EditReport report={edit} busy={busy} error={editError} onClose={() => setEdit(undefined)} onSave={saveEdit}/>}
  {notice && <div className="rp-toast" role="status">{notice}</div>}
 </section>;
}
function GroupRows({ title, version, size, expanded, onToggle, countCells, columns, children }: {
    title: string;
    version: string;
    size: number;
    expanded: boolean;
    onToggle: () => void;
    countCells: ReactNode;
    columns: number;
    children: ReactNode;
}) {
    return <><tr><td><div className="rp-group-title">{title}</div>{version.startsWith('v') && <span className="rp-detail-tag" title={version}>{version.split(' · ')[0]}</span>}</td><td>{size}</td>{countCells}<td><button type="button" onClick={onToggle}>{expanded ? '收起' : '查看'}</button></td></tr>{expanded && <tr className="rp-step-row"><td colSpan={columns}>{children}</td></tr>}</>;
}
