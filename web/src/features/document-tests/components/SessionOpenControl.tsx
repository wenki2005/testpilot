import { useEffect, useRef, useState } from 'react';
import { request } from '../api/client';
type SessionTask = {
    requestId: string;
    projectId: string;
    profileId: string | null;
    siteVersionId?: string;
    targetUrl: string;
    status: 'opening' | 'waiting_for_user' | 'connected' | 'failed';
    error?: string;
};
export function SessionOpenControl({ projectId, profileId, siteVersionId, disabled, onReady }: {
    projectId: string;
    profileId: string | null;
    siteVersionId?: string;
    disabled: boolean;
    onReady(): void;
}) {
    const [task, setTask] = useState<SessionTask | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const readyRef = useRef('');
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    useEffect(() => {
        let live = true;
        setTask(null);
        setError('');
        readyRef.current = '';
        const query = siteVersionId ? `?siteVersionId=${encodeURIComponent(siteVersionId)}` : '';
        void request<SessionTask | null>(`/api/document-projects/${encodeURIComponent(projectId)}/session/open${query}`)
            .then(current => {
            if (live && current && current.profileId === profileId)
                setTask(current);
        })
            .catch(reason => {
            if (live)
                setError((reason as Error).message);
        });
        return () => { live = false; };
    }, [projectId, profileId, siteVersionId]);
    useEffect(() => {
        if (!task || task.status !== 'opening' && task.status !== 'waiting_for_user') {
            if (task?.status === 'connected' && readyRef.current !== task.requestId) {
                readyRef.current = task.requestId;
                onReadyRef.current();
            }
            return;
        }
        let live = true;
        let timer = 0;
        const query = siteVersionId ? `?siteVersionId=${encodeURIComponent(siteVersionId)}` : '';
        const poll = async () => {
            try {
                const current = await request<SessionTask | null>(`/api/document-projects/${encodeURIComponent(projectId)}/session/open${query}`);
                if (!live)
                    return;
                if (current && current.requestId === task.requestId && current.profileId === profileId)
                    setTask(current);
            }
            catch (reason) {
                if (live)
                    setError((reason as Error).message);
            }
            if (live)
                timer = window.setTimeout(() => void poll(), 1000);
        };
        timer = window.setTimeout(() => void poll(), 500);
        return () => { live = false; window.clearTimeout(timer); };
    }, [projectId, profileId, siteVersionId, task?.requestId, task?.status]);
    const open = async () => {
        setBusy(true);
        setError('');
        try {
            const started = await request<SessionTask>(`/api/document-projects/${encodeURIComponent(projectId)}/session/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(siteVersionId ? { siteVersionId } : {}) });
            readyRef.current = '';
            setTask(started);
        }
        catch (reason) {
            setError((reason as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const continueLogin = async () => {
        setBusy(true);
        setError('');
        try {
            await request(`/api/document-projects/${encodeURIComponent(projectId)}/login/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        }
        catch (reason) {
            setError((reason as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const blocked = disabled || busy || task?.status === 'opening' || task?.status === 'waiting_for_user';
    return <section className="doc-session-open" aria-label="测试浏览器登录会话">
    <button className="button-secondary" disabled={blocked} onClick={() => void open()}>{busy ? '正在连接…' : task?.status === 'connected' ? '重新检查测试窗口' : '打开当前档案测试窗口'}</button>
    {task?.status === 'opening' && <p role="status">正在打开 TestPilot 专用 Edge 测试窗口…</p>}
    {task?.status === 'waiting_for_user' && <div className="doc-notice"><strong>请在 TestPilot 专用 Edge 窗口完成登录。</strong><p>普通链接中在其它浏览器完成的登录不会自动迁移 Cookie；TestPilot 不会索取或保存账号密码。</p><button className="button-primary" disabled={busy} onClick={() => void continueLogin()}>{busy ? '正在继续…' : '我已登录，继续'}</button></div>}
    {task?.status === 'connected' && <p role="status">当前档案的 TestPilot Edge 会话已连接。</p>}
    {task?.status === 'failed' && <p className="doc-notice error" role="alert">测试窗口连接失败：{task.error || '未知错误'}。可以重试。</p>}
    {error && <p className="doc-notice error" role="alert">{error}</p>}
  </section>;
}
