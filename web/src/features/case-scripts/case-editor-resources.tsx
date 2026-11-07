import { useEffect, useRef, useState } from 'react';
type ResourceFile = { project?: { id?: string } };

type Preview = { revision: string; added: string[]; removed: string[]; changed: string[]; unchanged: string[] };
const endpoint = '/api/system-module-regression/resources';
async function request<T>(path: string, value?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, value === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? '资源操作失败。');
    return data;
}
export default function CaseEditorResources({ systemId, disabled, onApplied, onBusyChange }: { systemId: string; disabled: boolean; onApplied: () => void; onBusyChange: (busy: boolean) => void }) {
    const dialog = useRef<HTMLDialogElement>(null), file = useRef<HTMLInputElement>(null);
    const [bundle, setBundle] = useState<ResourceFile>(), [preview, setPreview] = useState<Preview>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { setBundle(undefined); setPreview(undefined); setError(''); dialog.current?.close(); }, [systemId]);
    const perform = async (action: () => Promise<void>) => { setBusy(true); onBusyChange(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); onBusyChange(false); } };
    const download = () => perform(async () => {
        const current = await request<{ resources: ResourceFile }>('?systemId=' + encodeURIComponent(systemId));
        const url = URL.createObjectURL(new Blob([JSON.stringify(current.resources, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'testpilot-resources-' + systemId + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    return <><button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()}>资源</button>
        <dialog ref={dialog} className="ce-ai-dialog" aria-labelledby="ce-resource-title" onCancel={e => { if (busy) e.preventDefault(); }}>
            <header><h2 id="ce-resource-title">项目资源</h2><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button></header>
            <div className="ce-ai-content">
                <div className="ce-page-actions"><button type="button" disabled={busy} onClick={() => void download()}>导出</button><button type="button" disabled={busy} onClick={() => file.current?.click()}>导入</button></div>
                <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => {
                    const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return;
                    setBundle(undefined); setPreview(undefined);
                    void perform(async () => {
                        if (selected.size > 8 * 1024 * 1024) throw Error('资源文件不能超过8MB。');
                        const incoming = JSON.parse(await selected.text()) as ResourceFile;
                        if (incoming.project?.id !== systemId) throw Error('请选择当前项目的资源。');
                        const changes = await request<Preview>('/preview', incoming); setBundle(incoming); setPreview(changes);
                    });
                }} />
                {error && <p role="alert">{error}</p>}
                {preview ? <><p>新增 {preview.added.length} · 修改 {preview.changed.length} · 移除 {preview.removed.length} · 未变 {preview.unchanged.length}</p>
                    {(['added', 'changed', 'removed'] as const).map((kind, i) => preview[kind].length > 0 && <details key={kind}><summary>{['新增', '修改', '移除'][i]}</summary><ul>{preview[kind].map(key => <li key={key}>{key.split(':').at(-1)}</li>)}</ul></details>)}
                </> : <p>导出当前定义，修改后导入并预览。</p>}
            </div>
            <footer><span>保存为新版本，不执行测试</span><button type="button" disabled={busy || !preview || !bundle} onClick={() => void perform(async () => { await request('/apply', { resources: bundle, baseRevision: preview!.revision }); dialog.current?.close(); setPreview(undefined); setBundle(undefined); onApplied(); })}>{busy ? '处理中…' : '应用'}</button></footer>
        </dialog>
    </>;
}
