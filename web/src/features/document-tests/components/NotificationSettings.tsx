import { useEffect, useState } from 'react';
import { request } from '../api/client';

type Settings = { enabled: boolean; configured: boolean; destination: string };

export function NotificationSettings() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, configured: false, destination: '' });
  const [webhook, setWebhook] = useState('');
  const [authorizeSending, setAuthorizeSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { void request<Settings>('/api/document-notifications').then(setSettings).catch(error => setNotice((error as Error).message)); }, []);
  const save = async () => {
    setBusy(true); setNotice('');
    try {
      const body: { enabled: boolean; authorizeSending: boolean; webhook?: string } = { enabled: settings.enabled, authorizeSending };
      if (webhook.trim()) body.webhook = webhook.trim();
      const next = await request<Settings>('/api/document-notifications', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      setSettings(next); setWebhook(''); setAuthorizeSending(false); setNotice('通知配置已保存。');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  return <details className="doc-notification-settings"><summary>高级配置 · 企业微信通知</summary>
    <p>运行结束且失败、阻塞或取消时，向所配置企业微信群发送摘要：运行 ID、结果计数、异常用例 ID 和本机证据入口。不发送截图、页面内容及业务数据。</p>
    <label className="doc-notification-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings(current => ({ ...current, enabled: event.target.checked }))} />启用运行状态摘要通知（默认关闭）</label>
    <label>Webhook 地址（留空会保留已保存密钥）<input type="password" autoComplete="new-password" value={webhook} onChange={event => setWebhook(event.target.value)} placeholder={settings.configured ? '已配置；留空不替换' : '粘贴企业微信群机器人 Webhook'} /></label>
    {settings.configured && <small>密钥已配置。为保护密钥，读取时不会回显。</small>}
    <small>09 验收请使用测试群。在本轮结果的“通知预览与一次试发”核对内容后试发，再到企微群确认收到。群成员在其他设备不能直接访问本机链接。</small>
    <label className="doc-notification-toggle"><input type="checkbox" checked={authorizeSending} onChange={event => setAuthorizeSending(event.target.checked)} />我授权向上述配置的企业微信群发送运行摘要</label>
    <div className="doc-notification-actions"><button className="button-secondary" disabled={busy || (settings.enabled && !settings.configured && !webhook.trim()) || (settings.enabled && !authorizeSending)} onClick={() => void save()}>{busy ? '正在保存…' : '保存通知配置'}</button>{notice && <small role="status">{notice}</small>}</div>
  </details>;
}
