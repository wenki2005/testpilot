import { useEffect, useMemo, useState } from 'react';
import type { CaseEditorCatalog } from '../../../../src/domain/cases/case-script-contract';
import type { SystemModuleState } from '../../../../src/domain/regression/module-catalog-contract';
import { sidebarProjectEvents } from '../../shared/project-selection';
import './project-status-page.css';

const root = '/api/system-module-regression';
const phaseNames: Record<string, string> = { completed: '本轮结束', interrupted: '未完成', cancelled: '已取消', running: '执行中', queued: '排队中' };
async function request<T>(path: string): Promise<T> { const response = await fetch(path); const value = await response.json(); if (!response.ok) throw Error(value.error ?? '读取项目状态失败。'); return value; }
export default function ProjectStatusPage({ systemId, onNavigate }: { systemId?: string; onNavigate: (page: 'case-scripts' | 'dify-regression' | 'run-reports') => void }) {
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
    // 待核对里还有一部分是空脚本，它们不是“核对后能跑”，而是根本没有步骤可执行
    const latestRun = useMemo(() => state?.batches.filter(item => item.systemId === activeSystemId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0], [state, activeSystemId]);
    const latestRunCount = latestRun?.entries.reduce((total, entry) => total + (entry.selectedCaseIds?.length ?? entry.caseCount), 0) ?? 0;
    // 每条用例取它最近一次的执行结果（跨批次合并，重跑只保留最后一次）
    const latestByCase = useMemo(() => {
        const merged = new Map<string, { status: string; at: number; detail?: string; title?: string; runId?: string; evidence?: string; moduleName?: string }>();
        const batches = (state?.batches ?? []).filter(item => item.systemId === activeSystemId && item.phase !== 'cancelled')
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        for (const batch of batches) {
            const at = Date.parse(batch.updatedAt ?? batch.createdAt);
            for (const job of batch.jobs ?? []) {
                for (const result of job.results ?? []) {
                    const previous = merged.get(result.caseId);
                    if (!previous || at >= previous.at) merged.set(result.caseId, { status: result.status, at, detail: result.detail, title: result.title, runId: job.documentRunId, evidence: result.evidence, moduleName: job.moduleName });
                }
            }
        }
        return merged;
    }, [state, activeSystemId]);
    const latest = useMemo(() => {
        const tally = { passed: 0, failed: 0, blocked: 0, not_executed: 0, never: 0, at: 0 };
        const classify = (status: string) => status === 'passed' ? 'passed' : status === 'failed' || status === 'error' ? 'failed' : status === 'blocked' ? 'blocked' : 'not_executed';
        // 用用例列表里模块首次出现的顺序，module 数组自身顺序不是业务顺序
        const position = new Map<string, number>();
        for (const item of cases) if (!position.has(item.moduleId)) position.set(item.moduleId, position.size);
        const rows = modules.map(module => {
            const own = cases.filter(item => item.moduleId === module.id);
            const row = { id: module.id, name: module.name, total: own.length, passed: 0, failed: 0, blocked: 0, not_executed: 0, never: 0 };
            for (const item of own) {
                const hit = latestByCase.get(item.id);
                const key = hit ? classify(hit.status) : 'never';
                row[key] += 1;
                tally[key] += 1;
                if (hit && hit.at > tally.at) tally.at = hit.at;
            }
            return row;
        }).filter(row => row.total > 0).sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
        return { ...tally, rows, covered: cases.length - tally.not_executed - tally.never };
    }, [cases, modules, latestByCase]);
    const failedCases = useMemo(() => cases
        .map(c => ({ id: c.id, title: c.title, ...(latestByCase.get(c.id) ?? {}) }))
        .filter(c => c.status === 'failed')
        .sort((a, b) => a.id.localeCompare(b.id)), [cases, latestByCase]);
    const [failedOpen, setFailedOpen] = useState(false);
    const [failedDetail, setFailedDetail] = useState<string>();
    const statusSegments = [
        { key: 'passed', label: '通过', className: 'passed' },
        { key: 'failed', label: '失败', className: 'failed' },
        { key: 'blocked', label: '阻塞', className: 'blocked' },
        { key: 'not_executed', label: '未执行', className: 'not-executed' },
        { key: 'never', label: '从未运行', className: 'never' }
    ] as const;
    if (loading && !state) return <section className="project-status-page"><div className="project-status-empty">正在读取项目状态…</div></section>;
    return <section className="project-status-page" aria-label="项目状态">
      <header className="project-status-top"><div><span className="project-status-crumb">TestPilot / 项目状态</span><h1>{system?.name ?? '当前测试项目'}</h1></div><div className="project-status-actions"><button type="button" onClick={() => window.location.reload()}>刷新</button><button type="button" className="project-status-primary" onClick={() => onNavigate('case-scripts')}>查看用例与脚本</button></div></header>
      {error && <div className="project-status-error" role="alert">{error}</div>}
      <div className="project-status-heading"><div><h2>项目状态</h2></div></div>
      <div className="project-status-metrics"><div><strong>{cases.length || '—'}</strong><span>用例</span></div><div><strong>{modules.length || '—'}</strong><span>模块</span></div><div><strong>{catalog?.chains.length || '—'}</strong><span>核心链路</span></div><div className={pending ? 'warning' : ''}><strong>{pending || 0}</strong><span>脚本待核对</span></div></div>
      <section className="project-status-panel project-status-latest" aria-label="最新测试结果">
        <div className="project-status-latest-head">
          <div><h3>最新测试结果</h3></div>
          <span className="project-status-latest-stamp">{latest.at ? `最近执行 ${new Date(latest.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '还没有执行记录'}</span>
        </div>
        <div className="project-status-tiles">
          {statusSegments.map(segment => {
            const clickable = segment.key === 'failed' && latest.failed > 0;
            return <div key={segment.key} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined} onClick={() => clickable && setFailedOpen(true)} onKeyDown={e => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFailedOpen(true); } }} className={`project-status-tile ${segment.className}${clickable ? ' project-status-tile-clickable' : ''}`}><strong>{latest[segment.key]}</strong><span>{segment.label}</span>{clickable && <em>点击查看</em>}</div>;
        })}
        </div>
        {cases.length > 0 && <div className="project-status-progress" role="img" aria-label={statusSegments.map(segment => `${segment.label} ${latest[segment.key]}`).join('，')}>
          {statusSegments.filter(segment => latest[segment.key] > 0).map(segment => <i key={segment.key} className={segment.className} style={{ width: `${(latest[segment.key] / cases.length) * 100}%` }}/>)}
        </div>}
        
        {latest.rows.length > 0 && <table className="project-status-table">
          <thead><tr><th>模块</th><th>用例</th><th>通过</th><th>失败</th><th>阻塞</th><th>未执行</th><th>未运行</th></tr></thead>
          <tbody>{latest.rows.map(row => <tr key={row.id}>
            <td>{row.name}</td><td>{row.total}</td>
            <td className="passed">{row.passed}</td><td className="failed">{row.failed}</td>
            <td className="blocked">{row.blocked}</td><td className="not-executed">{row.not_executed}</td>
            <td className="never">{row.never}</td>
          </tr>)}</tbody>
        </table>}
      </section>
      {failedOpen && <div className="ps-mask" role="presentation" onClick={() => { setFailedOpen(false); setFailedDetail(undefined); }}>
        <div className="ps-modal" role="dialog" aria-label="失败用例" onClick={e => e.stopPropagation()}>
          <header><h3>失败用例 <span className="ps-tag">{failedCases.length} 条</span></h3><button type="button" onClick={() => { setFailedOpen(false); setFailedDetail(undefined); }}>关闭</button></header>
          <div className="ps-body">
            <table className="ps-table">
              <thead><tr><th style={{ width: 84 }}>编号</th><th>用例</th><th style={{ width: 190 }}>失败原因</th><th style={{ width: 60 }}/></tr></thead>
              <tbody>
                {failedCases.map(item => <tr key={item.id}>
                  <td>{item.id.replace('xmind-', '')}</td>
                  <td>{item.title}</td>
                  <td className="ps-reason">{item.detail ?? '—'}</td>
                  <td><button type="button" className="ps-link" onClick={() => setFailedDetail(item.id)}>查看</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <footer><span>共 {failedCases.length} 条</span><span>点「查看」看失败原因与截图</span></footer>
        </div>
      </div>}
      {failedDetail && (() => {
        const row = failedCases.find(c => c.id === failedDetail);
        if (!row) return null;
        const index = failedCases.findIndex(c => c.id === failedDetail);
        const goto = (delta: number) => { const next = failedCases[index + delta]; if (next) setFailedDetail(next.id); };
        return <div className="ps-mask" role="presentation" onClick={() => setFailedDetail(undefined)}>
          <div className="ps-modal ps-detail" role="dialog" aria-label="失败详情" onClick={e => e.stopPropagation()}>
            <header><h3>{row.id.replace('xmind-', '')} {row.title}</h3><button type="button" onClick={() => setFailedDetail(undefined)}>关闭</button></header>
            <div className="ps-body">
              <div className="ps-kv">
                <b>状态</b><span><span className="ps-tag">失败</span></span>
                <b>模块</b><span>{row.moduleName ?? '—'}</span>
                <b>执行时间</b><span>{new Date(row.at ?? 0).toLocaleString('zh-CN')}</span>
              </div>
              <div className="ps-reason-box"><b>失败原因</b><br/>{row.detail ?? '—'}</div>
              {row.runId && row.evidence
                ? <img className="ps-shot" alt="失败截图" src={`${root}/evidence/${row.runId}/${row.evidence}`}/>
                : <div className="ps-shot ps-shot-empty">这条没有截图</div>}
            </div>
            <footer>
              <button type="button" className="ps-link" disabled={index <= 0} onClick={() => goto(-1)}>◀ 上一条</button>
              <span>{index + 1} / {failedCases.length}</span>
              <button type="button" className="ps-link" disabled={index >= failedCases.length - 1} onClick={() => goto(1)}>下一条 ▶</button>
            </footer>
          </div>
        </div>;
      })()}
      <div className="project-status-recent-inline">
        <span className="project-status-recent-label">最近运行</span>
        {latestRun ? (<><b>{latestRun.scope === 'core' ? '核心链路' : latestRun.scope === 'custom' ? '自选用例' : '全部用例'} · {latestRunCount} 条</b>
          <span>{new Date(latestRun.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {phaseNames[latestRun.phase] ?? latestRun.phase}</span>
          <button type="button" className="project-status-inline-link" onClick={() => onNavigate('run-reports')}>打开运行报告</button></>)
          : <span className="project-status-muted">暂无运行记录</span>}
      </div>
    </section>;
}
