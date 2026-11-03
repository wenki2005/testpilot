import { useState } from 'react';
import { request } from '../api/client';
import type { Check } from '../types';

type Preview = { digest: string; changes: Array<{ id: string; kind: string; title: string }>; cases: Check[] };

export function CaseMarkdownAssets({ projectId, onImported }: { projectId: string; onImported(): void }) {
  const [markdown, setMarkdown] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const previewFile = async (file?: File) => {
    setNotice(''); setPreview(null);
    if (!file) return;
    if (!/\.(md|markdown)$/iu.test(file.name)) { setNotice('请选择 Markdown 文件（.md 或 .markdown）。'); return; }
    const text = await file.text(); setMarkdown(text); await previewText(text);
  };
  const previewText = async (text: string) => {
    setBusy(true); setNotice('');
    try { setPreview(await request<Preview>(`/api/document-projects/${encodeURIComponent(projectId)}/cases.md/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: text }) })); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  const download = () => { window.location.href = `/api/document-projects/${encodeURIComponent(projectId)}/cases.md`; };
  const apply = async () => {
    if (!preview) return;
    setBusy(true); setNotice('');
    try {
      const result = await request<{ projectId: string; imported: number; changes: Preview['changes'] }>(`/api/document-projects/${encodeURIComponent(projectId)}/cases.md/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown, expectedDigest: preview.digest }) });
      setPreview(null); setMarkdown(''); setNotice(`已导入 ${result.imported} 条用例。用例集已变更，需要重新审核后才能运行。`); onImported();
    } catch (error) { setPreview(null); setNotice(`导入未应用：${(error as Error).message}。请重新预览后再确认。`); }
    finally { setBusy(false); }
  };
  return <details className="doc-case-assets"><summary>高级配置 · Markdown 用例资产</summary>
    <p>下载当前用例，或预览本地 Markdown 的变更；只有确认应用后才会导入。</p>
    <div className="doc-notification-actions"><button className="button-secondary" onClick={download}>下载用例 Markdown</button><label>预览本地 Markdown<input type="file" accept=".md,.markdown,text/markdown" onChange={event => void previewFile(event.target.files?.[0])} /></label></div>
    {preview && <section className="doc-markdown-preview" aria-label="Markdown 导入预览"><strong>预览 · {preview.changes.length} 项变更</strong><ul>{preview.changes.map((change, index) => <li key={`${change.id}-${index}`}><code>{change.kind}</code> · {change.title} · {change.id}</li>)}</ul><p>预览版本摘要：{preview.digest.slice(0, 16)}</p><button className="button-primary" disabled={busy} onClick={() => void apply()}>确认应用导入</button></section>}
    {notice && <small role="status">{notice}</small>}
  </details>;
}
