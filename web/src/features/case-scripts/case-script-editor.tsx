import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaseEditorCatalog, EditableCase } from '../../../../src/domain/cases/case-script-contract';
import { sidebarProjectEvents } from '../../shared/project-selection';
import './case-script-editor.css';
import CaseEditorColumns from './case-editor-columns';
import CaseEditorDiff, { type CaseEditorFields, type CaseDiffTab } from './case-editor-diff';
import CaseEditorAiGuide from './case-editor-ai-guide';
import './case-editor-review.css';
import CaseEditorResources from './case-editor-resources';
import CaseVersionImport from './case-version-import';
import { caseDisplayNumber } from './case-display-number';
const root = '/api/system-module-regression/case-editor';
const key = (c: {
    moduleId: string;
    id?: string;
    caseId?: string;
}) => c.moduleId + ':' + (c.id ?? c.caseId);
const labels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', error: '错误', not_executed: '未执行', outside: '范围外' };
function CaseResultStatus({ status = 'not_executed' }: {
    status?: string;
}) { const style = status === 'error' ? 'failed' : status === 'not_executed' ? 'not-executed' : status; return <span className={`ce-result-status sm-badge sm-${style}`}>{labels[status] ?? '未执行'}</span>; }
type Fields = CaseEditorFields;
type HistoryEntry = {
    version: number;
    createdAt: string;
    data: EditableCase;
};
const fields = (c: EditableCase): Fields => ({ title: c.title, expected: c.expected, manual: c.manualSteps.join('\n'), prerequisites: structuredClone(c.prerequisites), script: JSON.stringify(c.script, null, 2) });
async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(root + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok)
        throw Error(data.error ?? '读取失败，请重试。');
    return data;
}
function Chevron() { return <svg className="ce-icon ce-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>; }
export default function CaseScriptEditor() {
    const [catalog, setCatalog] = useState<CaseEditorCatalog>(), [current, setCurrent] = useState<EditableCase>(), [form, setForm] = useState<Fields>(), [baseline, setBaseline] = useState<Fields>(), [scope, setScope] = useState(new URLSearchParams(location.search).get('caseScope') === 'core' ? 'core' : 'all'), [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'ready'>('all'), [query, setQuery] = useState(''), [collapsed, setCollapsed] = useState(false), [source, setSource] = useState(false), [picker, setPicker] = useState(false), [depQuery, setDepQuery] = useState(''), [history, setHistory] = useState<HistoryEntry[]>(), [historyOpen, setHistoryOpen] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [diffOpen, setDiffOpen] = useState(false), [diffTab, setDiffTab] = useState<CaseDiffTab>('script'), [aiOpen, setAiOpen] = useState(false), [historyError, setHistoryError] = useState(''), [changeOrigin, setChangeOrigin] = useState('手动修改');
    const historySerial = useRef(0);
    const [externalBefore, setExternalBefore] = useState<Fields>(), [externalPending, setExternalPending] = useState(false);
    const pending = useRef<() => void>(() => { }), dialog = useRef<HTMLDialogElement>(null), dirtyRef = useRef(false), allowNavigation = useRef(false), mounted = useRef(true), serial = useRef(0), numbers = useRef<HTMLPreElement>(null), busyRef = useRef(false);
    busyRef.current = busy;
    const dirty = !!form && JSON.stringify(form) !== JSON.stringify(baseline);
    dirtyRef.current = dirty;
    const byKey = useMemo(() => new Map(catalog?.cases.map(c => [key(c), c]) ?? []), [catalog]);
    const loadCase = useCallback((c: EditableCase) => { setExternalBefore(undefined); setExternalPending(false); setCurrent(c); const next = fields(c); setForm(next); setBaseline(next); dirtyRef.current = false; setSource(false); setPicker(false); setHistoryOpen(false); setHistory(undefined); setHistoryError(''); historySerial.current++; setDiffOpen(false); setChangeOrigin('手动修改'); setError(''); const url = new URL(location.href); url.searchParams.set('case', c.id); url.searchParams.set('module', c.moduleId); window.history.replaceState(null, '', url); }, []);
    const guard = useCallback((action: () => void) => {
        if (!dirtyRef.current) {
            action();
            return;
        }
        pending.current = action;
        dialog.current?.showModal();
    }, []);
    const refresh = useCallback(async (systemId?: string, selectedKey?: string) => {
        const ticket = ++serial.current;
        setLoading(true);
        setError('');
        try {
            const next = await request<CaseEditorCatalog>(systemId ? '?systemId=' + encodeURIComponent(systemId) : '');
            if (!mounted.current || ticket !== serial.current)
                return;
            setCatalog(next);
            const params = new URLSearchParams(location.search), wanted = selectedKey ?? ((params.get('module') ?? '') + ':' + (params.get('case') ?? ''));
            const identified = !params.get('module') ? next.cases.filter(c => c.id === params.get('case')) : [];
            const candidate = next.cases.find(c => key(c) === wanted) ?? (identified.length === 1 ? identified[0] : undefined) ?? next.cases.find(c => c.id === 'xmind-84') ?? next.cases[0];
            if (candidate)
                loadCase(candidate);
            else {
                setCurrent(undefined);
                setForm(undefined);
                setBaseline(undefined);
            }
            const url = new URL(location.href);
            url.searchParams.set('system', next.systemId);
            window.history.replaceState(null, '', url);
        }
        catch (e) {
            if (ticket === serial.current)
                setError((e as Error).message);
        }
        finally {
            if (ticket === serial.current)
                setLoading(false);
        }
    }, [loadCase]);
    useEffect(() => { mounted.current = true; void refresh(new URLSearchParams(location.search).get('system') || undefined); return () => { mounted.current = false; serial.current++; }; }, [refresh]);
    useEffect(() => {
        if (!catalog?.systemId || loading || busy) return;
        let stopped = false, checking = false;
        const expected = [...new Map(catalog.cases.map(c => [c.moduleId, c.versionId])).entries()].map(([m, v]) => m + ':' + v).sort().join('|');
        const timer = setInterval(async () => {
            if (stopped || checking || busyRef.current || document.hidden) return;
            checking = true;
            try {
                const value = await request<{ revision: string }>('/../maintenance/revision?systemId=' + encodeURIComponent(catalog.systemId));
                if (stopped || value.revision === expected) return;
                if (dirtyRef.current || busyRef.current) { setExternalPending(true); return; }
                const next = await request<CaseEditorCatalog>('?systemId=' + encodeURIComponent(catalog.systemId));
                if (stopped) return;
                if (dirtyRef.current || busyRef.current) { setExternalPending(true); return; }
                const candidate = next.cases.find(c => current && key(c) === key(current)) ?? next.cases[0];
                const before = current && candidate?.id === current.id && candidate.moduleId === current.moduleId ? fields(current) : undefined;
                setCatalog(next);
                if (candidate) loadCase(candidate);
                setExternalBefore(before); setExternalPending(false); setChangeOrigin(candidate?.changeSource === 'mcp' ? 'MCP 更新' : '外部更新'); setDiffTab(before?.script !== (candidate ? fields(candidate).script : undefined) ? 'script' : 'case'); setDiffOpen(!!before); setNotice('已同步外部修改');
            } catch { /* Keep local edits when the service is temporarily unavailable. */ }
            finally { checking = false; }
        }, 4000);
        return () => { stopped = true; clearInterval(timer); };
    }, [catalog, current, loading, busy, loadCase]);
    useEffect(() => {
        if (!catalog)
            return;
        const publish = () => window.dispatchEvent(new CustomEvent(sidebarProjectEvents.state, { detail: { systems: catalog.systems, systemId: catalog.systemId, disabled: busy || loading } }));
        const select = (e: Event) => {
            const id = (e as CustomEvent<string>).detail;
            if (id === catalog.systemId)
                return;
            guard(() => void refresh(id));
        };
        publish();
        window.addEventListener(sidebarProjectEvents.request, publish);
        window.addEventListener(sidebarProjectEvents.select, select);
        return () => { window.removeEventListener(sidebarProjectEvents.request, publish); window.removeEventListener(sidebarProjectEvents.select, select); };
    }, [catalog, busy, loading, guard, refresh]);
    useEffect(() => {
        const unload = (e: BeforeUnloadEvent) => {
            if (dirtyRef.current) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        const navigation = (e: MouseEvent) => {
            if (allowNavigation.current) {
                allowNavigation.current = false;
                return;
            }
            const target = e.target instanceof Element ? e.target.closest<HTMLButtonElement | HTMLAnchorElement>('.sidebar button,.sidebar a') : null;
            if (target && busyRef.current) {
                e.preventDefault();
                e.stopImmediatePropagation();
                setNotice('正在保存，请稍候');
                return;
            }
            if (target && dirtyRef.current) {
                e.preventDefault();
                e.stopImmediatePropagation();
                guard(() => { dirtyRef.current = false; allowNavigation.current = true; target.click(); });
            }
        };
        window.addEventListener('beforeunload', unload);
        window.addEventListener('click', navigation, true);
        return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('click', navigation, true); };
    }, [guard]);
    useEffect(() => {
        if (!notice)
            return;
        const timer = setTimeout(() => setNotice(''), 3500);
        return () => clearTimeout(timer);
    }, [notice]);
    let validation = '';
    if (form && current) {
        try {
            const script = JSON.parse(form.script);
            if (!script || script.caseId !== current.id)
                validation = '脚本编号与当前用例不一致。';
            else if (!Array.isArray(script.steps) || !Array.isArray(script.dependsOn))
                validation = '脚本需包含 steps 和 dependsOn 数组。';
            else if (script.dependsOn.some((d: Record<string, string>) => !d || d.requiredStatus !== 'passed') || JSON.stringify(script.dependsOn.map(key).sort()) !== JSON.stringify(form.prerequisites.map(key).sort()))
                validation = '脚本前置用例需与左侧一致，并要求执行通过。';
            else if (Object.keys(script).some(k => !['caseId', 'dependsOn', 'steps'].includes(k)))
                validation = '脚本仅支持 caseId、dependsOn、steps。';
        }
        catch {
            validation = 'JSON 格式有误，请修正后保存。';
        }
    }
    const change = (patch: Partial<Fields>) => { setExternalBefore(undefined); setChangeOrigin('手动修改'); setForm(f => f ? { ...f, ...patch } : f); };
    const save = useCallback(async () => {
        if (!current || !form || !dirty || busy || validation)
            return;
        if (!form.title.trim() || !form.expected.trim()) {
            setError('请填写名称和预期。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const saved = await request<EditableCase>('/' + current.moduleId, { versionId: current.versionId, caseId: current.id, title: form.title, expected: form.expected, manualSteps: form.manual.split('\n').filter(s => s.trim()), prerequisites: form.prerequisites, script: JSON.parse(form.script) });
            setNotice('已保存 v' + saved.version);
            await refresh(catalog?.systemId, key(saved));
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }, [current, form, dirty, busy, validation, refresh, catalog?.systemId]);
    useEffect(() => {
        const shortcut = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                void save();
            }
        };
        window.addEventListener('keydown', shortcut);
        return () => window.removeEventListener('keydown', shortcut);
    }, [save]);
    const reviewCount = catalog?.cases.filter(c => c.scriptReview?.status === 'pending' && c.script.steps.length > 0).length ?? 0;
    const groups = (scope === 'all' ? catalog?.modules : catalog?.chains)?.map(g => ({ ...g, caseKeys: g.caseKeys.filter(k => { const c = byKey.get(k); const matchesQuery = c && (!query || (c.id + ' ' + c.title + ' ' + c.expected).toLowerCase().includes(query.toLowerCase())); const matchesReview = c && (reviewFilter === 'all' || (reviewFilter === 'pending' ? c.scriptReview?.status === 'pending' && c.script.steps.length > 0 : c.script.steps.length > 0)); return !!matchesQuery && !!matchesReview; }) })).filter(g => g.caseKeys.length) ?? [];
    const visible = new Set(groups.flatMap(g => g.caseKeys)).size;
    const toggleDep = (candidate: EditableCase, checked: boolean) => {
        if (!form)
            return;
        try {
            const script = JSON.parse(form.script), ref = { moduleId: candidate.moduleId, caseId: candidate.id }, prerequisites = checked ? [...form.prerequisites, ref] : form.prerequisites.filter(d => key(d) !== key(candidate));
            script.dependsOn = prerequisites.map(d => ({ ...d, requiredStatus: 'passed' }));
            change({ prerequisites, script: JSON.stringify(script, null, 2) });
        }
        catch {
            setError('请先修正脚本格式。');
        }
    };
    const showHistory = async () => {
        if (!current)
            return;
        const ticket = ++historySerial.current;
        setHistoryOpen(true);
        setHistory(undefined);
        setHistoryError('');
        try {
            const versions = await request<HistoryEntry[]>('/' + current.moduleId + '/' + encodeURIComponent(current.id));
            if (mounted.current && ticket === historySerial.current)
                setHistory(versions);
        }
        catch (e) {
            if (mounted.current && ticket === historySerial.current)
                setHistoryError((e as Error).message);
        }
    };
    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setNotice('已复制');
        }
        catch {
            setError('复制失败，请手动复制。');
        }
    };
    const changed = form && baseline ? (['title', 'manual', 'prerequisites', 'expected', 'script'] as const).filter(k => JSON.stringify(form[k]) !== JSON.stringify(baseline[k])) : [];
    const dependencyBlocked = form?.prerequisites.some(d => byKey.get(key(d))?.status !== 'passed');
    return <section className="case-script-editor case-page" aria-label="用例与脚本" aria-busy={loading || busy}>
  <header className="case-page-heading"><h1>用例与脚本</h1><div className="ce-page-actions">{catalog?.systemId && <CaseVersionImport catalog={catalog} disabled={busy || loading || dirty} onBusyChange={setBusy} onApplied={() => void refresh(catalog.systemId)} />}{catalog?.systemId && <CaseEditorResources systemId={catalog.systemId} disabled={busy || loading || dirty} onBusyChange={setBusy} onApplied={() => void refresh(catalog.systemId)} />}<button type="button" className={diffOpen ? 'ce-action-selected' : ''} aria-pressed={diffOpen} onClick={() => { setHistoryOpen(false); setDiffOpen(!diffOpen); }} disabled={!current || loading}>修改对比{changed.length > 0 && <span className="ce-change-count">{changed.length}</span>}</button><button type="button" onClick={() => historyOpen ? setHistoryOpen(false) : void showHistory()} disabled={!current || busy || loading} aria-expanded={historyOpen}>版本</button></div></header>
  {error && <div className="ce-error" role="alert">{error}<button type="button" onClick={() => loading ? undefined : guard(() => void refresh(catalog?.systemId, current ? key(current) : undefined))}>刷新</button></div>}
  {loading && !catalog ? <div className="ce-empty">正在读取用例…</div> : !catalog?.cases.length ? <div className="ce-empty">该项目暂无用例。</div> : <>
  {current?.script.steps.length === 0 ? <div role="status" className="ce-validation">暂无可执行脚本：请在右侧编辑脚本并保存；补齐后即可尝试运行。</div> : current?.scriptReview?.status === 'pending' && <div role="status" className="ce-validation">脚本待核对（可选）：已有步骤，可以直接尝试运行；需要调整时在此编辑保存。<button type="button" disabled={busy || loading || dirty} onClick={() => { setBusy(true); void request('/review-script', { moduleId: current.moduleId, caseId: current.id, versionId: current.versionId }).then(() => refresh(catalog?.systemId, key(current))).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); }}>标记已核对（可选）</button></div>}
  <CaseEditorColumns review={diffOpen && current && form && baseline ? <CaseEditorDiff before={externalBefore ?? baseline} after={form} current={current} cases={catalog.cases} tab={diffTab} onTab={setDiffTab} origin={changeOrigin}/> : undefined}>
   <aside className="case-directory" aria-label="用例目录"><div className="directory-tools"><div className="scope-tabs" role="tablist" aria-label="用例范围">{['all', 'core'].map(s => <button type="button" role="tab" key={s} data-scope={s} aria-selected={scope === s} className={scope === s ? 'selected' : ''} onClick={() => { setScope(s); const u = new URL(location.href); u.searchParams.set('caseScope', s); window.history.replaceState(null, '', u); }}>{s === 'all' ? <>全部 <span>{catalog.cases.length}</span></> : '核心'}</button>)}</div><div className="directory-search"><svg className="ce-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input value={query} onChange={e => setQuery(e.target.value)} placeholder="编号 / 关键词" aria-label="搜索用例编号或内容"/></div><div className="directory-review-tabs" role="group" aria-label="脚本核对状态"><button type="button" className={reviewFilter === 'all' ? 'selected' : ''} onClick={() => setReviewFilter('all')}>全部</button><button type="button" className={reviewFilter === 'pending' ? 'selected' : ''} onClick={() => setReviewFilter('pending')}>待核对 <span>{reviewCount}</span></button><button type="button" className={reviewFilter === 'ready' ? 'selected' : ''} onClick={() => setReviewFilter('ready')}>可执行</button></div><div className="directory-count"><span>{groups.length} {scope === 'all' ? '模块' : '链路'} · {visible} 条</span><button type="button" className="text-button" onClick={() => setCollapsed(!collapsed)}>{collapsed ? '展开' : '收起'}</button></div></div>
    <div className="case-tree" key={scope + reviewFilter + String(collapsed)}>{!groups.length ? <p className="ce-empty">没有匹配的用例</p> : groups.map((g, index) => <details className="tree-group" key={g.id} open={!collapsed && (!!query || reviewFilter !== 'all' || g.caseKeys.includes(current ? key(current) : ''))}><summary><Chevron /><span>{scope === 'core' ? index + 1 + '. ' : ''}{'name' in g ? g.name : g.title}</span><span className="n">{g.caseKeys.length}</span></summary>{g.caseKeys.map(k => { const c = byKey.get(k)!; return <button type="button" key={k} data-case={c.id} className={'tree-case' + (current && key(current) === k ? ' selected' : '')} aria-current={current && key(current) === k ? 'true' : undefined} title={c.id + ' · ' + c.title} disabled={busy || loading} onClick={() => guard(() => loadCase(c))}><span className="no">{caseDisplayNumber(c.id, catalog?.cases ?? [])}</span><span className="case-label">{c.title}</span>{c.script.steps.length === 0 ? <span className="ce-pending-mark" aria-label="待补脚本">待补脚本</span> : c.scriptReview?.status === 'pending' && <span className="ce-pending-mark" aria-label="脚本待核对（可选）">待核对（可选）</span>}{dirty && current && key(current) === k && <span className="ce-tree-dirty" aria-label="未保存"/>}</button>; })}</details>)}</div>
   </aside>
   {current && form && <><section className="case-detail" aria-label="用例内容"><header className="pane-header"><h2>用例</h2><span className="detail-version">v{current.version}</span></header><div className="case-form"><div className="case-id-row"><span title={current.id}>用例 {caseDisplayNumber(current.id, catalog?.cases ?? [])}</span><button type="button" className="text-button" onClick={() => setSource(!source)}>来源</button></div><label className="field-label" htmlFor="ce-title">名称</label><textarea id="ce-title" className="title-input" rows={2} value={form.title} maxLength={500} disabled={busy || loading} onChange={e => change({ title: e.target.value })}/>
    {source && <div className="source-inline"><ol>{current.sourcePath.map((s, i) => <li key={i}>{s}</li>)}</ol><p>原始预期</p><p>{current.sourceExpected}</p></div>}
    <div className="prerequisite-heading"><span className="field-label">前置用例</span><button type="button" className="text-button" disabled={busy || loading} onClick={() => setPicker(!picker)}>编辑</button></div>
    {picker && <div className="ce-dependency-picker"><input placeholder="编号 / 关键词" aria-label="搜索前置用例" value={depQuery} onChange={e => setDepQuery(e.target.value)}/><div>{catalog.cases.filter(c => key(c) !== key(current) && (!depQuery || (c.id + ' ' + c.title).toLowerCase().includes(depQuery.toLowerCase()))).map(c => <label key={key(c)}><input type="checkbox" checked={form.prerequisites.some(d => key(d) === key(c))} onChange={e => toggleDep(c, e.target.checked)}/><span><b>{caseDisplayNumber(c.id, catalog.cases)}</b> {c.title}</span></label>)}</div></div>}
    {form.prerequisites.length ? <><table className="prerequisite-table"><thead><tr><th>编号</th><th>内容</th><th>状态</th></tr></thead><tbody>{form.prerequisites.map(d => { const c = byKey.get(key(d)); return <tr key={key(d)}><td><button type="button" className="text-button ref-link" title={d.caseId} onClick={() => c && guard(() => loadCase(c))}>{c ? caseDisplayNumber(c.id, catalog?.cases ?? []) : '—'}</button></td><td>{c?.title ?? '用例已归档或移除'}</td><td><CaseResultStatus status={c?.status}/></td></tr>; })}</tbody></table><p className={'dependency-gate' + (dependencyBlocked ? '' : ' ce-passed')}>{dependencyBlocked ? '前置未通过，暂不可执行' : '前置用例已通过'}</p></> : <div className="dependency-empty">{current.prerequisiteReview?.status === 'reviewed' ? '无前置用例' : current.prerequisiteReview?.status === 'pending' ? '前置待确认' : '前置待整理'}</div>}
    {current.prerequisiteReview && JSON.stringify(form.prerequisites) === JSON.stringify(current.prerequisites) && <details className="ce-prerequisite-details"><summary>前置说明{current.prerequisiteReview.status === 'pending' ? ' · 待确认' : ''}</summary><p className="ce-prerequisite-note">{current.prerequisiteReview.note}</p></details>}
    <label className="field-label" htmlFor="ce-steps">步骤</label><textarea id="ce-steps" rows={5} value={form.manual} placeholder="暂无步骤" disabled={busy || loading} onChange={e => change({ manual: e.target.value })}/><label className="field-label" htmlFor="ce-expected">预期</label><textarea id="ce-expected" rows={4} value={form.expected} disabled={busy || loading} onChange={e => change({ expected: e.target.value })}/></div></section>
   <section className="script-pane" aria-label="对应脚本"><header className="pane-header"><h2>脚本</h2><button type="button" className="text-button" onClick={() => void copy(form.script)}>复制</button></header><div className="file-strip"><svg className="ce-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg><span>{current.id}.json</span>{dirty && <span className="ce-dirty" aria-label="未保存"/>}<button type="button" className="text-button" onClick={() => void copy(new URL((location.pathname.startsWith('/dify/') ? '/dify' : '') + current.scriptPath, location.origin).href)}>路径</button></div>{current.executionSupport && !current.script.steps.length && <details className="ce-prerequisite-details"><summary>{current.executionSupport.label}{current.executionSupport.handler ? ' · ' + current.executionSupport.handler : ''}</summary><p>{current.executionSupport.nextAction}</p>{current.executionSupport.source && <code>{current.executionSupport.source}</code>}</details>}<div className="code-area"><pre ref={numbers} aria-hidden="true">{form.script.split('\n').map((_, i) => i + 1).join('\n')}</pre><textarea id="ce-script" value={form.script} spellCheck={false} wrap="off" aria-label="编辑对应脚本" disabled={busy || loading} onChange={e => change({ script: e.target.value })} onScroll={e => {
                    if (numbers.current)
                        numbers.current.scrollTop = e.currentTarget.scrollTop;
                }} onKeyDown={e => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        const el = e.currentTarget, start = el.selectionStart, end = el.selectionEnd;
                        change({ script: form.script.slice(0, start) + '  ' + form.script.slice(end) });
                        requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
                    }
                }}/></div></section></>}
  </CaseEditorColumns>{validation && <p className="ce-validation" role="alert">{validation}</p>}<footer className="editor-footer"><div className={'save-status' + (dirty ? ' ce-unsaved' : '')}><span /><strong>{busy ? '正在保存…' : dirty ? '未保存' : '已保存'}</strong></div><div className="footer-actions"><button type="button" disabled={!dirty || busy || loading} onClick={() => current && loadCase(current)}>放弃</button><button type="button" className="primary" title="保存为新版本，不执行测试" disabled={!dirty || busy || loading || !!validation} onClick={() => void save()}>保存</button></div></footer></>}
  {historyOpen && <section className="history-panel" aria-label="历史版本"><header><h2>历史版本</h2><button type="button" onClick={() => setHistoryOpen(false)}>关闭</button></header>{historyError ? <div className="ce-history-error"><p role="alert">{historyError}</p><button type="button" onClick={() => void showHistory()}>重试</button></div> : !history ? <p>正在读取…</p> : !history.length ? <p>暂无版本</p> : history.map(v => <div className="history-record" key={v.data.versionId}><strong>v{v.version}</strong><span>{v.data.changeSource === 'mcp' ? 'MCP' : v.data.changeSource === 'resources' ? '资源导入' : v.data.changeSource === 'manual' ? '手动' : '历史版本'}</span>{v.data.versionId === current?.versionId ? <span>当前</span> : <button type="button" disabled={busy || loading} onClick={() => guard(() => { setForm(fields(v.data)); setChangeOrigin('版本恢复'); setDiffOpen(true); setHistoryOpen(false); setNotice('已载入，保存后生效'); })}>恢复</button>}<span>{new Date(v.createdAt).toLocaleString('zh-CN', { hour12: false })}</span></div>)}</section>}
  <CaseEditorAiGuide systemId={catalog?.systemId ?? ''} open={aiOpen} onClose={() => setAiOpen(false)} onCopy={value => void copy(value)}/>
  {externalPending && <div role="status" className="ce-validation">外部已有新版本，当前编辑已保留。<button type="button" onClick={() => guard(() => void refresh(catalog?.systemId, current ? key(current) : undefined))}>查看更新</button></div>}
  {notice && <div className="ce-toast" role="status">{notice}</div>}
  <dialog ref={dialog} className="ce-switch-dialog"><h2>修改尚未保存</h2><p>切换会丢弃当前修改。</p><div><button type="button" onClick={() => dialog.current?.close()}>继续编辑</button><button type="button" onClick={() => { dialog.current?.close(); dirtyRef.current = false; pending.current(); }}>放弃并切换</button></div></dialog>
 </section>;
}
