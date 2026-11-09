import { useEffect, useRef, useState } from 'react';
type ResourceCase = { id: string; moduleId: string; title: string; expected: string; manualSteps: string[]; prerequisites: unknown[]; prerequisiteReview: { status: string; note: string }; sourcePath: string[]; sourceExpected: string; script: { caseId: string; dependsOn: unknown[]; steps: unknown[] } };
type ResourceFile = { project?: { id?: string }; modules?: { id: string; name: string }[]; cases?: ResourceCase[]; chains?: unknown[]; schema?: number };

type Preview = { revision: string; added: string[]; removed: string[]; changed: string[]; unchanged: string[] };
const endpoint = '/api/system-module-regression/resources';
async function request<T>(path: string, value?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, value === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? '资源操作失败。');
    return data;
}
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export default function CaseEditorResources({ systemId, disabled, onApplied, onBusyChange }: { systemId: string; disabled: boolean; onApplied: () => void; onBusyChange: (busy: boolean) => void }) {
    const dialog = useRef<HTMLDialogElement>(null), file = useRef<HTMLInputElement>(null);
    const [bundle, setBundle] = useState<ResourceFile>(), [preview, setPreview] = useState<Preview>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [modules, setModules] = useState<{ id: string; name: string }[]>([]), [existing, setExisting] = useState<string[]>([]);
    const [creating, setCreating] = useState(false), [form, setForm] = useState({ moduleId: '', id: '', title: '', expected: '' });
    useEffect(() => { setBundle(undefined); setPreview(undefined); setError(''); setCreating(false); dialog.current?.close(); }, [systemId]);
    const perform = async (action: () => Promise<void>) => { setBusy(true); onBusyChange(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); onBusyChange(false); } };
    const download = () => perform(async () => {
        const current = await request<{ resources: ResourceFile }>('?systemId=' + encodeURIComponent(systemId));
        const url = URL.createObjectURL(new Blob([JSON.stringify(current.resources, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'testpilot-resources-' + systemId + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const openCreate = () => perform(async () => {
        const current = await request<{ resources: ResourceFile }>('?systemId=' + encodeURIComponent(systemId));
        const list = current.resources.cases ?? [];
        setModules((current.resources.modules ?? []).map(m => ({ id: m.id, name: m.name })));
        setExisting(list.map(c => c.id));
        setForm({ moduleId: form.moduleId || (current.resources.modules ?? [])[0]?.id || '', id: '', title: '', expected: '' });
        setCreating(true);
        setBundle(undefined); setPreview(undefined);
    });
    const create = () => perform(async () => {
        const id = form.id.trim(), title = form.title.trim(), expected = form.expected.trim();
        if (!form.moduleId) throw Error('请选择所属模块。');
        if (!CASE_ID.test(id)) throw Error('用例编号只能包含字母、数字、点、下划线或短横线，最长80字符。');
        if (existing.includes(id)) throw Error(`用例编号 ${id} 已存在，请换一个。`);
        if (!title) throw Error('请填写用例标题。');
        if (!expected) throw Error('请填写预期结果。');
        const current = await request<{ resources: ResourceFile }>('?systemId=' + encodeURIComponent(systemId));
        const incoming = structuredClone(current.resources);
        const template = (incoming.cases ?? []).find(c => c.moduleId === form.moduleId) ?? (incoming.cases ?? [])[0];
        if (!template) throw Error('当前项目还没有可参照的用例结构，请先导入资源。');
        incoming.cases = incoming.cases ?? [];
        incoming.cases.push({ ...structuredClone(template), id, moduleId: form.moduleId, title, expected, manualSteps: [], prerequisites: [], sourcePath: [title], sourceExpected: expected, script: { caseId: id, dependsOn: [], steps: [] } });
        const changes = await request<Preview>('/preview', incoming);
        setBundle(incoming); setPreview(changes); setCreating(false);
    });
    return <><button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()}>资源</button>
        <dialog ref={dialog} className="ce-ai-dialog" aria-labelledby="ce-resource-title" onCancel={e => { if (busy) e.preventDefault(); }}>
            <header><h2 id="ce-resource-title">项目资源</h2><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button></header>
            <div className="ce-ai-content">
                <div className="ce-page-actions"><button type="button" disabled={busy} onClick={() => void download()}>导出</button><button type="button" disabled={busy} onClick={() => file.current?.click()}>导入</button><button type="button" disabled={busy || creating} onClick={() => void openCreate()}>新增用例</button></div>
                <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => {
                    const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return;
                    setBundle(undefined); setPreview(undefined); setCreating(false);
                    void perform(async () => {
                        if (selected.size > 8 * 1024 * 1024) throw Error('资源文件不能超过8MB。');
                        const incoming = JSON.parse(await selected.text()) as ResourceFile;
                        if (incoming.project?.id !== systemId) throw Error('请选择当前项目的资源。');
                        const changes = await request<Preview>('/preview', incoming); setBundle(incoming); setPreview(changes);
                    });
                }} />
                {error && <p role="alert">{error}</p>}
                {creating && <section aria-label="新增用例">
                    <p>新增一条用例。脚本留空，保存后标记“待补脚本”，不会被执行。</p>
                    <label>所属模块<select value={form.moduleId} disabled={busy} onChange={e => setForm({ ...form, moduleId: e.target.value })}>{modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                    <label>用例编号<input value={form.id} disabled={busy} placeholder="如 xmind-322" onChange={e => setForm({ ...form, id: e.target.value })} /></label>
                    <label>标题<input value={form.title} disabled={busy} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
                    <label>预期<textarea value={form.expected} disabled={busy} rows={3} onChange={e => setForm({ ...form, expected: e.target.value })} /></label>
                    <div className="ce-page-actions"><button type="button" disabled={busy} onClick={() => { setCreating(false); setError(''); }}>取消</button><button type="button" disabled={busy} onClick={() => void create()}>预览新增</button></div>
                </section>}
                {preview ? <><p>新增 {preview.added.length} · 修改 {preview.changed.length} · 移除 {preview.removed.length} · 未变 {preview.unchanged.length}</p>
                    {(['added', 'changed', 'removed'] as const).map((kind, i) => preview[kind].length > 0 && <details key={kind}><summary>{['新增', '修改', '移除'][i]}</summary><ul>{preview[kind].map(key => <li key={key}>{key.split(':').at(-1)}</li>)}</ul></details>)}
                </> : <p>导出当前定义，修改后导入并预览；也可以用“新增用例”直接建一条。</p>}
            </div>
            <footer><span>保存为新版本，不执行测试</span><button type="button" disabled={busy || !preview || !bundle} onClick={() => void perform(async () => { await request('/apply', { resources: bundle, baseRevision: preview!.revision }); dialog.current?.close(); setPreview(undefined); setBundle(undefined); onApplied(); })}>{busy ? '处理中…' : '应用'}</button></footer>
        </dialog>
    </>;
}
