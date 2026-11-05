import { useEffect, useMemo, useState } from 'react';
import '../case-assistance/case-assistance.css';
type ModulePlan = {
    id: string;
    name: string;
    digest: string;
    reviewer: string;
    suite: {
        baseUrl?: string;
        cases: Array<{
            id: string;
            title: string;
            source?: string;
            requirementRefs?: string[];
            request: unknown;
            expect: unknown;
        }>;
    };
};
type ModuleExecution = {
    id: string;
    moduleId: string;
    moduleName: string;
    method: string;
    executor: string;
    createdAt: string;
    stage: string;
    outcome: string;
    systemVersion: string;
    tester: string;
    message: string;
    workflowStatus: string;
    difyRuns: Array<{
        phase: string;
        id: string;
    }>;
    events: Array<{
        at: string;
        message: string;
    }>;
    apiRunId?: string;
};
type RecordRow = Partial<ModuleExecution> & {
    id: string;
    moduleName: string;
    method: string;
    executor: string;
    createdAt: string;
    stage: string;
    outcome: string;
    counts: Record<string, number>;
    apiRunId?: string;
};
type State = {
    plans: ModulePlan[];
    runs: ModuleExecution[];
    records: RecordRow[];
    difyConfigured: boolean;
    workflowUrl: string;
};
type Suite = {
    id: string;
    suiteName: string;
    status: string;
    digest: string;
    caseCount: number;
};
type WebStep = {
    action: string;
    [key: string]: unknown;
};
type WebCase = {
    id: string;
    title: string;
    source: string;
    priority?: string;
    kind: 'text' | 'visible' | 'field';
    lifecycleStatus?: string;
    selectedForRegression?: boolean;
    steps?: WebStep[];
    preconditions?: string[];
    preconditionsConfirmed?: boolean;
    sideEffectRisk?: string;
    executionReason?: string;
    coverageGap?: string;
    expected: string;
    requirementRefs?: string[];
    category?: string;
    confidence?: string;
    coverageAreas?: string[];
    testData?: string[];
    cleanup?: string;
};
type WebProject = {
    id: string;
    name: string;
    fileName: string;
    targetUrl: string;
    cases: WebCase[];
    reviewStatus?: string;
    reviewNotes?: string;
    generationWarning?: string;
    workflowId?: string;
};
type WebRun = {
    id: string;
    overall: string;
    deterministic: {
        results: Array<{
            id: string;
            title: string;
            status: string;
            detail: string;
        }>;
    };
    reportReady?: boolean;
    report?: string;
};
type Preparation = {
    status: string;
    stage: string;
    events: Array<{
        message: string;
    }>;
    projectId?: string;
    error?: string;
};
type SessionStatus = {
    state: 'occupied' | 'connected' | 'unavailable' | 'unknown';
    occupied: boolean;
    manualLoginRequired: boolean | null;
    message: string;
    checkedAt: string;
};
type ReviewFlags = {
    readOnly: boolean;
    expectation: boolean;
    preconditions: boolean;
};
type CaseEditor = {
    expected: string;
    stepsJson: string;
};
const label: Record<string, string> = { queued: '已排队', preparing: '核对清单', executing: '接口执行中', reporting: '汇总结果', completed: '完成', blocked: '阻塞', error: '异常', not_executed: '未执行', passed: '通过', failed: '失败', pending: '等待', not_used: '未使用' };
const assertionActions = new Set(['assertText', 'assertVisible', 'assertNotVisible', 'assertExactVisible', 'assertRoleVisible', 'assertRoleDisabled', 'assertValue', 'assertDisabled', 'assertFieldInvalid', 'assertMaxLengthOrMessage', 'assertNoHorizontalOverflow', 'assertNoFetchOrXhr']);
function hasAssertion(steps: WebStep[]) { return steps.some(step => assertionActions.has(step.action)); }
function hasPotentialWrite(steps: WebStep[]) {
    return steps.some(step => {
        const role = String(step.role ?? '').toLowerCase();
        if (['radio', 'checkbox'].includes(role))
            return false;
        const action = step.action.toLowerCase();
        if (!action.startsWith('click') && !/submit|save|delete|confirm|triggerclientvalidation/iu.test(action))
            return false;
        return /提交|保存|删除|撤销|同意|确认|申请|创建|修改|更新|下单|付款|发送|发起|确定|审核/iu.test(JSON.stringify(step));
    });
}
function parseSteps(value: string): WebStep[] | null {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some((step: unknown) => !step || typeof step !== 'object' || Array.isArray(step) || typeof (step as {
            action?: unknown;
        }).action !== 'string'))
            return null;
        return parsed as WebStep[];
    }
    catch {
        return null;
    }
}
async function api<T>(url: string, data?: unknown): Promise<T> {
    const r = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const v = await r.json();
    if (!r.ok)
        throw new Error(v.error ?? '操作失败');
    return v;
}
export default function ModuleRegressionPage({ embedded = false }: {
    embedded?: boolean;
}) {
    const [state, setState] = useState<State | null>(null);
    const [suites, setSuites] = useState<Suite[]>([]);
    const [name, setName] = useState('');
    const [suiteId, setSuiteId] = useState('');
    const [reviewer, setReviewer] = useState('');
    const [notes, setNotes] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [moduleId, setModuleId] = useState('');
    const [method, setMethod] = useState('api-direct');
    const [systemVersion, setSystemVersion] = useState('');
    const [dataLabel, setDataLabel] = useState('');
    const [allowNetwork, setAllowNetwork] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [filter, setFilter] = useState('');
    const [methodFilter, setMethodFilter] = useState('');
    const [packFile, setPackFile] = useState<File | null>(null);
    const [targetUrl, setTargetUrl] = useState('https://cdn.yibentushu.com/test-sample-apply/');
    const [project, setProject] = useState<WebProject | null>(null);
    const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
    const [caseFilter, setCaseFilter] = useState('all');
    const [showAllCases, setShowAllCases] = useState(false);
    const [reviewerName, setReviewerName] = useState('');
    const [reviewNote, setReviewNote] = useState('');
    const [webRun, setWebRun] = useState<WebRun | null>(null);
    const [workflowCheck, setWorkflowCheck] = useState<{
        status: string;
        message: string;
    } | null>(null);
    const [reviewFlags, setReviewFlags] = useState<Record<string, ReviewFlags>>({});
    const [caseEditors, setCaseEditors] = useState<Record<string, CaseEditor>>({});
    const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
    const [loginHandoff, setLoginHandoff] = useState<{
        status: 'waiting_for_user' | 'ready_to_continue';
        targetUrl: string;
        message: string;
    } | null>(null);
    const plan = state?.plans.find(p => p.id === moduleId) ?? state?.plans[0];
    const [evidence, setEvidence] = useState<Record<string, unknown>>({});
    async function refresh() { const [next, available] = await Promise.all([api<State>('/api/module-regression'), api<Suite[]>('/api/api-suites')]); setState(next); setSuites(available.filter(s => s.status === 'approved')); }
    async function restoreLatestPack() {
        try {
            const projects = await api<WebProject[]>('/api/document-projects');
            const latest = projects.find(p => /\.csv$/i.test(p.fileName));
            if (!latest)
                return;
            setProject(latest);
            setSelectedCaseIds([]);
            setReviewFlags(Object.fromEntries(latest.cases.map(c => [c.id, { readOnly: c.sideEffectRisk === 'none', expectation: !c.coverageGap, preconditions: c.preconditionsConfirmed === true }])));
            setCaseEditors(Object.fromEntries(latest.cases.map(c => [c.id, { expected: c.expected, stepsJson: JSON.stringify(c.steps ?? [], null, 2) }])));
            void checkDify(latest.id);
            void refreshSession(latest.id);
        }
        catch { }
    }
    useEffect(() => { void refresh().catch(e => setError(e.message)); void restoreLatestPack(); const t = window.setInterval(() => void refresh().catch(() => { }), 2000); return () => window.clearInterval(t); }, []);
    async function action(work: () => Promise<unknown>, message: string) {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await work();
            await refresh();
            setNotice(message);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    const runnableCases = useMemo(() => project?.cases.filter(c => c.lifecycleStatus === 'runnable' && c.sideEffectRisk === 'none' && c.preconditionsConfirmed === true && c.selectedForRegression !== false && hasAssertion(c.steps ?? []) && !hasPotentialWrite(c.steps ?? [])) ?? [], [project]);
    function canReviewCase(item: WebCase) { const flags = reviewFlags[item.id] ?? { readOnly: false, expectation: false, preconditions: false }; const editor = caseEditors[item.id]; const steps = parseSteps(editor?.stepsJson ?? JSON.stringify(item.steps ?? [])); return !!flags.readOnly && !!flags.expectation && !!flags.preconditions && !!editor?.expected.trim() && !!steps && hasAssertion(steps) && !hasPotentialWrite(steps); }
    const blockedCounts = useMemo(() => {
        const counts = { login: 0, review: 0, clarify: 0, missing: 0, held: 0 };
        for (const c of project?.cases ?? []) {
            const reason = `${c.coverageGap ?? ''} ${c.title} ${c.executionReason ?? ''} ${c.source ?? ''}`;
            if (/needs-login|登录|账号|会话|认证|身份/iu.test(reason))
                counts.login++;
            else if (/hold-clarification|待澄清|待确认|补充|需确认/iu.test(reason))
                counts.clarify++;
            else if (/needs-steps|缺步骤|缺少步骤/iu.test(reason) || !c.steps?.length)
                counts.missing++;
            else if (/hold-account-or-effect|账号.*副作用|风险确认/iu.test(reason) || c.sideEffectRisk !== 'none' || (c.preconditions?.length ?? 0) > 0 && c.preconditionsConfirmed !== true)
                counts.held++;
            else
                counts.review++;
        }
        return counts;
    }, [project]);
    const visibleWebCases = (project?.cases ?? []).filter(c => caseFilter === 'all' || caseFilter === 'runnable' && runnableCases.some(r => r.id === c.id) || caseFilter === 'login' && /登录|账号|会话|认证|身份/u.test(`${c.title} ${c.executionReason ?? ''}`) || caseFilter === 'blocked' && !runnableCases.some(r => r.id === c.id));
    async function checkDify(projectId: string) {
        try {
            const check = await api<{
                status: string;
                message: string;
            }>('/api/module-regression/web-package-check', { projectId });
            setWorkflowCheck(check);
        }
        catch (e) {
            setWorkflowCheck({ status: 'unavailable', message: (e as Error).message });
        }
    }
    async function refreshSession(projectId: string) {
        try {
            setSessionStatus(await api<SessionStatus>(`/api/document-projects/${encodeURIComponent(projectId)}/session-status`));
        }
        catch {
            setSessionStatus(null);
        }
    }
    async function importPack() {
        if (!packFile)
            throw new Error('请先选择模块用例包。');
        if (!/\.csv$/i.test(packFile.name))
            throw new Error('当前仅支持 CSV 模块用例包。');
        if (packFile.size > 4 * 1024 * 1024)
            throw new Error('用例包不能超过 4 MB。');
        let parsed: URL;
        try {
            parsed = new URL(targetUrl.trim());
        }
        catch {
            throw new Error('请输入有效的被测系统网址。');
        }
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
            throw new Error('请填写不含账号密码的 HTTP/HTTPS 被测系统网址。');
        parsed.search = '';
        parsed.hash = '';
        const bytesBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取 CSV 文件失败。')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(packFile); });
        const started = await api<{
            preparationId: string;
        }>('/api/document-projects/import', { name: packFile.name.replace(/\.csv$/i, ''), fileName: packFile.name, bytesBase64, targetUrl: parsed.toString(), caseMode: 'existing', requireConfirmation: true });
        let task: Preparation;
        do {
            task = await api<Preparation>(`/api/document-preparation/${started.preparationId}`);
            setNotice(task.events.at(-1)?.message ?? '正在识别 CSV 用例…');
            if (task.status === 'running')
                await new Promise(resolve => window.setTimeout(resolve, 500));
        } while (task.status === 'running');
        if (task.status === 'failed')
            throw new Error(task.error ?? '用例包导入失败。');
        if (!task.projectId)
            throw new Error('导入完成，但未返回项目编号。');
        const projects = await api<WebProject[]>('/api/document-projects');
        const loaded = projects.find(p => p.id === task.projectId);
        if (!loaded)
            throw new Error('无法读取已导入的模块用例。');
        setProject(loaded);
        setSelectedCaseIds([]);
        setShowAllCases(false);
        setWebRun(null);
        setWorkflowCheck(null);
        setReviewFlags(Object.fromEntries(loaded.cases.map(c => [c.id, { readOnly: c.sideEffectRisk === 'none', expectation: !c.coverageGap, preconditions: c.preconditionsConfirmed === true }])));
        setCaseEditors(Object.fromEntries(loaded.cases.map(c => [c.id, { expected: c.expected, stepsJson: JSON.stringify(c.steps ?? [], null, 2) }])));
        await Promise.all([checkDify(loaded.id), refreshSession(loaded.id)]);
    }
    async function reviewPack() {
        if (!project)
            throw new Error('请先导入用例包。');
        if (!reviewerName.trim() || !reviewNote.trim())
            throw new Error('填写审核人和本次审核说明后再确认。');
        const updated = await api<WebProject>(`/api/document-projects/${project.id}/review`, { decision: 'approve', notes: `${reviewerName.trim()}：${reviewNote.trim()}` });
        setProject(updated);
        setNotice('模块包已审核；执行仍仅接受安全门筛选通过的用例。');
    }
    async function saveCaseReview(item: WebCase) {
        if (!project)
            throw new Error('请先导入用例包。');
        const flags = reviewFlags[item.id] ?? { readOnly: false, expectation: false, preconditions: false };
        if (!flags.readOnly || !flags.expectation || !flags.preconditions)
            throw new Error('请确认步骤只读、预期明确且前置条件已满足。');
        const editor = caseEditors[item.id];
        const steps = parseSteps(editor?.stepsJson ?? '[]');
        if (!steps)
            throw new Error('步骤必须是最多 100 项、每项包含 action 的 JSON 数组。');
        if (hasPotentialWrite(steps))
            throw new Error('步骤包含疑似提交或修改操作，不能标记为只读；请将该用例留待独立测试环境复核。');
        if (!hasAssertion(steps))
            throw new Error('用例至少要有一个明确的页面断言；先补齐步骤 JSON。');
        if (!editor?.expected.trim())
            throw new Error('请补充明确的预期结果。');
        const cases = project.cases.map(c => c.id === item.id ? { ...c, expected: editor.expected, steps, lifecycleStatus: 'runnable', selectedForRegression: true, sideEffectRisk: 'none', preconditionsConfirmed: true, coverageGap: undefined } : c);
        const updated = await api<WebProject>(`/api/document-projects/${project.id}/update`, { cases });
        setProject(updated);
        setCaseEditors(editors => ({ ...editors, [item.id]: { expected: editor.expected, stepsJson: JSON.stringify(steps, null, 2) } }));
        setSelectedCaseIds(ids => [...new Set([...ids, item.id])]);
        setNotice(`已保存 ${item.id} 的逐条复核；请确认其他用例后再审核整包。`);
        await checkDify(project.id);
    }
    async function continueLogin() {
        if (!project)
            return;
        await api(`/api/document-projects/${encodeURIComponent(project.id)}/login/continue`, {});
        setLoginHandoff(current => current ? { ...current, status: 'ready_to_continue' } : null);
        setNotice('已通知 TestPilot 继续当前运行。');
    }
    async function runWebPack() {
        if (!project)
            throw new Error('请先导入用例包。');
        if (project.reviewStatus !== 'approved')
            throw new Error('请先审核用例包。');
        if (!selectedCaseIds.length)
            throw new Error('请至少选择一条可运行用例。');
        const eligible = new Set(runnableCases.map(c => c.id));
        if (selectedCaseIds.some(id => !eligible.has(id)))
            throw new Error('所选范围包含未通过安全门的用例，请重新选择。');
        const started = await api<{
            runId?: string;
            comparisons?: unknown;
        }>('/api/document-projects/' + encodeURIComponent(project.id) + '/start', { runMode: 'regression', selectedCaseIds, scopePlan: { mode: selectedCaseIds.length === 1 ? 'single' : 'custom', targetCaseIds: selectedCaseIds, impactCaseIds: [] } });
        if (!started.runId)
            throw new Error('服务未返回运行编号。');
        let last = '';
        while (true) {
            const progress = await api<{
                status: string;
                stage: string;
                progress?: {
                    completed: number;
                    total: number;
                };
                run?: WebRun;
                lastError?: string;
            }>(`/api/document-runs/${encodeURIComponent(started.runId)}/progress`);
            if (progress.status === 'completed') {
                setLoginHandoff(null);
                const result = progress.run ?? await api<WebRun>(`/api/document-runs/${encodeURIComponent(started.runId)}`);
                setWebRun(result);
                return;
            }
            if (progress.status === 'failed')
                throw new Error(progress.lastError ?? '模块运行中断。');
            if (progress.status === 'cancelled') {
                setLoginHandoff(null);
                setWebRun(progress.run ?? null);
                return;
            }
            if (progress.stage === 'awaiting-login') {
                setNotice('测试窗口正在等待登录。请在本机 TestPilot 测试窗口使用你的账号完成登录，再回到这里点击“我已登录，继续测试”。');
                try {
                    const handoff = await api<{
                        status: 'waiting_for_user' | 'ready_to_continue';
                        targetUrl: string;
                        message: string;
                    } | null>(`/api/document-projects/${encodeURIComponent(project.id)}/login`);
                    if (handoff)
                        setLoginHandoff(handoff);
                }
                catch { }
            }
            else if (progress.stage !== last) {
                setLoginHandoff(null);
                last = progress.stage;
                setNotice(`模块测试运行中：${progress.stage}${progress.progress ? ` · ${progress.progress.completed}/${progress.progress.total}` : ''}`);
            }
            await new Promise(resolve => window.setTimeout(resolve, 1000));
        }
    }
    const reason = !plan ? '先绑定一个已审核模块。' : !reviewer.trim() || !systemVersion.trim() || !dataLabel.trim() ? '填写测试人、被测版本及数据标识后可以运行。' : method === 'dify' && !state?.difyConfigured ? '尚未配置 Dify 执行工作流密钥。' : '';
    const rows = state?.records.filter(r => (!filter || r.moduleId === filter) && (!methodFilter || r.method === methodFilter)) ?? [];
    return <div className="dify-page">
    <div className="dify-heading module-heading"><div>{embedded ? <h2>模块测试</h2> : <h1>模块测试</h1>}</div></div>
    {error && <div className="dify-alert error" role="alert">{error}</div>}{notice && <div className="dify-alert" role="status">{notice}</div>}
    <section className="dify-card module-pack-prep"><label className="module-pack-file">模块用例包<input aria-label="选择 CSV 模块用例包" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { setPackFile(e.target.files?.[0] ?? null); e.target.value = ''; }}/><span>{packFile?.name ?? (project ? `${project.fileName} · 已导入` : '选择 CSV 文件')}</span></label><label>被测系统网址<input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://测试环境/"/></label><div className="module-account-choice">我的账号</div><button className="dify-primary" disabled={busy || !packFile} onClick={() => void action(importPack, '用例包已导入，正在显示 Dify 检查结果。')}>检查用例</button></section>
    {project && <>
      <section className="dify-card module-pack-summary"><div className="module-pack-title"><div><h2>{project.name}</h2><span>{project.targetUrl}</span></div><strong><b>{project.cases.length}</b> 条用例</strong></div>
        <div className="module-pack-counts"><span>{blockedCounts.login + blockedCounts.held + blockedCounts.clarify + blockedCounts.missing} 条待处理</span><span className="ready">{runnableCases.length} 条可运行</span><details className="module-count-details"><summary>明细</summary><div><span>{blockedCounts.login} 待登录 / 复核</span><span>{blockedCounts.held} 待环境 / 风险确认</span><span>{blockedCounts.clarify} 待澄清</span><span>{blockedCounts.missing} 缺步骤</span></div></details></div>
        <details className="module-system-details"><summary><span>运行状态</span><b className={workflowCheck?.status === 'ok' ? 'ok' : 'warn'}>{workflowCheck?.status === 'ok' ? 'Dify 已通过' : workflowCheck ? 'Dify 未通过' : 'Dify 未检查'}</b><b className={sessionStatus?.state === 'connected' && sessionStatus.manualLoginRequired !== true ? 'ok' : 'warn'}>{sessionStatus?.state === 'connected' && sessionStatus.manualLoginRequired !== true ? '账号已登录' : sessionStatus ? '账号待登录' : '登录状态未知'}</b></summary><div className="module-system-detail-body">{workflowCheck && <div className={`module-workflow-check ${workflowCheck.status === 'ok' ? 'ok' : 'warn'}`}><strong>{workflowCheck.status === 'ok' ? 'Dify 检查通过' : 'Dify 检查未通过'}</strong><span>{workflowCheck.message}</span></div>}<div className={`module-session-status ${sessionStatus?.state === 'connected' && sessionStatus.manualLoginRequired !== true ? 'connected' : sessionStatus?.state === 'occupied' ? 'occupied' : 'unknown'}`}><div><strong>{sessionStatus?.state === 'connected' && sessionStatus.manualLoginRequired === true ? '测试窗口已连接，等待你登录' : sessionStatus?.state === 'connected' ? '本机登录会话已就绪' : sessionStatus?.state === 'occupied' ? '本机测试窗口正被占用' : sessionStatus?.state === 'unavailable' ? '本机测试窗口不可用' : '检查本机登录会话'}</strong><span>{sessionStatus?.message ?? '导入后检查当前 TestPilot 浏览器会话。'}</span></div><button disabled={busy} onClick={() => void action(() => refreshSession(project.id), '已刷新本机测试会话状态。')}>刷新登录状态</button></div></div></details>
        {loginHandoff && <div className="module-login-handoff"><strong>等待你在测试窗口登录</strong><span>{loginHandoff.message || '请在本机 TestPilot 测试窗口使用你的账号登录。'}</span><button disabled={busy || loginHandoff.status === 'ready_to_continue'} onClick={() => void action(continueLogin, '已通知测试继续。')}>{loginHandoff.status === 'ready_to_continue' ? '已通知继续' : '我已登录，继续测试'}</button></div>}
        <div className="module-case-toolbar"><strong>用例清单</strong><select aria-label="筛选用例" value={caseFilter} onChange={e => setCaseFilter(e.target.value)}><option value="all">全部用例</option><option value="runnable">可运行</option><option value="login">待登录 / 复核</option><option value="blocked">待处理</option></select></div>
        <div className="module-case-table-wrap"><table className="module-case-table"><thead><tr><th><input type="checkbox" aria-label="选择全部可运行用例" disabled={!runnableCases.length || project.reviewStatus !== 'approved'} checked={runnableCases.length > 0 && runnableCases.every(c => selectedCaseIds.includes(c.id))} onChange={e => setSelectedCaseIds(e.target.checked ? runnableCases.map(c => c.id) : [])}/></th><th>级别</th><th>用例</th><th>当前状态</th></tr></thead><tbody>{visibleWebCases.slice(0, showAllCases ? undefined : 20).map(c => { const runnable = runnableCases.some(item => item.id === c.id); const reason = `${c.coverageGap ?? ''} ${c.title} ${c.executionReason ?? ''}`; const waitingLogin = /needs-login|登录|账号|会话|认证|身份/iu.test(reason); const status = runnable ? '可运行' : waitingLogin ? '待登录 / 复核' : /hold-clarification|待澄清|待确认|补充|需确认/iu.test(reason) ? '待澄清' : /needs-steps|缺步骤|缺少步骤/iu.test(reason) || !c.steps?.length ? '缺少步骤' : /hold-account-or-effect/iu.test(reason) || c.sideEffectRisk !== 'none' || (c.preconditions?.length ?? 0) > 0 ? '待环境 / 风险确认' : '待审核'; const editor = caseEditors[c.id] ?? { expected: c.expected, stepsJson: JSON.stringify(c.steps ?? [], null, 2) }; const flags = reviewFlags[c.id] ?? { readOnly: false, expectation: false, preconditions: false }; const editedSteps = parseSteps(editor.stepsJson); const unsafe = editedSteps ? hasPotentialWrite(editedSteps) : false; return <tr key={c.id}><td><input type="checkbox" aria-label={`选择 ${c.title}`} disabled={!runnable || project.reviewStatus !== 'approved'} checked={selectedCaseIds.includes(c.id)} onChange={e => setSelectedCaseIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))}/></td><td><span className={`module-priority ${c.priority === 'P0' ? 'p0' : c.priority === 'P1' ? 'p1' : ''}`}>{c.priority ?? 'P2'}</span></td><td><strong>{c.title}</strong><details className="module-case-review"><summary>{runnable ? '查看复核' : '确认这条用例'}</summary><div className="module-case-editor"><div className="module-case-id">{c.id} · {c.steps?.length ?? 0} 步</div>{c.source && <details className="module-case-source"><summary>查看来源</summary><p>{c.source}</p></details>}<label>预期结果<textarea value={editor.expected} onChange={e => { setCaseEditors(old => ({ ...old, [c.id]: { ...editor, expected: e.target.value } })); setReviewFlags(old => ({ ...old, [c.id]: { ...flags, expectation: false } })); }} rows={2}/></label><label>测试步骤<textarea className="module-steps-editor" value={editor.stepsJson} onChange={e => { setCaseEditors(old => ({ ...old, [c.id]: { ...editor, stepsJson: e.target.value } })); setReviewFlags(old => ({ ...old, [c.id]: { ...flags, readOnly: false, expectation: false } })); }} rows={8}/></label>{(c.preconditions ?? []).length > 0 && <p>前置条件：{c.preconditions!.join('；')}</p>}{unsafe && <p className="module-review-warning">步骤疑似包含提交或修改操作，不能自动执行。</p>}{editedSteps && !hasAssertion(editedSteps) && <p className="module-review-warning">缺少页面断言，补充断言后才能执行。</p>}<label className="module-review-check"><input type="checkbox" checked={flags.readOnly} onChange={e => setReviewFlags(old => ({ ...old, [c.id]: { ...flags, readOnly: e.target.checked } }))}/> 确认只读，不提交或修改数据</label><label className="module-review-check"><input type="checkbox" checked={flags.expectation} onChange={e => setReviewFlags(old => ({ ...old, [c.id]: { ...flags, expectation: e.target.checked } }))}/> 确认预期正确且步骤能验证</label><label className="module-review-check"><input type="checkbox" checked={flags.preconditions} onChange={e => setReviewFlags(old => ({ ...old, [c.id]: { ...flags, preconditions: e.target.checked } }))}/> 确认前置条件已满足；登录使用我的本机账号</label><button disabled={busy || !canReviewCase(c)} onClick={() => void action(() => saveCaseReview(c), '已保存单条用例复核。')}>{runnable ? '保存复核' : '确认并加入本轮'}</button></div></details></td><td><span className={`module-case-state ${runnable ? 'ready' : waitingLogin ? 'login' : 'wait'}`}>{status}</span></td></tr>; })}</tbody></table></div>
        {visibleWebCases.length > 20 && <div className="module-case-footer"><button className="module-text-button" onClick={() => setShowAllCases(value => !value)}>{showAllCases ? '收起' : '查看全部'} {visibleWebCases.length} 条用例</button></div>}
        <div className="module-review-row"><label>审核人<input value={reviewerName} onChange={e => setReviewerName(e.target.value)} placeholder="姓名或代号"/></label><label>审核说明<input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="已核对用例范围、预期和安全边界"/></label><button disabled={busy || project.reviewStatus === 'approved' || !reviewerName.trim() || !reviewNote.trim()} onClick={() => void action(reviewPack, '用例包已审核；可运行项仍会经过安全门检查。')}>{project.reviewStatus === 'approved' ? '已审核' : '确认审核'}</button></div>
      </section>
        <div className="module-runbar"><strong>{runnableCases.length ? `${selectedCaseIds.length} 条已选 · ${runnableCases.length} 条可运行` : '暂无可运行用例'}</strong><button className="dify-primary" disabled={busy || project.reviewStatus !== 'approved' || !selectedCaseIds.length || workflowCheck?.status !== 'ok'} onClick={() => void action(runWebPack, '本轮模块测试完成，结果已保存在执行记录。')}>运行测试</button></div>
      {webRun && <section className="dify-card"><div className="dify-section-heading"><h2>本轮结果 · {webRun.overall}</h2>{webRun.reportReady && <a href={`/api/document-runs/${webRun.id}/report`} download>下载测试报告</a>}</div>{(webRun.deterministic?.results ?? []).map(r => <details className="dify-case" key={r.id}><summary>{r.title}<span>{label[r.status] ?? r.status}</span></summary><p>{r.detail}</p></details>)}</section>}
    </>}
    <details className="module-advanced"><summary>固定 API 套件执行与历史记录</summary>
    <section className="dify-card"><h2>1. 绑定模块和审核版本</h2><p>每个模块绑定一个不可变 API 套件。本期支持普通只读接口；页面显示、颜色、点击交互等用例仍需浏览器执行，不能用接口成功替代。</p>
      <div className="dify-form"><label>模块名称<input value={name} onChange={e => setName(e.target.value)} placeholder="例如：我的申请 · 列表接口"/></label><label>已批准 API 套件<select value={suiteId} onChange={e => setSuiteId(e.target.value)}><option value="">请选择</option>{suites.map(s => <option key={s.id} value={s.id}>{s.suiteName} · {s.caseCount} 条 · {s.digest.slice(0, 8)}</option>)}</select></label><label>审核人 / 本轮测试人<input value={reviewer} onChange={e => setReviewer(e.target.value)}/></label><label>模块范围和审核意见<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="说明这些接口对应哪些原用例、固定预期和数据准备" rows={2}/></label></div>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> 已核对模块范围、来源、目标和断言，确认绑定此固定版本</label>
      <button disabled={busy || !name.trim() || !suiteId || !reviewer.trim() || notes.trim().length < 5 || !confirmed} onClick={() => void action(async () => { const p = await api<ModulePlan>('/api/module-regression/plans', { name, suiteId, reviewer, notes, confirmed }); setModuleId(p.id); }, '模块版本已锁定；后续执行不会让模型重写请求或断言。')}>保存固定模块</button>
      {!suites.length && <p>还没有已批准套件。先在 API 测试套件页面审核；XMind 草稿不会自动变成已批准接口用例。</p>}
    </section>
    <section className="dify-card"><h2>2. 选择模块和执行方式</h2><div className="dify-form"><label>固定模块<select value={plan?.id ?? ''} onChange={e => setModuleId(e.target.value)}><option value="" disabled>请选择</option>{state?.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.digest.slice(0, 8)}</option>)}</select></label><label>发起方式<select value={method} onChange={e => setMethod(e.target.value)}><option value="api-direct">API 直接执行</option><option value="dify">Dify 编排执行（实际执行器：API）</option></select></label><label>被测系统版本<input value={systemVersion} onChange={e => setSystemVersion(e.target.value)} placeholder="填写本轮发布版本"/></label><label>测试数据 / 数据库快照标识<input value={dataLabel} onChange={e => setDataLabel(e.target.value)} placeholder="不要填写数据库密码或个人资料"/></label></div>
      <label><input type="checkbox" checked={allowNetwork} onChange={e => setAllowNetwork(e.target.checked)}/> 本轮允许访问套件中锁定的外部测试环境（本机样例无需勾选）</label>
      {plan && <details className="dify-case"><summary>查看固定请求、断言和来源（{plan.suite.cases.length} 条）</summary><p>目标：{plan.suite.baseUrl} · 审核人：{plan.reviewer}</p><small>内容指纹：{plan.digest}</small>{plan.suite.cases.map(c => <div key={c.id}><h3>{c.title}</h3><small>{c.id} · {c.source} · {c.requirementRefs?.join('、')}</small><pre className="module-code">{JSON.stringify({ request: c.request, expect: c.expect }, null, 2)}</pre></div>)}</details>}
      <p role="status">{reason || '可以执行。Dify 模式只向云端发送匿名编号和状态，目标请求由本机 API 执行器完成。'}</p><button className="dify-primary" disabled={busy || !!reason} onClick={() => void action(() => api('/api/module-regression/run', { moduleId: plan!.id, method, systemVersion, dataLabel, tester: reviewer, allowNetwork, requestId: crypto.randomUUID() }), '本轮任务已保存，正在按固定版本执行。')}>运行选中模块</button>
    </section>
    <section className="dify-card"><div className="dify-section-heading"><h2>统一执行记录</h2><button disabled={!state} onClick={() => { const u = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = '模块回归记录.json'; a.click(); URL.revokeObjectURL(u); }}>导出模块与记录</button></div>
      <div className="dify-form"><label>按模块筛选<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部模块</option>{state?.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {p.digest.slice(0, 8)}</option>)}<option value="unassigned">未归类 API 套件</option></select></label><label>按发起方式筛选<select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}><option value="">全部方式</option><option value="api-direct">API 直接执行</option><option value="dify">Dify 编排执行</option></select></label></div>
      {!rows.length && <p>暂无符合条件的记录。</p>}{rows.map(r => <details className="dify-case" key={r.id}><summary>{r.moduleName} · {r.method === 'dify' ? 'Dify 编排' : 'API 直接'}<span>{label[r.stage]} · 实际结果：{label[r.outcome]}</span></summary><p>{new Date(r.createdAt).toLocaleString('zh-CN')} · 实际执行器：API · {r.systemVersion ?? '未记录被测版本'} · {r.tester ?? '历史记录'}</p><p>{r.message}</p><small>用例结果：通过 {r.counts.passed} / 失败 {r.counts.failed} / 阻塞 {r.counts.blocked} / 异常 {r.counts.error} / 未执行 {r.counts.not_executed}</small><small>Dify 流程状态：{label[r.workflowStatus ?? 'not_used']} · 任务编号 {r.id}</small>{r.difyRuns?.map(d => <small key={d.id}>{d.phase}：{d.id}</small>)}{r.events?.map((e, i) => <p key={i}>{new Date(e.at).toLocaleTimeString('zh-CN')} {e.message}</p>)}{r.apiRunId && <><a href={`/api/api-runs/${r.apiRunId}/report`} target="_blank" rel="noreferrer">下载实际 API 执行报告</a><button onClick={() => void action(async () => { const value = await api(`/api/api-runs/${r.apiRunId}`); setEvidence(old => ({ ...old, [r.id]: value })); }, '已读取实际请求、断言和响应证据。')}>查看实际证据</button>{evidence[r.id] !== undefined && <pre className="module-code">{JSON.stringify(evidence[r.id], null, 2)}</pre>}</>}</details>)}
    </section>
    </details>
  </div>;
}
