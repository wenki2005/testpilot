import React, { useState } from 'react';
import { request } from '../api/client';

type CodeFile = { name: string; language: string; code: string; description: string; path?: string; startLine?: number; sha256?: string };
type CodeView = { caseId: string; origin: string; version: string; runId?: string; notice: string; files: CodeFile[] };

export function CaseCodeViewer({ caseId, title, projectId, runId }: { caseId: string; title: string; projectId?: string; runId?: string }) {
  const [value, setValue] = useState<CodeView>();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const owner = runId ?? projectId;
      if (!owner) throw new Error('没有可读取的项目或运行标识。');
      setValue(await request<CodeView>(`/api/${runId ? 'document-runs' : 'document-projects'}/${encodeURIComponent(owner)}/cases/${encodeURIComponent(caseId)}/code`)); setSelected(0);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const file = value?.files[selected];
  const copy = async () => {
    if (!file) return;
    try { await navigator.clipboard.writeText(file.code); setNotice('代码已复制。'); }
    catch { setNotice('无法自动复制，请选择代码后按 Ctrl+C。'); }
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.code], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name.replace(/[\\/:*?"<>|]/gu, '_');
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('已下载当前代码文件。');
  };
  return <React.Fragment><details className="case-code-viewer" onToggle={event => { if (event.currentTarget.open && !value && !busy && !error) void load(); }}>
    <summary aria-label={`${title}：查看代码`}>查看代码</summary>
    {busy && <p role="status">正在读取此用例的代码…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="button-secondary" onClick={() => void load()}>重新读取代码</button></div>}
    {value && file && <div className="case-code-content">
      <p><strong>{value.caseId}</strong> · {value.origin}{value.runId ? ` · 运行 ${value.runId}` : ''}</p>
      <div className="case-code-toolbar"><label>代码文件<select aria-label={`${caseId}代码文件`} value={selected} onChange={event => { setSelected(Number(event.target.value)); setNotice(''); }}>{value.files.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
        <button type="button" className="button-secondary" onClick={() => void copy()}>复制代码</button><button type="button" className="button-secondary" onClick={download}>下载代码</button></div>
      <p>{file.description}</p>{file.path && <p className="case-code-path">文件：{file.path}{file.startLine ? ` · 从第 ${file.startLine} 行显示` : ''}</p>}
      <pre tabIndex={0} aria-label={`${value.caseId} ${file.name}代码`}><code>{file.code.split('\n').map((line, index) => <span className="case-code-line" key={index}><span aria-hidden="true" className="case-code-number">{(file.startLine ?? 1) + index}</span><span>{line || ' '}</span></span>)}</code></pre>
      <small>用例版本：{value.version} {file.sha256 ? ` · 文件 SHA-256：${file.sha256}` : ''}</small>
      <p>{value.notice}</p>{!value.files.some(item => item.language === 'vue') && <p>此用例尚未关联经过核实的业务源码；可查看测试定义和可用的执行器源码。</p>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </details></React.Fragment>;
}
