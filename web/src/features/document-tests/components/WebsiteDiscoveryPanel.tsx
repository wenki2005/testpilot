import React, { useEffect, useState } from 'react';
import type { WebsiteMap } from '../../../../../src/domain/documents/projects/website-map';
import { request, HttpRequestError } from '../api/client';
export function WebsiteDiscoveryPanel({ projectId, disabled }: {
    projectId: string;
    disabled: boolean;
}) {
    const [map, setMap] = useState<WebsiteMap | null>(null);
    const [error, setError] = useState('');
    const [starting, setStarting] = useState(false);
    const [verifying, setVerifying] = useState('');
    const [verificationMessage, setVerificationMessage] = useState('');
    useEffect(() => {
        let current = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setMap(null);
        setError('');
        const load = async () => {
            try {
                const result = await request<{
                    map: WebsiteMap | null;
                }>(`/api/document-projects/${encodeURIComponent(projectId)}/website-map`);
                if (!current)
                    return;
                setMap(result.map);
                setError('');
            }
            catch (e) {
                if (current)
                    setError(e instanceof HttpRequestError && e.status === 404 ? '当前后台尚未加载网站探索功能，请使用新版服务入口。' : e instanceof TypeError ? '暂时无法连接测试服务，正在自动重连。以下内容是最近一次读取的记录。' : (e as Error).message);
            }
            if (current)
                timer = setTimeout(() => void load(), 2500);
        };
        void load();
        return () => {
            current = false;
            if (timer)
                clearTimeout(timer);
        };
    }, [projectId]);
    const start = async () => {
        setStarting(true);
        setError('');
        try {
            setMap((await request<{
                map: WebsiteMap;
            }>(`/api/document-projects/${encodeURIComponent(projectId)}/website-map`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).map);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setStarting(false);
        }
    };
    const verify = async (pageId: string) => {
        setVerifying(pageId);
        setVerificationMessage('');
        try {
            await request(`/api/document-projects/${encodeURIComponent(projectId)}/website-map/pages/${pageId}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            setVerificationMessage('已从项目入口重新执行保存路径，并确认到达目标页面。');
        }
        catch (e) {
            setVerificationMessage(`路径复验受阻：${(e as Error).message}`);
        }
        finally {
            setVerifying('');
        }
    };
    return <React.Fragment><section className="daily-run-info website-discovery" aria-label="网站自主探索">
    <div className="daily-start-heading"><div><h3>认识这个网站</h3><p>AI 寻找当前账号可访问的菜单、列表和详情，保存导航路径，供后续用例准备使用。</p></div><button type="button" className="button-secondary" disabled={disabled || starting || !!verifying || map?.state === 'running'} onClick={() => void start()}>{starting || map?.state === 'running' ? '正在探索…' : map ? '重新探索' : '探索网站'}</button></div>
    {error && <p role="alert">{error}</p>}{verificationMessage && <p role="status">{verificationMessage}</p>}
    {map && <><p role="status">{({ running: '探索进行中', completed: '本轮可发现入口已探索', partial: '部分完成，仍有未探索或受阻入口', blocked: '探索受阻' })[map.state]} · 已发现 {map.pages.length} 个页面／状态，记录 {map.edges.filter(e => e.status === 'visited').length} 条导航。</p>
      <p role="status">最近路径复验：{({ unverified: '本次服务启动后尚未复验', partial: '部分路径已复验', ready: '全部保存路径已复验', blocked: '存在复验失败，路径需要恢复或重新探索' })[map.runtimeVerification?.state ?? 'unverified']} · {map.runtimeVerification?.verified ?? 0} / {map.pages.length} 条通过{map.runtimeVerification?.checkedAt ? ` · ${new Date(map.runtimeVerification.checkedAt).toLocaleString('zh-CN')}` : ''}。探索完成不代表当前路径已验证可用。</p>
      <details><summary>查看页面与路径</summary><p>范围限于本轮账号和实际发现的入口；不代表整个网站功能均已测试。</p><ul>{map.pages.map(page => <li key={page.id}><strong>{page.snapshot.headings.join(' / ') || page.snapshot.title}</strong><code>{page.snapshot.route}</code><p>路径：{page.path.map(t => t.label.match(/申请(?:编号|单号)[：:\s]*[A-Za-z0-9_-]+/u)?.[0] ?? t.label).join(' → ') || '项目入口'}</p><button type="button" className="button-secondary" disabled={disabled || !!verifying || map.state === 'running'} onClick={() => void verify(page.id)}>{verifying === page.id ? '正在复验…' : '验证这条路径'}</button>{(() => { const recent = map.verifications?.filter(v => v.pageId === page.id && (!map.runtimeVerification || v.checkedAt >= map.runtimeVerification.since)).at(-1); return recent?.status === 'verified' ? <span> 最近复验通过</span> : recent?.status === 'blocked' ? <p role="alert">最近复验失败：{recent.reason}</p> : <span> 本次启动后待复验</span>; })()}</li>)}</ul>{map.edges.filter(e => e.status === 'blocked').map((edge, index) => <p key={index}>入口“{edge.target.label}”受阻：{edge.reason}</p>)}{map.notices.map((notice, index) => <p key={index}>{notice}</p>)}</details>
    </>}
  </section></React.Fragment>;
}
