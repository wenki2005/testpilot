import { Fragment, useEffect, useMemo, useState } from 'react';
import type { FixedModule } from '../../../../src/domain/regression/module-catalog-contract';
import { latestModuleSummary, type LatestModuleResults } from './latest-case-results';
type Scope = 'starter' | 'all' | 'custom';
type Counts = ReturnType<typeof latestModuleSummary>['counts'];
type CasePack = {
    cases: Array<{
        id: string;
        title: string;
        expected: string;
        priority?: string;
    }>;
};
const names = { passed: '通过', failed: '失败', blocked: '阻塞', error: '异常', not_executed: '未执行', outside: '范围外' };
const emptyCounts = (): Counts => ({ passed: 0, failed: 0, blocked: 0, error: 0, not_executed: 0, outside: 0 });
const apiBase = location.pathname.startsWith('/dify/') ? '/dify/api' : '/api';
function CountsView({ counts }: {
    counts: Counts;
}) {
    const entries = Object.entries(counts).filter(([, count]) => count > 0) as Array<[
        keyof Counts,
        number
    ]>;
    return entries.length ? <span className="sm-module-counts">{entries.map(([status, count]) => <span key={status} className={`sm-${status === 'not_executed' ? 'not-executed' : status === 'error' ? 'failed' : status}`}>{count} {names[status]}</span>)}</span> : <span className="sm-not-executed">未执行</span>;
}
/** Preview the current draft selection. Historical batches render their own snapshot. */
export default function SelectionResults({ modules, scope, caseSelections, latestResults, onSource, onDownload, downloadDisabled }: {
    modules: FixedModule[];
    scope: Scope;
    caseSelections: Record<string, string[] | undefined>;
    latestResults: LatestModuleResults;
    onSource: (batchId: string, jobId: string) => void;
    onDownload: () => void;
    downloadDisabled: boolean;
}) {
    const [expanded, setExpanded] = useState('');
    const [detailId, setDetailId] = useState('');
    const [filter, setFilter] = useState('all');
    const [pack, setPack] = useState<{
        key: string;
        value: CasePack;
    }>();
    const [error, setError] = useState('');
    const rows = modules.map(module => {
        const version = module.versions.at(-1)!;
        const ids = scope === 'all' ? undefined : caseSelections[module.id] ?? [];
        const count = ids?.length ?? version.caseCount;
        return { module, version, ids, count, summary: latestModuleSummary(latestResults, module.id, version.id, ids, count) };
    });
    const counts = rows.reduce((total, row) => {
        for (const key of Object.keys(total) as Array<keyof Counts>)
            total[key] += row.summary.counts[key];
        return total;
    }, emptyCounts());
    const selectedCount = rows.reduce((total, row) => total + row.count, 0);
    const opened = rows.find(row => row.module.id === expanded);
    const packKey = opened ? `${opened.module.id}:${opened.version.id}` : '';
    const selectionKey = JSON.stringify(rows.map(row => [row.module.id, row.version.id, row.ids]));
    useEffect(() => { setDetailId(''); setFilter('all'); }, [selectionKey]);
    useEffect(() => {
        if (!packKey || !opened)
            return;
        let live = true;
        const controller = new AbortController();
        setError('');
        void fetch(`${apiBase}/system-module-regression/modules/${encodeURIComponent(opened.module.id)}?version=${encodeURIComponent(opened.version.id)}`, { signal: controller.signal })
            .then(async (response) => {
            if (!response.ok)
                throw Error('用例详情暂未加载，请重新展开。');
            return response.json() as Promise<CasePack>;
        })
            .then(value => {
            if (live)
                setPack({ key: packKey, value });
        })
            .catch(reason => {
            if (live)
                setError((reason as Error).message);
        });
        return () => { live = false; controller.abort(); };
    }, [packKey]);
    const cases = useMemo(() => {
        if (!opened || pack?.key !== packKey)
            return [];
        const ids = opened.ids ? new Set(opened.ids) : undefined;
        const results = latestResults.get(packKey);
        return pack.value.cases.filter(item => !ids || ids.has(item.id)).map(item => {
            const source = results?.get(item.id);
            return { item, source, status: source?.result.outOfScope ? 'outside' as const : source?.result.status ?? 'not_executed' as const };
        });
    }, [pack, packKey, latestResults, selectionKey]);
    return <section className="sm-results" aria-label="当前所选模块运行结果">
    <div className="sm-heading"><div><h2>运行结果</h2><p className="sm-batch-range">当前勾选 {modules.length} 个模块 · {({ starter: '日常用例', all: '全部用例', custom: '自选用例' })[scope]} {selectedCount} 条 · 尚未执行</p></div><div className="sm-actions">{modules.length > 0 && <CountsView counts={counts}/>}<button disabled={downloadDisabled} onClick={onDownload}>下载固定脚本</button></div></div>
    <div className="sm-table"><table><thead><tr><th>模块</th><th>版本</th><th>用例</th><th>结果</th><th>操作</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.module.id}><td>{row.module.name}</td><td>v{row.version.version}</td><td>{row.count}</td><td>{row.count ? <CountsView counts={row.summary.counts}/> : <span className="sm-not-executed">{scope === 'starter' ? '未设置日常用例' : '未选择用例'}</span>}</td><td><button className="sm-link" disabled={!row.count} aria-expanded={expanded === row.module.id} onClick={() => { setExpanded(expanded === row.module.id ? '' : row.module.id); setDetailId(''); setFilter('all'); }}>{expanded === row.module.id ? '收起结果' : '查看结果'}</button></td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="sm-empty">请先勾选模块。</td></tr>}
    </tbody></table></div>
    {opened && <div className="sm-case-results"><div className="sm-heading"><h3>{opened.module.name} · 所选 {opened.count} 条</h3><CountsView counts={opened.summary.counts}/><select aria-label="筛选当前范围结果" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(names).map(([status, name]) => <option key={status} value={status}>{name}</option>)}</select></div>
      {error ? <p role="alert">{error}</p> : pack?.key !== packKey ? <p role="status">正在加载用例…</p> : <div className="sm-table"><table><thead><tr><th>用例</th><th>运行结果</th><th>操作</th></tr></thead><tbody>{cases.filter(row => filter === 'all' || row.status === filter).map(({ item, source, status }) => {
                    const evidence = source?.result.evidence ? `${apiBase}/dify-web-modules/jobs/${source.jobId}/evidence/${source.result.evidence}` : undefined;
                    return <Fragment key={item.id}><tr><td><span className="sm-priority">{item.priority ?? '—'}</span>{item.title}</td><td><span className={`sm-badge sm-${status}`}>{names[status]}</span></td><td><button className="sm-link" aria-expanded={detailId === item.id} onClick={() => setDetailId(detailId === item.id ? '' : item.id)}>{detailId === item.id ? '收起详情' : '查看详情'}</button></td></tr>
          {detailId === item.id && <tr className="sm-detail-row"><td colSpan={3}><div className="sm-evidence"><h3>{item.title}</h3><h4>原始预期</h4><p>{item.expected}</p><h4>实际结果</h4><p>{source?.result.detail ?? '当前账号、环境和模块版本下尚无执行结果。'}</p>{source?.result.nextAction && <p>{source.result.nextAction}</p>}{source && <><p>执行时间：{new Date(source.startedAt).toLocaleString('zh-CN', { hour12: false })}</p><button className="sm-link" onClick={() => onSource(source.batchId, source.jobId)}>查看来源批次</button></>}{evidence && <p><a href={evidence} target="_blank" rel="noreferrer">查看执行截图</a></p>}</div></td></tr>}
        </Fragment>;
                })}</tbody></table></div>}
    </div>}
  </section>;
}
