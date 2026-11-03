import React, { useState } from 'react';
import { request } from '../api/client';

type Preview = { content: string; applicable: boolean; enabled: boolean; configured: boolean; canSend: boolean; status: { status: string } };

export function NotificationTrialPanel({ runId, onSent }: { runId: string; onSent: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = async () => {
    setBusy(true); setNotice(''); setAuthorized(false);
    try { setPreview(await request<Preview>(`/api/document-runs/${encodeURIComponent(runId)}/notification/preview`)); }
    catch (error) { setPreview(undefined); setNotice((error as Error).message); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!authorized || !preview?.canSend) return;
    setBusy(true); setNotice('');
    try {
      const result = await request<{ status: string }>(`/api/document-runs/${encodeURIComponent(runId)}/notification/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorizeSending: true }),
      });
      setPreview(current => current ? { ...current, canSend: false, status: result } : current);
      setAuthorized(false);
      setNotice(result.status === 'delivered' ? '企微接口已确认接收。请在测试群核对消息，再确认真实接收验收。' : result.status === 'pending' ? '送达结果未确认，请先核对群内消息；系统不会自动重发。' : '未确认送达，请查看通知状态；此入口不会重复试发已有记录。');
      onSent();
    } catch (error) { setNotice((error as Error).message); setPreview(undefined); setAuthorized(false); onSent(); }
    finally { setBusy(false); }
  };
  return <React.Fragment><details className="doc-notification-settings">
    <summary>09 · 通知预览与一次试发</summary>
    <p>仅向已配置的企业微信测试群发送下面的摘要。预览不会发送消息，试发不会重新运行测试。</p>
    <button className="button-secondary" disabled={busy} onClick={() => void load()}>{busy ? '处理中…' : '读取本轮通知预览'}</button>
    {preview && <>
      <pre>{preview.content}</pre>
      {!preview.applicable ? <p>本轮尚未结束或已通过，无需发送异常通知。</p> : !preview.enabled || !preview.configured ? <p>尚未启用接收群。请在运行控制区的“高级配置 · 企业微信通知”填写测试群机器人 Webhook 并保存。</p> : !preview.canSend ? <p>本轮已有通知记录（{preview.status.status}）。为避免重复，本入口不会再次发送；请查看上方状态并核对测试群。</p> : <>
        <label className="doc-notification-toggle"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />我确认已配置的是测试群，并允许发送上述摘要</label>
        <button className="button-secondary" disabled={busy || !authorized} onClick={() => void send()}>向已配置测试群发送一次</button>
      </>}
      <p>本机链接只在运行 TestPilot 的电脑可用。截图不上传企微；在本机打开运行结果，按异常用例 ID 查看证据。</p>
    </>}
    {notice && <p role="status">{notice}</p>}
  </details></React.Fragment>;
}
