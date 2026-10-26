import { useEffect, useState } from 'react';

type ApiSuiteSummary = { id: string; status: 'draft' | 'approved' | 'rejected'; automaticReadOnlyRun: boolean; revision: number; createdAt: string; reviewedAt?: string; reviewerNotes?: string; digest: string; suiteName: string; caseCount: number };

export default function ApiSuitesPage({ openSuite }: { openSuite: (id: string) => void }) {
  const [items, setItems] = useState<ApiSuiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/api-suites'); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); setItems(await response.json()); }
    catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const labels = { draft: '待审核', approved: '已批准', rejected: '已拒绝' };
  return <div className="secondary-page api-suites-page">
    <header className="secondary-heading"><div><span className="section-kicker">HTTP API REGRESSION</span><h1>API 测试套件</h1><p>持久化草稿与审核版本。打开候选只会读取它，不会自动重新运行。</p></div><button className="button-secondary" onClick={() => void refresh()} disabled={loading}>{loading ? '正在刷新…' : '刷新列表'}</button></header>
    {error && <div className="api-session-notice error" role="alert">读取套件失败：{error}</div>}
    {!loading && !error && !items.length && <div className="empty-state"><h2>还没有 API 套件</h2><p>在“新建测试”里选择 API 服务，添加需求或 OpenAPI 契约后开始。</p></div>}
    <div className="api-suite-list">{items.map(item => <button className="api-suite-list-item" key={item.id} onClick={() => openSuite(item.id)}><span className={`api-suite-status ${item.status}`}>{labels[item.status]} · v{item.revision}</span><strong>{item.suiteName}</strong><small>{item.caseCount} 条用例 · 创建于 {new Date(item.createdAt).toLocaleString('zh-CN')}</small><code>{item.id}</code></button>)}</div>
  </div>;
}
