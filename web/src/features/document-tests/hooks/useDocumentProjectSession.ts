import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { request } from '../api/client';
import type { Project, SessionStatus } from '../types';

export function useDocumentProjectSession(input: {
  project: Project | undefined;
  siteVersionId?: string;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
}) {
  const { project, siteVersionId, setProjects, setError, setMessage } = input;
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [sessionStatusLoading, setSessionStatusLoading] = useState(false);
  const [sessionStatusError, setSessionStatusError] = useState('');
  const [sessionIdentityDraft, setSessionIdentityDraft] = useState('');
  const [sessionIdentitySaving, setSessionIdentitySaving] = useState(false);

  const refreshSessionStatus = async (projectId = project?.id, versionId = siteVersionId) => {
    if (!projectId) return;
    setSessionStatusLoading(true); setSessionStatusError('');
    try {
      const query = versionId ? `?siteVersionId=${encodeURIComponent(versionId)}` : '';
      setSessionStatus(await request<SessionStatus>(`/api/document-projects/${projectId}/session-status${query}`));
    } catch (error) { setSessionStatusError((error as Error).message); }
    finally { setSessionStatusLoading(false); }
  };

  const saveSessionIdentity = async () => {
    if (!project) return;
    setSessionIdentitySaving(true); setError('');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/session-identity`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identityNote: sessionIdentityDraft }),
      });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setSessionStatus(current => current ? { ...current, identityNote: updated.sessionIdentityNote, identitySource: updated.sessionIdentityNote ? 'user-confirmed' : undefined } : current);
      setMessage(updated.sessionIdentityNote ? '已保存人工确认的身份/角色备注；这不会改变用例审核状态。' : '已清除身份/角色备注。');
    } catch (error) { setError((error as Error).message); }
    finally { setSessionIdentitySaving(false); }
  };

  useEffect(() => {
    setSessionStatus(null); setSessionStatusError(''); setSessionIdentityDraft(project?.sessionIdentityNote ?? '');
    if (!project) return;
    let live = true;
    const query = siteVersionId ? `?siteVersionId=${encodeURIComponent(siteVersionId)}` : '';
    void request<SessionStatus>(`/api/document-projects/${project.id}/session-status${query}`)
      .then(state => { if (live) setSessionStatus(state); })
      .catch(error => { if (live) setSessionStatusError((error as Error).message); });
    return () => { live = false; };
  }, [project?.id, siteVersionId, project?.sessionIdentityNote]);

  return { sessionStatus, sessionStatusLoading, sessionStatusError, sessionIdentityDraft, setSessionIdentityDraft, sessionIdentitySaving, refreshSessionStatus, saveSessionIdentity };
}
