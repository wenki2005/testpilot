import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import { request } from '../api/client';

type Profile = { id: string; name: string; role: string };
type ProfileList = { profiles: Profile[]; activeProfileId: string | null; message: string };
type Job = { runId?: string; profileId: string; modulePath: string[]; status: 'running' | 'completed' | 'failed'; overall?: string; error?: string; stage?: string; progress?: { completed: number; total: number }; awaitingLogin?: boolean };
type Group = { id: string; projectId: string; jobs: Job[] };
type GroupSummary = Group & { createdAt?: string };
type Draft = { profileId: string; moduleKey: string; testDataSetId: string };
const pathKey = (path: string[]) => JSON.stringify(path);

export function ParallelModuleRuns({ project, siteVersionId, disabled }: { project: Project; siteVersionId?: string; disabled: boolean }) {
  const modulePaths = useMemo(() => [...new Map(project.cases.map(item => item.modulePath?.filter(Boolean) ?? []).filter(path => path.length).map(path => [pathKey(path), path] as const)).values()], [project.cases]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([{ profileId: '', moduleKey: '' , testDataSetId: ''}, { profileId: '', moduleKey: '', testDataSetId: '' }]);
  const [group, setGroup] = useState<Group | null>(null);
  const [history, setHistory] = useState<GroupSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginReady, setLoginReady] = useState<Record<string, boolean>>({});
  const scope = useRef({ projectId: project.id, siteVersionId });
  const profileRequest = useRef(0);
  const historyRequest = useRef(0);
  const detailRequest = useRef(0);
  const contextKey = `${project.id}:${siteVersionId ?? ''}`;
  const requestProfiles = async () => {
    const requestId = ++profileRequest.current;
    setProfilesLoading(true);
    try {
      const result = await request<ProfileList>(`/api/document-projects/${encodeURIComponent(project.id)}/session-profiles`);
      if (requestId === profileRequest.current && scope.current.projectId === project.id) setProfiles(result.profiles);
    } catch (reason) { if (requestId === profileRequest.current) setError((reason as Error).message); }
    finally { if (requestId === profileRequest.current) setProfilesLoading(false); }
  };
  const refreshHistory = async () => {
    const requestId = ++historyRequest.current;
    setHistoryLoading(true); setError('');
    try {
      const rows = await request<GroupSummary[]>(`/api/document-projects/${encodeURIComponent(project.id)}/parallel-runs`);
      if (requestId === historyRequest.current && scope.current.projectId === project.id) {
        const nextRows = Array.isArray(rows) ? rows : [];
        setHistory(nextRows);
        setHistoryLoaded(true);
      }
    } catch (reason) { if (requestId === historyRequest.current) { setHistoryLoaded(false); setError((reason as Error).message); } }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false); }
  };
  const selectHistory = async (id: string) => {
    const requestId = ++detailRequest.current;
    setBusy(true); setError('');
    try {
      const item = await request<Group>(`/api/document-projects/${encodeURIComponent(project.id)}/parallel-runs/${encodeURIComponent(id)}`);
      if (requestId === detailRequest.current && scope.current.projectId === project.id) setGroup(item);
    } catch (reason) { if (requestId === detailRequest.current) setError((reason as Error).message); }
    finally { if (requestId === detailRequest.current) setBusy(false); }
  };
  useEffect(() => { scope.current = { projectId: project.id, siteVersionId }; profileRequest.current++; historyRequest.current++; detailRequest.current++; setGroup(null); setHistory([]); setHistoryLoaded(false); setProfiles([]); setBusy(false); setError(''); setLoginReady({}); void requestProfiles(); void refreshHistory(); return () => { profileRequest.current++; historyRequest.current++; detailRequest.current++; }; }, [contextKey]);
  const update = (index: number, patch: Partial<Draft>) => setDrafts(current => current.map((draft, row) => row === index ? { ...draft, ...patch } : draft));
  const hasActiveJobs = !!group?.jobs.some(job => job.status === 'running');
  const hasAnyActiveJobs = !!group?.jobs.some(job => job.status === 'running') || history.some(item => item.jobs.some(job => job.status === 'running'));
  useEffect(() => {
    if (!group || !hasActiveJobs) return;
    let active = true; let timer = 0;
    const poll = async () => {
      try {
        const next = await request<Group>(`/api/document-projects/${encodeURIComponent(project.id)}/parallel-runs/${encodeURIComponent(group.id)}`);
        if (!active) return;
        const jobs = await Promise.all(next.jobs.map(async job => {
          if (!job.runId || job.status !== 'running') return job;
          try {
            const progress = await request<{ stage?: string; status: string; progress?: Job['progress'] }>(`/api/document-runs/${encodeURIComponent(job.runId)}/progress`);
            let awaitingLogin = false;
            if (progress.stage === 'awaiting-login') {
              const login = await request<{ required?: boolean; status?: string }>(`/api/document-runs/${encodeURIComponent(job.runId!)}/login`);
              awaitingLogin = login.required === true || login.status === 'waiting' || login.status === 'waiting_for_user';
            }
            return { ...job, stage: progress.stage, progress: progress.progress, awaitingLogin };
          } catch { return job; }
        }));
        if (!active) return;
        setGroup({ ...next, jobs });
        setHistory(current => current.map(item => item.id === next.id ? { ...item, ...next, jobs } : item));
      } catch (reason) { if (active) setError((reason as Error).message); }
      if (active) timer = window.setTimeout(() => void poll(), 1200);
    };
    void poll(); return () => { active = false; window.clearTimeout(timer); };
  }, [project.id, group?.id, hasActiveJobs]);
  const start = async () => {
    if (!historyLoaded || hasAnyActiveJobs) return;
    const startedInContext = contextKey;
    setBusy(true); setError('');
    try {
      const jobs = drafts.map(draft => {
        const path = modulePaths.find(item => pathKey(item) === draft.moduleKey);
        if (!path || !draft.profileId) throw new Error('请为每个任务选择模块和独立会话档案。');
        const cases = project.cases.filter(item => item.lifecycleStatus === 'runnable' && item.selectedForRegression !== false && pathKey(item.modulePath ?? []) === draft.moduleKey);
        if (!cases.length || cases.some(item => item.sideEffectRisk !== 'none' || (item.preconditions?.length && item.preconditionsConfirmed !== true))) throw new Error(`模块「${path.join(' / ')}」未全部达到已审核、只读条件。`);
        return { profileId: draft.profileId, modulePath: path, ...(draft.testDataSetId ? { testDataSetId: draft.testDataSetId } : {}) };
      });
      if (new Set(jobs.map(job => job.profileId)).size !== jobs.length) throw new Error('每个并行任务必须使用不同的会话档案。');
      const result = await request<{ id: string; jobs: Array<{ runId: string; profileId: string; modulePath: string[]; status: Job['status']; error?: string }> }>(`/api/document-projects/${encodeURIComponent(project.id)}/parallel-runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobs, ...(siteVersionId ? { siteVersionId } : {}) }) });
      if (startedInContext === `${scope.current.projectId}:${scope.current.siteVersionId ?? ''}`) {
        setGroup({ ...result, projectId: project.id, jobs: result.jobs });
        void refreshHistory();
      }
    } catch (reason) { if (startedInContext === `${scope.current.projectId}:${scope.current.siteVersionId ?? ''}`) setError((reason as Error).message); }
    finally { if (startedInContext === `${scope.current.projectId}:${scope.current.siteVersionId ?? ''}`) setBusy(false); }
  };
  const control = async (job: Job, action: 'pause' | 'continue' | 'cancel') => {
    if (!job.runId) return;
    try { await request(`/api/document-runs/${encodeURIComponent(job.runId)}/${action}`, { method: 'POST' }); }
    catch (reason) { setError((reason as Error).message); }
  };
  const continueLogin = async (job: Job) => {
    if (!job.runId) return;
    try { await request(`/api/document-runs/${encodeURIComponent(job.runId)}/login/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setLoginReady(current => ({ ...current, [job.runId!]: true })); }
    catch (reason) { setError((reason as Error).message); }
  };
  const allowed = project.reviewStatus === 'approved' && project.cases.some(item => item.lifecycleStatus === 'runnable' && item.sideEffectRisk === 'none');
  return <details className="doc-parallel-module-runs">
    <summary>高级配置 · 并行模块运行</summary>
    <p>仅运行已审核、只读的独立模块。每个任务使用不同会话档案，不会自动更改项目的当前档案；登录仍由你在对应浏览器会话中手动完成。</p>
    <button className="text-button" disabled={profilesLoading || busy} onClick={() => void requestProfiles()}>{profilesLoading ? '正在刷新档案…' : '刷新会话档案'}</button>
    <div className="doc-parallel-history"><label>历史批次<select value={group?.id ?? ''} disabled={busy} onChange={event => { if (event.target.value) void selectHistory(event.target.value); else setGroup(null); }}><option value="">选择历史批次</option>{history.map(item => <option key={item.id} value={item.id}>{item.id} · {item.jobs.filter(job => job.status === 'running').length ? '运行中' : '已结束'}</option>)}</select></label><button className="text-button" disabled={historyLoading || busy} onClick={() => void refreshHistory()}>{historyLoading ? '正在刷新批次…' : '刷新历史批次'}</button></div>
    {drafts.map((draft, index) => <div className="doc-parallel-job-config" key={index}><strong>任务 {index + 1}</strong>
      <label>模块<select value={draft.moduleKey} disabled={disabled || busy || hasAnyActiveJobs} onChange={event => update(index, { moduleKey: event.target.value })}><option value="">选择模块</option>{modulePaths.map(path => <option key={pathKey(path)} value={pathKey(path)}>{path.join(' / ')}</option>)}</select></label>
      <label>会话档案<select value={draft.profileId} disabled={disabled || busy || hasAnyActiveJobs} onChange={event => update(index, { profileId: event.target.value })}><option value="">选择档案</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.role}</option>)}</select></label>
      <label>测试数据组（可选）<select value={draft.testDataSetId} disabled={disabled || busy || hasAnyActiveJobs} onChange={event => update(index, { testDataSetId: event.target.value })}><option value="">使用用例默认数据</option>{project.testDataSets?.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
      <button className="text-button" disabled={drafts.length <= 2 || hasAnyActiveJobs} onClick={() => setDrafts(rows => rows.filter((_row, rowIndex) => rowIndex !== index))}>移除任务</button>
    </div>)}
    {!hasAnyActiveJobs && drafts.length < 4 && <button className="button-secondary" disabled={busy} onClick={() => setDrafts(rows => [...rows, { profileId: '', moduleKey: '', testDataSetId: '' }])}>添加任务（最多 4 个）</button>}
    <button className="button-primary" disabled={!allowed || disabled || busy || !historyLoaded || hasAnyActiveJobs || drafts.length < 2} onClick={() => void start()}>{busy ? '正在启动…' : !historyLoaded ? '正在确认历史批次…' : hasAnyActiveJobs ? '已有批次运行中' : '启动并行运行'}</button>
    {error && <p className="doc-notice error" role="alert">{error}</p>}
    {group && <section className="doc-parallel-results" aria-label="并行任务进度">{group.jobs.map((job, index) => <article key={job.runId ?? index}><div><strong>{job.modulePath.join(' / ')} · {job.status === 'running' ? '运行中' : job.status === 'completed' ? `已完成 · ${job.overall ?? ''}` : `失败${job.error ? ` · ${job.error}` : ''}`}</strong><small>会话档案：{profiles.find(profile => profile.id === job.profileId)?.name ?? job.profileId} · {job.stage ?? (job.status === 'running' ? '正在准备' : '')}{job.progress ? ` · ${job.progress.completed}/${job.progress.total}` : ''}</small></div>
      {job.runId && <a className="button-secondary" href={`/?page=document-tests&documentProject=${encodeURIComponent(project.id)}&documentRun=${encodeURIComponent(job.runId)}`}>查看结果</a>}
      {job.status === 'running' && job.runId && <div className="doc-parallel-controls"><button className="button-secondary" onClick={() => void control(job, 'pause')}>暂停</button><button className="button-secondary" onClick={() => void control(job, 'continue')}>继续</button><button className="button-secondary" onClick={() => void control(job, 'cancel')}>取消</button>{job.awaitingLogin && <button className="button-primary" disabled={loginReady[job.runId]} onClick={() => void continueLogin(job)}>{loginReady[job.runId] ? '已通知继续' : '我已登录，继续此任务'}</button>}</div>}</article>)}</section>}
  </details>;
}
