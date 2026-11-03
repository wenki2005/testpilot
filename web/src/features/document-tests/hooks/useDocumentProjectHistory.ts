import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { request } from '../api/client';
import type { Project, ProjectRevision, ProjectRevisionKind, ProjectRevisionPage, ProjectRevisionSummary, Run, RunListItem } from '../types';

export function useDocumentProjectHistory({
  projectId,
  run,
  setRun,
  setRunMode,
  setError,
  setMessage,
  setProjects,
}: {
  projectId: string;
  run: Run | null;
  setRun: (run: Run) => void;
  setRunMode: (mode: 'regression' | 'compare') => void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
  setProjects: Dispatch<SetStateAction<Project[]>>;
}) {
  const [runHistory, setRunHistory] = useState<RunListItem[]>([]);
  const [historyLoadingId, setHistoryLoadingId] = useState('');
  const [projectRevisions, setProjectRevisions] = useState<ProjectRevisionSummary[]>([]);
  const [projectRevisionTotal, setProjectRevisionTotal] = useState(0);
  const [projectRevisionKind, setProjectRevisionKind] = useState<ProjectRevisionKind | ''>('');
  const [projectRevisionEntity, setProjectRevisionEntity] = useState('');
  const [projectRevisionOffset, setProjectRevisionOffset] = useState(0);
  const [projectRevisionLoading, setProjectRevisionLoading] = useState(false);
  const [projectRevisionError, setProjectRevisionError] = useState('');
  const [projectRevisionSnapshots, setProjectRevisionSnapshots] = useState<Record<string, ProjectRevision>>({});
  const [projectRevisionBusyId, setProjectRevisionBusyId] = useState('');

  const refreshRunHistory = (id: string) => {
    void request<RunListItem[]>(`/api/document-projects/${id}/runs`).then(setRunHistory).catch(() => undefined);
  };

  const openHistoricalRun = async (item: RunListItem) => {
    if (run?.id === item.id) {
      document.getElementById('doc-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setHistoryLoadingId(item.id); setError('');
    try {
      const detail = await request<Run>(`/api/document-runs/${encodeURIComponent(item.id)}`);
      if (detail.projectId && detail.projectId !== projectId) throw new Error('这轮运行不属于当前项目，无法在此查看。');
      setRun(detail); setRunMode(detail.runMode ?? 'regression');
      setMessage(`正在查看 ${new Date(item.startedAt).toLocaleString()} 的历史运行结果。`);
      window.setTimeout(() => document.getElementById('doc-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (e) { setError((e as Error).message); }
    finally { setHistoryLoadingId(''); }
  };

  const refreshProjectRevisions = async (id: string, offset = 0, append = false) => {
    setProjectRevisionLoading(true); setProjectRevisionError('');
    try {
      const query = new URLSearchParams({ offset: String(offset), limit: '50' });
      if (projectRevisionKind) query.set('kind', projectRevisionKind);
      if (projectRevisionKind && projectRevisionEntity.trim()) query.set('entityId', projectRevisionEntity.trim());
      const page = await request<ProjectRevisionPage>(`/api/document-projects/${id}/revisions?${query}`);
      setProjectRevisions(current => append ? [...current, ...page.items] : page.items);
      setProjectRevisionTotal(page.total);
      setProjectRevisionOffset(offset + page.items.length);
    } catch (e) { setProjectRevisionError((e as Error).message); }
    finally { setProjectRevisionLoading(false); }
  };

  const toggleProjectRevision = async (revision: ProjectRevisionSummary) => {
    if (projectRevisionSnapshots[revision.id]) {
      setProjectRevisionSnapshots(current => { const next = { ...current }; delete next[revision.id]; return next; });
      return;
    }
    setProjectRevisionBusyId(revision.id); setProjectRevisionError('');
    try {
      const detail = await request<ProjectRevision>(`/api/document-projects/${revision.projectId}/revisions/${revision.id}`);
      setProjectRevisionSnapshots(current => ({ ...current, [revision.id]: detail }));
    } catch (e) { setProjectRevisionError((e as Error).message); }
    finally { setProjectRevisionBusyId(''); }
  };

  const restoreProjectStepRevision = async (revision: ProjectRevisionSummary) => {
    setProjectRevisionBusyId(revision.id); setProjectRevisionError(''); setError('');
    try {
      const result = await request<{ project: Project; restoredCaseId: string; restoredRevisionVersion: number; regressionStarted: false }>(
        `/api/document-projects/${encodeURIComponent(revision.projectId)}/cases/${encodeURIComponent(revision.entityId)}/restore-steps`,
        { method: 'POST', body: JSON.stringify({ revisionId: revision.id }) },
      );
      setProjects(current => current.map(item => item.id === result.project.id ? result.project : item));
      setMessage(`已恢复 ${result.restoredCaseId} 的步骤历史版本 v${result.restoredRevisionVersion}。用例已取消回归选择并转为待审核；没有启动测试。`);
      await refreshProjectRevisions(revision.projectId);
    } catch (e) { setProjectRevisionError((e as Error).message); }
    finally { setProjectRevisionBusyId(''); }
  };

  useEffect(() => {
    let active = true;
    if (!projectId) { setRunHistory([]); return; }
    void request<RunListItem[]>(`/api/document-projects/${projectId}/runs`)
      .then(rows => { if (active) setRunHistory(rows); })
      .catch(() => { if (active) setRunHistory([]); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    setProjectRevisionSnapshots({}); setProjectRevisionOffset(0); setProjectRevisionEntity('');
  }, [projectId]);

  useEffect(() => {
    setProjectRevisionSnapshots({}); setProjectRevisionOffset(0);
    if (!projectId) { setProjectRevisions([]); setProjectRevisionTotal(0); return; }
    let active = true;
    setProjectRevisionLoading(true); setProjectRevisionError('');
    const query = new URLSearchParams({ offset: '0', limit: '50' });
    if (projectRevisionKind) query.set('kind', projectRevisionKind);
    if (projectRevisionKind && projectRevisionEntity.trim()) query.set('entityId', projectRevisionEntity.trim());
    void request<ProjectRevisionPage>(`/api/document-projects/${projectId}/revisions?${query}`)
      .then(page => { if (active) { setProjectRevisions(page.items); setProjectRevisionTotal(page.total); setProjectRevisionOffset(page.items.length); } })
      .catch(e => { if (active) setProjectRevisionError((e as Error).message); })
      .finally(() => { if (active) setProjectRevisionLoading(false); });
    return () => { active = false; };
  }, [projectId, projectRevisionKind, projectRevisionEntity]);

  return {
    runHistory, historyLoadingId, refreshRunHistory, openHistoricalRun,
    projectRevisions, projectRevisionTotal, projectRevisionKind, setProjectRevisionKind,
    projectRevisionEntity, setProjectRevisionEntity, projectRevisionOffset,
    projectRevisionLoading, projectRevisionError, projectRevisionSnapshots,
    projectRevisionBusyId, refreshProjectRevisions, toggleProjectRevision, restoreProjectStepRevision,
  };
}
