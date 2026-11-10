import DepartmentCoreChains from './core-chains/core-chain-selector';
import { difyScriptArchiveName } from '../../../../src/domain/regression/script-package-layout';
import SelectionResults from './selected-case-results';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SystemModuleState, TestedSystem, FixedModule, BatchView } from '../../../../src/domain/regression/module-catalog-contract';
import type { WebModuleJobView } from '../../../../src/domain/regression/module-execution-contract';
import './execution-page.css';
import { supportsDepartmentDatabase } from '../../../../src/domain/database/regression-database-contract';
import { latestModuleSummary, type LatestModuleResults } from './latest-case-results';
import type { CoreState } from '../../../../src/domain/regression/core-chain-definitions';
import type { ReportFormat } from '../run-reports/report-export';
import { sidebarProjectEvents, type SidebarProjects } from '../../shared/project-selection';
const root = '/api/system-module-regression';
const evidenceRoot = location.pathname.startsWith('/dify/') ? '/dify/api/dify-web-modules' : '/api/dify-web-modules';
const labels: Record<string, string> = { queued: '等待开始', running: '正在回归', completed: '本轮结束', cancelled: '已取消', interrupted: '未完成', preflight: '连接测试窗口', 'awaiting-login': '等待登录', preparing: '准备脚本', dispatching: '派发用例', executing: '网页执行', reporting: '汇总结果', error: '未完成', blocked: '阻塞', passed: '通过', failed: '失败', not_executed: '未执行' };
const notificationLabels: Record<string, string> = { disabled: '未启用', 'not-needed': '无需通知', sending: '发送中', sent: '已发送', failed: '发送失败', partial: '部分送达', uncertain: '接收结果待核对' };
const activeJob = (job: WebModuleJobView) => !['completed', 'error', 'blocked', 'cancelled', 'interrupted'].includes(job.phase);
const resultCounts = (job: WebModuleJobView) => {
    const counts = { passed: 0, blocked: 0, failed: 0, not_executed: 0, error: 0, outside: 0 };
    for (const result of job.results) {
        if (result.outOfScope) {
            counts.outside += 1;
            continue;
        }
        if (result.status === 'passed')
            counts.passed += 1;
        else if (result.status === 'blocked')
            counts.blocked += 1;
        else if (result.status === 'failed')
            counts.failed += 1;
        else if (result.status === 'not_executed')
            counts.not_executed += 1;
        else if (result.status === 'error')
            counts.error += 1;
    }
    return counts;
};
const ResultCounts = ({ job }: {
    job: WebModuleJobView;
}) => { const c = resultCounts(job); return <span className="sm-module-counts"><span className="sm-passed">通过 {c.passed}</span><span className="sm-blocked">阻塞 {c.blocked}</span>{c.failed > 0 && <span className="sm-failed">失败 {c.failed}</span>}{c.not_executed > 0 && <span className="sm-not-executed">未执行 {c.not_executed}</span>}{c.error > 0 && <span className="sm-failed">异常 {c.error}</span>}{c.outside > 0 && <span className="sm-outside">范围外 {c.outside}</span>}</span>; };
async function api<T>(path = '', data?: unknown): Promise<T> {
    const controller = !path && data === undefined ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : undefined;
    try {
        const r = await fetch(root + path, data === undefined ? { ...(controller ? { signal: controller.signal } : {}) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const value = await r.json();
        if (!r.ok)
            throw Error(value.error ?? '操作失败。');
        return value;
    }
    catch (e) {
        if (controller?.signal.aborted)
            throw Error('本地服务响应超时，系统和模块尚未加载。请重试；也可在 Edge 或 Chrome 打开当前地址。');
        throw e;
    }
    finally {
        clearTimeout(timer);
    }
}
const latest = (m: FixedModule) => m.versions[m.versions.length - 1]!;
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function Modal({ title, onClose, children, error }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    error: string;
}) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []); return <dialog className="sm-modal" ref={ref} onCancel={onClose}><header><h2>{title}</h2><button onClick={onClose}>关闭</button></header>{error && <p role="alert" className="sm-modal-error">{error}</p>}{children}</dialog>; }
type CasePack = {
    module: FixedModule;
    version: {
        id: string;
        version: number;
    };
    cases: Array<{
        id: string;
        title: string;
        expected: string;
        source: string;
        steps: unknown[];
        priority: string;
    }>;
    readiness?: Array<{
        caseId: string;
        hasFixedSteps: boolean;
        coverageGap?: string;
        detail?: string;
        nextAction?: string;
    }>;
};
function ReportExport({ format, onFormat, onDownload, disabled }: {
    format: ReportFormat;
    onFormat: (value: ReportFormat) => void;
    onDownload: () => void;
    disabled: boolean;
}) { return <span className="sm-report-export"><select aria-label="报告格式" value={format} onChange={e => onFormat(e.target.value as ReportFormat)} disabled={disabled}><option value="xlsx">Excel 表格（.xlsx）</option><option value="xmind">XMind（.xmind）</option></select><button onClick={onDownload} disabled={disabled}>下载报告</button></span>; }
type ExecutionScope = 'all' | 'custom' | 'chains';
type CustomCaseSelection = Record<string, {
    versionId: string;
    caseIds: string[];
}>;
export default function SystemModuleWorkbench() {
    const initial = new URLSearchParams(location.search);
    const [state, setState] = useState<SystemModuleState>();
    const [systemId, setSystemId] = useState(initial.get('system') ?? '');
    const [batchId, setBatchId] = useState(initial.get('batch') ?? '');
    const [chosen, setChosen] = useState<string[]>([]);
    const selectionSystem = useRef('');
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loadError, setLoadError] = useState('');
    const [modal, setModal] = useState<'' | 'system' | 'manage' | 'cases'>('');
    const [systemEdit, setSystemEdit] = useState<TestedSystem | null>(null);
    const [name, setName] = useState('');
    const [target, setTarget] = useState('');
    const [environment, setEnvironment] = useState('测试环境');
    const [accountName, setAccountName] = useState('');
    const [databaseEnabled, setDatabaseEnabled] = useState(false);
    const [notifyFailures, setNotifyFailures] = useState(false);
    const [notifyScreenshots, setNotifyScreenshots] = useState(false);
    const [editing, setEditing] = useState('');
    const [moduleName, setModuleName] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [legacyId, setLegacyId] = useState('');
    const [pack, setPack] = useState<CasePack>();
    const [versionId, setVersionId] = useState('');
    const [reportFormat, setReportFormat] = useState<ReportFormat>('xlsx');
    const [coreState, setCoreState] = useState<CoreState>();
    const [coreRunId, setCoreRunId] = useState(initial.get('coreRun') ?? '');
    const [coreLoadError, setCoreLoadError] = useState('');
    const [scope, setScope] = useState<ExecutionScope>(initial.get('scope') === 'all' || initial.get('scope') === 'starter' ? 'all' : initial.get('scope') === 'custom' ? 'custom' : 'chains');
    const [customCases, setCustomCases] = useState<CustomCaseSelection>({});
    const [caseIds, setCaseIds] = useState<string[]>([]);
    const [priority, setPriority] = useState('all');
    const [expanded, setExpanded] = useState('');
    const [detailId, setDetailId] = useState('');
    const [filter, setFilter] = useState('all');
    const resultPanelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (expanded)
            resultPanelRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, [expanded]);
    const system = state?.systems.find(s => s.id === systemId);
    const history = state?.batches.filter(b => b.systemId === systemId) ?? [];
    const batch = scope === 'chains' ? undefined : history.find(b => b.id === batchId);
    const liveModules = state?.modules.filter(m => m.systemId === systemId && !m.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [];
    const modules = (state?.modules.filter(m => m.systemId === systemId && (!m.archived || batch?.entries.some(e => e.moduleId === m.id))) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(m => { const entry = batch?.entries.find(e => e.moduleId === m.id), version = m.versions.find(v => v.id === entry?.versionId); return version ? { ...m, versions: [...m.versions.filter(v => v.id !== version.id), version] } : m; });
    const coreRun = scope === 'chains' ? coreState?.runs.find(r => r.id === coreRunId) : undefined;
    const coreOccupied = !!coreState?.runs.some(r => ['queued', 'running', 'awaiting-login'].includes(r.phase));
    const historical = !!batch || !!coreRun;
    const viewedRun = batch ?? coreRun;
    const activeBatch = history.find(b => ['queued', 'running'].includes(b.phase));
    const savedAccount = systemId ? state?.accounts[systemId] : undefined;
    const account = savedAccount?.profileId && savedAccount.profileId !== (system?.activeAccountId ?? system?.profileId) ? undefined : savedAccount;
    const connecting = account?.state === 'connecting' || account?.state === 'awaiting-login';
    const occupied = !!activeBatch || connecting || coreOccupied;
    const waiting = activeBatch?.jobs.find(j => j.phase === 'awaiting-login');
    const current = activeBatch?.jobs.find(j => activeJob(j) && j.phase !== 'queued') ?? activeBatch?.jobs.find(activeJob);
    const runLabel = waiting ? '等待登录' : activeBatch?.phase === 'queued' ? '等待开始' : '正在运行';
    const finishedModules = activeBatch?.jobs.filter(j => !activeJob(j)).length ?? 0;
    // 固定脚本执行走本地浏览器，不依赖 Dify；只有 AI 辅助（assist）才需要 Dify 工作流。
    // 这里不能再拿 configured.execution 当开关，否则没配 Dify 的机器连固定脚本都跑不了。
    const canRun = !!state;
    useEffect(() => {
        const publish = () => {
            if (!state)
                return;
            const detail: SidebarProjects = { systems: state.systems.map(s => ({ id: s.id, name: s.name })), systemId, disabled: busy || occupied };
            window.dispatchEvent(new CustomEvent(sidebarProjectEvents.state, { detail }));
        };
        const select = (event: Event) => {
            const id = (event as CustomEvent<string>).detail;
            if (!busy && !occupied && state?.systems.some(s => s.id === id)) {
                setSystemId(id);
                setBatchId('');
            }
        };
        publish();
        window.addEventListener(sidebarProjectEvents.request, publish);
        window.addEventListener(sidebarProjectEvents.select, select);
        return () => { window.removeEventListener(sidebarProjectEvents.request, publish); window.removeEventListener(sidebarProjectEvents.select, select); };
    }, [state, systemId, busy, occupied]);
    const selected = modules.filter(m => chosen.includes(m.id));
    const latestResults = useMemo(() => {
        const index: LatestModuleResults = new Map();
        for (const entry of batch?.entries ?? []) {
            const job = batch?.jobs.find(j => j.id === entry.jobId);
            if (job)
                index.set(entry.moduleId + ':' + entry.versionId, new Map(job.results.map(result => [result.caseId, { result, batchId: batch!.id, jobId: job.id, startedAt: Date.parse(job.createdAt) }])));
        }
        return index;
    }, [batch]);
    const customIds = (m: FixedModule) => customCases[m.id]?.versionId === latest(m).id ? customCases[m.id]!.caseIds : undefined;
    const scopeCount = (m: FixedModule) => batch ? (batch.entries.find(e => e.moduleId === m.id)?.selectedCaseIds?.length ?? batch.entries.find(e => e.moduleId === m.id)?.caseCount ?? 0) : scope === 'all' ? latest(m).caseCount : customIds(m)?.length ?? 0;
    const selectedCount = selected.reduce((sum, m) => sum + scopeCount(m), 0);
    const selectionReady = selected.length > 0 && selected.every(m => scopeCount(m) > 0);
    const batchCount = batch?.entries.reduce((sum, e) => sum + (e.selectedCaseIds?.length ?? e.caseCount), 0) ?? 0;
    const batchRange = batch?.scope === 'starter' ? '自选用例（原日常范围）' : batch?.scope === 'core' ? '自选用例（原固定范围）' : scope === 'all' ? '全部用例' : '自选用例';
    function resetResults() { setExpanded(''); setDetailId(''); setFilter('all'); }
    function scopeForBatch(b: BatchView): ExecutionScope { return b.scope === 'all' && b.entries.every(e => !e.selectedCaseIds || e.selectedCaseIds.length === e.caseCount) ? 'all' : 'custom'; }
    function selectBatch(id: string) {
        const b = history.find(b => b.id === id);
        if (!b)
            return;
        setBatchId(id);
        setCoreRunId('');
        setScope(scopeForBatch(b));
        setChosen(b.entries.map(e => e.moduleId));
        setCustomCases(Object.fromEntries(b.entries.map(e => [e.moduleId, { versionId: e.versionId, caseIds: e.selectedCaseIds ?? [] }])));
        resetResults();
    }
    function selectCore(id: string) { setScope('chains'); setBatchId(''); setCoreRunId(id); resetResults(); }
    function newDraft(next: ExecutionScope = scope) { setScope(next); setBatchId(''); setCoreRunId(''); setChosen(next === 'custom' ? [] : liveModules.map(m => m.id)); setCustomCases({}); resetResults(); }
    function changeScope(next: ExecutionScope) {
        newDraft(next);
    }
    function selectHistory(value: string) {
        if (value.startsWith('core:'))
            selectCore(value.slice(5));
        else if (value.startsWith('batch:'))
            selectBatch(value.slice(6));
        else
            newDraft();
    }
    async function refreshCore() {
        if (!systemId)
            return;
        const next = await api<CoreState>('/core-chains?systemId=' + encodeURIComponent(systemId));
        setCoreState(next);
        setCoreLoadError('');
    }
    useEffect(() => {
        if (!systemId)
            return;
        let alive = true, timer: ReturnType<typeof setTimeout>;
        setCoreState(undefined);
        const poll = async () => {
            try {
                const data = await api<CoreState>('/core-chains?systemId=' + encodeURIComponent(systemId));
                if (alive) {
                    setCoreState(data);
                    setCoreLoadError('');
                }
            }
            catch (e) {
                if (alive)
                    setCoreLoadError((e as Error).message);
            }
            finally {
                if (alive)
                    timer = setTimeout(poll, 1800);
            }
        };
        void poll();
        return () => { alive = false; clearTimeout(timer); };
    }, [systemId]);
    async function refresh() { const next = await api<SystemModuleState>(); setState(next); setLoadError(''); return next; }
    useEffect(() => {
        let live = true;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const next = await api<SystemModuleState>();
                if (live) {
                    setState(next);
                    setLoadError('');
                }
            }
            catch (e) {
                if (live)
                    setLoadError((e as Error).message);
            }
            finally {
                if (live)
                    timer = setTimeout(() => void poll(), 1800);
            }
        };
        void poll();
        return () => { live = false; clearTimeout(timer); };
    }, []);
    useEffect(() => {
        if (!state)
            return;
        if (!systemId) {
            if (state.systems.length)
                setSystemId(state.systems[0]!.id);
            return;
        }
        if (!system)
            return;
        if (selectionSystem.current !== systemId) {
            const switchingSystem = selectionSystem.current !== '';
            selectionSystem.current = systemId;
            const requested = !switchingSystem && scope !== 'chains' ? history.find(b => b.id === batchId) : undefined;
            if (requested)
                selectBatch(requested.id);
            else {
                setChosen(scope === 'custom' ? [] : system.selectedModuleIds);
                setCustomCases({});
                setBatchId('');
                if (switchingSystem || scope !== 'chains')
                    setCoreRunId('');
                resetResults();
            }
        }
    }, [state, systemId]);
    useEffect(() => {
        if (batch) {
            setChosen(batch.entries.map(e => e.moduleId));
            setCustomCases(Object.fromEntries(batch.entries.map(e => [e.moduleId, { versionId: e.versionId, caseIds: e.selectedCaseIds ?? [] }])));
        }
        if (batch)
            setScope(scopeForBatch(batch));
    }, [batch?.id]);
    useEffect(() => {
        const url = new URL(location.href);
        url.searchParams.set('page', 'dify-regression');
        url.searchParams.set('scope', scope);
        for (const key of ['tab', 'job', 'module'])
            url.searchParams.delete(key);
        systemId ? url.searchParams.set('system', systemId) : url.searchParams.delete('system');
        scope !== 'chains' && batchId ? url.searchParams.set('batch', batchId) : url.searchParams.delete('batch');
        scope === 'chains' && coreRunId ? url.searchParams.set('coreRun', coreRunId) : url.searchParams.delete('coreRun');
        if (batchId || coreRunId)
            url.searchParams.delete('draft');
        else
            url.searchParams.set('draft', '1');
        window.history.replaceState(window.history.state, '', url);
    }, [systemId, batchId, coreRunId, scope]);
    async function perform(work: () => Promise<void>) {
        if (lock.current)
            return;
        lock.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await work();
            await refresh();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    function openSystem(value: TestedSystem | null) { setSystemEdit(value); setAccountName(''); setDatabaseEnabled(!!value?.databaseBinding); setNotifyFailures(!!value?.notifyFailures); setNotifyScreenshots(!!value?.notifyScreenshots); setName(value?.name ?? ''); setTarget(value?.targetUrl ?? ''); setEnvironment(value?.environment ?? '测试环境'); setModal('system'); }
    async function saveSystem() { const s = await api<TestedSystem>('/systems', { ...(systemEdit ? { id: systemEdit.id } : {}), name, environment, targetUrl: target, notifyFailures, notifyScreenshots, databaseBinding: databaseEnabled ? 'department-supply-readonly' : null }); setSystemId(s.id); setBatchId(''); setModal(''); setNotice('系统已保存。'); }
    function manage() { setEditing(''); setModuleName(''); setFile(null); setLegacyId(''); setModal('manage'); }
    async function savePack() {
        if (!system)
            throw Error('请先选择系统。');
        if (!file)
            throw Error('请选择 CSV 或 Markdown 用例包。');
        const bytesBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(Error('读取文件失败。')); reader.readAsDataURL(file); });
        const saved = await api<FixedModule>('/modules/import', { systemId: system.id, ...(editing ? { moduleId: editing } : {}), name: moduleName, fileName: file.name, bytesBase64 });
        setFile(null);
        setEditing(saved.id);
        setModuleName(saved.name);
        const v = latest(saved);
        setNotice(`已保存 v${v.version}：新增 ${v.added}、修改 ${v.changed}、移除 ${v.removed} 条；旧版本保留。`);
    }
    async function showCases(key: string, version?: string) { const next = await api<CasePack>(`/modules/${key}${version ? `?version=${version}` : ''}`); setPack(next); setCaseIds(batch ? (batch.entries.find(e => e.moduleId === key)?.selectedCaseIds ?? next.cases.map(c => c.id)) : scope === 'all' ? next.cases.map(c => c.id) : customCases[key]?.versionId === next.version.id ? customCases[key]!.caseIds : []); setPriority('all'); setVersionId(String(next.version.version)); setModal('cases'); }
    async function exportReport() {
        const reports = await import('../run-reports/report-export');
        if (coreRun)
            await reports.downloadCoreRegressionReport(coreRun, reportFormat);
        else if (batch)
            await reports.downloadRegressionReport(batch.id, reportFormat);
        else
            throw Error('请先选择历史运行批次。');
    }
    async function start() {
        if (!system)
            throw Error('请先选择系统。');
        if (!selectionReady)
            throw Error(scope === 'custom' ? '请为已勾选模块选择用例，或取消勾选该模块。' : '请选择要执行的模块。');
        const b = await api<BatchView>('/batches', { systemId: system.id, moduleIds: selected.map(m => m.id), versionSelections: Object.fromEntries(selected.map(m => [m.id, latest(m).id])), runMode: 'fixed', scope, ...(scope === 'custom' ? { caseSelections: Object.fromEntries(selected.map(m => [m.id, customIds(m)!])) } : {}), requestId: crypto.randomUUID() });
        setBatchId(b.id);
        setExpanded('');
        setDetailId('');
    }
    async function download(path: string, fileName: string, data?: unknown) {
        const response = await fetch(root + path, data === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        if (!response.ok) {
            const result = await response.json();
            throw Error(result.error ?? '导出未完成。');
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        const encodedName = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        link.download = encodedName ? decodeURIComponent(encodedName) : fileName;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    function applyCustom() {
        if (!pack || pack.version.id !== latest(pack.module).id)
            return;
        const next = { ...customCases, [pack.module.id]: { versionId: pack.version.id, caseIds: [...caseIds] } };
        setCustomCases(next);
        setChosen(modules.filter(m => next[m.id]?.versionId === latest(m).id && next[m.id]!.caseIds.length > 0).map(m => m.id));
        setScope('custom');
        setModal('');
        setNotice('已更新自选范围，可继续选择其他模块，或开始测试。');
    }
    async function runCases(ids: string[], runMode: 'fixed' | 'assist' = 'fixed') {
        if (!canRun || runMode === 'assist' && !state?.configured.prepare)
            throw Error('请先配置该操作需要的 Dify 工作流。');
        if (!pack || !system || !ids.length)
            throw Error('请选择用例。');
        const b = await api<BatchView>('/batches', { systemId: system.id, moduleIds: [pack.module.id], runMode, scope: 'custom', caseSelections: { [pack.module.id]: ids }, versionSelections: { [pack.module.id]: pack.version.id }, requestId: crypto.randomUUID() });
        setCustomCases(selections => ({ ...selections, [pack.module.id]: { versionId: pack.version.id, caseIds: [...ids] } }));
        setChosen([pack.module.id]);
        setScope('custom');
        setBatchId(b.id);
        setModal('');
        setExpanded('');
        setDetailId('');
    }
    async function retestCase(id: string) {
        if (!batch || !selectedJob)
            return;
        const entry = batch.entries.find(e => e.jobId === selectedJob.id)!;
        const b = await api<BatchView>(`/batches/${batch.id}/retest`, { mode: 'selected', moduleId: entry.moduleId, caseIds: [id], requestId: crypto.randomUUID() });
        setBatchId(b.id);
        setExpanded('');
        setDetailId('');
    }
    async function retest(mode: 'failed' | 'unfinished' | 'pending' | 'checkpoint') {
        if (!batch)
            return;
        const b = await api<BatchView>(`/batches/${batch.id}/retest`, { mode, requestId: crypto.randomUUID() });
        setBatchId(b.id);
        setExpanded('');
        setDetailId('');
    }
    function moduleResult(id: string) {
        const module = modules.find(m => m.id === id);
        if (!module)
            return { label: '待执行', type: 'not_executed' };
        if (!chosen.includes(id))
            return { label: batch ? '本批次未执行' : '未选择', type: 'not_executed' };
        const ids = batch ? batch.entries.find(e => e.moduleId === id)?.selectedCaseIds : scope === 'custom' ? customIds(module) : undefined;
        if (!batch && scope !== 'all' && !ids?.length)
            return { label: '未执行', type: 'not_executed' };
        return latestModuleSummary(latestResults, id, latest(module).id, ids, latest(module).caseCount);
    }
    const selectedJob = batch?.jobs.find(j => j.id === expanded);
    const detail = selectedJob?.results.find(r => r.caseId === detailId);
    const rows = selectedJob?.results.filter(r => filter === 'all' || (filter === 'outside' ? r.outOfScope : !r.outOfScope && r.status === filter)) ?? [];
    return <div className="sm-workbench">
    <header className="sm-title"><div className="sm-title-main"><h1>执行测试</h1>{activeBatch && <span className={`sm-run-label${waiting ? ' sm-run-paused' : ''}`}>{runLabel}</span>}</div><div className="sm-actions"><a href={(() => { const url = new URL(location.href); url.searchParams.set('view', 'legacy'); url.searchParams.set('scope', scope); systemId ? url.searchParams.set('system', systemId) : url.searchParams.delete('system'); scope !== 'chains' && batchId ? url.searchParams.set('batch', batchId) : url.searchParams.delete('batch'); scope === 'chains' && coreRunId ? url.searchParams.set('coreRun', coreRunId) : url.searchParams.delete('coreRun'); return url.href; })()}>旧版记录</a><button className="sm-link" onClick={() => openSystem(null)} disabled={busy}>新增系统</button></div></header>
    {error && !modal && <div className="sm-error" role="alert"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}
    {loadError && <div className="sm-error" role="alert"><span>{loadError}</span><button disabled={busy} onClick={() => void perform(async () => { await refresh(); })}>重新加载</button></div>}
    {notice && <div className="sm-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
    {activeBatch && <section className={`sm-progress sm-live-progress${waiting ? ' sm-run-paused' : ''}${activeBatch.phase === 'queued' ? ' sm-run-queued' : ''}`} aria-label="当前运行状态">
      <div className="sm-live-status" role="status" aria-live="polite"><span className="sm-run-spinner" aria-hidden="true"/><div><strong>{runLabel}{current && !waiting ? ' · ' + (labels[current.phase] ?? current.phase) : ''}</strong><p>{waiting ? '请在测试窗口完成登录，然后点击“我已登录”继续。' : current?.moduleName ?? activeBatch.message}</p></div></div>
      {current?.progress?.currentCase && <p className="sm-current-case">当前用例：{current.progress.currentCase.title}</p>}
      <div className="sm-live-meter"><span>已结束 {finishedModules} / {activeBatch.entries.length} 个模块{current?.progress && current.progress.total > 0 ? ` · 当前模块已执行 ${current.progress.completed} / ${current.progress.total} 条` : ''}</span><progress aria-label={current?.progress && current.progress.total > 0 ? '当前模块用例进度' : '模块执行进度'} value={current?.progress && current.progress.total > 0 ? current.progress.completed : finishedModules} max={current?.progress && current.progress.total > 0 ? current.progress.total : activeBatch.entries.length || 1}/></div>
      <div className="sm-live-actions">{batchId !== activeBatch.id && <button onClick={() => { selectBatch(activeBatch.id); }}>查看运行批次</button>}<button disabled={busy} onClick={() => void perform(async () => { await api(`/batches/${activeBatch.id}/cancel`, {}); })}>取消本轮</button></div>
    </section>}
    <section className="sm-system" aria-label="被测系统"><div className="sm-system-name"><select aria-label="选择系统" value={systemId} onChange={e => { setSystemId(e.target.value); setBatchId(''); }} disabled={busy}><option value="" disabled>选择系统</option>{state?.systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{system && <><span className="sm-environment" title="系统设置中填写的环境名称，用于区分测试、预发布或正式环境。">环境：{viewedRun?.environment ?? system.environment}</span>{!historical && system.databaseBinding && <span className={`sm-connection ${state?.database?.connected ? 'sm-connection-connected' : 'sm-connection-pending'}`}>{state?.database?.connected ? '数据库已连接' : '数据库待连接'}</span>}<button className="sm-link" onClick={() => openSystem(system)} disabled={busy || occupied}>系统设置</button></>}</div>{system && !historical && <div className="sm-account"><select aria-label="选择测试账号" value={activeBatch?.profileId ?? system.activeAccountId ?? system.profileId} disabled={busy || occupied} onChange={e => void perform(async () => { await api(`/systems/${system.id}/account-selection`, { accountId: e.target.value }); })}><option value={system.profileId}>我的账号</option>{system.accountProfiles?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><span className={`sm-connection ${!waiting && account?.state === 'connected' ? 'sm-connection-connected' : 'sm-connection-pending'} sm-account-${waiting ? 'awaiting-login' : account?.state ?? 'unknown'}`} title={account?.message}>{waiting ? '等待登录' : ({ unknown: '尚未登录', saved: '登录信息已保存', connecting: '正在打开', 'awaiting-login': '等待登录', connected: '已登录', error: '连接未完成' }[account?.state ?? 'unknown'])}</span>{waiting ? <button onClick={() => void perform(async () => { await api(`/batches/${activeBatch!.id}/continue`, {}); })} disabled={busy}>我已登录</button> : account?.state === 'awaiting-login' ? <button onClick={() => void perform(async () => { await api(`/systems/${system.id}/continue`, {}); })} disabled={busy}>我已登录</button> : <button disabled={busy || occupied} onClick={() => void perform(async () => { await api(`/systems/${system.id}/connect`, {}); })}>{account?.state === 'connected' || account?.state === 'saved' ? '打开被测系统' : '连接我的账号'}</button>}{connecting && <button className="sm-link" onClick={() => void perform(async () => { await api(`/systems/${system.id}/disconnect`, {}); })} disabled={busy}>取消连接</button>}</div>}<div className="sm-history"><strong>历史运行批次</strong><select aria-label="历史运行批次" value={coreRun ? 'core:' + coreRun.id : batch ? 'batch:' + batch.id : ''} onChange={e => selectHistory(e.target.value)} disabled={busy}><option value="">新建运行</option>{coreState?.runs.length ? <optgroup label="核心用例">{coreState.runs.map(r => <option key={r.id} value={'core:' + r.id}>{date(r.createdAt)} · {r.chains.length} 条链路 · {labels[r.phase]}</option>)}</optgroup> : null}{(['all', 'custom'] as const).map(category => <optgroup key={category} label={category === 'all' ? '全部用例' : '自选用例 / 历史范围'}>{history.filter(b => scopeForBatch(b) === category).map(b => <option key={b.id} value={'batch:' + b.id}>{date(b.createdAt)} · {b.entries.length} 个模块 · {b.entries.reduce((n, e) => n + (e.selectedCaseIds?.length ?? e.caseCount), 0)} 条 · {labels[b.phase]}</option>)}</optgroup>)}</select>{historical && <><button onClick={() => newDraft()} disabled={busy}>新建运行</button><ReportExport format={reportFormat} onFormat={setReportFormat} onDownload={() => void perform(exportReport)} disabled={busy}/></>}</div>{viewedRun && <div className="sm-history-context" aria-live="polite">正在查看 {date(viewedRun.createdAt)} · {viewedRun.environment} · {batch?.accountName ?? system?.accountProfiles?.find(a => a.id === viewedRun.profileId)?.name ?? (viewedRun.profileId === system?.profileId ? '我的账号' : '历史账号')} · {labels[viewedRun.phase]} · 范围只读，点“新建运行”重新选择。</div>}</section>
    <div className="core-execution-selector"><label htmlFor="execution-category">执行范围</label><select id="execution-category" aria-label="执行范围" value={scope} onChange={e => changeScope(e.target.value as ExecutionScope)} disabled={busy || occupied}><option value="chains">核心用例</option><option value="all">全部用例</option><option value="custom">自选用例</option></select></div>
    {coreLoadError && <p className="sm-error" role="alert">核心批次加载失败：{coreLoadError}<button onClick={() => void perform(refreshCore)} disabled={busy}>重新加载</button></p>}
    {scope === 'chains' && system && <DepartmentCoreChains systemId={system.id} occupied={!!activeBatch || connecting} state={coreState} run={coreRun} onRun={selectCore} onRefresh={refreshCore}/>}
    {scope !== 'chains' && <><section aria-label="固定模块">
      <div className="sm-heading"><h2>{batch ? '本批次模块' : '选择模块'}</h2><div className="sm-actions"><button className="sm-link" disabled={!!batch || !system || busy || occupied} onClick={() => setChosen(system?.selectedModuleIds ?? [])}>恢复上次选择</button><button disabled={!system || busy} onClick={manage}>管理模块</button></div></div>
      <div className="sm-table"><table><thead><tr><th><input type="checkbox" aria-label="选择全部模块" disabled={!!batch || busy || occupied || !modules.length} checked={modules.length > 0 && selected.length === modules.length} ref={el => {
                if (el)
                    el.indeterminate = selected.length > 0 && selected.length < modules.length;
            }} onChange={e => setChosen(e.target.checked ? modules.map(m => m.id) : [])}/></th><th>模块</th><th>本次 / 模块全部</th><th>{batch ? '本批次结果' : '运行结果'}</th><th>操作</th></tr></thead><tbody>{modules.map(m => { const result = moduleResult(m.id); return <tr key={m.id} className={chosen.includes(m.id) ? 'sm-selected' : ''}><td><input type="checkbox" aria-label={'选择' + m.name} disabled={!!batch || busy || occupied} checked={chosen.includes(m.id)} onChange={e => setChosen(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))}/></td><td><div className="sm-module-name">{m.name}{m.pendingScriptReviewCount ? <span className="sm-script-review-badge" title="有脚本待核对，但不阻止运行">待核对（可选） {m.pendingScriptReviewCount}</span> : null}{m.missingScriptCount ? <span className="sm-script-review-badge" title="这些用例还没有可执行脚本">待补脚本 {m.missingScriptCount}</span> : null}</div></td><td>{chosen.includes(m.id) ? scope === 'custom' && customCases[m.id] && !customIds(m) ? '需重选' : scopeCount(m) : 0} / {latest(m).caseCount}</td><td>{'counts' in result && result.counts && Object.values(result.counts).some(count => count > 0) ? <span className="sm-module-counts" aria-label={result.label}>{Object.entries(result.counts).filter(([, count]) => count > 0).map(([status, count]) => <span key={status} className={`sm-${status === 'not_executed' ? 'not-executed' : status === 'error' ? 'failed' : status}`}>{count} {status === 'outside' ? '范围外' : labels[status]}</span>)}</span> : <span className={'sm-badge sm-' + result.type}>{result.label}</span>}</td><td><button className="sm-link" onClick={() => void perform(() => showCases(m.id, batch?.entries.find(e => e.moduleId === m.id)?.versionId))} disabled={busy}>{scope === 'custom' && !batch ? '选择用例' : '查看用例'}</button></td></tr>; })}{!modules.length && <tr><td colSpan={5} className="sm-empty">{state ? '还没有固定模块' : '正在加载…'}　<button className="sm-link" disabled={!system} onClick={manage}>导入模块</button></td></tr>}</tbody></table></div>
      <div className="sm-launch"><span aria-live="polite">{batch ? '本批次' : '本次选择'} <strong>{selected.length}</strong> 个模块 · <strong>{selectedCount}</strong> 条用例</span><div className="sm-run-controls"><span className="sm-scope-field">{scope === 'all' ? '全部用例' : '自选用例'}</span><button className="sm-primary" disabled={busy || occupied || !selectionReady || !canRun} onClick={() => void perform(async () => {
                if (batch) {
                    const b = await api<BatchView>('/batches/' + batch.id + '/retest', { mode: 'all', requestId: crypto.randomUUID() });
                    setBatchId(b.id);
                    resetResults();
                }
                else
                    await start();
            })}>{activeBatch ? runLabel : batch ? '按此范围重新运行' : '开始测试'}</button></div></div>

      {scope === 'custom' && selected.some(m => !scopeCount(m)) && <p className="sm-scope-note">请为已勾选模块选择用例，或取消勾选该模块。</p>}
      {state && !state.configured.execution && <div className="sm-hint">固定脚本执行不需要 Dify；未配置 Dify 只影响「AI 辅助整理」。</div>}
    </section>



    {!batch && <SelectionResults downloadDisabled={busy || occupied || !selectionReady} onDownload={() => void perform(() => download('/scripts/export', 'Dify_当前范围_固定脚本.zip', { systemId, moduleIds: selected.map(m => m.id), scope, versionSelections: Object.fromEntries(selected.map(m => [m.id, latest(m).id])), ...(scope === 'custom' ? { caseSelections: Object.fromEntries(selected.map(m => [m.id, customIds(m)])) } : {}) }))} modules={selected} scope={scope} caseSelections={Object.fromEntries(selected.map(m => [m.id, scope === 'custom' ? customIds(m) : undefined]))} latestResults={latestResults} onSource={(sourceBatch, sourceJob) => { selectBatch(sourceBatch); setExpanded(sourceJob); }}/>}
    </>}
    {scope !== 'chains' && batch && <section className="sm-results" aria-label="所选历史批次结果"><div className="sm-heading"><div><h2>运行结果</h2><p className="sm-batch-range">{batchRange} · {batchCount} 条 · {labels[batch.phase]}</p></div><div className="sm-counts"><span className="sm-passed">通过 {batch.counts.passed}</span><span className="sm-blocked">阻塞 {batch.counts.blocked}</span><span className="sm-failed">失败 {batch.counts.failed}</span>{batch.counts.not_executed > 0 && <span className="sm-not-executed">未执行 {batch.counts.not_executed}</span>}{batch.counts.error > 0 && <span className="sm-failed">异常 {batch.counts.error}</span>}{batch.counts.outside > 0 && <span className="sm-outside">范围外 {batch.counts.outside}</span>}</div></div>{batch.phase === 'interrupted' && <p className="sm-error">{batch.message}</p>}<div className="sm-table"><table><thead><tr><th>模块</th><th>版本</th><th>用例</th><th>结果</th><th>操作</th></tr></thead><tbody>{batch.entries.map(e => { const job = batch.jobs.find(j => j.id === e.jobId); const status = job ? (activeJob(job) ? job.phase : job.phase === 'completed' ? job.outcome : job.phase) : 'not_executed'; return <tr key={e.moduleId}><td>{e.moduleName}</td><td>v{e.version}</td><td>{job?.results.length ?? e.selectedCaseIds?.length ?? e.caseCount}</td><td>{job?.phase === 'completed' ? <ResultCounts job={job}/> : <span className={`sm-badge sm-${status}`}>{labels[status]}</span>}</td><td><button className="sm-link" disabled={!job} onClick={() => { setExpanded(job?.id === expanded ? '' : job?.id ?? ''); setDetailId(''); setFilter('all'); }}>查看结果</button></td></tr>; })}</tbody></table></div>
      {selectedJob && <div className="sm-case-results" ref={resultPanelRef} tabIndex={-1}><div className="sm-heading"><h3>{selectedJob.moduleName} · {selectedJob.results.length} 条结果</h3><ResultCounts job={selectedJob}/><select aria-label="筛选用例结果" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option><option value="failed">失败</option><option value="blocked">阻塞</option><option value="passed">通过</option><option value="not_executed">未执行</option><option value="outside">范围外</option></select></div><div className="sm-table"><table><thead><tr><th>用例</th><th>结果</th><th>证据</th></tr></thead><tbody>{rows.map(r => <Fragment key={r.caseId}><tr><td><span className="sm-priority">{r.priority ?? '—'}</span>{r.title}</td><td><span className={`sm-badge sm-${r.outOfScope ? 'outside' : r.status}`}>{r.outOfScope ? '范围外' : labels[r.status]}</span></td><td><div className="sm-evidence-links"><button className="sm-link" aria-expanded={detailId === r.caseId} onClick={() => setDetailId(detailId === r.caseId ? '' : r.caseId)}>{detailId === r.caseId ? '收起详情' : '查看详情'}</button>{r.evidence && ['failed', 'blocked'].includes(r.status) && <a href={`${evidenceRoot}/jobs/${selectedJob.id}/evidence/${r.evidence}`} target="_blank" rel="noreferrer" aria-label={`${r.caseId} 的本轮截图`}>截图</a>}</div></td></tr>{detailId === r.caseId && detail && <tr className="sm-detail-row"><td colSpan={3}><div className="sm-evidence"><h3>{detail.title}</h3><h4>原始预期</h4><p>{detail.expected}</p><h4>实际结果</h4><p>{detail.detail}</p>{detail.nextAction && <p>{detail.nextAction}</p>}{detail.evidenceNote && <p>{detail.evidenceNote}</p>}{detail.preparationReview && <p>{detail.preparationReview}</p>}{detail.needsConfirmation && !occupied && <button disabled={busy} onClick={() => void perform(async () => { const entry = batch.entries.find(e => e.jobId === selectedJob.id)!; const next = await api<BatchView>(`/batches/${batch.id}/confirm-case`, { moduleId: entry.moduleId, caseId: detail.caseId, confirmed: true, requestId: crypto.randomUUID() }); setBatchId(next.id); setExpanded(''); setDetailId(''); })}>前置数据已准备，重测此项</button>}{!occupied && <button disabled={busy} onClick={() => void perform(() => retestCase(detail.caseId))}>重测此用例</button>}{detail.evidence && <a href={`${evidenceRoot}/jobs/${selectedJob.id}/evidence/${detail.evidence}`} target="_blank" rel="noreferrer"><img src={`${evidenceRoot}/jobs/${selectedJob.id}/evidence/${detail.evidence}`} alt={`${detail.title} 的本轮截图`}/></a>}</div></td></tr>}</Fragment>)}</tbody></table></div></div>}

      <div className="sm-result-actions"><div>{batch.notification?.items.some(i => i.status === 'failed' || i.status === 'pending') && <button disabled={busy || occupied} onClick={() => void perform(async () => { await api(`/batches/${batch.id}/retry-notification`, {}); })}>重试通知</button>}{(batch.counts.not_executed > 0 || batch.phase === 'interrupted') && <button disabled={busy || occupied} onClick={() => void perform(() => retest('checkpoint'))}>断点重跑</button>}{batch.counts.not_executed > 0 && <button disabled={busy || occupied} onClick={() => void perform(() => retest('pending'))}>继续未执行</button>}{batch.jobs.some(j => ['error', 'interrupted', 'blocked'].includes(j.phase) && j.executionFinished) && <button disabled={busy || occupied} onClick={() => void perform(async () => { await api(`/batches/${batch.id}/retry-report`, {}); })}>重试汇总</button>}<button disabled={busy || occupied || !batch.counts.failed} onClick={() => void perform(() => retest('failed'))}>重测失败模块</button>{(batch.counts.blocked + batch.counts.error + batch.counts.not_executed > 0) && <button disabled={busy || occupied} onClick={() => void perform(() => retest('unfinished'))}>重测未完成模块</button>}{batch.jobs.some(j => j.documentRunId && j.executionFinished) && <a href={`${root}/batches/${batch.id}/scripts`} onClick={e => { e.preventDefault(); void perform(() => download(`/batches/${batch.id}/scripts`, difyScriptArchiveName(batch))); }}>下载本批脚本</a>}</div></div>
    </section>}
    <details className="sm-run-information" key={viewedRun?.id ?? 'new'}><summary>运行详情</summary>{!historical && account?.databaseEvidence && <details className="sm-database-evidence" aria-label="运行准备"><summary>运行准备 · {account.databaseEvidence.status === 'passed' ? '已核对' : account.databaseEvidence.status === 'failed' ? '发现不一致' : '有待准备项'}</summary><div className="sm-table"><table><thead><tr><th>检查项</th><th>结果</th><th>准备情况</th></tr></thead><tbody>{account.databaseEvidence.checks.map(c => <tr key={c.id}><td>{c.title}</td><td><span className={`sm-badge sm-${c.status}`}>{labels[c.status]}</span></td><td>{c.detail}</td></tr>)}</tbody></table></div><p>连接检查时间：{date(account.databaseEvidence.capturedAt)}。实际测试会重新核验，不计入用例通过数。</p></details>}{batch && <>{batch.jobs.some(j => j.databaseEvidence) && <details className="sm-database-evidence"><summary>数据库核验 · {batch.jobs.some(j => j.databaseEvidence?.status === 'failed') ? '发现不一致' : batch.jobs.some(j => j.databaseEvidence?.status === 'blocked') ? '有待准备项' : '已完成'}</summary>{batch.jobs.filter(j => j.databaseEvidence).map(j => <div key={j.id}><h3>{j.moduleName}</h3><div className="sm-table"><table><thead><tr><th>检查项</th><th>结果</th><th>证据</th></tr></thead><tbody>{j.databaseEvidence!.checks.map(c => <tr key={c.id}><td>{c.title}</td><td><span className={`sm-badge sm-${c.status}`}>{labels[c.status]}</span></td><td>{c.detail}</td></tr>)}</tbody></table></div><p>采集于 {date(j.databaseEvidence!.capturedAt)} · 补充核验不计入用例通过数</p></div>)}</details>}<details><summary>执行流程记录</summary><p>{batch.environment} · {batch.targetUrl}</p><p>{batch.accountName ?? '历史默认账号'} · {batch.runMode === 'fixed' ? '固定回归' : 'AI 辅助整理'}</p><p>批次：{batch.id}</p><h4>异常通知 · {notificationLabels[batch.notification?.status ?? 'disabled']}</h4>{batch.notification?.items.map(item => <p key={item.id}>{item.type === 'summary' ? '摘要' : '截图'} · {item.status === 'sent' ? '已发送' : item.status === 'failed' ? '发送失败' : item.status === 'uncertain' ? '待核对' : item.status === 'skipped' ? '未发送' : '处理中'}{item.detail ? ' · ' + item.detail : ''}</p>)}{batch.jobs.map(j => <Fragment key={j.id}><h4>{j.moduleName}</h4><p>网页运行：{j.documentRunId ?? '尚未执行'}</p>{j.difyRuns.map((r, i) => <p key={i}>{r.phase === 'database-summary' ? '数据库汇总' : r.phase} · {r.status === 'succeeded' ? '完成' : '失败'} · {r.id ?? '未取得编号'}</p>)}</Fragment>)}</details></>}{coreRun && <><p>{coreRun.environment} · {coreRun.targetUrl}</p><p>批次：{coreRun.id}</p><p>{coreRun.message}</p><p>提交和人工审批使用已有凭证；本轮逐项读回核验。</p>{coreRun.difyRuns.map((r, i) => <p key={i}>{coreRun.chains.find(c => c.id === r.chainId)?.title ?? r.chainId} · {r.phase === 'dispatch' ? 'Dify 派发' : 'Dify 汇总'} · {r.status === 'succeeded' ? '完成' : '失败'} · {r.id}</p>)}</>}{!viewedRun && !account?.databaseEvidence && <p>新建运行后可查看本批次的数据库核验、执行流程与任务编号。</p>}</details>
    {modal === 'system' && <Modal error={error} title={systemEdit ? '系统设置' : '新增系统'} onClose={() => setModal('')}><form onSubmit={e => { e.preventDefault(); void perform(saveSystem); }}><label>系统名称<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoFocus/></label><label>被测网址<input required type="url" value={target} onChange={e => setTarget(e.target.value)} placeholder="https://测试环境/"/></label><label>环境<input required maxLength={80} value={environment} onChange={e => setEnvironment(e.target.value)}/></label>{supportsDepartmentDatabase(target) && <label className="sm-database-option"><input type="checkbox" checked={databaseEnabled} onChange={e => setDatabaseEnabled(e.target.checked)}/>核对部门申样测试库（只读）</label>}<details className="sm-notification-settings"><summary>异常通知</summary><label className="sm-database-option"><input type="checkbox" checked={notifyFailures} disabled={!state?.notificationConfigured && !notifyFailures} onChange={e => {
                setNotifyFailures(e.target.checked);
                if (!e.target.checked)
                    setNotifyScreenshots(false);
            }}/>将异常摘要发送到测试群</label><label className="sm-database-option"><input type="checkbox" checked={notifyScreenshots} disabled={!notifyFailures} onChange={e => setNotifyScreenshots(e.target.checked)}/>同时发送本轮失败截图</label>{!state?.notificationConfigured && <p>测试群机器人尚未配置，通知关闭。</p>}</details>{systemEdit && <><label>新增测试账号<input maxLength={40} value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="例如：审批人测试账号"/></label><button type="button" disabled={busy || !accountName.trim()} onClick={() => void perform(async () => { const next = await api<TestedSystem>(`/systems/${systemEdit.id}/accounts`, { name: accountName }); setSystemEdit(next); setAccountName(''); setNotice('账号已添加，请在主页面选择后登录。'); })}>添加账号</button><p>更换网址或环境后，需要重新连接账号。</p></>}<footer><button type="submit" className="sm-primary" disabled={busy}>保存系统</button></footer></form></Modal>}
    {modal === 'manage' && <Modal error={error} title="管理模块" onClose={() => setModal('')}><form onSubmit={e => { e.preventDefault(); void perform(savePack); }}><label>新增或更新<select aria-label="选择要更新的模块" value={editing} onChange={e => { const key = e.target.value; setEditing(key); setModuleName(state?.modules.find(m => m.id === key)?.name ?? ''); setFile(null); }}><option value="">新增模块</option>{state?.modules.filter(m => m.systemId === systemId).map(m => <option key={m.id} value={m.id}>{m.name}{m.archived ? '（已归档）' : ''}</option>)}</select></label><label>模块名称<input required maxLength={120} value={moduleName} onChange={e => setModuleName(e.target.value)}/></label><a href={`${root}/template.md`}>下载 Markdown 模板</a><label className="sm-upload">CSV / Markdown 用例包<input key={editing} type="file" accept=".csv,.md,.markdown,text/csv,text/markdown" aria-label="上传模块用例包" onChange={e => setFile(e.target.files?.[0] ?? null)}/></label><footer><button type="submit" className="sm-primary" disabled={busy || !file}>保存模块</button></footer></form>{notice && <p role="status">{notice}</p>}<div className="sm-manage-list">{state?.modules.filter(m => m.systemId === systemId).map(m => <div key={m.id}><span>{m.name} · v{latest(m).version}</span><button className="sm-link" disabled={busy} onClick={() => void perform(async () => { await api(`/modules/${m.id}/archive`, { archived: !m.archived }); setChosen(ids => ids.filter(id => id !== m.id)); })}>{m.archived ? '恢复' : '归档'}</button></div>)}</div>{editing && <details><summary>版本变化</summary>{state?.modules.find(m => m.id === editing)?.versions.slice().reverse().map(v => <p key={`${v.id}-${v.version}`}>v{v.version} · {v.caseCount} 条 · 新增 {v.added} / 修改 {v.changed} / 移除 {v.removed}</p>)}</details>}{!!state?.legacyModules.length && <details><summary>历史用例包（{state.legacyModules.length}）</summary><label>归入当前系统<select value={legacyId} onChange={e => { setLegacyId(e.target.value); setModuleName(state.legacyModules.find(m => m.id === e.target.value)?.name ?? ''); }}><option value="">选择历史包</option>{state.legacyModules.map(m => <option key={m.id} value={m.id}>{m.name}（{m.caseCount} 条）</option>)}</select></label>{legacyId && <p>{state.legacyModules.find(m => m.id === legacyId)?.targetUrl}</p>}<button disabled={busy || !legacyId || !moduleName.trim()} onClick={() => void perform(async () => { await api('/modules/attach', { systemId, versionId: legacyId, name: moduleName }); setLegacyId(''); setNotice('历史包已归入当前系统；原记录保留。'); })}>保存到此系统</button></details>}</Modal>}
    {modal === 'cases' && pack && <Modal error={error} title={pack.module.name} onClose={() => setModal('')}>
      <div className="sm-heading"><strong>{pack.cases.length} 条用例</strong><select aria-label="查看用例版本" disabled={!!batch} value={versionId} onChange={e => void perform(() => showCases(pack.module.id, e.target.value))}>{pack.module.versions.slice().reverse().map(v => <option key={`${v.id}-${v.version}`} value={v.version}>v{v.version}</option>)}</select></div>
      <div className="sm-case-toolbar"><label><input type="checkbox" aria-label="全选当前用例" disabled={!!batch || busy || !pack.cases.some(c => priority === 'all' || c.priority === priority)} checked={pack.cases.some(c => priority === 'all' || c.priority === priority) && pack.cases.filter(c => priority === 'all' || c.priority === priority).every(c => caseIds.includes(c.id))} onChange={e => { const visible = pack.cases.filter(c => priority === 'all' || c.priority === priority).map(c => c.id); setCaseIds(ids => e.target.checked ? [...new Set([...ids, ...visible])] : ids.filter(id => !visible.includes(id))); }}/>全选</label><select aria-label="筛选优先级" value={priority} onChange={e => setPriority(e.target.value)}><option value="all">全部优先级</option>{['P0', 'P1', 'P2', 'P3'].map(p => <option key={p}>{p}</option>)}</select><a href={`${root}/modules/${pack.module.id}/markdown?version=${versionId}`} onClick={e => { e.preventDefault(); void perform(() => download(`/modules/${pack.module.id}/markdown?version=${versionId}`, 'module-cases.md')); }}>导出 MD</a></div>
      <div className="sm-pack-cases">{pack.cases.filter(c => priority === 'all' || c.priority === priority).map(c => { const readiness = pack.readiness?.find(r => r.caseId === c.id); return <div className="sm-pack-row" key={c.id}><input type="checkbox" aria-label={`选择用例 ${c.id}`} disabled={!!batch} checked={caseIds.includes(c.id)} onChange={e => setCaseIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/><details><summary><span className="sm-priority">{c.priority}</span>{c.title}</summary><h4>原始预期</h4><p>{c.expected}</p><h4>执行准备</h4><p>{readiness?.detail ?? readiness?.coverageGap ?? (readiness?.hasFixedSteps ? '已有固定步骤，登录和前置条件以本轮实际检查为准。' : '尚无固定步骤，请使用 AI 辅助整理。')}</p>{readiness?.nextAction && <p>{readiness.nextAction}</p>}<h4>来源</h4><p>{c.source || c.id}</p></details><button className="sm-link" disabled={!!batch || busy || occupied || !canRun || pack.version.id !== latest(pack.module).id} onClick={() => void perform(() => runCases([c.id]))}>运行</button></div>; })}</div>
      {!batch && <footer className="sm-case-footer"><span>已选 {caseIds.length} / {pack.cases.length} 条</span><button className="sm-primary" disabled={busy || occupied || pack.version.id !== latest(pack.module).id} onClick={applyCustom}>应用自选</button></footer>}
      {/* AI 辅助整理只在真的配了 Dify prepare 工作流时才出现；固定脚本执行不需要它 */}
      {!batch && !!state?.configured.prepare && <details className="sm-case-maintenance"><summary>用例维护（AI 辅助）</summary><p>用 Dify 对所选用例提出步骤建议并运行，另存为新批次。</p><div className="sm-maintenance-actions"><button disabled={busy || occupied || !canRun || !caseIds.length || pack.version.id !== latest(pack.module).id} onClick={() => void perform(() => runCases(caseIds, 'assist'))}>Dify 辅助整理并运行所选</button></div></details>}
    </Modal>}
  </div>;
}
