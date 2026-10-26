import { useEffect, useState, type FormEvent } from 'react';

type Settings = {
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  keySource: 'settings' | 'environment' | 'none';
  computerUseModel: string;
  computerUseNativeApi: boolean;
  browserCdpEndpoint: string;
  browserCdpConfigured: boolean;
  computerUse: { available: boolean; reason: string; model: string };
};
type BrowserStatus = { mode: 'isolated' | 'edge-cdp'; configured: boolean; reachable: boolean | null; version?: string; contexts: number; openTabs: number; managedTabs: number; message: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）。`);
  return body as T;
}

export default function SettingsPage({ onSaved }: { onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [browserCdpEndpoint, setBrowserCdpEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [browserMessage, setBrowserMessage] = useState('');
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);

  useEffect(() => {
    let live = true;
    request<Settings>('/api/settings').then((value) => {
      if (!live) return;
      setSettings(value); setBaseUrl(value.baseUrl); setModel(value.model); setBrowserCdpEndpoint(value.browserCdpEndpoint ?? '');
    }).catch((reason: Error) => { if (live) setError(`读取设置失败：${reason.message}`); });
    const refreshBrowserStatus = async () => {
      try { const status = await request<BrowserStatus>('/api/browser/status'); if (live) setBrowserStatus(status); }
      catch { if (live) setBrowserStatus(null); }
    };
    void refreshBrowserStatus();
    const timer = window.setInterval(refreshBrowserStatus, 10000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const payload = () => ({ baseUrl, model, apiKey, clearApiKey, browserCdpEndpoint });
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request<Settings>('/api/settings', { method: 'POST', body: JSON.stringify(payload()) });
      setSettings(updated); setApiKey(''); setClearApiKey(false);
      setMessage('API 设置已保存到本机。');
      await onSaved();
      return true;
    } catch (reason) { setError((reason as Error).message); return false; }
    finally { setBusy(false); }
  };

  const saveAndTest = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request<Settings>('/api/settings', { method: 'POST', body: JSON.stringify(payload()) });
      setSettings(updated); setApiKey(''); setClearApiKey(false); await onSaved();
      const result = await request<{ model: string; toolCalling: boolean; computerUse: Settings['computerUse'] }>('/api/settings/test', { method: 'POST', body: '{}' });
      setSettings((current) => current ? { ...current, computerUse: result.computerUse } : current);
      setMessage(`连接成功：${result.model} 支持 Chat Completions 和工具调用。${result.computerUse.available ? ' Computer Use 已就绪。' : ` Computer Use 尚不可用：${result.computerUse.reason}`}`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const testBrowser = async () => {
    setBusy(true); setError(''); setBrowserMessage('');
    try {
      const result = await request<{ version: string; contexts: number }>('/api/settings/test-browser', { method: 'POST', body: '{}' });
      setBrowserMessage(`Edge 会话连接成功：${result.version}，${result.contexts} 个浏览器上下文。`);
      setBrowserStatus(await request<BrowserStatus>('/api/browser/status'));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="secondary-page settings-page">
    <div className="page-heading"><div><div className="eyebrow">模型服务连接</div><h1>设置</h1><p>配置兼容 OpenAI Chat Completions 与工具调用的模型 API。</p></div><span className={`settings-state ${settings?.keyConfigured ? 'configured' : ''}`}><i />{settings?.keyConfigured ? '已配置密钥' : '尚未配置'}</span></div>
    <div className="settings-grid">
      <form className="settings-card settings-form" onSubmit={save}>
        <div className="settings-card-heading"><div><h2>API 接口</h2><p>保存后，Agent 和 AI 脚本草稿会使用这里的配置。</p></div><span className="settings-mark">API</span></div>
        <label>兼容 API 根地址<input autoComplete="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" required /></label>
        <small className="settings-help">填写服务商 API 根地址，通常以 /v1 结尾；无需填写 /chat/completions。服务需支持 Chat Completions 和 function tool calls。</small>
        <label>模型名称<input autoComplete="off" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1-mini" required /></label>
        <label>现有 Edge 会话（可选）<input autoComplete="off" value={browserCdpEndpoint} onChange={(event) => setBrowserCdpEndpoint(event.target.value)} placeholder="http://127.0.0.1:9222" /></label>
        <small className="settings-help">需要用已登录的 Edge 页面测试时可配置本机 CDP 地址。仅接受本机回环地址；不填则使用隔离浏览器。启用 CDP 前，需用远程调试端口启动 Edge。TestPilot 会新开一个标签页，并只在该标签页阻止非 GET/HEAD 请求，不会导航或改动你已有的标签页。</small>
        <div className="compat-row browser-status-row"><span className={`compat-dot ${browserStatus?.reachable === true || browserStatus?.mode === 'isolated' ? 'good' : ''}`}/><div><strong>{browserStatus?.mode === 'edge-cdp' ? browserStatus.reachable ? 'Edge 已连接' : 'Edge 未连接' : '使用独立浏览器会话'}</strong><p>{browserStatus?.message ?? '正在读取浏览器状态…'}{browserStatus?.mode === 'edge-cdp' && browserStatus.reachable ? ` 当前 ${browserStatus.openTabs} 个标签页，${browserStatus.managedTabs} 个可复用的 TestPilot 标签页。` : ''}</p></div></div>
        <div className="settings-actions"><button className="button-secondary" type="button" disabled={busy || !browserCdpEndpoint.trim()} onClick={testBrowser}>测试 Edge 会话</button>{browserMessage && <p className="settings-message success" role="status">{browserMessage}</p>}</div>
        <label>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }} placeholder={settings?.keyConfigured ? '已保存密钥；留空会保留现有值' : '粘贴 API Key'} /></label>
        {settings?.keyConfigured && <div className="settings-secret-state"><span>密钥来源：{settings.keySource === 'environment' ? '环境变量' : '本地设置'}</span>{settings.keySource === 'settings' && <label className="settings-clear-key"><input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />清除已保存密钥</label>}</div>}
        <div className="settings-actions"><button className="button-secondary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button><button className="button-primary" type="button" disabled={busy} onClick={saveAndTest}>{busy ? '连接中…' : '保存并测试连接'}</button></div>
        {message && <p className="settings-message success" role="status">{message}</p>}{error && <p className="settings-message error" role="alert">{error}</p>}
        <p className="settings-privacy">API Key 不会从服务端回传到页面；此本地 Demo 将密钥保存在本机的 artifacts/demo/model-settings.json 中。请勿在共享电脑上保存个人密钥。</p>
      </form>
      <aside className="settings-card settings-compatibility">
        <h2>兼容范围</h2>
        <div className="compat-row"><span className="compat-dot good"/><div><strong>普通 Agent 与脚本生成</strong><p>使用 OpenAI 兼容 Chat Completions API。连接测试会验证文本回复和工具调用。</p></div></div>
        <div className="compat-row"><span className={`compat-dot ${settings?.computerUse.available ? 'good' : ''}`}/><div><strong>Computer Use 自主测试</strong><p>{settings?.computerUse.available ? `${settings.computerUse.model} 将通过视觉输入与函数调用执行受限浏览器动作；运行时会验证模型能力。${settings.browserCdpConfigured ? '当前使用已配置的 Edge 会话。' : '当前使用隔离浏览器会话。'}` : settings?.computerUse.reason ?? '需要兼容 Chat Completions API 和已配置密钥。'}</p></div></div>
        <div className="settings-note"><strong>关于第三方兼容地址</strong><p>视觉自主测试使用截图输入与工具调用。中转站和模型必须同时支持图片输入与函数调用；只兼容文本接口的模型不能运行视觉测试，工作台会显示具体失败原因。</p></div>
      </aside>
    </div>
  </div>;
}
