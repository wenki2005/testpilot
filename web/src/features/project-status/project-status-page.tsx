import { useEffect, useMemo, useState } from 'react';
import type { DemoConfig } from '../../../../src/domain/testing/local-test-contracts';
import type { CaseEditorCatalog } from '../../../../src/domain/cases/case-script-contract';
import type { SystemModuleState } from '../../../../src/domain/regression/module-catalog-contract';
import { sidebarProjectEvents } from '../../shared/project-selection';
import './project-status-page.css';

const root = '/api/system-module-regression';
const phaseNames: Record<string, string> = { completed: '本轮结束', interrupted: '未完成', cancelled: '已取消', running: '执行中', queued: '排队中' };
async function request<T>(path: string): Promise<T> { const response = await fetch(path); const value = await response.json(); if (!response.ok) throw Error(value.error ?? '读取项目状态失败。'); return value; }
export default function ProjectStatusPage({ systemId, storage, onNavigate }: { systemId?: string; storage?: DemoConfig['storage']; onNavigate: (page: 'case-scripts' | 'dify-regression' | 'run-reports') => void }) {
    const [state, setState] = useState<SystemModuleState>();
    const [catalog, setCatalog] = useState<CaseEditorCatalog>();
    const [selected, setSelected] = useState(systemId ?? '');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const activeSystemId = selected || state?.systems[0]?.id || '';
    useEffect(() => { if (systemId && systemId !== selected) setSelected(systemId); }, [systemId]);
    useEffect(() => { let live = true; request<SystemModuleState>(root).then(next => { if (!live) return; setState(next); setSelected(current => current || next.systems[0]?.id || ''); }).catch(e => live && setError((e as Error).message)).finally(() => live && setLoading(false)); return () => { live = false; }; }, []);
    useEffect(() => { if (!activeSystemId) return; let live = true; request<CaseEditorCatalog>(root + '/case-editor?systemId=' + encodeURIComponent(activeSystemId)).then(value => live && setCatalog(value)).catch(e => live && setError((e as Error).message)); return () => { live = false; }; }, [activeSystemId]);
    useEffect(() => { if (!state) return; window.dispatchEvent(new CustomEvent(sidebarProjectEvents.state, { detail: { systems: state.systems, systemId: activeSystemId, disabled: false } })); const select = (event: Event) => setSelected((event as CustomEvent<string>).detail); window.addEventListener(sidebarProjectEvents.select, select); return () => window.removeEventListener(sidebarProjectEvents.select, select); }, [state, activeSystemId]);
    const system = state?.systems.find(item => item.id === activeSystemId);
    const modules = state?.modules.filter(item => item.systemId === activeSystemId && !item.archived) ?? [];
    const cases = catalog?.cases ?? [];
    const pending = cases.filter(item => item.scriptReview?.status === 'pending').length;
    const latestVersion = Math.max(0, ...modules.flatMap(item => item.versions.map(version => version.version)));
    const latestRun = useMemo(() => state?.batches.filter(item => item.systemId === activeSystemId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0], [state, activeSystemId]);
    const latestRunCount = latestRun?.entries.reduce((total, entry) => total + (entry.selectedCaseIds?.length ?? entry.caseCount), 0) ?? 0;
    if (loading && !state) return <section className="project-status-page"><div className="project-status-empty">正在读取项目状态…</div></section>;
    return <section className="project-status-page" aria-label="项目状态">
      <header className="project-status-top"><div><span className="project-status-crumb">TestPilot / 项目状态</span><h1>{system?.name ?? '当前测试项目'}</h1></div><div className="project-status-actions"><button type="button" onClick={() => window.location.reload()}>刷新</button><button type="button" className="project-status-primary" onClick={() => onNavigate('case-scripts')}>查看用例与脚本</button></div></header>
      {error && <div className="project-status-error" role="alert">{error}</div>}
      <div className="project-status-heading"><div><h2>项目状态</h2><p>查看当前项目的资源、脚本和最近运行情况。</p></div><span className="project-status-live"><i/>本机数据正常</span></div>
      <div className="project-status-metrics"><div><strong>{cases.length || '—'}</strong><span>用例</span></div><div><strong>{modules.length || '—'}</strong><span>模块</span></div><div><strong>{catalog?.chains.length || '—'}</strong><span>核心链路</span></div><div className={pending ? 'warning' : ''}><strong>{pending || 0}</strong><span>脚本待核对</span></div></div>
      <div className="project-status-columns"><section className="project-status-panel"><h3>项目资源</h3><div className="project-status-list"><div><div><b>被测网址</b><small>{system?.environment ?? '—'} · {system?.targetUrl ?? '未配置'}</small></div><em className="ok">已配置</em></div><div><div><b>用例版本</b><small>当前版本 v{latestVersion || '—'} · {cases.length || 0} 条</small></div><em className="ok">已写入</em></div><div><div><b>脚本状态</b><small>{pending ? `${pending} 条需要核对后才能执行` : '当前没有待核对脚本'}</small></div><em className={pending ? 'warn' : 'ok'}>{pending ? '待核对' : '可执行'}</em></div><div><div><b>运行数据</b><small>{storage?.dataDirectory ? '保存在本机，不随项目资源分发' : '与项目资源分开保存'}</small></div><em className="ok">已分离</em></div></div><div className="project-status-links"><button type="button" className="project-status-primary" onClick={() => onNavigate('case-scripts')}>查看用例与脚本</button><button type="button" onClick={() => onNavigate('dify-regression')}>选择执行范围</button></div></section>
        <section className="project-status-panel"><h3>最近运行</h3>{latestRun ? <div className="project-status-run"><span className={latestRun.phase === 'completed' ? 'passed' : 'neutral'}>{latestRun.phase === 'completed' ? '✓' : '—'}</span><div><b>{latestRun.scope === 'core' ? '核心链路' : latestRun.scope === 'custom' ? '自选用例' : '全部用例'} · {latestRunCount} 条</b><small>{new Date(latestRun.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {phaseNames[latestRun.phase] ?? latestRun.phase}</small></div></div> : <p className="project-status-muted">暂无运行记录</p>}<div className="project-status-links"><button type="button" className="project-status-primary" onClick={() => onNavigate('run-reports')}>打开运行报告</button></div></section>
      </div>
      <div className="project-status-note"><b>说明：</b>用例、脚本和链路属于项目资源；运行记录、截图、账号状态和数据库连接保存在本机。</div><p className="project-status-foot">当前页面只展示状态，不会自动执行测试。</p>
    </section>;
}
