import { useEffect, useRef, useState } from 'react';
import type { LoginHandoff, Recovery } from '../types';
import { request } from '../api/client';

/** Polls the user-mediated login handoff and persisted run recovery state. */
export function useDocumentRunHandoffs(projectId: string, reviewStatus?: string) {
  const [loginHandoff, setLoginHandoff] = useState<LoginHandoff | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const notifiedLoginRun = useRef('');

  useEffect(() => {
    if (!projectId) { setLoginHandoff(null); return; }
    let live = true;
    const pollLogin = async () => {
      try {
        const state = await request<LoginHandoff | null>(`/api/document-projects/${projectId}/login`);
        if (!live) return;
        setLoginHandoff(state);
        if (!state || notifiedLoginRun.current === state.runId) return;
        window.focus();
        if ('Notification' in window && Notification.permission === 'granted') new Notification('TestPilot 需要你登录', { body: '测试浏览器窗口已置顶。完成登录后回到 TestPilot 点击“继续测试”。' });
        notifiedLoginRun.current = state.runId;
      } catch { /* no pending human login handoff */ }
    };
    void pollLogin();
    const timer = window.setInterval(pollLogin, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) { setRecovery(null); return; }
    let live = true;
    const checkRecovery = async () => {
      try { const state = await request<Recovery | null>(`/api/document-projects/${projectId}/recovery`); if (live) setRecovery(state); }
      catch { if (live) setRecovery(null); }
    };
    void checkRecovery();
    const timer = window.setInterval(checkRecovery, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [projectId, reviewStatus]);

  return { loginHandoff, setLoginHandoff, recovery, setRecovery };
}
