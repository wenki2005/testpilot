import { useEffect, useState } from 'react';
import { readSqliteSuiteArchive } from './sqlite-suite-archive';

type Candidate = { id: string; status: 'draft' | 'approved' | 'rejected'; revision: number; createdAt: string; reviewedAt?: string; reviewerNotes?: string; digest: string; suite: { version: 1; name: string; baseline?: string; fixtures: string[]; migrations: Array<{ id: string; file: string }>; scenarios: Array<{ id: string; title: string; migrations: string[]; checks: Array<{ id: string; title: string; query: string; expectedRows: Array<Record<string, unknown>> }> }> }; files: Record<string, string> };
type Summary = Pick<Candidate, 'id' | 'status' | 'revision' | 'createdAt' | 'digest'> & { suiteName: string; scenarioCount: number; migrationCount: number };
type Run = { runId: string; status: string; results: Array<{ caseId: string; title: string; status: string; durationMs: number; evidence: Array<{ content: string }> }>; limitations: string[]; sqliteMigration?: { sqliteVersion: string; suiteDigest: string } };

const starterSuite = { version: 1, name: '我的 SQLite 迁移检查', migrations: [{ id: '001-create-example', file: 'migrations/001-create-example.sql' }], scenarios: [{ id: 'create-example-table', title: '迁移创建预期的数据表', migrations: ['001-create-example'], checks: [{ id: 'table-exists', title: 'sample_records 表存在', query: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sample_records'", expectedRows: [{ name: 'sample_records' }] }] }] };
const starterFiles = { 'migrations/001-create-example.sql': 'CREATE TABLE sample_records (id INTEGER PRIMARY KEY, label TEXT NOT NULL);' };
const statusName: Record<string, string> = { draft: '待审核', approved: '已批准', rejected: '已拒绝', passed: '通过', failed: '失败', blocked: '受限', error: '运行错误' };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) { let detail = `${response.status} ${response.statusText}`; try { detail = (await response.json()).error ?? detail; } catch {} throw new Error(detail); }
  return response.json() as Promise<T>;
}

export default function SqliteMigrationPage() {
  const [items, setItems] = useState<Summary[]>([]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [suiteText, setSuiteText] = useState(JSON.stringify(starterSuite, null, 2));
  const [filesText, setFilesText] = useState(JSON.stringify(starterFiles, null, 2));
  const [notes, setNotes] = useState('已检查迁移文件、前置数据、预期失败与断言范围。');
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (keepId?: string) => {
    const rows = await api<Summary[]>('/api/sqlite-migration-suites'); setItems(rows);
    if (keepId) await openCandidate(keepId);
  };
  const openCandidate = async (id: string) => {
    const value = await api<Candidate>(`/api/sqlite-migration-suites/${id}`);
    setCandidate(value); setSuiteText(JSON.stringify(value.suite, null, 2)); setFilesText(JSON.stringify(value.files, null, 2)); setRun(null); setError('');
  };
  useEffect(() => { void refresh().catch(cause => setError((cause as Error).message)); }, []);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const suite = JSON.parse(suiteText); const files = JSON.parse(filesText);
      if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('SQL 文件内容必须是“相对路径: SQL 文本”的 JSON 对象。');
      const route = candidate ? `/api/sqlite-migration-suites/${candidate.id}/update` : '/api/sqlite-migration-suites';
      const value = await api<Candidate>(route, { method: 'POST', body: JSON.stringify({ suite, files }) });
      await refresh(value.id);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const review = async (decision: 'approve' | 'reject') => {
    if (!candidate) return;
    setBusy(true); setError('');
    try { await api(`/api/sqlite-migration-suites/${candidate.id}/review`, { method: 'POST', body: JSON.stringify({ decision, notes }) }); await refresh(candidate.id); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const execute = async () => {
    if (!candidate) return;
    setBusy(true); setError(''); setRun(null);
    try { const result = await api<Run>(`/api/sqlite-migration-suites/${candidate.id}/run`, { method: 'POST', body: '{}' }); setRun(result); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const importArchive = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const imported = await readSqliteSuiteArchive(file);
      setCandidate(null); setSuiteText(JSON.stringify(imported.suite, null, 2)); setFilesText(JSON.stringify(imported.files, null, 2)); setRun(null);
      setNotice('脚本包已导入为新草稿。请检查套件和 SQL 内容，保存后重新审核再运行。');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const newSuite = () => { setCandidate(null); setSuiteText(JSON.stringify(starterSuite, null, 2)); setFilesText(JSON.stringify(starterFiles, null, 2)); setRun(null); setError(''); };
  const parseError = (() => { try { JSON.parse(suiteText); JSON.parse(filesText); return ''; } catch (cause) { return (cause as Error).message; } })();
  const dirty = Boolean(candidate && (suiteText !== JSON.stringify(candidate.suite, null, 2) || filesText !== JSON.stringify(candidate.files, null, 2)));

  return <div className="secondary-page sqlite-migrations-page">
    <header className="secondary-heading"><div><span className="section-kicker">ISOLATED SQLITE RUNNER</span><h1>数据库迁移测试</h1><p>检查 SQLite schema 和数据迁移。每个场景运行在全新的内存数据库中，不连接外部数据库。</p></div><div className="sqlite-heading-actions"><label className="button-secondary sqlite-import-button">导入脚本 ZIP<input type="file" accept=".zip,application/zip" aria-label="导入 SQLite 脚本 ZIP" disabled={busy} onChange={event => { void importArchive(event.target.files?.[0]); event.target.value = ''; }}/></label><button className="button-secondary" onClick={newSuite}>新建套件</button></div></header>
    <div className="sqlite-layout">
      <aside className="sqlite-list-panel" aria-label="已保存的迁移测试"><div className="sqlite-panel-heading"><strong>迁移套件</strong><button className="text-button" onClick={() => void refresh(candidate?.id).catch(cause => setError((cause as Error).message))}>刷新</button></div>
        {!items.length && <p className="sqlite-empty-list">还没有套件。右侧示例可直接作为起点。</p>}
        {items.map(item => <button key={item.id} className={`sqlite-list-row ${candidate?.id === item.id ? 'selected' : ''}`} onClick={() => void openCandidate(item.id).catch(cause => setError((cause as Error).message))}><span className={`api-suite-status ${item.status}`}>{statusName[item.status]} · v{item.revision}</span><strong>{item.suiteName}</strong><small>{item.migrationCount} 次迁移 · {item.scenarioCount} 个场景</small></button>)}
      </aside>
      <section className="sqlite-editor-panel">
        <div className="sqlite-state-line"><span className={`api-suite-status ${candidate?.status ?? 'draft'}`}>{candidate ? `${statusName[candidate.status]} · v${candidate.revision}` : '新草稿'}</span>{candidate && <code>SHA-256 {candidate.digest}</code>}{dirty && <small className="sqlite-unsaved">有未保存修改</small>}</div>
        <div className="sqlite-editors"><label><span>套件定义 <small>JSON：baseline、fixtures、migrations、scenarios、预期行</small></span><textarea aria-label="套件定义 JSON" spellCheck={false} value={suiteText} onChange={event => setSuiteText(event.target.value)} disabled={candidate?.status !== undefined && candidate.status !== 'draft'} /></label><label><span>SQL 文件 <small>JSON 对象：相对路径对应 SQL 源码</small></span><textarea aria-label="SQL 文件 JSON" spellCheck={false} value={filesText} onChange={event => setFilesText(event.target.value)} disabled={candidate?.status !== undefined && candidate.status !== 'draft'} /></label></div>
        <p className="sqlite-boundary-note">只接受套件声明的 .sql 相对路径。SQL 每个文件不超过 512 KB、总计不超过 5 MB；断言是只读 SELECT。ATTACH、PRAGMA、事务控制和文件数据库会被拒绝。</p>
        {error && <div role="alert" className="api-session-notice error">操作失败：{error}</div>}
        {notice && <div className="api-session-notice" role="status">{notice}</div>}
        {candidate?.status === 'draft' && <div className="api-review-panel"><p>保存会创建或递增草稿版本并重新计算摘要。批准后内容锁定；运行只会使用这个确切版本。</p><div className="api-review-actions"><button className="button-secondary" disabled={busy || !!parseError || !dirty} onClick={() => void submit()}>{busy ? '处理中…' : '保存修订'}</button><button className="button-primary" disabled={busy || dirty} onClick={() => void review('approve')}>批准套件</button><button className="text-button" disabled={busy || dirty} onClick={() => void review('reject')}>拒绝</button></div>{dirty && <small className="sqlite-parse-error">先保存修改，审核才会针对当前显示的版本。</small>}{parseError && <small className="sqlite-parse-error">JSON 尚未完整：{parseError}</small>}</div>}
        {!candidate && <div className="api-review-panel"><p>编辑上方示例，或直接保存为一个新的迁移测试套件。保存后再检查和审核。</p><div className="api-review-actions"><button className="button-primary" disabled={busy || !!parseError} onClick={() => void submit()}>{busy ? '正在保存…' : '保存草稿'}</button></div>{parseError && <small className="sqlite-parse-error">JSON 尚未完整：{parseError}</small>}</div>}
        {candidate?.status === 'draft' && <label className="sqlite-review-notes">审核说明<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} rows={2}/></label>}
        {candidate?.status === 'approved' && <div className="api-run-panel"><header><div><h3>已审核版本</h3><p>运行将从摘要锁定的内容重建临时套件，并使用隔离内存数据库。</p></div><button className="button-primary" disabled={busy} onClick={() => void execute()}>{busy ? '正在运行…' : '运行迁移测试'}</button></header>{candidate.reviewerNotes && <small>审核说明：{candidate.reviewerNotes}</small>}</div>}
        {run && <section className="api-run-panel sqlite-run-result"><header><div><h3>运行结果：{statusName[run.status] ?? run.status}</h3><p>{run.results.length} 个迁移场景{run.sqliteMigration ? ` · SQLite ${run.sqliteMigration.sqliteVersion}` : ''}</p></div><div className="api-downloads"><a href={`/api/sqlite-migration-runs/${run.runId}/report`} download>下载报告</a><a href={`/api/sqlite-migration-runs/${run.runId}/package`} download>下载脚本包</a></div></header>{run.results.map(result => <article className={`api-result ${result.status}`} key={result.caseId}><span>{statusName[result.status] ?? result.status}</span><div className="api-result-main"><strong>{result.title}</strong><small>{result.durationMs} ms</small><details><summary>查看迁移证据</summary><pre>{result.evidence.map(item => item.content).join('\n')}</pre></details></div></article>)}{run.limitations.map(item => <small key={item} className="sqlite-limitation">{item}</small>)}</section>}
      </section>
    </div>
  </div>;
}
