import { useEffect, useState } from 'react';
import { request } from '../api/client';
type Profile = {
    id: string;
    name: string;
    role: string;
};
type ProfilesResponse = {
    profiles: Profile[];
    activeProfileId: string | null;
    message: string;
};
type ProfileResponse = Profile & {
    message?: string;
};
export function SessionProfiles({ projectId, disabled, onChanged }: {
    projectId: string;
    disabled: boolean;
    onChanged(): Promise<void>;
}) {
    const [data, setData] = useState<ProfilesResponse>({ profiles: [], activeProfileId: null, message: '' });
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const load = async () => setData(await request<ProfilesResponse>(`/api/document-projects/${encodeURIComponent(projectId)}/session-profiles`));
    useEffect(() => { void load().catch(error => setNotice((error as Error).message)); }, [projectId]);
    const switchTo = async (profileId: string | null) => {
        setBusy(true);
        setNotice('');
        try {
            const result = await request<{
                activeProfileId: string | null;
                message: string;
            }>(`/api/document-projects/${encodeURIComponent(projectId)}/session-profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId }) });
            await load();
            await onChanged();
            setNotice(result.message || '会话档案已切换，登录状态已刷新。');
        }
        catch (error) {
            setNotice((error as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const create = async () => {
        setBusy(true);
        setNotice('');
        try {
            const result = await request<ProfileResponse>(`/api/document-projects/${encodeURIComponent(projectId)}/session-profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, role }) });
            await load();
            setName('');
            setRole('');
            setNotice(result.message || '会话档案已保存。登录仍需人工完成，角色不会自动核验。');
        }
        catch (error) {
            setNotice((error as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    return <details className="doc-session-profiles"><summary>高级配置 · 会话档案</summary>
    <p>档案只保存名称和角色备注，不保存账号密码。登录需人工完成；角色不会自动核验。</p>
    <label>当前档案<select aria-label="当前会话档案" value={data.activeProfileId ?? ''} disabled={disabled || busy} onChange={event => void switchTo(event.target.value || null)}><option value="">默认会话</option>{data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.role}</option>)}</select></label>
    <div className="doc-profile-create"><label>档案名称<input value={name} maxLength={80} disabled={disabled || busy} onChange={event => setName(event.target.value)}/></label><label>角色备注<input value={role} maxLength={80} disabled={disabled || busy} onChange={event => setRole(event.target.value)} placeholder="例如：只读审核员"/></label><button className="button-secondary" disabled={disabled || busy || !name.trim() || !role.trim()} onClick={() => void create()}>{busy ? '处理中…' : '新增档案'}</button></div>
    {notice && <small role="status">{notice}</small>}
  </details>;
}
