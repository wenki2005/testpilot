import { useEffect, useRef, useState } from 'react';
import { canSelectCaseForRun } from './case-selection';
import type { RunScopePlan, ApiContract, Project, Run } from './types';
import type { ProjectPlatform as NewProjectPlatform } from './project-platform';
import { request } from './api/client';
import { useDocumentRunExecution } from './hooks/useDocumentRunExecution';
import { useDocumentRunActions } from './hooks/useDocumentRunActions';
import { WorkflowRail } from './components/WorkflowRail';
import { RunResultsPanel } from './components/RunResultsPanel';
import { RunHistoryPanel } from './components/RunHistoryPanel';
import { DocumentChangeImpactPanel } from './components/DocumentChangeImpactPanel';
import { AutonomousRegressionPlans } from './components/AutonomousRegressionPlans';
import { ProjectRevisionPanel } from './components/ProjectRevisionPanel';
import { ApiContractPanel } from './components/ApiContractPanel';
import { DocumentCaseEditorList } from './components/DocumentCaseEditorList';
import { RunConfigurationPanel } from './components/RunConfigurationPanel';
import { DailyRunStartPanel } from './components/DailyRunStartPanel';
import { DailyRunOutcome } from './components/DailyRunOutcome';
import { ProjectPlatformConfirmation, ProjectPlatformPicker } from './components/ProjectPlatformSetup';
import { RunExecutionActions } from './components/RunExecutionActions';
import { PrerequisiteHandoffNotice } from './components/PrerequisiteHandoffNotice';
import { NotificationSettings } from './components/NotificationSettings';
import { CaseMarkdownAssets } from './components/CaseMarkdownAssets';
import { SessionProfiles } from './components/SessionProfiles';
import { SessionOpenControl } from './components/SessionOpenControl';
import { ParallelModuleRuns } from './components/ParallelModuleRuns';
import { RunHandoffNotice } from './components/RunHandoffNotice';
import { useDocumentProjectHistory } from './hooks/useDocumentProjectHistory';
import { useDocumentCaseSelection } from './hooks/useDocumentCaseSelection';
import { useDocumentCaseEditor } from './hooks/useDocumentCaseEditor';
import { useDocumentChangeImpact } from './hooks/useDocumentChangeImpact';
import { useDocumentRunHandoffs } from './hooks/useDocumentRunHandoffs';
import { useDocumentProjectPreparation } from './hooks/useDocumentProjectPreparation';
import { useDocumentProjectSession } from './hooks/useDocumentProjectSession';
import { useDocumentApiSuiteCatalog } from './hooks/useDocumentApiSuiteCatalog';
import { useDocumentProjectMaterials } from './hooks/useDocumentProjectMaterials';
import { useDocumentTestDataSets } from './hooks/useDocumentTestDataSets';
import { useDocumentCaseAuthoringActions } from './hooks/useDocumentCaseAuthoringActions';
import { useDocumentProjectApproval } from './hooks/useDocumentProjectApproval';
import { useDocumentStepProbe } from './hooks/useDocumentStepProbe';
import { normalizedSiteOrigin, parameterInputModels } from './presentation';
import { pauseControlForProgress, visibleHandoffForProgress } from './presentation/handoff-progress-state';

function dependencyPreview(cases: Project['cases'], requestedIds: string[]) {
  const byId = new Map(cases.map(item => [item.id, item]));
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, chain: string[]) => {
    if (visiting.has(id)) throw new Error(`前置依赖循环：${[...chain, id].join(' → ')}`);
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`缺少前置用例 ${id}`);
    if (item.lifecycleStatus === 'draft' || item.lifecycleStatus === 'disabled') throw new Error(`前置用例 ${id} 为草稿或停用状态`);
    visiting.add(id);
    for (const dependency of item.dependsOnCaseIds ?? []) visit(dependency, [...chain, id]);
    visiting.delete(id); visited.add(id); ordered.push(id);
  };
  try {
    for (const id of requestedIds) visit(id, []);
    const roots = new Set(requestedIds);
    return { ordered, prerequisites: ordered.filter(id => !roots.has(id)), error: '' };
  } catch (error) { return { ordered: requestedIds, prerequisites: [] as string[], error: (error as Error).message }; }
}

