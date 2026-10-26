import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DemoAssertion, DemoCheck, DemoConfig, DemoMode, DemoRun } from '../../src/demo/contracts';
import DocumentTestsPage from './document-tests-page';
import ApiTestsPage from './api-tests-page';
import ApiSuitesPage from './api-suites-page';
import SqliteMigrationPage from './sqlite-migration-page';
import MysqlExplorerPage from './mysql-explorer-page';
import SettingsPage from './settings-page';
import CaseGeneratorPage, { type GenerationResult } from './case-generator-page';

type Page = 'workbench' | 'history' | 'run-detail' | 'regressions' | 'architecture' | 'project-tests' | 'document-tests' | 'case-generator' | 'api-suites' | 'sqlite-migrations' | 'mysql-browser' | 'settings';
type Notice = { kind: 'error' | 'success' | 'info'; text: string } | null;
type ProjectProfile = { id: string; name: string; suiteName: string };
type ProjectRun = { id: string; profileId: string; profileName: string; suiteName: string; scriptId?: string; scriptVersion?: number; status: 'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled' | 'error'; startedAt: string; completedAt?: string; durationMs: number; summary: string; results: Array<{ caseId: string; title: string; status: string; actualExitCode: number | null; evidence: Array<{ kind: string; content: string }> }>; artifactFiles: string[] };
type ProjectScript = { id: string; profileId: string; profileName: string; suiteName: string; version: number; status: 'candidate' | 'approved' | 'rejected'; origin: string; createdAt: string; reviewedAt?: string; reviewDecision?: 'approve' | 'reject'; reviewerNotes?: string; digest: string; requirement?: string; generationSummary?: string; previousApprovedVersion?: number; diff: string[]; files: Array<{ path: string; content: string }>; cases: Array<{ id: string; title: string; bin: string; args: string[]; cwd?: string; timeoutMs?: number; expectedExitCode: number }> };
type PreparationTask = { id: string; status: 'running' | 'completed' | 'needs-review' | 'failed'; stage: string; events: Array<{ stage: string; status: string; message: string; at: string }>; projectId?: string; error?: string };
type TaskFileRole = 'auto' | 'requirements' | 'coverage-reference' | 'held-out-benchmark';
const taskFileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
const taskFileRoleLabels: Record<TaskFileRole, string> = { auto: '自动识别', requirements: '需求资料', 'coverage-reference': '覆盖参考', 'held-out-benchmark': '留出基准' };
const preparationLabels: Record<string, string> = { planning: '正在规划测试范围', 'reading-materials': '正在读取资料与来源角色', 'web-research': '正在检索公开测试参考', 'generating-cases': '正在独立生成测试用例', 'reviewing-cases': '正在校验用例与需求引用', 'generating-steps': '正在准备可执行步骤', ready: '准备完成，正在继续测试', 'needs-review': '测试用例已准备，等待审核', failed: '资料准备失败' };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); message = body.error ?? body.message ?? message; } catch { /* response may be empty */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const statusNames: Record<DemoRun['status'], string> = { queued: '排队中', running: '执行中', passed: '通过', failed: '发现问题', blocked: '已阻塞', cancelled: '已取消', error: '运行错误' };
const labels: Record<DemoMode, string> = { deterministic: '已有用例', requirements: '需求测试', autonomous: '自主探索' };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<string, React.ReactNode> = {
    check: <><path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3Z"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    nodes: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7.2 10.8 16M16 7.2 13.2 16M8 6h8"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v3h14v-3"/></>,
    stop: <><rect x="6" y="6" width="12" height="12" rx="2"/></>,
    pulse: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3H3.8a1.8 1.8 0 1 1 0-3.6H4a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0V2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></>,
    paperclip: <path d="m21.4 11.1-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.box}</svg>;
}

function pretty(value: unknown) { return JSON.stringify(value, null, 2) ?? '—'; }
function dateText(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function duration(value: number) { return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`; }

export default function App() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [runs, setRuns] = useState<DemoRun[]>([]);
  const [checks, setChecks] = useState<DemoCheck[]>([]);
  const [profiles, setProfiles] = useState<ProjectProfile[]>([]);
  const [projectRuns, setProjectRuns] = useState<ProjectRun[]>([]);
  const [projectScripts, setProjectScripts] = useState<ProjectScript[]>([]);
  const [projectBusy, setProjectBusy] = useState(false);
  const [scriptRequirements, setScriptRequirements] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => window.location.hash.startsWith('#doc-') ? 'document-tests' : 'workbench');
  const requestedDocumentProjectId = new URLSearchParams(window.location.search).get('documentProject') ?? '';
  const requestedDocumentRunId = new URLSearchParams(window.location.search).get('documentRun') ?? '';
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [savedAssertionIds, setSavedAssertionIds] = useState<Set<string>>(() => new Set());
  const [targetKind, setTargetKind] = useState<'website' | 'api' | 'project'>('website');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [taskFileRoles, setTaskFileRoles] = useState<Record<string, TaskFileRole>>({});
  const [preparingTask, setPreparingTask] = useState(false);
  const [caseMode, setCaseMode] = useState<'existing' | 'ai' | 'both'>('both');
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [activeDocumentProjectId, setActiveDocumentProjectId] = useState('');
  const [activeApiSuiteId, setActiveApiSuiteId] = useState('');
  const [activeApiAutoRun, setActiveApiAutoRun] = useState(false);
  const [apiSpecification, setApiSpecification] = useState('');
  const [allowExternalApi, setAllowExternalApi] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedId) ?? null, [runs, selectedId]);
  const activeRun = runs.find((r) => r.status === 'queued' || r.status === 'running');
  const refresh = useCallback(async () => {
    const [nextRuns, nextConfig, nextChecks, nextProfiles, nextProjectRuns, nextProjectScripts] = await Promise.all([
      api<DemoRun[]>('/api/runs'), api<DemoConfig>('/api/config'), api<DemoCheck[]>('/api/regressions'),
      api<ProjectProfile[]>('/api/project-profiles'), api<ProjectRun[]>('/api/project-runs'), api<ProjectScript[]>('/api/project-scripts'),
    ]);
    setRuns(nextRuns); setConfig(nextConfig); setChecks(nextChecks); setProfiles(nextProfiles); setProjectRuns(nextProjectRuns); setProjectScripts(nextProjectScripts);
    setSelectedId((current) => current && nextRuns.some((r) => r.id === current) ? current : nextRuns[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh().catch((error: Error) => setNotice({ kind: 'error', text: `无法连接本地 API：${error.message}` })).finally(() => setBooting(false));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => { if (requestedDocumentProjectId) setPage('document-tests'); }, [requestedDocumentProjectId]);

  useEffect(() => {
    if (!selectedRun || !['queued', 'running'].includes(selectedRun.status)) return;
    let live = true;
    const poll = async () => {
      try {
        const next = await api<DemoRun>(`/api/runs/${selectedRun.id}`);
        if (!live) return;
        setRuns((current) => [next, ...current.filter((run) => run.id !== next.id)]);
        if (!['queued', 'running'].includes(next.status)) {
          setNotice({ kind: next.status === 'passed' ? 'success' : 'info', text: `运行已结束：${statusNames[next.status]}` });
        }
      } catch (error) { if (live) setNotice({ kind: 'error', text: `刷新运行状态失败：${(error as Error).message}` }); }
    };
    const id = window.setInterval(poll, 1200);
    return () => { live = false; window.clearInterval(id); };
  }, [selectedRun?.id, selectedRun?.status]);

  const cancelRun = async (run: DemoRun) => {
    try { const next = await api<DemoRun>(`/api/runs/${run.id}/cancel`, { method: 'POST' }); setRuns((current) => [next, ...current.filter((r) => r.id !== next.id)]); setNotice({ kind: 'info', text: '已请求取消运行。' }); }
    catch (error) { setNotice({ kind: 'error', text: `取消失败：${(error as Error).message}` }); }
  };
  const setFixed = async (fixed: boolean) => {
    try { const next = await api<DemoConfig>('/api/target', { method: 'POST', body: JSON.stringify({ fixed }) }); setConfig(next); setNotice({ kind: 'success', text: fixed ? '样本已切换为预置修复状态。' : '样本已切换为预置故障状态。' }); }
    catch (error) { setNotice({ kind: 'error', text: `切换样本失败：${(error as Error).message}` }); }
  };
  const saveRegression = async (assertion: DemoAssertion) => {
    if (!selectedRun) return;
    try { const check = await api<DemoCheck>('/api/regressions', { method: 'POST', body: JSON.stringify({ runId: selectedRun.id, assertionId: assertion.id }) }); setChecks((current) => [check, ...current.filter((c) => c.id !== check.id)]); setSavedAssertionIds((current) => new Set(current).add(assertion.id)); setNotice({ kind: 'success', text: '失败断言已保存为回归用例。' }); }
    catch (error) { setNotice({ kind: 'error', text: `保存回归用例失败：${(error as Error).message}` }); }
  };
  const rerunRegressions = async () => {
    setBusy(true); setNotice(null);
    try { const run = await api<DemoRun>('/api/regressions/run', { method: 'POST' }); setRuns((current) => [run, ...current.filter((r) => r.id !== run.id)]); setSelectedId(run.id); setPage('run-detail'); setNotice({ kind: 'info', text: '回归运行已提交。' }); }
    catch (error) { setNotice({ kind: 'error', text: `回归重跑失败：${(error as Error).message}` }); }
    finally { setBusy(false); }
  };
  const cancelProjectRun = async (run: ProjectRun) => {
    try {
      const next = await api<ProjectRun>(`/api/project-runs/${run.id}/cancel`, { method: 'POST' });
      setProjectRuns((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setNotice({ kind: 'info', text: '已请求停止项目测试。' });
    } catch (error) { setNotice({ kind: 'error', text: `取消失败：${(error as Error).message}` }); }
  };
  const createScriptCandidate = async (profile: ProjectProfile) => {
    setProjectBusy(true); setNotice(null);
    try {
      const candidate = await api<ProjectScript>('/api/project-scripts/candidates', { method: 'POST', body: JSON.stringify({ profileId: profile.id }) });
      setProjectScripts((current) => [candidate, ...current.filter((item) => item.id !== candidate.id)]);
      setNotice({ kind: 'success', text: `已保存 ${profile.id} 候选版本 v${candidate.version}，请检查命令后审批。` });
    } catch (error) { setNotice({ kind: 'error', text: `创建候选版本失败：${(error as Error).message}` }); }
    finally { setProjectBusy(false); }
  };
  const generateScriptCandidate = async (profile: ProjectProfile) => {
    setProjectBusy(true); setNotice(null);
    try {
      const requirement = (scriptRequirements[profile.id] ?? '').trim();
      const candidate = await api<ProjectScript>('/api/project-scripts/ai-candidates', { method: 'POST', body: JSON.stringify({ profileId: profile.id, requirement }) });
      setProjectScripts((current) => [candidate, ...current.filter((item) => item.id !== candidate.id)]);
      setNotice({ kind: 'success', text: `AI 已按需求生成受限测试候选 v${candidate.version}；请审阅步骤和文件后决定是否批准。` });
    } catch (error) { setNotice({ kind: 'error', text: `AI 生成候选失败：${(error as Error).message}` }); }
    finally { setProjectBusy(false); }
  };
  const reviewProjectScript = async (script: ProjectScript, decision: 'approve' | 'reject', notes: string) => {
    try {
      const reviewed = await api<ProjectScript>(`/api/project-scripts/${script.id}/review`, { method: 'POST', body: JSON.stringify({ decision, notes }) });
      setProjectScripts((current) => current.map((item) => item.id === reviewed.id ? reviewed : item));
      setNotice({ kind: decision === 'approve' ? 'success' : 'info', text: decision === 'approve' ? `版本 v${reviewed.version} 已审批并持久化。` : `候选版本 v${reviewed.version} 已拒绝并留在版本历史中。` });
    } catch (error) { setNotice({ kind: 'error', text: `脚本审批失败：${(error as Error).message}` }); }
  };
  const runApprovedScript = async (script: ProjectScript) => {
    setProjectBusy(true); setNotice(null);
    try {
      const run = await api<ProjectRun>(`/api/project-scripts/${script.id}/run`, { method: 'POST' });
      setProjectRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setNotice({ kind: 'info', text: `正在无模型地重跑已审批脚本 v${script.version}。` });
    } catch (error) { setNotice({ kind: 'error', text: `已审批脚本运行失败：${(error as Error).message}` }); }
    finally { setProjectBusy(false); }
  };
  const downloadReport = async (format: 'json' | 'md') => {
    if (!selectedRun) return;
    try {
      const response = await fetch(`/api/runs/${selectedRun.id}/report?format=${format}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `testpilot-${selectedRun.id}.${format === 'md' ? 'md' : 'json'}`; link.click(); URL.revokeObjectURL(url);
      setNotice({ kind: 'success', text: `已下载 ${format.toUpperCase()} 报告。` });
    } catch (error) { setNotice({ kind: 'error', text: `报告下载失败：${(error as Error).message}` }); }
  };
  const navigate = (destination: Page) => {
    setPage(destination);
    setNotice(null);
    if (destination !== 'document-tests' && window.location.hash.startsWith('#doc-')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };
  const transferGeneratedCases = async (generation: GenerationResult, generatedTargetUrl: string) => {
    const draft = await api<{ projectId: string; caseCount: number; selectedForReview: number }>('/api/case-generator/execute-draft', { method: 'POST', body: JSON.stringify({ generation, targetUrl: generatedTargetUrl }) });
    setActiveDocumentProjectId(draft.projectId);
    setPage('document-tests');
    setNotice({ kind: 'info', text: `已将 ${draft.caseCount} 条 AI 用例移交为待审核测试项目；${draft.selectedForReview} 条关联到已确认的本期需求。用例尚未执行，先审核范围和前置条件。` });
  };

  const createTask = async () => {
    setPreparingTask(true); setNotice(null);
    try {
      setActiveDocumentProjectId('');
      const files = taskFiles.length ? taskFiles : [new File([`# 测试任务\n\n${taskPrompt.trim() || '请自主探索目标应用中可访问的主要功能，检查明显的错误、异常状态和关键交互。'}`], '测试任务.md', { type: 'text/markdown' })];
      if (files.length > 5) throw new Error('一次最多附加 5 个资料文件。');
      const oversized = files.find(file => file.size > 9 * 1024 * 1024);
      if (oversized) throw new Error(`${oversized.name} 超过 9 MB 限制。`);
      const encodedFiles = await Promise.all(files.map(async (file) => {
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`无法读取资料：${file.name}`)); reader.readAsDataURL(file); });
        return { fileName: file.name, bytesBase64: dataUrl.split(',')[1] ?? '', role: taskFiles.some(item => item === file) ? taskFileRoles[taskFileKey(file)] ?? 'auto' : 'requirements' };
      }));
      if (targetKind === 'api') {
        if (!targetUrl.trim()) throw new Error('请先填写 API Base URL。');
        if (!taskFiles.length && !taskPrompt.trim() && !apiSpecification.trim()) throw new Error('请添加 API 需求资料、补充说明或 OpenAPI 契约。');
        const candidate = await api<{ id: string; suite: { name: string; cases: unknown[] }; research?: { count: number } }>('/api/api-suites/generate', { method: 'POST', body: JSON.stringify({ baseUrl: targetUrl.trim(), contextText: taskPrompt.trim(), apiSpecification: apiSpecification.trim(), files: encodedFiles.filter(item => taskFiles.some(file => file.name === item.fileName)) }) });
        setActiveApiSuiteId(candidate.id);
        setActiveApiAutoRun(!requireConfirmation);
        setNotice({ kind: 'success', text: `已生成 ${candidate.suite.cases.length} 条 API 用例候选${candidate.research?.count ? `，参考了 ${candidate.research.count} 条公开资料` : ''}。${requireConfirmation ? '请先检查并审核。' : 'Agent 将尝试自动运行只读用例；其它套件会停在审核环节。'}` });
      } else if (targetKind === 'website') {
        if (!targetUrl.trim()) throw new Error('请先填写要测试的网址。');
        const started = await api<{ preparationId: string }>('/api/document-projects/import', { method: 'POST', body: JSON.stringify({ files: encodedFiles, targetUrl: targetUrl.trim(), contextText: taskPrompt.trim(), caseMode, requireConfirmation }) });
        let task: PreparationTask;
        do {
          task = await api<PreparationTask>(`/api/document-preparation/${started.preparationId}`);
          const latest = task.events.at(-1);
          setNotice({ kind: task.status === 'failed' ? 'error' : 'info', text: latest?.message ?? preparationLabels[task.stage] ?? '正在准备测试任务…' });
          if (task.status === 'running') await new Promise(resolve => window.setTimeout(resolve, 400));
        } while (task.status === 'running');
        if (task.status === 'failed') throw new Error(task.error ?? '资料准备失败。');
        if (!task.projectId) throw new Error('资料准备任务结束，但未生成测试项目。');
        setActiveDocumentProjectId(task.projectId);
        setNotice({ kind: task.status === 'needs-review' ? 'info' : 'success', text: task.status === 'needs-review' ? '用例准备完成，需要你复核或补充后再运行。' : '测试用例和步骤已准备完成；核对范围后可手动启动常规回归。' });
      } else {
        const profile = profiles.find((item) => item.id === selectedProfileId);
        if (!profile) throw new Error('请选择一个已登记的本地项目。');
        if (!taskFiles.length && taskPrompt.trim().length < 8) throw new Error('请描述至少 8 个字符的测试目标，或附上一份需求资料。');
        const file = encodedFiles[0];
        const candidate = await api<ProjectScript>('/api/project-scripts/ai-candidates', { method: 'POST', body: JSON.stringify({ profileId: profile.id, requirement: taskPrompt.trim() || '请阅读附加需求资料，整理适用于此项目的关键测试场景。', ...(taskFiles.length ? { fileName: file?.fileName, bytesBase64: file?.bytesBase64 } : {}) }) });
        setProjectScripts((current) => [candidate, ...current.filter((item) => item.id !== candidate.id)]);
        navigate('project-tests');
        setNotice({ kind: 'success', text: '已生成脚本候选。请审核测试步骤和文件后，再批准执行。' });
      }
    } catch (error) { setNotice({ kind: 'error', text: `无法准备测试：${(error as Error).message}` }); }
    finally { setPreparingTask(false); }
  };
  const startNewTest = () => {
    setActiveDocumentProjectId(''); setTargetUrl(''); setTaskPrompt(''); setTaskFiles([]); setTaskFileRoles({});
    setActiveApiSuiteId(''); setActiveApiAutoRun(false); setApiSpecification(''); setAllowExternalApi(false);
    setTargetKind('website'); setCaseMode('both'); setRequireConfirmation(false); setNotice(null);
  };

  return <div className="app-shell agent-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="pulse" size={20}/></div><div><strong>TestPilot</strong><span>QUALITY WORKBENCH</span></div></div>
      <div className="nav-section-label">测试空间</div>
      <nav aria-label="主导航" className="main-nav">
        <NavItem active={page === 'workbench'} icon="plus" label="新建测试" onClick={() => navigate('workbench')} />
        <NavItem active={page === 'document-tests'} icon="list" label="网页回归" onClick={() => { navigate('document-tests'); setMoreOpen(false); }} />
        <NavItem active={page === 'regressions'} icon="check" label="回归用例" count={checks.length || undefined} onClick={() => { navigate('regressions'); setMoreOpen(false); }} />
        <NavItem active={page === 'history' || page === 'run-detail'} icon="clock" label="运行记录" count={runs.length || undefined} onClick={() => { navigate('history'); setMoreOpen(false); }} />
        <NavItem active={moreOpen || ['architecture','project-tests','case-generator','api-suites','sqlite-migrations','mysql-browser','settings'].includes(page)} icon="layers" label="工具" onClick={() => setMoreOpen((open) => !open)} />
      </nav>
      {moreOpen && <div className="nav-more-menu" aria-label="测试工具">
        <NavItem active={page === 'project-tests'} icon="box" label="本地项目与脚本" onClick={() => { navigate('project-tests'); setMoreOpen(false); }} />
        <NavItem active={page === 'case-generator'} icon="plus" label="生成测试用例" onClick={() => { navigate('case-generator'); setMoreOpen(false); }} />
        <NavItem active={page === 'api-suites'} icon="nodes" label="API 测试套件" onClick={() => { navigate('api-suites'); setMoreOpen(false); }} />
        <NavItem active={page === 'sqlite-migrations'} icon="database" label="数据库迁移测试" onClick={() => { navigate('sqlite-migrations'); setMoreOpen(false); }} />
        <NavItem active={page === 'mysql-browser'} icon="database" label="MySQL 数据查看" onClick={() => { navigate('mysql-browser'); setMoreOpen(false); }} />
        <NavItem active={page === 'architecture'} icon="nodes" label="系统说明" onClick={() => { navigate('architecture'); setMoreOpen(false); }} />
        <NavItem active={page === 'settings'} icon="settings" label="设置" onClick={() => { navigate('settings'); setMoreOpen(false); }} />
      </div>}
      <div className="sidebar-bottom">
        <div className="target-switch"><div className="target-heading"><span className="status-dot"/><strong>样本服务</strong></div><div className="target-name">订单 API <span className="target-tag">本地</span></div><p>预置故障 / 修复用于对照验证</p><div className="segmented" role="group" aria-label="样本状态"><button className={!config?.fixedTarget ? 'selected' : ''} onClick={() => setFixed(false)} disabled={!config || !!activeRun}>预置故障</button><button className={config?.fixedTarget ? 'selected' : ''} onClick={() => setFixed(true)} disabled={!config || !!activeRun}>已修复</button></div></div>
        <div className="scope-caption"><span>本轮范围</span><p>本地 API 与 CLI<br/>Web / 移动端待适配</p></div>
        <div className="user-chip"><div className="avatar">T</div><div><strong>本地演示环境</strong><span>{config?.framework ?? 'Pi'} · TestPilot</span></div><span className="online-dot" aria-label="连接状态"/></div>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span>TestPilot</span><Icon name="chevron" size={14}/><strong>{pageTitle(page)}</strong></div><div className="topbar-meta">{page === 'workbench' && (activeDocumentProjectId || activeApiSuiteId) && <button className="new-session-button" onClick={startNewTest}><Icon name="plus" size={15}/>新建测试</button>}<span className="environment-pill"><span className="status-dot"/>{config?.modelAvailable ? `模型已连接 · ${config.modelLabel}` : '本地测试 Agent'}</span><span className="divider"/><button className="top-settings" onClick={() => navigate('settings')} aria-label="打开设置"><Icon name="settings" size={16}/></button></div></header>
      {notice && <div className={`notice notice-${notice.kind}`} role="status"><span>{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
      {page === 'workbench' && <div className={`agent-home ${activeDocumentProjectId || activeApiSuiteId ? 'agent-home-active' : ''}`}>
        {!activeDocumentProjectId && !activeApiSuiteId ? <section className="agent-conversation">
          <div className="agent-welcome"><h1>把网址和资料交给我</h1><p>我会整理测试用例、自动生成可复用步骤，再用脚本和 AI 分别测试并对比结果。</p></div>
          <div className={`agent-composer ${draggingFiles ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDraggingFiles(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false); }} onDrop={(event) => { event.preventDefault(); setDraggingFiles(false); const allowed = Array.from(event.dataTransfer.files).filter(file => /\.(pdf|xmind|md|markdown|txt)$/i.test(file.name)); if (allowed.length) setTaskFiles(current => [...current, ...allowed].slice(0, 5)); }}>
            <div className="target-type-switch" role="tablist" aria-label="测试目标类型">
              <button className={targetKind === 'website' ? 'selected' : ''} role="tab" aria-selected={targetKind === 'website'} onClick={() => setTargetKind('website')}><Icon name="link" size={16}/>网站网址</button>
              <button className={targetKind === 'api' ? 'selected' : ''} role="tab" aria-selected={targetKind === 'api'} onClick={() => setTargetKind('api')}><Icon name="nodes" size={16}/>API 服务</button>
              <button className={targetKind === 'project' ? 'selected' : ''} role="tab" aria-selected={targetKind === 'project'} onClick={() => setTargetKind('project')}><Icon name="box" size={16}/>本地项目</button>
            </div>
            {targetKind !== 'project' ? <><label className="agent-target-field"><span>{targetKind === 'api' ? 'API Base URL' : '测试网址'}</span><input type="url" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder={targetKind === 'api' ? 'https://api.example.com/v1/' : 'https://example.com'} /></label>{targetKind === 'api' && <><label className="agent-prompt-label" htmlFor="api-specification">OpenAPI 契约 <span>可选，粘贴 JSON/YAML</span></label><textarea id="api-specification" className="api-spec-input" value={apiSpecification} onChange={(event) => setApiSpecification(event.target.value)} placeholder="粘贴 OpenAPI 文档；也可附加需求 PDF、XMind、Markdown 或 TXT。" rows={4} /><label className="api-network-option"><input type="checkbox" checked={allowExternalApi} onChange={(event) => setAllowExternalApi(event.target.checked)} /><span>允许向这个外网 API 地址发送测试请求</span></label><p className="target-mode-note">默认只自动运行只读 GET/HEAD/OPTIONS 用例；写操作、角色矩阵和并发需要检查与审核。</p></>}</> : <><label className="agent-target-field"><span>已登记项目</span><select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}><option value="">选择一个本地项目…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.suiteName}</option>)}</select></label><p className="target-mode-note">本地项目会生成待审核的脚本候选；网页回归可以手动运行确定性用例，也可按需选择 AI 辅助对照。</p></>}
            <label className="agent-prompt-label" htmlFor="agent-prompt">你希望重点检查什么？ <span>可选</span></label>
            <textarea id="agent-prompt" value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="例如：重点检查申请、审批和历史记录流程。也可以留空，让 Agent 自主探索。" rows={3} />
            {taskFiles.map((file, index) => <div className="attached-file" key={`${file.name}-${index}`}><Icon name="file" size={15}/><span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} KB</small>{targetKind === 'website' && <select aria-label={`${file.name} 的资料角色`} value={taskFileRoles[taskFileKey(file)] ?? 'auto'} onChange={event => setTaskFileRoles(current => ({ ...current, [taskFileKey(file)]: event.target.value as TaskFileRole }))}>{Object.entries(taskFileRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<button onClick={() => setTaskFiles(current => current.filter((_, i) => i !== index))} aria-label={`移除 ${file.name}`}>×</button></div>)}
            {targetKind !== 'api' && <details className="composer-advanced"><summary>高级选项</summary><div className="composer-options"><label>测试用例<select value={caseMode} onChange={event => setCaseMode(event.target.value as typeof caseMode)}><option value="both">资料用例 + AI 补充</option><option value="existing">只使用资料用例</option><option value="ai">只生成 AI 用例</option></select></label></div></details>}
            <div className="composer-footer"><div className="composer-tools"><label className="attach-button"><Icon name="paperclip" size={17}/><span>{taskFiles.length ? '添加更多资料' : '添加资料'}</span><input type="file" multiple accept=".pdf,.xmind,.md,.markdown,.txt" onChange={(event) => { const allowed = Array.from(event.target.files ?? []).filter(file => /\.(pdf|xmind|md|markdown|txt)$/i.test(file.name)); setTaskFiles(current => [...current, ...allowed].slice(0, 5)); event.target.value = ''; }} /></label><span className="composer-hint">可拖入或添加 PDF、XMind、Markdown、TXT · 最多 5 个文件</span></div><div className="composer-actions"><label className="review-policy"><input type="checkbox" checked={requireConfirmation} onChange={(event) => setRequireConfirmation(event.target.checked)} /><span>开始前先确认</span></label><button className="button-primary agent-submit" onClick={createTask} disabled={preparingTask || booting || (targetKind === 'project' ? !selectedProfileId : !targetUrl.trim())}><Icon name="arrowUp" size={16}/>{preparingTask ? '正在准备…' : '开始测试'}</button></div></div>
          </div>
          {preparingTask && <div className="agent-planning-live" role="status"><strong>正在准备测试</strong><ol><li>读取你提供的资料</li><li>搜索公开测试案例</li><li>整理用例并生成可复用步骤</li></ol></div>}
          <p className="agent-promise"><span className="promise-dot"/>测试资料准备好后，由你复核并手动启动常规回归；需要登录时会暂停并提示你。</p>
        </section> : <section className="agent-session-panel">
          <header className="session-heading"><div><h1>{activeApiSuiteId ? 'API 测试会话' : '测试会话'}</h1><p>{targetKind === 'project' ? '本地项目测试' : targetUrl}{taskFiles.length > 0 ? ` · ${taskFiles.length} 个资料文件` : ''}</p></div><span className={`session-review-mode ${requireConfirmation ? 'confirm' : ''}`}>{requireConfirmation ? '运行前确认' : '自动运行'}</span></header>
          <div className="agent-thread"><div className="agent-message agent-message-user"><strong>测试请求</strong>{targetKind !== 'project' && <span>{targetUrl}</span>}{taskPrompt && <p>{taskPrompt}</p>}{taskFiles.map((file, index) => <small key={`${file.name}-${index}`}>资料：{file.name}</small>)}</div><div className="agent-message agent-message-assistant"><strong>TestPilot Agent</strong><span>资料读取与公开案例搜索已完成。我已自动整理测试用例并生成脚本步骤，接下来会运行确定性脚本和 AI 视觉测试，再逐项对比。</span></div></div>
          {activeApiSuiteId ? <ApiTestsPage key={activeApiSuiteId} suiteId={activeApiSuiteId} autoRun={activeApiAutoRun} allowNetwork={allowExternalApi} /> : <DocumentTestsPage key={activeDocumentProjectId} modelAvailable={config?.modelAvailable ?? false} computerUseAvailable={config?.computerUseAvailable ?? false} computerUseReason={config?.computerUseReason ?? 'Computer Use 配置状态不可用。'} computerUseModel={config?.computerUseModel ?? ''} initialProjectId={activeDocumentProjectId} embedded />}
        </section>}
        {(runs.length > 0 || projectRuns.length > 0) && <button className="recent-run-link" onClick={() => navigate('history')}><Icon name="clock" size={15}/>查看最近运行 <span>{runs.length + projectRuns.length}</span><Icon name="chevron" size={14}/></button>}
      </div>}
      {page === 'history' && <HistoryPage runs={runs} selectedId={selectedId} select={(run) => { setSelectedId(run.id); setPage('run-detail'); }} />}
      {page === 'run-detail' && selectedRun && <div className="run-detail-page"><div className="run-detail-heading"><button className="text-button" onClick={() => navigate('history')}><Icon name="chevron" size={15}/>运行记录</button><div><h1>运行详情</h1><p>{dateText(selectedRun.startedAt)} · {statusNames[selectedRun.status]}</p></div><div className="report-actions"><button className="text-button" onClick={() => downloadReport('md')}><Icon name="download" size={15}/>报告</button><button className="text-button" onClick={() => downloadReport('json')}><Icon name="download" size={15}/>JSON</button>{['queued','running'].includes(selectedRun.status) && <button className="button-secondary" onClick={() => cancelRun(selectedRun)}><Icon name="stop" size={15}/>停止</button>}</div></div><div className="run-detail-grid"><div><RunResults run={selectedRun} onSave={saveRegression} savedIds={savedAssertionIds}/></div><aside className="event-column"><div className="event-header"><div><h2>执行事件</h2><p>{selectedRun.events.length} 条记录</p></div><span className={`run-state state-${selectedRun.status}`}><span/>{statusNames[selectedRun.status]}</span></div><EventStream run={selectedRun}/></aside></div></div>}
      {page === 'regressions' && <RegressionPage checks={checks} busy={busy} rerun={rerunRegressions} />}
      {page === 'architecture' && <ArchitecturePage config={config} />}
      {page === 'project-tests' && <ProjectProfilesPage profiles={profiles} scripts={projectScripts} runs={projectRuns} busy={projectBusy} modelAvailable={config?.modelAvailable ?? false} requirements={scriptRequirements} setRequirement={(id, value) => setScriptRequirements((current) => ({ ...current, [id]: value }))} createCandidate={createScriptCandidate} generateCandidate={generateScriptCandidate} review={reviewProjectScript} runApproved={runApprovedScript} cancel={cancelProjectRun} />}
      {page === 'document-tests' && <DocumentTestsPage modelAvailable={config?.modelAvailable ?? false} computerUseAvailable={config?.computerUseAvailable ?? false} computerUseReason={config?.computerUseReason ?? 'Computer Use 配置状态不可用。'} computerUseModel={config?.computerUseModel ?? ''} initialProjectId={activeDocumentProjectId || requestedDocumentProjectId || undefined} initialRunId={requestedDocumentRunId || undefined} />}
      {page === 'case-generator' && <CaseGeneratorPage modelAvailable={config?.modelAvailable ?? false} onTransfer={transferGeneratedCases} />}
      {page === 'api-suites' && <ApiSuitesPage openSuite={id => { setActiveApiSuiteId(id); setActiveApiAutoRun(false); setTargetKind('api'); setPage('workbench'); setNotice(null); }} />}
      {page === 'sqlite-migrations' && <SqliteMigrationPage />}
      {page === 'mysql-browser' && <MysqlExplorerPage />}
      {page === 'settings' && <SettingsPage onSaved={refresh} />}
    </main>
  </div>;
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: string; label: string; count?: number; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}><Icon name={icon}/><span>{label}</span>{count !== undefined && <small>{count}</small>}</button>;
}
function pageTitle(page: Page) { return ({ workbench: '新建测试', history: '运行记录', 'run-detail': '运行详情', regressions: '回归用例', architecture: '系统说明', 'project-tests': '本地项目测试', 'document-tests': '网页回归', 'case-generator': '生成测试用例', 'api-suites': 'API 测试套件', 'sqlite-migrations': '数据库迁移测试', 'mysql-browser': 'MySQL 数据查看', settings: '设置' })[page]; }
function RunResults({ run, onSave, savedIds }: { run: DemoRun; onSave: (assertion: DemoAssertion) => void; savedIds: Set<string> }) {
  const [assertionFilter, setAssertionFilter] = useState<'all' | 'failed' | 'passed'>('all');
  const passed = run.assertions.filter((a) => a.status === 'passed').length;
  const failed = run.assertions.filter((a) => a.status === 'failed').length;
  const inconclusive = run.assertions.filter((a) => a.status === 'inconclusive').length;
  const visibleAssertions = run.assertions
    .map((assertion, index) => ({ assertion, index }))
    .filter(({ assertion }) => assertionFilter === 'all' || assertion.status === assertionFilter)
    .sort((a, b) => {
      const rank = (status: DemoAssertion['status']) => status === 'failed' ? 0 : status === 'passed' ? 1 : 2;
      return rank(a.assertion.status) - rank(b.assertion.status) || a.index - b.index;
    });
  return <div className="results-stack">
    <div className="summary-strip"><div className="summary-status"><span className={`status-symbol ${run.status === 'passed' ? 'good' : run.status === 'failed' ? 'bad' : 'neutral'}`}>{run.status === 'passed' ? '✓' : run.status === 'failed' ? '!' : '·'}</span><div><strong>{statusNames[run.status]}</strong><small>{run.summary}</small></div></div><div className="summary-metrics"><Metric value={run.assertions.length} label="断言"/><Metric value={passed} label="通过" tone="green"/><Metric value={failed} label="失败" tone="red"/><Metric value={inconclusive} label="待确认"/></div></div>
    <div className="result-meta"><span><b>入口</b>{labels[run.mode]}</span><span><b>执行器</b>{run.mode === 'deterministic' ? '固定断言 runner · 不调用模型' : run.provider === 'offline' ? '离线演示 · 脚本决策，非 AI 推理' : '真实模型'}</span><span><b>目标</b>{run.fixedTarget ? '预置修复' : '预置故障'}</span><span><b>耗时</b>{duration(run.durationMs)}</span><span><b>动作</b>{run.actionCount} / {run.maxActions}</span></div>
    {run.error && <div className="error-callout"><strong>运行错误</strong><span>{run.error}</span></div>}
    <section className="result-section"><div className="assertions-toolbar"><div className="section-title"><div><h3>断言结果</h3><p>失败断言优先显示，可保存为回归用例</p></div><span className="section-count">{run.assertions.length}</span></div><div className="assertion-filters" role="group" aria-label="筛选断言"><button className={assertionFilter === 'all' ? 'active' : ''} onClick={() => setAssertionFilter('all')}>全部 <span>{run.assertions.length}</span></button><button className={assertionFilter === 'failed' ? 'active failed-filter' : ''} onClick={() => setAssertionFilter('failed')}>失败 <span>{failed}</span></button><button className={assertionFilter === 'passed' ? 'active passed-filter' : ''} onClick={() => setAssertionFilter('passed')}>通过 <span>{passed}</span></button></div></div>{run.assertions.length ? visibleAssertions.length ? <div className="assertion-list">{visibleAssertions.map(({ assertion }) => <AssertionCard key={assertion.id} assertion={assertion} run={run} onSave={onSave} saved={savedIds.has(assertion.id)} />)}</div> : <div className="inline-empty">没有{assertionFilter === 'failed' ? '失败' : '通过'}断言。{inconclusive ? ` 另有 ${inconclusive} 条待确认。` : ''}</div> : <div className="inline-empty">当前运行尚未产生断言结果。运行完成后会显示检查项。</div>}</section>
    <section className="result-section"><div className="section-title"><div><h3>执行计划</h3><p>本次运行的检查步骤</p></div><span className="section-count">{run.plan.length}</span></div>{run.plan.length ? <ol className="plan-list">{run.plan.map((step, index) => <li key={`${step}-${index}`}><span className="plan-marker">{String(index + 1).padStart(2, '0')}</span><span>{step}</span></li>)}</ol> : <div className="inline-empty">暂无计划记录。</div>}</section>
    <section className="result-section"><div className="section-title"><div><h3>覆盖与限制</h3><p>清楚标出已访问路径和未测范围</p></div></div><div className="coverage-grid"><div className="coverage-cell"><strong>{run.coverage.visited.length}</strong><span>已访问路径</span><div className="tag-cloud">{run.coverage.visited.length ? run.coverage.visited.map((path) => <code key={path}>{path}</code>) : <em>暂无已访问路径</em>}</div></div><div className="coverage-cell"><strong>{run.coverage.untested.length}</strong><span>未测路径</span><div className="tag-cloud muted">{run.coverage.untested.length ? run.coverage.untested.map((path) => <code key={path}>{path}</code>) : <em>没有未测路径</em>}</div></div></div>{run.limitations.length > 0 && <ul className="limitation-list">{run.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}</section>
    {run.evidence.length > 0 && <EvidenceSection run={run}/>}
  </div>;
}
function Metric({ value, label, tone }: { value: number; label: string; tone?: 'green' | 'red' }) { return <div className={`metric ${tone ?? ''}`}><strong>{value}</strong><span>{label}</span></div>; }
function AssertionCard({ assertion, run, onSave, saved }: { assertion: DemoAssertion; run: DemoRun; onSave: (assertion: DemoAssertion) => void; saved: boolean }) {
  const [open, setOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(assertion.status !== 'passed');
  const evidence = run.evidence.find((item) => item.id === assertion.evidenceId);
  const stateText = assertion.status === 'passed' ? '通过' : assertion.status === 'failed' ? '失败' : '待确认';
  const expected = pretty(assertion.expected).replace(/\s+/g, ' ');
  const actual = pretty(assertion.actual).replace(/\s+/g, ' ');
  const concise = (value: string) => value.length > 110 ? `${value.slice(0, 107)}…` : value;
  return <article className={`assertion-card assertion-${assertion.status}`}><div className="assertion-main"><span className={`assertion-marker ${assertion.status}`}>{assertion.status === 'passed' ? '✓' : assertion.status === 'failed' ? '×' : '·'}</span><div className="assertion-copy"><div className="assertion-name-row"><strong>{assertion.title}</strong><span className={`assertion-state ${assertion.status}`}>{stateText}</span></div><div className="assertion-source">{assertion.source} <span>·</span> {assertion.reproduction.method} {assertion.reproduction.path}</div>{assertion.status === 'passed' && <button className="comparison-toggle" aria-expanded={comparisonOpen} onClick={() => setComparisonOpen((value) => !value)}>{comparisonOpen ? '收起预期 / 实际' : '查看预期 / 实际'} <Icon name="chevron" size={12}/></button>}{comparisonOpen && <div className="expected-actual"><div><small>预期</small><code title={expected}>{concise(expected)}</code></div><div><small>实际</small><code title={actual}>{concise(actual)}</code></div></div>}{evidence && <button className="evidence-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '收起' : '查看'}请求与响应证据 <Icon name="chevron" size={13}/></button>}{open && evidence && <EvidenceDetail evidence={evidence}/>}</div>{assertion.status === 'failed' && <button className="save-check" onClick={() => onSave(assertion)} disabled={saved} title={saved ? '已保存' : '保存为回归用例'}>{saved ? '✓ 已保存' : '保存为回归用例'}</button>}</div></article>;
}

function EvidenceDetail({ evidence }: { evidence: DemoRun['evidence'][number] }) {
  return <div className="evidence-detail"><div className="evidence-request"><div className="code-heading"><span>请求</span><span>{evidence.method} {evidence.path}</span></div>{(evidence.requestHeaders && Object.keys(evidence.requestHeaders).length > 0) && <pre>{pretty(evidence.requestHeaders)}</pre>}{evidence.requestBody !== undefined && <pre>{pretty(evidence.requestBody)}</pre>}</div><div className="evidence-response"><div className="code-heading"><span>响应</span><span className={evidence.status >= 400 ? 'http-error' : 'http-good'}>{evidence.status} · {duration(evidence.durationMs)}</span></div><pre>{pretty(evidence.body)}</pre></div></div>;
}
function EvidenceSection({ run }: { run: DemoRun }) { return <section className="result-section"><div className="section-title"><div><h3>HTTP 证据</h3><p>每次请求的状态、响应体与耗时</p></div><span className="section-count">{run.evidence.length}</span></div><div className="evidence-index">{run.evidence.map((item, index) => <div key={item.id} className="evidence-index-row"><span className="evidence-index-num">{String(index + 1).padStart(2, '0')}</span><code>{item.method}</code><span className="evidence-path">{item.path}</span><strong className={item.status >= 400 ? 'http-error' : 'http-good'}>{item.status}</strong><span className="evidence-duration">{duration(item.durationMs)}</span></div>)}</div></section>; }
function EventStream({ run }: { run: DemoRun }) {
  const sorted = [...run.events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return <div className="event-stream">{sorted.length ? sorted.map((event) => <EventEntry event={event} key={event.id}/>) : <div className="stream-empty">等待执行事件…</div>}</div>;
}
function EventEntry({ event }: { event: DemoRun['events'][number] }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = event.detail.length > 150;
  return <article className={`event-item event-${event.kind}`}><span className="event-marker"><EventIcon kind={event.kind}/></span><div className="event-content"><div className="event-title-row"><strong>{event.title}</strong><time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time></div><p className={shouldCollapse && !expanded ? 'event-detail-collapsed' : ''}>{event.detail}</p>{shouldCollapse && <button className="event-detail-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起详情' : '展开详情'}</button>}</div></article>;
}
function EventIcon({ kind }: { kind: string }) { return <span aria-hidden="true">{{ plan: '≡', tool: '↗', observation: '◉', assertion: '✓', info: 'i', error: '!' }[kind] ?? '·'}</span>; }

function HistoryPage({ runs, selectedId, select }: { runs: DemoRun[]; selectedId: string | null; select: (run: DemoRun) => void }) {
  return <div className="secondary-page"><div className="page-heading"><div><div className="eyebrow">可复查记录</div><h1>运行历史</h1><p>选择一次运行，回到工作台查看断言、请求证据与完整事件。</p></div><span className="page-count">{runs.length} 次运行</span></div>{runs.length ? <div className="history-table"><div className="table-head"><span>运行</span><span>入口</span><span>执行方式</span><span>结果</span><span>断言</span><span>耗时</span><span/></div>{runs.map((run) => <button key={run.id} className={`history-row ${selectedId === run.id ? 'selected' : ''}`} onClick={() => select(run)}><span className="history-run"><strong>{run.summary || labels[run.mode]}</strong><small>{dateText(run.startedAt)} · {run.id.slice(0, 10)}</small></span><span>{labels[run.mode]}</span><span>{run.mode === 'deterministic' ? '固定断言 runner' : run.provider === 'offline' ? '离线演示' : '真实模型'}</span><span><i className={`table-status status-${run.status}`}>{statusNames[run.status]}</i></span><span>{run.assertions.filter((a) => a.status === 'passed').length} / {run.assertions.length}</span><span>{duration(run.durationMs)}</span><Icon name="chevron" size={15}/></button>)}</div> : <div className="page-empty"><div className="empty-icon"><Icon name="clock" size={22}/></div><h3>还没有运行记录</h3><p>开始一次测试后，运行状态、断言与证据会保存在这里。</p></div>}</div>;
}

function ProjectProfilesPage({ profiles, scripts, runs, busy, modelAvailable, requirements, setRequirement, createCandidate, generateCandidate, review, runApproved, cancel }: { profiles: ProjectProfile[]; scripts: ProjectScript[]; runs: ProjectRun[]; busy: boolean; modelAvailable: boolean; requirements: Record<string, string>; setRequirement: (id: string, value: string) => void; createCandidate: (profile: ProjectProfile) => void; generateCandidate: (profile: ProjectProfile) => void; review: (script: ProjectScript, decision: 'approve' | 'reject', notes: string) => void; runApproved: (script: ProjectScript) => void; cancel: (run: ProjectRun) => void }) {
  const running = runs.find((run) => run.status === 'queued' || run.status === 'running');
  const statusLabels: Record<ProjectRun['status'], string> = { queued: '排队中', running: '执行中', passed: '通过', failed: '失败', blocked: '已阻塞', cancelled: '已取消', error: '运行错误' };
  const scriptStatus: Record<ProjectScript['status'], string> = { candidate: '待人工审核', approved: '已批准', rejected: '已拒绝' };
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  return <div className="secondary-page project-tests-page">
    <div className="page-heading"><div><div className="eyebrow">持久化脚本生命周期</div><h1>本地项目测试</h1><p>从本机登记的测试套件建立候选快照，经人工审核并批准为不可变版本，再由确定性 runner 重跑。当前候选来自人工维护的 profile 配置，不是 AI 生成。</p></div></div>
    <section className="profile-list" aria-label="已登记项目测试">
      {profiles.map((profile) => <article className="profile-card" key={profile.id}>
        <div className="profile-card-copy"><span className="profile-kicker">登记配置 · {profile.id}</span><h2>{profile.name}</h2><p>{profile.suiteName}</p><small>从本地 profile 捕获现有命令；执行复用现有 Playwright 用例与回环服务，目标源码保持不变。</small>
          <div className="authoring-box"><label htmlFor={`requirement-${profile.id}`}>按需求生成人工审核的测试候选</label><textarea id={`requirement-${profile.id}`} value={requirements[profile.id] ?? ''} maxLength={2000} onChange={(event) => setRequirement(profile.id, event.target.value)} placeholder="例如：数量到达 5 个后，加号应禁用，句子保持复数表达。"/><div><button className="button-primary" disabled={busy || !!running || !modelAvailable || (requirements[profile.id] ?? '').trim().length < 8 || scripts.some((item) => item.profileId === profile.id && item.status === 'candidate')} onClick={() => generateCandidate(profile)}><Icon name="nodes" size={16}/>AI 生成脚本候选</button><span>{modelAvailable ? '受限 DSL · 需人工批准 · 不自动执行' : '需先配置模型 API Key'}</span></div></div>
        </div>
        <div className="profile-actions"><button className="button-secondary" disabled={busy || !!running || scripts.some((item) => item.profileId === profile.id && item.status === 'candidate')} onClick={() => createCandidate(profile)}><Icon name="list" size={16}/>导入现有套件快照</button></div>
      </article>)}
      {!profiles.length && <div className="page-empty"><h3>没有已登记的本地项目测试</h3><p>项目测试只通过 TestPilot 注册配置提供。</p></div>}
    </section>
    <div className="section-title project-run-title"><div><h2>脚本版本与审核</h2><p>每次候选捕获都会保存完整命令快照和 SHA-256 摘要；批准后的版本不能直接改写。</p></div><span className="page-count">{scripts.length} 个版本</span></div>
    {scripts.length ? <div className="project-run-list">{scripts.map((script) => <article className="project-run-card" key={script.id}>
      <header className="project-run-head"><div><span className="profile-kicker">{script.profileId} · {script.createdAt ? dateText(script.createdAt) : '—'}</span><h3>{script.suiteName} · v{script.version}</h3><p>来源：{script.origin === 'ai-requirement-candidate' ? 'AI 需求候选（受限 Playwright DSL）' : '人工维护的注册 profile 快照'} · SHA-256 <code>{script.digest.slice(0, 16)}…</code></p></div><span className={`table-status status-${script.status === 'approved' ? 'passed' : script.status === 'rejected' ? 'failed' : 'running'}`}>{scriptStatus[script.status]}</span></header>
      {script.requirement && <div className="script-diff"><strong>输入需求</strong><p>{script.requirement}</p><small>{script.generationSummary}</small></div>}
      <div className="script-diff"><strong>{script.previousApprovedVersion ? `与批准版本 v${script.previousApprovedVersion} 的差异` : '候选差异'}</strong><ul>{script.diff.map((line, index) => <li key={index}>{line}</li>)}</ul></div>
      <div className="script-command-list">{script.cases.map((item) => <div className="script-command" key={item.id}><strong>{item.title}</strong><code>{item.bin} {item.args.join(' ')}</code><small>预期退出码 {item.expectedExitCode} · 超时 {item.timeoutMs ?? 120000} ms</small></div>)}</div>
      <details className="project-stdout script-sources"><summary>已版本化测试源文件（{script.files.length}）</summary>{script.files.map((file) => <details key={file.path}><summary><code>{file.path}</code></summary><pre>{file.content}</pre></details>)}</details>
      {script.status === 'candidate' && <div className="script-review"><label htmlFor={`review-${script.id}`}>审核备注（可选）</label><textarea id={`review-${script.id}`} value={reviewNotes[script.id] ?? ''} maxLength={2000} onChange={(event) => setReviewNotes((current) => ({ ...current, [script.id]: event.target.value }))} placeholder="记录核对过的需求、命令和预期行为"/><div className="script-review-actions"><button className="button-secondary" onClick={() => review(script, 'reject', reviewNotes[script.id] ?? '')}>拒绝并保留记录</button><button className="button-primary" onClick={() => review(script, 'approve', reviewNotes[script.id] ?? '')}>批准此版本</button></div></div>}
      {script.status !== 'candidate' && <p className="script-review-note">{script.reviewDecision === 'approve' ? '批准' : '拒绝'}于 {dateText(script.reviewedAt)} · {script.reviewerNotes || '没有附加备注'}</p>}
      {script.status === 'approved' && <div className="script-run-action"><button className="button-primary" disabled={busy || !!running} onClick={() => runApproved(script)}><Icon name="pulse" size={16}/>{running ? '运行中…' : '无模型重跑此批准版本'}</button><small>执行的是此版本的保存快照，运行时不调用 AI。</small></div>}
    </article>)}</div> : <div className="page-empty"><h3>尚无已保存脚本版本</h3><p>先建立候选快照。你可以先人工编辑仓库中的注册 profile 配置，再创建下一版本供审核。</p></div>}
    <div className="section-title project-run-title"><div><h2>运行记录</h2><p>每次运行包含退出码、标准输出和保留的测试文件。</p></div><span className="page-count">{runs.length} 次运行</span></div>
    {runs.length ? <div className="project-run-list">{runs.map((run) => {
      const last = run.results.at(-1);
      const stdout = run.results.flatMap((result) => result.evidence.filter((item) => item.kind === 'stdout').map((item) => item.content)).join('\n');
      return <article className="project-run-card" key={run.id}>
        <header className="project-run-head"><div><span className="profile-kicker">{run.profileId}{run.scriptVersion ? ` · 批准脚本 v${run.scriptVersion}` : ''} · {dateText(run.startedAt)}</span><h3>{run.profileName}</h3><p>{run.summary}</p></div><span className={`table-status status-${run.status}`}>{statusLabels[run.status]}</span></header>
        <div className="project-run-meta"><span>耗时 <b>{duration(run.durationMs)}</b></span><span>退出码 <b>{last?.actualExitCode ?? (run.status === 'running' || run.status === 'queued' ? '运行中' : '—')}</b></span><span>用例 <b>{run.results.filter((item) => item.status === 'passed').length}/{run.results.length}</b></span></div>
        {stdout && <details className="project-stdout"><summary>标准输出摘要</summary><pre>{stdout.length > 6000 ? `${stdout.slice(0, 6000)}\n…（已截断）` : stdout}</pre></details>}
        <div className="project-links"><a href={`/api/project-runs/${run.id}/report?format=md`} download>Markdown 报告</a><a href={`/api/project-runs/${run.id}/report?format=json`} download>JSON 报告</a>{run.artifactFiles.map((file) => <a key={file} href={`/api/project-runs/${run.id}/artifacts/${file.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noreferrer">{file}</a>)}{(run.status === 'running' || run.status === 'queued') && <button className="text-button cancel-button" onClick={() => cancel(run)}>停止测试</button>}</div>
      </article>;
    })}</div> : <div className="page-empty"><div className="empty-icon"><Icon name="box" size={22}/></div><h3>还没有项目测试记录</h3><p>启动已登记配置后，结果、标准输出和浏览器截图会显示在这里。</p></div>}
  </div>;
}

function RegressionPage({ checks, busy, rerun }: { checks: DemoCheck[]; busy: boolean; rerun: () => void }) {
  return <div className="secondary-page"><div className="page-heading"><div><div className="eyebrow">持续验证</div><h1>回归用例</h1><p>从失败断言保存检查项，再以相同预期运行验证修复。</p></div><button className="button-primary" onClick={rerun} disabled={busy || checks.length === 0}><Icon name="pulse" size={16}/>{busy ? '提交中…' : '运行全部回归'}</button></div>{checks.length ? <div className="regression-list">{checks.map((check) => <article className="regression-row" key={check.id}><div className="regression-icon"><Icon name="check" size={17}/></div><div className="regression-content"><strong>{check.title}</strong><p>{check.source}</p><div className="regression-route"><code>{check.method}</code><span>{check.path}</span><small>预期状态 {check.expect.status}</small></div></div><span className="saved-label">已保存</span></article>)}</div> : <div className="page-empty"><div className="empty-icon"><Icon name="check" size={22}/></div><h3>还没有回归用例</h3><p>在工作台运行测试后，可将失败断言保存为回归用例。</p></div>}</div>;
}

function ArchitecturePage({ config }: { config: DemoConfig | null }) {
  return <div className="secondary-page architecture-page"><div className="page-heading"><div><div className="eyebrow">运行边界</div><h1>架构说明</h1><p>TestPilot 使用受限工具循环检查本地样本服务，也支持需求文档驱动的 Playwright 浏览器检查。</p></div><span className="mode-pill"><Icon name="nodes" size={15}/>{config?.framework ?? 'Pi'} Agent</span></div><div className="architecture-flow"><div className="arch-node"><span className="arch-node-icon"><Icon name="list"/></span><strong>测试入口</strong><small>固定用例 / 需求 / 探索 / 文档</small></div><span className="flow-arrow"><Icon name="arrow"/></span><div className="arch-node emphasized"><span className="arch-node-icon"><Icon name="nodes"/></span><strong>受限 Agent 循环</strong><small>{config?.framework ?? 'Pi'} · 动作预算控制</small></div><span className="flow-arrow"><Icon name="arrow"/></span><div className="arch-node"><span className="arch-node-icon"><Icon name="box"/></span><strong>样本 API / 浏览器应用</strong><small>受限 API 与只读风险边界</small></div><span className="flow-arrow"><Icon name="arrow"/></span><div className="arch-node"><span className="arch-node-icon"><Icon name="check"/></span><strong>断言与报告</strong><small>事件 / 证据 / 回归 / ZIP</small></div></div><div className="architecture-columns"><section className="architecture-card"><h2>执行模式</h2><div className="arch-mode"><span className="arch-mode-dot unavailable"/><div><strong>固定断言 runner</strong><p>“已有用例”和保存回归逐条执行既定断言，不调用模型，也不使用 Agent 自主判断。</p></div></div><div className="arch-mode"><span className="arch-mode-dot offline"/><div><strong>离线演示</strong><p>样本 API 需求测试与自主探索由脚本决策驱动受限工具循环；文档用例由无模型 Playwright runner 执行。</p></div></div><div className="arch-mode"><span className={`arch-mode-dot ${config?.modelAvailable ? 'online' : 'unavailable'}`}/><div><strong>真实模型</strong><p>{config?.modelAvailable ? `${config.modelLabel} 已配置。模型生成计划并通过受限样本工具检查，也可经 Pi Agent 生成文档独立检查。` : '当前尚未配置可用模型；AI 文档验证会被标记为阻塞，固定用例仍可运行。'}</p></div></div></section><section className="architecture-card"><h2>安全与证据</h2><ul className="architecture-bullets"><li>项目测试仅通过注册配置运行，不提供任意 shell。</li><li>文档测试使用新建浏览器上下文，并禁止提交表单和风险按钮。</li><li>每条浏览器用例都需先编辑并通过人工审核，修改后需重新审核。</li><li>固定用例不调用模型；独立 AI lane 将需求文本发送至配置的模型提供方。</li></ul></section></div><div className="scope-note"><strong>当前浏览器 DSL 边界</strong><p>支持按可访问标签填写与选择、点击经审核的安全非提交控件，以及检查文本、可见性、字段值和禁用状态。此版本不做截图视觉比较、任意 CSS/XPath 定位、文件上传、复杂多页工作流或提交后的服务端状态检查。</p></div></div>;
}

