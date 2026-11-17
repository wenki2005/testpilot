import { useMemo, useState } from 'react';
import CaseEvidenceDialog from '../shared/case-evidence-dialog';

type ResultRow = {
  jobId: string;
  moduleName: string;
  caseId: string;
  title: string;
  status: string;
  detail?: string;
  evidenceUrl?: string;
};

const statusOrder = ['failed', 'blocked', 'passed', 'not_executed', 'outside'] as const;
const statusNames: Record<string, string> = { failed: '失败', blocked: '阻塞', passed: '通过', not_executed: '未执行', outside: '范围外', error: '异常' };

export default function CrossModuleResults({ jobs, evidenceBase, onOpen }: {
  jobs: Array<{ id: string; moduleName: string; results: Array<{ caseId: string; title: string; status: string; detail?: string; evidence?: string; outOfScope?: boolean }> }>;
  evidenceBase: string;
  onOpen: (jobId: string, caseId: string) => void;
}) {
  const [status, setStatus] = useState('failed');
  const [keyword, setKeyword] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [shot, setShot] = useState<{ cases: Array<{ id: string; title: string; status: string; moduleName?: string; at?: string | number; detail?: string; evidenceUrl?: string }>; index: number } | null>(null);

  const rows = useMemo<ResultRow[]>(() => jobs.flatMap(job => job.results.map(result => ({
    jobId: job.id,
    moduleName: job.moduleName,
    caseId: result.caseId,
    title: result.title,
    status: result.outOfScope ? 'outside' : result.status,
    detail: result.detail,
    ...(result.evidence ? { evidenceUrl: `${evidenceBase}/jobs/${job.id}/evidence/${result.evidence}` } : {}),
  }))), [jobs, evidenceBase]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    for (const row of rows) map[row.status] = (map[row.status] ?? 0) + 1;
    return map;
  }, [rows]);

  const activeStatus = status === 'all' || counts[status] ? status : 'all';
  const filtered = useMemo(() => rows.filter(row => {
    const byStatus = activeStatus === 'all' || row.status === status;
    const byKeyword = !keyword.trim() || `${row.caseId} ${row.title} ${row.moduleName}`.toLowerCase().includes(keyword.trim().toLowerCase());
    return byStatus && byKeyword;
  }), [rows, activeStatus, keyword]);

  if (!rows.length) return null;

  const openShot = (row: ResultRow) => {
    const list = filtered.filter(item => item.evidenceUrl).map(item => ({ id: item.caseId, title: item.title, status: item.status, moduleName: item.moduleName, at: 0, detail: item.detail, evidenceUrl: item.evidenceUrl }));
    const index = Math.max(0, list.findIndex(item => item.id === row.caseId));
    setShot({ cases: list, index });
  };

  const table = (items: ResultRow[]) => <div className="sm-table"><table><thead><tr><th style={{ width: '180px' }}>模块</th><th>用例</th><th style={{ width: '90px' }}>结果</th><th style={{ width: '150px' }}>操作</th></tr></thead><tbody>
    {items.map(row => <tr key={`${row.jobId}:${row.caseId}`}>
      <td>{row.moduleName}</td>
      <td>{row.title}</td>
      <td><span className={`sm-badge sm-${row.status}`}>{statusNames[row.status] ?? row.status}</span></td>
      <td><div className="sm-evidence-links"><button type="button" className="sm-link" onClick={() => onOpen(row.jobId, row.caseId)}>查看</button>{row.evidenceUrl && <button type="button" className="sm-link" onClick={() => openShot(row)}>查看截图</button>}</div></td>
    </tr>)}
    {!items.length && <tr><td colSpan={4} className="sm-empty">当前筛选没有用例。</td></tr>}
  </tbody></table></div>;

  const groups = grouped ? [...new Set(filtered.map(row => row.jobId))].map(id => ({ id, moduleName: filtered.find(row => row.jobId === id)!.moduleName, items: filtered.filter(row => row.jobId === id) })) : [];

  return <section className="sm-cross-results" aria-label="跨模块失败筛选">
    <div className="sm-cross-toolbar">
      <button type="button" className={'sm-chip' + (activeStatus === 'all' ? ' active' : '')} onClick={() => setStatus('all')}>全部 {counts.all ?? 0}</button>
      {statusOrder.map(key => counts[key] ? <button type="button" key={key} className={'sm-chip' + (activeStatus === key ? ' active' : '')} onClick={() => setStatus(key)}>{statusNames[key] ?? key} {counts[key]}</button> : null)}
      <input className="sm-cross-search" type="search" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索编号 / 标题 / 模块" aria-label="搜索用例结果"/>
      <label className="sm-cross-group"><input type="checkbox" checked={grouped} onChange={event => setGrouped(event.target.checked)}/>按模块分组</label>
    </div>
    {activeStatus === 'all' && !keyword.trim() && !grouped ? <p className="sm-cross-hint">选择状态或输入关键词，查看跨模块用例明细。</p> : grouped ? groups.map(group => <div key={group.id} className="sm-cross-group-block"><h4>{group.moduleName}</h4>{table(group.items)}</div>) : table(filtered)}
    {shot && <CaseEvidenceDialog cases={shot.cases} index={shot.index} onChange={index => setShot({ ...shot, index })} onClose={() => setShot(null)} />}
  </section>;
}
