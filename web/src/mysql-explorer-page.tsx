import { useEffect, useMemo, useState, type FormEvent } from 'react';

type ConnectionStatus = { connected: boolean; host: string; port: number; database: string; account?: string };
type Table = { name: string };
type Column = { name: string; dataType: string; columnType: string; nullable: boolean; primaryKey: boolean; autoIncrement: boolean; sensitive: boolean; displayable: boolean };
type RowsPage = { table: string; columns: Column[]; rows: Array<Record<string, string | number | null>>; offset: number; limit: number; hasMore: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); message = body.error ?? body.message ?? message; } catch { /* response may be empty */ }
    throw new Error(message);
  }
  return response.json();
}

export default function MysqlExplorerPage() {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [username, setUsername] = useState('fengqi');
  const [password, setPassword] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [data, setData] = useState<RowsPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const visibleTables = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? tables.filter(table => table.name.toLowerCase().includes(query)) : tables;
  }, [filter, tables]);

  const refreshTables = async () => {
    const result = await api<Table[]>('/api/mysql/tables');
    setTables(result);
  };

  useEffect(() => {
    let live = true;
    void api<ConnectionStatus>('/api/mysql/status').then(async current => {
      if (!live) return;
      setConnection(current);
      if (current.connected) {
        const result = await api<Table[]>('/api/mysql/tables');
        if (live) setTables(result);
      }
    }).catch(cause => { if (live) setError((cause as Error).message); });
    return () => { live = false; };
  }, []);

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const current = await api<ConnectionStatus>('/api/mysql/connect', { method: 'POST', body: JSON.stringify({ user: username, password }) });
      setConnection(current); setPassword(''); setSelectedTable(''); setColumns([]); setData(null);
      await refreshTables(); setMessage('连接成功。该会话只保存在 TestPilot 内存中。');
    } catch (cause) { setError((cause as Error).message); }
    finally { setPassword(''); setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/mysql/disconnect', { method: 'POST', body: '{}' });
      setConnection(current => current ? { ...current, connected: false, account: undefined } : current);
      setTables([]); setSelectedTable(''); setColumns([]); setData(null); setMessage('已断开连接。');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const selectTable = async (table: string) => {
    setBusy(true); setError(''); setMessage(''); setSelectedTable(table); setData(null);
    try { setColumns(await api<Column[]>(`/api/mysql/tables/${encodeURIComponent(table)}/columns`)); }
    catch (cause) { setColumns([]); setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  const loadRows = async (offset: number) => {
    if (!selectedTable) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const query = new URLSearchParams({ offset: String(offset), limit: '25' });
      setData(await api<RowsPage>(`/api/mysql/tables/${encodeURIComponent(selectedTable)}/rows?${query}`));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="secondary-page mysql-explorer-page">
    <header className="secondary-heading"><div><span className="section-kicker">READ ONLY DATABASE BROWSER</span><h1>MySQL 数据库</h1><p>连接部门申样测试库，查看表结构和分页数据，辅助整理测试数据与回归用例。</p></div>
      {connection?.connected && <button className="button-secondary" disabled={busy} onClick={() => void disconnect()}>断开连接</button>}
    </header>
    <div className="mysql-safety-banner"><span className="mysql-safety-icon">↗</span><div><strong>加密只读连接</strong><p>TestPilot 仅接受 supply 库的 SELECT 专用账号，并要求校验 TLS 证书；每次数据查询使用只读事务。敏感字段默认遮蔽，密码不会写入配置或浏览器本地存储。</p></div></div>
    {error && <div className="mysql-notice mysql-notice-error" role="alert">{error}</div>}
    {message && <div className="mysql-notice mysql-notice-success" role="status">{message}</div>}
    {!connection?.connected ? <form className="mysql-connect-card" onSubmit={event => void connect(event)}>
      <div className="mysql-card-heading"><div><h2>连接测试数据库</h2><p>连接地址与库名已固定为测试环境；输入数据库账号完成连接。</p></div><span className="mysql-disconnected"><i/>未连接</span></div>
      <div className="mysql-connection-fields"><label><span>主机</span><input value={connection?.host ?? '47.95.211.86'} readOnly /></label><label><span>端口</span><input value={connection?.port ?? 12010} readOnly /></label><label><span>数据库</span><input value={connection?.database ?? 'supply'} readOnly /></label><label><span>用户名</span><input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required /></label><label className="mysql-password-field"><span>密码 <small>仅用于此次内存连接</small></span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label></div>
      <div className="mysql-connect-footer"><span>服务端会验证账号仅有 supply 库读取权限。</span><button className="button-primary" type="submit" disabled={busy || !password}>{busy ? '连接中…' : '连接数据库'}</button></div>
    </form> : <>
      <div className="mysql-connected-card"><div className="mysql-connected-status"><i/><div><strong>已连接 · {connection.database}</strong><span>{connection.host}:{connection.port} · {connection.account ?? username}</span></div></div><div className="mysql-connected-meta"><strong>{tables.length}</strong><span>张数据表</span></div><button className="text-button" disabled={busy} onClick={() => { void refreshTables().catch(cause => setError((cause as Error).message)); }}>刷新表清单</button></div>
      <div className="mysql-browser-layout">
        <aside className="mysql-table-panel"><div className="mysql-table-panel-head"><strong>数据表</strong><span>{visibleTables.length}</span></div><label className="mysql-table-search"><span>⌕</span><input aria-label="搜索数据表" placeholder="搜索表名" value={filter} onChange={event => setFilter(event.target.value)} /></label><div className="mysql-table-list">{visibleTables.map(table => <button key={table.name} className={`mysql-table-row ${selectedTable === table.name ? 'selected' : ''}`} onClick={() => void selectTable(table.name)}><span className="mysql-table-glyph">▦</span><span>{table.name}</span></button>)}{!visibleTables.length && <p className="mysql-no-tables">没有匹配的数据表。</p>}</div></aside>
        <section className="mysql-detail-panel">
          {!selectedTable ? <div className="mysql-empty-state"><div className="mysql-empty-glyph">▤</div><h2>选择一张表</h2><p>先查看字段结构。只有点击“查看数据”后才会读取该表的首 25 行。</p></div> : <>
            <div className="mysql-detail-heading"><div><span className="section-kicker">TABLE STRUCTURE</span><h2>{selectedTable}</h2><p>{columns.length} 个字段 · 敏感字段会在服务端直接遮蔽</p></div><button className="button-primary" disabled={busy} onClick={() => void loadRows(0)}>{busy ? '读取中…' : data ? '重新读取' : '查看数据'}</button></div>
            <div className="mysql-column-list" aria-label="字段结构"><div className="mysql-column-head"><span>字段</span><span>类型</span><span>说明</span></div>{columns.map(column => <div className="mysql-column-row" key={column.name}><code>{column.name}{column.primaryKey && <b className="mysql-key-tag">PK</b>}</code><span>{column.columnType}</span><small>{column.sensitive ? '敏感信息已遮蔽' : !column.displayable ? '大字段不展示' : column.nullable ? '可为空' : '非空'}{column.autoIncrement ? ' · 自增' : ''}</small></div>)}</div>
            {data && <div className="mysql-data-section"><div className="mysql-data-heading"><div><h3>数据预览</h3><p>第 {data.offset + 1}–{data.offset + data.rows.length} 行 · 最多每页 {data.limit} 行；未返回总行数</p></div><div className="mysql-page-actions"><button className="button-secondary" disabled={busy || data.offset === 0} onClick={() => void loadRows(Math.max(0, data.offset - data.limit))}>上一页</button><button className="button-secondary" disabled={busy || !data.hasMore} onClick={() => void loadRows(data.offset + data.limit)}>下一页</button></div></div>
              {data.rows.length ? <div className="mysql-grid-scroll"><table className="mysql-grid"><thead><tr>{data.columns.map(column => <th key={column.name}>{column.name}{column.sensitive && <small>已遮蔽</small>}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={`${data.offset}-${index}`}>{data.columns.map(column => <td key={column.name} className={column.sensitive ? 'mysql-cell-masked' : ''}>{row[column.name] === null ? <span className="mysql-null">NULL</span> : String(row[column.name])}</td>)}</tr>)}</tbody></table></div> : <div className="mysql-no-rows">这张表当前没有数据。</div>}
            </div>}
          </>}
        </section>
      </div>
    </>}
  </div>;
}
