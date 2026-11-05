import React, { useEffect, useState } from 'react';
import { request } from '../api/client';
import { NotificationTrialPanel } from './NotificationTrialPanel';
export type RunNotificationStatusValue = {
    status: 'disabled' | 'not-applicable' | 'no-record';
} | {
    status: 'pending' | 'delivered' | 'failed';
    attempts: number;
    updatedAt: string;
};
export function notificationStatusLabel(status: RunNotificationStatusValue['status']): string {
    return ({
        disabled: '通知已关闭',
        'not-applicable': '本轮无需通知',
        'no-record': '没有送达记录',
        pending: '送达结果未确认',
        delivered: '已送达',
        failed: '送达失败',
    })[status];
}
export function NotificationStatusContent({ loading, error, value, onRefresh }: {
    loading: boolean;
    error?: string;
    value?: RunNotificationStatusValue;
    onRefresh: () => void;
}) {
    return <section className="doc-notification-settings" aria-label="运行通知送达状态">
    <h3>通知送达状态</h3>
    {loading ? <p role="status">正在读取通知送达状态…</p> : error ? <div role="alert"><p>无法读取通知送达状态：{error}</p><button className="button-secondary" onClick={onRefresh}>重试读取</button></div> : value && <>
      <p role="status">{notificationStatusLabel(value.status)}{value.status === 'pending' ? '。系统不会自动重发，请稍后重新读取状态。' : ''}</p>
      {'attempts' in value && <p>尝试次数：{value.attempts}</p>}
      {'updatedAt' in value && <p>最近更新：<time dateTime={value.updatedAt}>{new Date(value.updatedAt).toLocaleString()}</time></p>}
      <button className="button-secondary" onClick={onRefresh}>刷新送达状态</button>
    </>}
  </section>;
}
export function RunNotificationStatus({ runId }: {
    runId: string;
}) {
    const [snapshot, setSnapshot] = useState<{
        runId: string;
        value?: RunNotificationStatusValue;
        error?: string;
        loading: boolean;
    }>({ runId, loading: true });
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        setSnapshot({ runId, loading: true });
        void request<RunNotificationStatusValue>(`/api/document-runs/${encodeURIComponent(runId)}/notification`)
            .then(value => {
            if (active)
                setSnapshot({ runId, value, loading: false });
        })
            .catch(error => {
            if (active)
                setSnapshot({ runId, error: error instanceof Error ? error.message : '读取通知状态失败。', loading: false });
        });
        return () => { active = false; };
    }, [runId, revision]);
    const current = snapshot.runId === runId ? snapshot : { runId, loading: true as const };
    return <React.Fragment><NotificationStatusContent {...{
        loading: current.loading,
        error: current.error,
        value: current.value,
        onRefresh: () => setRevision(value => value + 1),
    }}/><NotificationTrialPanel key={runId} runId={runId} onSent={() => setRevision(value => value + 1)}/></React.Fragment>;
}