export default function DocumentTestsPage({ modelAvailable, computerUseAvailable, computerUseReason, computerUseModel, initialProjectId, initialRunId, embedded = false }: { modelAvailable: boolean; computerUseAvailable: boolean; computerUseReason: string; computerUseModel: string; initialProjectId?: string; initialRunId?: string; embedded?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLoadState, setProjectLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [baselineRunId, setBaselineRunId] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [importExpanded, setImportExpanded] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('已核对用例与需求来源，并确认只读检查预期。');
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    if (!embedded && run) window.requestAnimationFrame(() => document.getElementById('doc-results')?.scrollIntoView({ block: 'start' }));
  }, [run?.id, embedded]);
  const [busy, setBusy] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [handoffProgress, setHandoffProgress] = useState<import('./types').RunHandoffProgress>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { activeRunId, setActiveRunId, startRun } = useDocumentRunExecution(setMessage, progress => {
    setHandoffProgress(visibleHandoffForProgress(progress));
    const pauseControl = pauseControlForProgress(progress);
    if (pauseControl !== undefined) setPauseRequested(pauseControl);
  });
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [newProjectPlatform, setNewProjectPlatform] = useState<NewProjectPlatform | ''>('');
  const [runMode, setRunMode] = useState<'regression' | 'compare'>('regression');
  const caseDetailsRef = useRef<HTMLDetailsElement>(null);
  const revealSection = (hash: string) => {
    if(!/^#doc-[A-Za-z-]+$/u.test(hash)) return;
    const target=document.getElementById(hash.slice(1));
    if(!target)return;
    for(let parent:Element|null=target;parent;parent=parent.parentElement) if(parent instanceof HTMLDetailsElement)parent.open=true;
    if(hash==='#doc-cases' && caseDetailsRef.current)caseDetailsRef.current.open=true;
    if(hash==='#doc-execution')target.querySelectorAll<HTMLDetailsElement>('details').forEach(details=>{details.open=true;});
    window.requestAnimationFrame(()=>target.scrollIntoView({block:'start'}));
  };
  useEffect(()=>{
    const reveal=()=>revealSection(window.location.hash);
    window.addEventListener('hashchange',reveal);
    reveal();
    return()=>window.removeEventListener('hashchange',reveal);
  },[selectedId]);
  const openCaseEditor = () => {
    const details = caseDetailsRef.current;
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.requestAnimationFrame(() => {
      [...details.querySelectorAll<HTMLInputElement>('input[placeholder="例如：/apply/orders"]')]
        .find(input => !input.value.trim())
        ?.focus({ preventScroll: true });
    });
  };
  const project = projects.find(item => item.id === selectedId);
  const { loginHandoff, setLoginHandoff, recovery, setRecovery } = useDocumentRunHandoffs(project?.id ?? '', project?.reviewStatus);
  const {
    setSiteVersionId, siteVersionLabel, setSiteVersionLabel,
    siteVersionEnvironment, setSiteVersionEnvironment, siteVersionTargetUrl, setSiteVersionTargetUrl,
    siteVersionChangeNotes, setSiteVersionChangeNotes, impactSelectedCaseIds, setImpactSelectedCaseIds,
    impactReviewNotes, setImpactReviewNotes, selectedSiteVersion, selectedImpactAnalysis,
    registerSiteVersion, analyzeIterationImpact, reviewIterationImpact,
  } = useDocumentChangeImpact({ project, setProjects, setRun, setMessage, setError, setBusy, setTargetUrl });
  const {
    sessionStatus, sessionStatusLoading, sessionStatusError, sessionIdentityDraft, setSessionIdentityDraft,
    sessionIdentitySaving, refreshSessionStatus, saveSessionIdentity,
  } = useDocumentProjectSession({ project, siteVersionId: selectedSiteVersion?.id, setProjects, setError, setMessage });
  const { apiSuites, apiSuiteDetail, apiSuiteLoading, apiSuiteError } = useDocumentApiSuiteCatalog(project);
  const {
    runHistory, historyLoadingId, refreshRunHistory, openHistoricalRun,
    projectRevisions, projectRevisionTotal, projectRevisionKind, setProjectRevisionKind,
    projectRevisionEntity, setProjectRevisionEntity, projectRevisionOffset,
    projectRevisionLoading, projectRevisionError, projectRevisionSnapshots,
    projectRevisionBusyId, refreshProjectRevisions, toggleProjectRevision, restoreProjectStepRevision,
  } = useDocumentProjectHistory({ projectId: project?.id ?? '', run, setRun, setRunMode, setError, setMessage, setProjects });
  const {
    testDataSetId, setTestDataSetId, testDataSetName, setTestDataSetName, selectedTestDataSet, saveTestDataSet, deleteTestDataSet,
  } = useDocumentTestDataSets({ project, selectedProjectId: selectedId, parameterValues, setParameterValues, setProjects, setBusy, setError, setMessage, refreshRevisions: refreshProjectRevisions });
  const {
    projectMaterialFile, setProjectMaterialFile, projectMaterialRole, setProjectMaterialRole,
    replaceProjectMaterialId, setReplaceProjectMaterialId, saveProjectMaterial,
  } = useDocumentProjectMaterials({ project, setProjects, setBusy, setError, setMessage, refreshRevisions: refreshProjectRevisions });
  const {
    selectedModuleKeys, selectedPageRouteKeys, setRunScopePlan,
    impactCandidates, impactCandidateSelection, setImpactCandidateSelection,
    selectedCases, selectedCaseIdSet, selectedCaseCount, runnableCaseCount,
    effectiveScopePlan, moduleOptions, pageEntryOptions,
    unassignedPageCaseCount, selectedPageCaseCount, setCaseSelection,
    toggleModuleSelection, togglePageRouteSelection, applyModuleSelection, applyPageSelection,
    toggleCaseSelection, selectOnlyCase, analyzeRelatedCases, addSelectedImpactCases, clearImpactCases,
  } = useDocumentCaseSelection(project, selectedId, setProjects, setRun, setMessage);
  const runDependencyPreview = dependencyPreview(project?.cases ?? [], selectedCases.map(item => item.id));
  const {
    editCase, editCaseList, setTestDataRequirements, setCaseLifecycleStatus, confirmCasePreconditions,
    updateCaseSteps, changeStep, addStep, removeStep, moveStep, editSteps, addCase, insertCase, moveCase, editorNotice, removeCase,
  } = useDocumentCaseEditor(project, setProjects, setRun, setStepDrafts);
  const blockedStepCaseIds = project?.stepAuthoring?.results.filter(item => item.status === 'blocked').map(item => item.caseId) ?? [];
  const { results: stepProbeResults, setResults: setStepProbeResults, busyKey: stepProbeBusyKey, probe: probeSavedStep } = useDocumentStepProbe({
    project,
    ...(selectedSiteVersion?.id ? { siteVersionId: selectedSiteVersion.id } : {}),
    setError,
  });
  const { saveDraft, createIterationCaseDraft, generateCases, repairBlockedCases } = useDocumentCaseAuthoringActions({
    project, targetUrl, blockedCaseIds: blockedStepCaseIds, setProjects, setStepDrafts, setStepProbeResults, setRun,
    setBusy, setError, setMessage, refreshProjectRevisions,
  });  const { approve } = useDocumentProjectApproval({
    project, targetUrl, notes, runMode, effectiveScopePlan,
    ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}), baselineRunId,
    ...(testDataSetId ? { testDataSetId } : {}), parameterValues,
    setProjects, setStepProbeResults, setRun, setRunMode, setBusy, setError, setMessage,
    setActiveRunId, setCancelRequested, startRun, refreshRunHistory,
  });
  useEffect(() => {
    if (!project) return;
    const sectionId = window.location.hash.slice(1);
    if (!['doc-session', 'doc-version', 'doc-impact', 'doc-revisions', 'doc-cases', 'doc-execution', 'doc-run-history', 'doc-results'].includes(sectionId)) return;
    document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
  }, [project?.id]);
  const selectedBaselineRun = runHistory.find(item => item.id === baselineRunId);
  const baselineEnvironmentReview = selectedBaselineRun
    ? !selectedSiteVersion?.environment.trim() || !selectedBaselineRun.siteVersionSnapshot?.environment.trim()
      || !normalizedSiteOrigin(selectedSiteVersion.targetUrl) || !normalizedSiteOrigin(selectedBaselineRun.siteVersionSnapshot?.targetUrl)
      ? 'unknown'
      : selectedSiteVersion.environment.trim().toLocaleLowerCase() === selectedBaselineRun.siteVersionSnapshot.environment.trim().toLocaleLowerCase()
        && normalizedSiteOrigin(selectedSiteVersion.targetUrl) === normalizedSiteOrigin(selectedBaselineRun.siteVersionSnapshot.targetUrl) ? 'same' : 'different'
    : undefined;
  const baselineRunModeReview = selectedBaselineRun
    ? !runMode || !selectedBaselineRun.runMode ? 'unknown' : runMode === selectedBaselineRun.runMode ? 'same' : 'different'
    : undefined;
  const runParameterCases = project?.cases.filter(item => runDependencyPreview.ordered.includes(item.id)) ?? selectedCases;
  const dataParameterInputs = parameterInputModels(runParameterCases);
  const stepsReady = selectedCases.length > 0 && selectedCases.every(item => item.steps?.length > 0);
  const safetyReviewCount = project?.cases.filter(item => (item.sideEffectRisk ?? 'unknown') !== 'none' || ((item.preconditions?.length ?? 0) > 0 && item.preconditionsConfirmed !== true)).length ?? 0;
  const lowConfidenceCount = project?.cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false && item.confidence === 'low').length ?? 0;
  const executeState = run ? 'done' : project?.generationWarning ? 'warning' : project?.reviewStatus === 'approved' ? 'current' : project?.confirmationRequired ? 'waiting' : 'waiting';
  const compareState = !run ? 'waiting' : run.finalReady ? 'done' : 'warning';
  const reportState = !run ? 'waiting' : run.finalReady ? 'done' : (run.reportReady || run.report) ? 'warning' : 'waiting';
  const retestCaseIds = run ? [...new Set([
    ...(run.diagnostics?.filter(item => item.classification === 'mismatch' || item.classification === 'unverified').map(item => item.caseId) ?? []),
    ...run.comparisons.filter(item => /failed|失败/iu.test(`${item.deterministic} ${item.computerUse}`)).map(item => item.id),
  ])] : [];

  const refresh = async (preferred?: string) => {
    const rows = await request<Project[]>('/api/document-projects'); setProjects(rows);
    const id = preferred ?? (selectedId || rows[0]?.id || '');
    if (id) { setSelectedId(id); const next = rows.find(item => item.id === id); if (next) setTargetUrl(next.targetUrl); }
  };
  const importFile = useDocumentProjectPreparation({ setBusy, setError, setMessage, refresh, setStepDrafts, setRun });
  useEffect(() => {
    let active = true;
    setProjectLoadState('loading');
    void (async () => {
      try {
        await refresh(initialProjectId);
        if (active) setProjectLoadState('ready');
        if (!active || !initialRunId) return;
        const savedRun = await request<Run>(`/api/document-runs/${encodeURIComponent(initialRunId)}`);
        if (!active || (savedRun.projectId && initialProjectId && savedRun.projectId !== initialProjectId)) return;
        setRun(savedRun);
        setRunMode(savedRun.runMode ?? 'compare');
        setMessage(savedRun.runMode === 'regression' ? `已打开常规回归结果：${savedRun.overall}。报告和脚本包可下载。` : '已打开本轮 AI 辅助对照结果；报告和脚本包可下载。');
      } catch (e) { if (active) { setProjectLoadState('error'); setError((e as Error).message); } }
    })();
    return () => { active = false; };
  }, [initialProjectId, initialRunId]);

  useEffect(() => {
    const activeVersion = project?.siteVersions?.find(item => item.id === project.activeSiteVersionId) ?? project?.siteVersions?.at(-1);
    setSiteVersionId(activeVersion?.id ?? '');
    setSiteVersionTargetUrl(activeVersion?.targetUrl ?? project?.targetUrl ?? '');
    setSiteVersionLabel('');
    setSiteVersionEnvironment('主环境');
    setSiteVersionChangeNotes('');
  }, [selectedId]);
  useEffect(() => { setBaselineRunId(''); }, [project?.id]);

  const addAcceptedImpactToRun = () => {
    if (!project || selectedImpactAnalysis?.status !== 'accepted') return;
    const acceptedIds = new Set((selectedImpactAnalysis.selectedCaseIds ?? []).filter(id => project.cases.some(item => item.id === id && canSelectCaseForRun(item))));
    if (!acceptedIds.size) return;
    const hasDirectTarget = effectiveScopePlan.targetCaseIds.length > 0;
    const targetCaseIds = [...effectiveScopePlan.targetCaseIds];
    const impactCaseIds = [...new Set([...effectiveScopePlan.impactCaseIds, ...acceptedIds])]
      .filter(id => !targetCaseIds.includes(id));
    const included = new Set([...targetCaseIds, ...impactCaseIds]);
    const cases = project.cases.map(item => canSelectCaseForRun(item) ? { ...item, selectedForRegression: included.has(item.id) } : item);
    const mode: RunScopePlan['mode'] = impactCaseIds.length ? 'impact'
      : !hasDirectTarget ? targetCaseIds.length === 1 ? 'single' : 'feature'
        : effectiveScopePlan.mode;
    setProjects(rows => rows.map(item => item.id === project.id ? { ...item, cases } : item));
    const iterationReasons = Object.fromEntries(impactCaseIds.filter(id => acceptedIds.has(id)).map(id => {
      const suggestion = selectedImpactAnalysis.suggestions.find(item => item.caseId === id);
      const reasons = suggestion
        ? [`迭代说明匹配词：${suggestion.matchedTerms.join('、').slice(0, 280) || '未提供'}`, ...suggestion.evidence.slice(0, 8).map(reason => reason.slice(0, 280))].slice(0, 10)
        : [`人工审核确认：网站版本「${selectedImpactAnalysis.siteVersionLabel}」的迭代影响用例`];
      return [id, reasons] as const;
    }));
    const impactReasons = { ...effectiveScopePlan.impactReasons, ...iterationReasons };
    setRunScopePlan({ mode, targetCaseIds, impactCaseIds, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) });
    setRun(null);
    const newlyAddedImpacts = impactCaseIds.filter(id => !effectiveScopePlan.impactCaseIds.includes(id)).length;
    const alreadyDirect = [...acceptedIds].some(id => targetCaseIds.includes(id));
    const alreadyImpact = [...acceptedIds].some(id => impactCaseIds.includes(id));
    setMessage(newlyAddedImpacts
      ? `已把 ${newlyAddedImpacts} 条迭代影响用例加入关联影响检查；与直接目标分别留档。`
      : alreadyDirect && !alreadyImpact
        ? '已确认用例已包含在当前直接目标中，没有重复添加；如需单独检查影响，请先缩小直接目标范围。'
        : alreadyImpact
          ? '经确认的迭代影响用例已在本轮关联影响检查中。'
          : hasDirectTarget
            ? '已确认影响范围；当前选择已包含这些用例。'
            : `已把 ${acceptedIds.size} 条经迭代说明确认的用例加入纯影响检查；请检查范围后手动启动测试。`);
  };
  const updateApiContract = (apiContract: ApiContract) => {
    if (!project) return;
    setProjects(rows => rows.map(item => item.id === project.id ? { ...item, apiContract, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const chooseApiSuite = (suiteId: string) => {
    updateApiContract({ ...(suiteId ? { suiteId } : {}), mappings: [], allowNetwork: false, allowMutations: false, allowConcurrency: false });
  };
  const setApiMapping = (documentCaseId: string, apiCaseId: string, checked: boolean) => {
    if (!project) return;
    const mappings = (project.apiContract?.mappings ?? []).map(item => ({ ...item, apiCaseIds: [...item.apiCaseIds] }));
    let mapping = mappings.find(item => item.documentCaseId === documentCaseId);
    if (!mapping && checked) { mapping = { documentCaseId, apiCaseIds: [] }; mappings.push(mapping); }
    if (!mapping) return;
    mapping.apiCaseIds = checked ? [...new Set([...mapping.apiCaseIds, apiCaseId])] : mapping.apiCaseIds.filter(id => id !== apiCaseId);
    updateApiContract({ ...project.apiContract, mappings: mappings.filter(item => item.apiCaseIds.length > 0), allowNetwork: project.apiContract?.allowNetwork === true, allowMutations: project.apiContract?.allowMutations === true, allowConcurrency: project.apiContract?.allowConcurrency === true });
  };
  const { retryCheckpoint, execute, retestUnresolved, resumeInterrupted, finalizeInterruptedPackage, cancelRun, pauseRun, continuePausedRun, continueAfterLogin } = useDocumentRunActions({
    project, run, recovery, retestCaseIds, selectedCaseIds: selectedCases.map(item => item.id), runMode, effectiveScopePlan,
    ...(selectedSiteVersion ? { selectedSiteVersionId: selectedSiteVersion.id } : {}), baselineRunId,
    ...(testDataSetId ? { testDataSetId } : {}), parameterValues, activeRunId, cancelRequested, pauseRequested,
    setRun, setBusy, setError, setMessage, setRunMode, setActiveRunId, setCancelRequested, setPauseRequested, setRecovery, setLoginHandoff,
    startRun, refreshRunHistory,
  });
  const runSingleCase = async (caseId: string) => {
    if (!project) return;
    if (project.reviewStatus !== 'approved') {
      setError('此用例尚未通过项目审核。请先保存并审核用例，再运行；系统不会绕过现有审核门。');
      return;
    }
    if (project.cases.find(item => item.id === caseId)?.selectedForRegression === false) {
      setError('此用例未包含在已审核的可运行范围中。请先调整所选范围并重新审核后运行。');
      return;
    }
    if (runMode === 'compare' && !computerUseAvailable) {
      setError(computerUseReason || '当前视觉对照运行不可用。');
      return;
    }
    setBusy(true); setError(''); setMessage(`正在准备单条用例 ${caseId} 及其显式前置依赖…`);
    try {
      const result = await startRun(project.id, {
        runMode, selectedCaseIds: [caseId], scopePlan: { mode: 'single', targetCaseIds: [caseId], impactCaseIds: [] },
        ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}),
        ...(baselineRunId ? { baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues,
      });
      setRun(result); refreshRunHistory(project.id);
      const outcomeLabel = result.overall === 'passed' ? '通过'
        : result.overall === 'failed' ? '失败'
          : result.overall === 'cancelled' ? '已取消'
            : result.overall === 'blocked' ? '阻塞' : '存在未验证项';
      setMessage(`单条用例结束：${caseId} · ${outcomeLabel}。自动补入的前置已在报告中独立列出。`);
    } catch (error) { setError((error as Error).message); setMessage(''); }
    finally { setBusy(false); setActiveRunId(''); }
  };
  const runDailyModule = async (targetCaseIds: string[], moduleLabel: string, handoffAfterPrerequisites = false) => {
    if (!project || !targetCaseIds.length) return;
    if (project.platform?.status !== 'confirmed' || project.platform.type === 'unknown') { setError('请先确认项目实际运行端类型，再启动回归。'); return; }
    if (project.reviewStatus !== 'approved') { setError('项目尚未通过审核；先核对用例和执行入口，再审核后运行。'); return; }
    const notApproved = targetCaseIds.filter(id => project.cases.find(item => item.id === id)?.selectedForRegression === false);
    if (notApproved.length) { setError(`所选模块中有用例尚未纳入已审核范围：${notApproved.join('、')}。请复核并重新审核。`); return; }
    const dependency = dependencyPreview(project.cases, targetCaseIds);
    if (dependency.error) { setError(dependency.error); return; }
    setBusy(true); setError(''); setMessage(`正在启动模块“${moduleLabel}”的常规回归；直接目标 ${targetCaseIds.length} 条，自动前置 ${dependency.prerequisites.length} 条…`);
    try {
      const scopePlan: RunScopePlan = { mode: targetCaseIds.length === 1 ? 'single' : 'feature', targetCaseIds, impactCaseIds: [], ...(handoffAfterPrerequisites ? { handoffAfterPrerequisites: true } : {}) };
      const result = await startRun(project.id, {
        runMode: 'regression', selectedCaseIds: targetCaseIds, scopePlan,
        ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}),
        ...(baselineRunId ? { baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues,
      });
      setRun(result); setRunMode('regression'); refreshRunHistory(project.id);
      setMessage(result.overall === 'passed' ? `模块“${moduleLabel}”回归完成：通过。` : `模块“${moduleLabel}”回归完成：${result.overall}。失败、阻碍与未执行情况已分别记录。`);
    } catch (error) { setError((error as Error).message); setMessage(''); }
    finally { setBusy(false); setActiveRunId(''); }
  };
  return <div className={`secondary-page doc-tests-page ${embedded ? 'doc-tests-embedded' : ''}`} onClick={event=>{
    const anchor=(event.target as Element).closest('a[href^="#doc-"]');
    if(anchor)revealSection(anchor.getAttribute('href') ?? '');
  }}>
    {!embedded && <div className="page-heading"><div><h1>运行测试</h1><p>选模块、开始测试，然后查看结果。</p></div></div>}
    {projectLoadState === 'loading' && <p role="status">正在读取项目与可运行模块…</p>}
    {projectLoadState === 'error' && <button className="button-secondary" onClick={() => window.location.reload()}>重新读取项目</button>}
    {error && <div className="doc-notice error">{error}</div>}{message && <div className="doc-notice">{message}</div>}
    <PrerequisiteHandoffNotice handoff={handoffProgress} />
    <RunHandoffNotice recovery={recovery && (embedded || recovery.isRunning || recovery.canResume || recovery.canFinalizePackage) ? recovery : null} loginHandoff={loginHandoff} busy={busy} resume={resumeInterrupted} finalizePackage={finalizeInterruptedPackage} continueAfterLogin={continueAfterLogin} />
    {!embedded && projects.length > 0 && <section className="daily-project" aria-label="当前测试项目"><div><small>当前项目</small><strong>{project?.name ?? '请选择项目'}</strong></div><details open={!project || undefined}><summary>切换项目</summary><label>项目<select aria-label="切换测试项目" value={selectedId} disabled={busy || !!activeRunId} onChange={e => { setSelectedId(e.target.value); const item = projects.find(row => row.id === e.target.value); if (item) setTargetUrl(item.targetUrl); setRun(null); }}><option value="">选择项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></details></section>}
    {project && <nav className="doc-project-nav" aria-label="测试项目分区">
      {!embedded && <a href="#doc-daily-start">开始测试</a>}
      {run && <a href="#doc-results">本轮结果</a>}
      <a href="#doc-run-history">历史记录</a>
      <a href="#doc-management">管理与设置</a>
    </nav>}
    {!embedded && project && <ProjectPlatformConfirmation project={project} onSaved={updated => { setProjects(rows => rows.map(item => item.id === updated.id ? updated : item)); setError(''); setMessage('项目端类型与执行模板已保存；请按该端复核入口和用例，再重新审核。'); }} onError={setError} />}
    {!embedded && project && <DailyRunStartPanel project={project} modules={moduleOptions} busy={busy || !!activeRunId} modelAvailable={modelAvailable} activeSiteVersionId={selectedSiteVersion?.id} testDataSetId={testDataSetId} parameterValues={parameterValues} selectedTestDataSet={selectedTestDataSet} onSelectDataSet={id => { const item = project.testDataSets?.find(row => row.id === id); setTestDataSetId(id); setTestDataSetName(item?.name ?? ''); setParameterValues(item?.values ?? {}); }} onProfileChanged={async () => { await refresh(project.id); await refreshSessionStatus(project.id, selectedSiteVersion?.id); }} onStart={(ids, label, handoff) => { void runDailyModule(ids, label, handoff); }} />}
    {!embedded && busy && activeRunId && <section className="daily-running" role="status"><div><strong>{pauseRequested ? '测试已请求暂停' : '正在执行测试，请稍候'}</strong><p>{cancelRequested ? '正在停止，已完成结果会保留。' : '完成后会在下方显示结果。需要接手时可暂停。'}</p></div><div><button className="button-secondary" disabled={cancelRequested} onClick={() => void (pauseRequested ? continuePausedRun() : pauseRun())}>{pauseRequested ? '继续测试' : '暂停'}</button><button className="button-secondary" disabled={cancelRequested} onClick={() => void cancelRun()}>{cancelRequested ? '正在停止…' : '停止'}</button></div></section>}
    <details className="daily-management" id="doc-management" hidden={projectLoadState !== 'ready'} open={embedded || !project || undefined}><summary>管理与设置 <span>用例、数据、版本、通知和自定义运行</span></summary>
    {!embedded && recovery && !recovery.isRunning && !recovery.canResume && !recovery.canFinalizePackage && <details className="daily-old-recovery"><summary>历史中断记录（不影响新测试）</summary><RunHandoffNotice recovery={recovery} loginHandoff={null} busy={busy} resume={resumeInterrupted} finalizePackage={finalizeInterruptedPackage} continueAfterLogin={continueAfterLogin} /></details>}
    {!embedded && <section className={project && !importExpanded ? 'doc-import-card doc-import-card-collapsed' : 'doc-import-card'}><h2>{project ? <button type="button" className="doc-import-toggle" aria-expanded={importExpanded} onClick={() => setImportExpanded(value => !value)}>首次接入 · 新建项目 <span>{importExpanded ? '收起' : '展开'}</span></button> : '1 · 首次接入与项目建立'}</h2><div className="doc-import-grid"><label>项目名称<input value={name} onChange={e => setName(e.target.value)} placeholder="例如：部门申样书" /></label><label>目标应用入口<input value={targetUrl} onChange={e => { setTargetUrl(e.target.value); if (project && !(project.siteVersions?.length)) setProjects(rows => rows.map(item => item.id === project.id ? { ...item, reviewStatus: 'draft' } : item)); }} placeholder="https://example.com/" /><small>仅作为项目入口保存；创建项目不会自动打开或登录网站。</small></label><ProjectPlatformPicker value={newProjectPlatform} onChange={setNewProjectPlatform} /><label className="doc-file-field">需求文档<input type="file" accept=".pdf,.xmind,.md,.markdown,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} /><small>支持 PDF、XMind、Markdown、TXT，最大 9 MB。扫描版 PDF 暂不支持 OCR。</small></label><label className="review-policy"><input type="checkbox" checked={confirmBeforeRun} onChange={e => setConfirmBeforeRun(e.target.checked)} /><span>运行前需要我确认</span></label><button className="button-primary" disabled={busy || !file || !newProjectPlatform} onClick={() => void importFile({ file, targetUrl, name, requireConfirmation: confirmBeforeRun, platform: newProjectPlatform || undefined })}>{busy ? '处理中…' : '创建并准备项目'}</button></div></section>}


    {project && <>
      <details className="doc-session-disclosure" id="doc-session" open={sessionStatus?.manualLoginRequired === true || !!sessionStatus?.occupied || !!recovery?.isRunning}>
        <summary>项目 Edge 登录会话 <span>{sessionStatus?.state === 'connected' ? '已连接' : sessionStatus?.state === 'unavailable' ? '未连接' : '状态待确认'}</span></summary>
        <section className="doc-site-version-card doc-project-session-card">
        <div className="doc-section-head"><div><h2>项目 Edge 登录会话</h2><p>复用已有 Edge 登录态；不会打开或关闭浏览器。</p></div><span className={`table-status ${activeRunId || recovery?.isRunning || sessionStatus?.occupied ? 'status-running' : sessionStatus?.state === 'connected' ? 'status-passed' : 'status-running'}`}>{activeRunId || recovery?.isRunning || sessionStatus?.occupied ? '当前运行占用中' : sessionStatus?.state === 'connected' ? 'Edge 会话已连接' : sessionStatus?.state === 'unavailable' ? '未检测到可复用会话' : sessionStatus?.state === 'unknown' ? '登录状态待确认' : '正在检查会话'}</span></div>
        <div className="doc-site-version-meta">
          <div><strong>人工登录</strong><span>{activeRunId || recovery?.isRunning || sessionStatus?.occupied ? (sessionStatus?.manualLoginRequired === true ? '当前运行正在等待人工登录' : '浏览器会话正被占用') : sessionStatus?.manualLoginRequired === true ? '检测到登录页，需要人工登录' : sessionStatus?.manualLoginRequired === false ? '未检测到登录页；账号权限仍以实际运行结果为准' : '暂时无法判断，运行时会再次检查'}</span></div>
          <div><strong>身份/角色</strong><span>{project.sessionIdentityNote ? `人工确认备注：${project.sessionIdentityNote}` : '尚未填写人工确认备注'}</span></div>
          <small>{sessionStatusError || sessionStatus?.message || '正在读取现有 Edge 会话状态…'}{sessionStatus?.checkedAt ? ` · 检查时间：${new Date(sessionStatus.checkedAt).toLocaleString()}` : ''}</small>
        </div>
        <label className="doc-session-identity">身份备注<input aria-label="当前身份或角色备注" value={sessionIdentityDraft} maxLength={160} onChange={event => setSessionIdentityDraft(event.target.value)} placeholder="例如：QA 测试账号 · 只读审核员" /><small>请勿填写密码、令牌或 Cookie。</small></label>
        <ParallelModuleRuns key={`${project.id}:${selectedSiteVersion?.id ?? "default"}`} project={project} siteVersionId={selectedSiteVersion?.id} disabled={busy || !!activeRunId || !!recovery?.isRunning || !!sessionStatus?.occupied} />
        <SessionOpenControl key={`${project.id}:${selectedSiteVersion?.id ?? "default"}:${project.activeSessionProfileId ?? "default-profile"}`} projectId={project.id} profileId={project.activeSessionProfileId ?? null} siteVersionId={selectedSiteVersion?.id} disabled={busy || !!activeRunId || !!recovery?.isRunning || !!sessionStatus?.occupied} onReady={() => { void refreshSessionStatus(project.id, selectedSiteVersion?.id); }} />
        <SessionProfiles key={project.id} projectId={project.id} disabled={busy || !!activeRunId || !!recovery?.isRunning || !!sessionStatus?.occupied} onChanged={async () => { await refresh(project.id); await refreshSessionStatus(project.id, selectedSiteVersion?.id); }} />
        <div className="doc-buttons"><button className="button-secondary" disabled={sessionIdentitySaving} onClick={saveSessionIdentity}>{sessionIdentitySaving ? '正在保存…' : '保存身份备注'}</button><button className="button-secondary" disabled={sessionStatusLoading} onClick={() => void refreshSessionStatus()}>{sessionStatusLoading ? '正在检查…' : '刷新会话状态'}</button></div>
      </section>
      </details>
      <details className="doc-daily-advanced"><summary>版本、资料与变更规划</summary>
      <DocumentChangeImpactPanel
        project={project}
        busy={busy}
        version={{ selected: selectedSiteVersion, setSelectedId: setSiteVersionId, label: siteVersionLabel, setLabel: setSiteVersionLabel, environment: siteVersionEnvironment, setEnvironment: setSiteVersionEnvironment, targetUrl: siteVersionTargetUrl, setTargetUrl: setSiteVersionTargetUrl, changeNotes: siteVersionChangeNotes, setChangeNotes: setSiteVersionChangeNotes }}
        impact={{ selected: selectedImpactAnalysis, selectedCaseIds: impactSelectedCaseIds, setSelectedCaseIds: setImpactSelectedCaseIds, reviewNotes: impactReviewNotes, setReviewNotes: setImpactReviewNotes }}
        actions={{ registerSiteVersion, analyzeIterationImpact, createIterationCaseDraft: () => createIterationCaseDraft(selectedSiteVersion), reviewIterationImpact, addAcceptedImpactToRun }}
        onSelectVersion={version => { setSiteVersionId(version?.id ?? ''); if (version) { setTargetUrl(version.targetUrl); setSiteVersionTargetUrl(version.targetUrl); } setRun(null); }}
      />
      <AutonomousRegressionPlans key={`${project.id}:${selectedSiteVersion?.id ?? 'none'}`} project={project} version={selectedSiteVersion} />
      <ProjectRevisionPanel
        project={project}
        busy={busy}
        materials={{
          file: projectMaterialFile, setFile: setProjectMaterialFile,
          role: projectMaterialRole, setRole: setProjectMaterialRole,
          replacementId: replaceProjectMaterialId, setReplacementId: setReplaceProjectMaterialId,
          save: saveProjectMaterial,
        }}
        revisions={{
          total: projectRevisionTotal, kind: projectRevisionKind, setKind: setProjectRevisionKind,
          entity: projectRevisionEntity, setEntity: setProjectRevisionEntity,
          offset: projectRevisionOffset, loading: projectRevisionLoading, error: projectRevisionError,
          items: projectRevisions, snapshots: projectRevisionSnapshots, busyId: projectRevisionBusyId,
          toggle: toggleProjectRevision,
          restoreSteps: restoreProjectStepRevision,
          loadMore: offset => refreshProjectRevisions(project.id, offset, true),
        }}
      />
      </details>
      {embedded && <WorkflowRail stages={[
        { label: '读取资料与搜索', state: 'done' },
        { label: '生成用例与步骤', state: project.generationWarning ? 'warning' : stepsReady ? 'done' : 'current' },
        { label: '人工启动回归', state: executeState },
        { label: '查看运行结果', state: compareState },
        { label: '报告与脚本包', state: reportState },
      ]} />}
      <section className="doc-cases-card" id="doc-cases"><div className="doc-section-head"><div><h2>测试用例</h2><p>{project.cases.length} 条 · 已选 {selectedCaseCount} 条</p></div><div className="doc-buttons">{blockedStepCaseIds.length > 0 && <button className="button-secondary" disabled={busy || !modelAvailable} title={!modelAvailable ? '请先配置模型 API Key' : '将逐条失败原因反馈给 Agent，限次修订步骤并重新校验；不会运行测试'} onClick={repairBlockedCases}>{busy ? 'Agent 复查中…' : `Agent 复查阻塞项（${blockedStepCaseIds.length}）`}</button>}{project.caseMode !== 'existing' && <button className="button-secondary" disabled={busy || !modelAvailable} title={!modelAvailable ? '请先配置模型 API Key' : '会读取目标页当前可见文字和控件作为探索证据；不会自动登录或触发页面操作'} onClick={generateCases}>重新生成用例</button>}<span className={`table-status status-${project.reviewStatus === 'approved' ? 'passed' : 'running'}`}>{project.reviewStatus === 'approved' ? (project.confirmationRequired ? '已确认' : '已准备') : project.generationWarning ? '需处理' : project.confirmationRequired ? '待你确认' : '准备中'}</span></div></div>
        {project.generationWarning && <div className="doc-notice error">{project.generationWarning.includes('条用例没有形成可执行步骤：') ? '部分用例尚未形成可执行步骤；具体原因见各条用例下方的“步骤状态”，可尝试让 Agent 复查阻塞项。' : project.generationWarning}</div>}
        {safetyReviewCount > 0 && <div className="doc-notice">{safetyReviewCount} 条用例需确认只读和前置条件；未知或有副作用的用例会阻止运行。</div>}
        {lowConfidenceCount > 0 && <div className="doc-notice">有 {lowConfidenceCount} 条入选用例的预期置信度为低；请先补充可判定的验收标准，或复核后再批准执行。</div>}
        <CaseMarkdownAssets key={project.id} projectId={project.id} onImported={() => { void refresh(project.id); setRun(null); setMessage("Markdown 用例已导入，项目需要重新审核。"); }} />
        <ApiContractPanel
          project={project}
          busy={busy}
          loading={apiSuiteLoading}
          error={apiSuiteError}
          suites={apiSuites}
          detail={apiSuiteDetail}
          onChooseSuite={chooseApiSuite}
          onUpdateContract={updateApiContract}
          onSetMapping={setApiMapping}
          onSave={saveDraft}
        />
        <div className="doc-regression-toolbar"><span>本轮执行 {selectedCaseCount}/{runnableCaseCount} 条可运行用例</span><button className="text-button" onClick={() => setCaseSelection(() => true, 'full')}>全量回归</button><button className="text-button" onClick={() => setCaseSelection(item => item.priority === 'P0' || item.priority === 'P1')}>只选 P0/P1</button><button className="text-button" onClick={() => setCaseSelection(() => false)}>清空选择</button>
          {moduleOptions.length > 0 && <details className="doc-module-picker" open><summary>按模块选择</summary><div className="doc-module-picker-list">{moduleOptions.map(([key, path]) => {
            const matches = project.cases.filter(item => key === '__unassigned__'
              ? !(item.modulePath?.filter(Boolean).length)
              : (item.modulePath ?? []).some((_segment, index) => JSON.stringify(item.modulePath!.slice(0, index + 1)) === key));
            return <label key={key} style={{ paddingInlineStart: `${(path.length - 1) * 18}px` }}><input type="checkbox" checked={selectedModuleKeys.includes(key)} onChange={event => toggleModuleSelection(key, event.target.checked)} /><span>{path.at(-1)} <small>{path.join(' / ')}</small><span className="doc-module-count">{matches.filter(canSelectCaseForRun).length} 条可运行 / 共 {matches.length} 条</span></span></label>;
          })}</div><button className="button-secondary" disabled={!selectedModuleKeys.length} onClick={applyModuleSelection}>应用模块范围（{selectedModuleKeys.length}）</button></details>}
          <details className="doc-module-picker doc-page-picker"><summary>按页面入口选择{pageEntryOptions.length ? ` · ${pageEntryOptions.length} 个页面` : ' · 尚未标注'}</summary>{pageEntryOptions.length ? <div className="doc-module-picker-list">{pageEntryOptions.map(option => <label key={option.route}><input type="checkbox" checked={selectedPageRouteKeys.includes(option.route)} disabled={option.runnableCount === 0} onChange={event => togglePageRouteSelection(option.route, event.target.checked)} /><span>{option.route}<small>{option.runnableCount} 条可运行 · 共 {option.totalCount} 条；query 参数不同的入口按同一路由归组</small></span></label>)}</div> : <div className="doc-page-picker-empty"><p className="doc-page-picker-hint">当前项目还没有标注页面入口。补充入口并重新审核后，即可按页面单独运行；未标注用例不会自动混入该范围。</p><button className="button-secondary" onClick={openCaseEditor}>补充页面入口</button></div>}{pageEntryOptions.length > 0 && unassignedPageCaseCount > 0 && <div className="doc-page-picker-unassigned"><small className="doc-page-picker-hint">另有 {unassignedPageCaseCount} 条可运行用例未标注页面入口；应用页面范围时不会自动纳入。</small><button className="text-button" onClick={openCaseEditor}>补充入口</button></div>}<button className="button-secondary" disabled={!selectedPageRouteKeys.length || selectedPageCaseCount === 0} onClick={applyPageSelection}>应用页面范围（{selectedPageCaseCount}）</button></details>
        </div>
        <section className="doc-scope-panel" aria-label="本轮回归范围">
          <div className="doc-scope-summary"><div><strong>{effectiveScopePlan.mode === 'single' ? '单项测试' : effectiveScopePlan.mode === 'feature' ? '功能范围' : effectiveScopePlan.mode === 'impact' ? effectiveScopePlan.targetCaseIds.length ? '功能与影响检查' : '纯影响检查' : effectiveScopePlan.mode === 'full' ? '全量回归' : '自定义范围'}</strong><span>直接目标 {effectiveScopePlan.targetCaseIds.length} 条 · 关联影响 {effectiveScopePlan.impactCaseIds.length} 条 · 自动前置 {runDependencyPreview.prerequisites.length} 条 · 本轮合计 {runDependencyPreview.ordered.length} 条</span>{runDependencyPreview.error ? <small className="doc-evidence-unavailable">前置计划错误：{runDependencyPreview.error}</small> : runDependencyPreview.prerequisites.length > 0 ? <small>执行顺序：{runDependencyPreview.ordered.join(' → ')}</small> : null}</div><div className="doc-scope-actions"><button className="button-secondary" onClick={openCaseEditor}>选择具体用例</button><button className="button-secondary" disabled={!effectiveScopePlan.targetCaseIds.length || !project.cases.some(item => canSelectCaseForRun(item) && !selectedCaseIdSet.has(item.id))} onClick={analyzeRelatedCases}>识别关联影响</button>{effectiveScopePlan.impactCaseIds.length > 0 && <button className="text-button" onClick={clearImpactCases}>移除关联用例</button>}</div></div>
          {impactCandidates.length > 0 && <div className="doc-impact-candidate-panel"><header><strong>关联候选 · {impactCandidates.length} 条</strong><span>依据用例资料中的显式关系生成，逐条勾选后才会运行。</span></header><div className="doc-impact-candidates">{impactCandidates.map(candidate => <label key={candidate.caseId}><input type="checkbox" checked={impactCandidateSelection.includes(candidate.caseId)} onChange={event => setImpactCandidateSelection(current => event.target.checked ? [...new Set([...current, candidate.caseId])] : current.filter(id => id !== candidate.caseId))} /><span><strong>{candidate.title} · {candidate.caseId}</strong><small>{candidate.reasons.join('；')}</small></span></label>)}</div><button className="button-secondary" disabled={!impactCandidateSelection.length} onClick={addSelectedImpactCases}>加入本轮影响检查（{impactCandidateSelection.length}）</button></div>}
        </section>
        <details className="doc-case-details" ref={caseDetailsRef}><summary>查看或修改 {project.cases.length} 条用例</summary>
          {project.workflowPlan?.length ? <details className="agent-plan"><summary>资料来源与规划记录</summary><ol>{project.workflowPlan.map(item => <li key={item}>{item}</li>)}</ol><div className="agent-source-list">{(project.sourceFiles ?? [project.fileName]).map(item => <span key={item}>本地资料：{item}</span>)}{project.researchExamples?.map(item => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">公开参考：{item.title}</a>)}</div>{project.researchExamples?.length ? <small>公开案例仅用于启发测试覆盖，未被视为目标产品事实。</small> : <small>本次没有搜索到可用的公开案例；用例仍依据本地资料生成。</small>}</details> : null}
          <DocumentCaseEditorList
            editorNotice={editorNotice}
            project={project}
            scope={effectiveScopePlan}
            busy={busy}
            onRunCase={caseId => void runSingleCase(caseId)}
            stepDrafts={stepDrafts}
            probeBusyKey={stepProbeBusyKey}
            probeResults={stepProbeResults}
            cases={{
              insert: insertCase, move: moveCase,
              toggleSelection: toggleCaseSelection, selectOnly: selectOnlyCase, remove: removeCase,
              edit: editCase, editList: editCaseList, setLifecycle: setCaseLifecycleStatus,
              confirmPreconditions: confirmCasePreconditions, setTestDataRequirements, editSteps,
            }}
            steps={{
              update: updateCaseSteps, change: changeStep, add: addStep, remove: removeStep,
              move: moveStep, probe: probeSavedStep,
            }}
          />
        </details>
        <div className="doc-review" id="doc-execution">
          <details className="doc-run-advanced-config"><summary>首次接入与高级运行配置</summary><RunConfigurationPanel
            project={project}
            busy={busy}
            addCase={addCase}
            configuration={{
              notes, setNotes, runMode, setRunMode, dataParameterInputs,
              testDataSetId, parameterValues, testDataSetName, selectedTestDataSet,
              selectDataSet: id => { const item = project.testDataSets?.find(row => row.id === id); setTestDataSetId(id); setTestDataSetName(item?.name ?? ''); setParameterValues(item?.values ?? {}); },
              setParameterValue: (key, value) => setParameterValues(values => ({ ...values, [key]: value })),
              setTestDataSetName, saveTestDataSet, deleteTestDataSet,
              baselineRunId, setBaselineRunId, runHistory, baselineEnvironmentReview, baselineRunModeReview,
            }}
          /></details>
          {!embedded && <NotificationSettings />}<RunExecutionActions project={project} busy={busy} activeRunId={activeRunId} cancelRequested={cancelRequested} pauseRequested={pauseRequested}
            selectedCaseCount={selectedCaseCount} runMode={runMode}
            computerUseAvailable={computerUseAvailable} computerUseReason={computerUseReason} computerUseModel={computerUseModel}
            modelAvailable={modelAvailable} stepDrafts={stepDrafts}
            onCancel={() => void cancelRun()} onPause={() => void pauseRun()} onContinue={() => void continuePausedRun()} onSave={() => void saveDraft()} onApprove={() => void approve()} onExecute={() => void execute()} />
        </div>
      </section>
    </>}
    </details>
    {!embedded && run && <DailyRunOutcome run={run} busy={busy} onRetry={retestUnresolved} canRetry={retestCaseIds.length > 0} />}
    {project && <details className="daily-history" open={embedded || undefined}><summary>历史记录 <span>{runHistory.length} 次运行</span></summary><RunHistoryPanel run={run} items={runHistory} loadingId={historyLoadingId} onOpenRun={item => { void openHistoricalRun(item); }} onShowRecovery={item => { revealSection('#doc-run-recovery'); if (!document.getElementById('doc-run-recovery')) setError(item.lastError ?? '该运行尚未归档为完整结果。'); }} /></details>}
    {run && <details className="daily-result-tools" open={embedded || undefined}><summary>更多结果工具 <span>调查、恢复、通知与完整报告</span></summary><RunResultsPanel sectionId={embedded ? 'doc-results' : 'doc-results-detail'} run={run} project={project} busy={busy} retestCaseIds={retestCaseIds} onRetestUnresolved={retestUnresolved} onRetryCheckpoint={retryCheckpoint} onProjectChanged={() => { if (project) void refresh(project.id); }} /></details>}
  </div>;
}
