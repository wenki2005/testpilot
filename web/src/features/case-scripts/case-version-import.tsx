import { useEffect, useRef, useState } from 'react';
import type { CaseEditorCatalog } from '../../../../src/domain/cases/case-script-contract';
type Preview = { revision: string; resources: unknown; total: number; added: string[]; changed: string[]; removed: string[]; unchanged: string[]; scriptsToReview: string[]; mappingUpdates: string[]; issues: string[]; unresolved: Array<{ key: string; title: string; sourcePath: string[]; reason: string }> };
type Upload = { fileName: string; bytesBase64: string };
export default function CaseVersionImport({ catalog, disabled, onBusyChange, onApplied }: { catalog: CaseEditorCatalog; disabled: boolean; onBusyChange: (busy: boolean) => void; onApplied: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null), file = useRef<HTMLInputElement>(null);
    const [upload, setUpload] = useState<Upload>(), [preview, setPreview] = useState<Preview>(), [mapping, setMapping] = useState<Record<string, { moduleId: string; caseId?: string }>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { dialog.current?.close(); setUpload(undefined); setPreview(undefined); setMapping({}); setError(''); }, [catalog.systemId]);
    const perform = async (fn: () => Promise<void>) => { setBusy(true); onBusyChange(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); onBusyChange(false); } };
    const post = async <T,>(suffix: string, body: unknown): Promise<T> => { const response = await fetch('/api/system-module-regression/resources' + suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw Error(value.error ?? '更新失败'); return value; };
    const inspect = (value: Upload, choices = mapping) => perform(async () => setPreview(await post<Preview>('/cases/preview', { systemId: catalog.systemId, ...value, mapping: choices })));
    return <><button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()}>更新用例</button>
        <dialog ref={dialog} className="ce-ai-dialog" aria-labelledby="ce-version-import-title" onCancel={e => { if (busy) e.preventDefault(); }}>
            <header><h2 id="ce-version-import-title">更新用例</h2><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button></header>
            <div className="ce-ai-content"><button type="button" disabled={busy} onClick={() => file.current?.click()}>上传完整新版</button>{upload && <span> {upload.fileName}</span>}
                <input ref={file} type="file" accept=".xmind,.csv" hidden onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return; setPreview(undefined); setMapping({}); setUpload(undefined); void perform(async () => { if (selected.size > 8 * 1024 * 1024) throw Error('文件不能超过8MB。'); const bytesBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(Error('读取文件失败')); reader.readAsDataURL(selected); }); const value = { fileName: selected.name, bytesBase64 }; setUpload(value); setPreview(await post<Preview>('/cases/preview', { systemId: catalog.systemId, ...value, mapping: {} })); }); }} />
                {error && <p role="alert">{error}</p>}
                {preview ? <><p>共 {preview.total} · 新增 {preview.added.length} · 修改 {preview.changed.length} · 移除 {preview.removed.length} · 未变 {preview.unchanged.length}</p>
                    {(['added', 'changed', 'removed', 'scriptsToReview'] as const).map((kind, i) => !!preview[kind].length && <details key={kind}><summary>{['新增', '修改', '移除', '脚本待核对'][i]} {preview[kind].length}</summary><ul>{preview[kind].map(k => <li key={k}>{k.slice(k.indexOf(':') + 1)}</li>)}</ul></details>)}
                    {!!preview.mappingUpdates.length && <p>已识别原编号 {preview.mappingUpdates.length} 条，下次按源ID匹配。</p>}
                    {preview.unresolved.map(row => <label className="field-label" key={row.key}>{row.title}<select aria-label={'对应编号：' + row.title} disabled={busy} value={mapping[row.key] ? mapping[row.key]!.moduleId + ':' + (mapping[row.key]!.caseId ?? '') : ''} onChange={e => { const value = e.target.value; setMapping(old => ({ ...old, [row.key]: { moduleId: value.slice(0, 36), ...(value.slice(37) ? { caseId: value.slice(37) } : {}) } })); setPreview(p => p ? { ...p, issues: ['映射已修改，请重新预览。'] } : p); }}><option value="" disabled>选择原用例或新增模块位置</option>{catalog.modules.map(m => <optgroup key={m.id} label={m.name}><option value={m.id + ':'}>新增到此模块</option>{catalog.cases.filter(c => c.moduleId === m.id).map(c => <option key={c.id} value={m.id + ':' + c.id}>{c.id} · {c.title}</option>)}</optgroup>)}</select></label>)}
                    {preview.issues.map(issue => <p role="status" key={issue}>{issue}</p>)}
                    {(!!preview.unresolved.length || preview.issues.length > 0) && <button type="button" disabled={busy || !upload} onClick={() => upload && void inspect(upload)}>重新预览</button>}
                </> : <p>XMind / CSV。未变脚本保留，变更脚本需核对。</p>}
            </div>
            <footer><span>旧版本和运行记录保留</span><button type="button" disabled={busy || !preview || !!preview.issues.length} onClick={() => void perform(async () => { await post('/apply', { resources: preview!.resources, baseRevision: preview!.revision }); dialog.current?.close(); setPreview(undefined); onApplied(); })}>{busy ? '处理中…' : '更新'}</button></footer>
        </dialog></>;
}
