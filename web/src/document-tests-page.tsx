import { useEffect, useRef, useState } from 'react';
import { suggestApiMappingCandidates } from './api-mapping-candidates';

type Step = { action: string; [key: string]: string };
type TestDataSet = { id: string; name: string; values: Record<string, string>; createdAt: string; updatedAt: string };
type CaseCategory = 'functional' | 'input-validation' | 'boundary' | 'authentication' | 'authorization' | 'state-transition' | 'navigation' | 'accessibility' | 'visual' | 'security' | 'performance' | 'compatibility' | 'resilience' | 'other';
type Check = { id: string; title: string; source: string; entryPath?: string; modulePath?: string[]; tags?: string[]; requirementRefs?: string[]; priority?: 'P0' | 'P1' | 'P2' | 'P3'; category?: CaseCategory; confidence?: 'high' | 'medium' | 'low'; coverageAreas?: CaseCategory[]; lifecycleStatus?: 'draft' | 'runnable' | 'disabled'; selectedForRegression?: boolean; preconditions?: string[]; preconditionsConfirmed?: boolean; testData?: string[]; sideEffectRisk?: 'none' | 'reversible' | 'irreversible' | 'unknown'; cleanup?: string; caseOrigin?: 'held-out-benchmark' | 'ai-generated' | 'document-derived' | 'manual' | 'iteration-impact-draft'; kind: 'text' | 'visible' | 'field'; expected: string; steps: Step[]; executionRoute?: string; executionReason?: string; nextAction?: string };
type RunScopePlan = { mode: 'single' | 'feature' | 'impact' | 'full' | 'custom'; targetCaseIds: string[]; impactCaseIds: string[]; impactReasons?: Record<string, string[]> };
type ImpactCandidate = { caseId: string; title: string; reasons: string[] };

function pageEntryRoute(entryPath?: string): string {
  if (!entryPath?.trim()) return '';
  try {
    const parsed = new URL(entryPath.trim(), 'https://testpilot.invalid');
    const route = /^#\//u.test(parsed.hash) ? parsed.hash.slice(1).split('?')[0] ?? '/' : parsed.pathname;
    const normalized = route.replace(/\/+$/u, '') || '/';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  } catch { return entryPath.trim(); }
}

function pageEntryRouteSegments(entryPath?: string): string[] {
  return pageEntryRoute(entryPath).split('/').filter(Boolean);
}

const categoryOptions: Array<{ value: CaseCategory; label: string }> = [
  { value: 'functional', label: '功能流程' }, { value: 'input-validation', label: '输入校验' }, { value: 'boundary', label: '边界条件' },
  { value: 'authentication', label: '身份认证' }, { value: 'authorization', label: '权限控制' }, { value: 'state-transition', label: '状态流转' },
  { value: 'navigation', label: '导航跳转' }, { value: 'accessibility', label: '无障碍' }, { value: 'visual', label: '视觉布局' },
  { value: 'security', label: '安全' }, { value: 'performance', label: '性能' }, { value: 'compatibility', label: '兼容性' },
  { value: 'resilience', label: '异常恢复' }, { value: 'other', label: '其他' },
];
const canSelectCaseForRun = (item: Check) => item.lifecycleStatus !== 'draft' && item.lifecycleStatus !== 'disabled';
type ApiContract = { suiteId?: string; mappings?: Array<{ documentCaseId: string; apiCaseIds: string[] }>; allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean };
type ApiSuiteCase = { id: string; title: string; request: { method: string; path: string } };
type ApiSuiteSummary = { id: string; status: string; revision: number; suiteName: string; caseCount: number; digest: string };
type ApiSuiteCandidate = ApiSuiteSummary & { suite: { name: string; cases: ApiSuiteCase[] } };
type StepAuthoringResult = { caseId: string; status: 'generated' | 'partial' | 'blocked'; stepCount: number; detail: string };
type SiteVersion = { id: string; label: string; environment: string; targetUrl: string; changeNotes: string; createdAt: string };
type BaselineRunSnapshot = { runId: string; startedAt: string; completedAt: string; runMode?: 'regression' | 'compare'; siteVersionSnapshot?: SiteVersion; caseVersion?: string; materialVersion?: string; testDataVersion?: string; scopePlan?: RunScopePlan; selectedCaseCount: number; totalCases: number };
type ImpactSuggestion = { caseId: string; title: string; score: number; matchedTerms: string[]; evidence: string[] };
type ImpactAnalysis = { id: string; siteVersionId: string; siteVersionLabel: string; changeNotesSnapshot: string; caseVersion: string; analyzedAt: string; matchingMethod: 'keyword-evidence'; suggestions: ImpactSuggestion[]; unmatchedTerms: string[]; status: 'pending' | 'accepted' | 'rejected'; selectedCaseIds?: string[]; reviewNotes?: string; reviewedAt?: string };
type SourceMaterial = { id: string; fileName: string; role: string; sha256: string; byteLength: number; createdAt: string };
type ProjectRevisionKind = 'case' | 'steps' | 'case-set' | 'materials' | 'test-data';
type ProjectRevisionSummary = { id: string; projectId: string; kind: ProjectRevisionKind; entityId: string; version: number; digest: string; createdAt: string; source: 'saved-project' | 'run-snapshot'; summary: string };
type ProjectRevision = ProjectRevisionSummary & { snapshot: unknown };
type ProjectRevisionPage = { items: ProjectRevisionSummary[]; total: number };
type Project = { id: string; name: string; fileName: string; siteVersions?: SiteVersion[]; activeSiteVersionId?: string; impactAnalyses?: ImpactAnalysis[]; testDataSets?: TestDataSet[]; sourceMaterials?: SourceMaterial[]; sourceFiles?: string[]; researchExamples?: Array<{ title: string; url: string; snippet: string }>; workflowPlan?: string[]; caseMode?: 'existing' | 'ai' | 'both'; confirmationRequired?: boolean; apiContract?: ApiContract; sessionIdentityNote?: string; format: string; targetUrl: string; cases: Check[]; sourceText: string; reviewStatus?: string; reviewNotes?: string; generationWarning?: string; stepAuthoring?: { generatedAt: string; results: StepAuthoringResult[] } };
type Lane = { status: string; summary: string; results: Array<{ id: string; title: string; status: string; detail: string }> };
type TriageCategory = 'suspected-product-regression' | 'case-or-expectation-review' | 'locator-failure' | 'environment-or-session' | 'test-data-or-fixture' | 'needs-review';
type Comparison = { id: string; title: string; deterministic: string; computerUse: string; apiContract?: string; aligned: boolean; resolution?: 'aligned' | 'mismatch' | 'unresolved' | 'not-applicable'; issue: string; nextAction?: string; triage?: { category: TriageCategory; confidence: 'evidence-based' | 'tentative'; detail: string } };
type BaselineDisposition = 'regression' | 'fixed' | 'unchanged' | 'case-changed' | 'added' | 'removed' | 'not-run' | 'no-baseline-result' | 'unresolved';
type BaselineComparison = { caseId: string; title: string; baselineStatus?: string; currentStatus?: string; caseChanged?: boolean; disposition: BaselineDisposition };
type RunListItem = { id: string; startedAt: string; completedAt: string; overall: string; executionState?: 'running' | 'interrupted' | 'failed'; stage?: Recovery['stage']; recordedCaseCount?: number; resultCounts?: Record<string, number>; lastError?: string; canFinalizePackage?: boolean; runMode?: 'regression' | 'compare'; scopePlan?: RunScopePlan; parentRunId?: string; baselineRunId?: string; baselineSiteVersionSnapshot?: SiteVersion; baselineEnvironmentComparison?: 'same' | 'different' | 'unknown'; baselineRunModeComparison?: 'same' | 'different' | 'unknown'; caseTitles?: Record<string, string>; siteVersionSnapshot?: SiteVersion; caseVersion?: string; materialVersion?: string; testDataVersion?: string; selectedCaseCount: number; totalCases: number; baselineEligible: boolean };
type Run = { id: string; projectId?: string; runMode?: 'regression' | 'compare'; scopePlan?: RunScopePlan; siteVersionSnapshot?: SiteVersion; materialVersion?: string; sourceMaterialsSnapshot?: SourceMaterial[]; baselineRunId?: string; baselineRunSnapshot?: BaselineRunSnapshot; baselineEnvironmentComparison?: 'same' | 'different' | 'unknown'; baselineRunModeComparison?: 'same' | 'different' | 'unknown'; baselineMaterialChanged?: boolean; baselineTestDataChanged?: boolean; baselineComparison?: BaselineComparison[]; testDataSetId?: string; testDataVersion?: string; parameterValues?: Record<string, string>; parentRunId?: string; caseVersion?: string; retestSelection?: string[]; retestNotes?: string; diagnostics?: Array<{ caseId: string; classification: 'mismatch' | 'unverified' | 'aligned' | 'not-applicable' }>; overall: string; finalReady: boolean; caseScope?: { selectedCaseIds: string[]; excludedCaseIds: string[]; totalCases: number }; caseScopeKnown?: boolean; coverageSummary?: { projectAreas: CaseCategory[]; selectedAreas: CaseCategory[]; notCoveredThisRun: CaseCategory[] }; reportReady?: boolean; packageReady?: boolean; comparisons: Comparison[]; deterministic: Lane; ai: Lane; analysis?: string; report: string };
const baselineDispositionLabels: Record<BaselineDisposition, string> = { regression: '疑似回归', fixed: '已修复', unchanged: '未变化', 'case-changed': '用例已变更', added: '新增用例', removed: '已移除', 'not-run': '本轮未运行', 'no-baseline-result': '基线无结果', unresolved: '无法比较' };
const baselineStatusLabels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', 'not-run': '未运行', cancelled: '已取消', 'not-applicable': '不适用' };
const runScopeLabels: Record<RunScopePlan['mode'], string> = { single: '单项测试', feature: '功能测试', impact: '影响检查', full: '全量回归', custom: '自定义范围' };
function normalizedSiteOrigin(targetUrl?: string): string {
  try { return targetUrl ? new URL(targetUrl).origin.toLocaleLowerCase() : ''; }
  catch { return ''; }
}
type BaselineScopeGroup = 'target' | 'impact' | 'unselected' | 'removed' | 'unknown';
const baselineScopeGroupLabels: Record<BaselineScopeGroup, string> = { target: '直接目标', impact: '关联影响检查', unselected: '本轮未选 · 未验证', removed: '已从当前项目移除', unknown: '历史范围未标注' };
function baselineScopeGroup(item: BaselineComparison, scope?: RunScopePlan): BaselineScopeGroup {
  if (item.disposition === 'removed') return 'removed';
  if (!scope) return 'unknown';
  if (scope.targetCaseIds.includes(item.caseId)) return 'target';
  if (scope.impactCaseIds.includes(item.caseId)) return 'impact';
  return 'unselected';
}
const runOutcomeLabels: Record<string, string> = { passed: '通过', failed: '发现失败', partial: '部分完成', unresolved: '未验证', cancelled: '已取消' };
const recoveryCaseStatusLabels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', cancelled: '已取消', 'not-run': '未运行', 'not-applicable': '不适用' };
const triageLabels: Record<TriageCategory, string> = { 'suspected-product-regression': '疑似产品回归', 'case-or-expectation-review': '用例或预期需复核', 'locator-failure': '元素定位失效', 'environment-or-session': '环境或登录会话问题', 'test-data-or-fixture': '测试数据或 fixture 问题', 'needs-review': '待确认' };
const editableStepActions: Array<{ value: string; label: string }> = [
  { value: 'fillByLabel', label: '填写字段' }, { value: 'fillByPlaceholder', label: '按占位提示填写' },
  { value: 'selectByLabel', label: '选择字段选项' }, { value: 'selectByPlaceholder', label: '按占位提示选择' },
  { value: 'clickByRole', label: '点击控件' }, { value: 'clickExactText', label: '点击完全匹配文本' },
  { value: 'triggerClientValidation', label: '触发前端校验' },
  { value: 'assertText', label: '断言页面包含文本' }, { value: 'assertExactVisible', label: '断言完全匹配文本可见' },
  { value: 'assertVisible', label: '断言文本可见' }, { value: 'assertNotVisible', label: '断言文本不可见' },
  { value: 'assertValue', label: '断言字段值' }, { value: 'assertValueByPlaceholder', label: '断言占位字段值' },
  { value: 'assertDisabled', label: '断言字段禁用' }, { value: 'assertFieldInvalid', label: '断言字段无效' },
  { value: 'assertRoleVisible', label: '断言控件可见' },
];
const stepFieldSpecs: Record<string, Array<{ key: string; label: string; kind?: 'role' }>> = {
  fillByLabel: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '输入值（可用参数）' }],
  fillByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '输入值（可用参数）' }],
  selectByLabel: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '选项文本或值' }],
  selectByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '选项文本或值' }],
  clickByRole: [{ key: 'role', label: '控件类型', kind: 'role' }, { key: 'name', label: '控件名称' }],
  clickExactText: [{ key: 'text', label: '完全匹配文本' }],
  triggerClientValidation: [{ key: 'name', label: '提交按钮名称' }],
  assertText: [{ key: 'text', label: '预期文本（可用参数）' }],
  assertExactVisible: [{ key: 'text', label: '预期文本（可用参数）' }],
  assertVisible: [{ key: 'text', label: '预期文本（可用参数）' }],
  assertNotVisible: [{ key: 'text', label: '不应出现的文本' }],
  assertValue: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '预期值（可用参数）' }],
  assertValueByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '预期值（可用参数）' }],
  assertDisabled: [{ key: 'label', label: '字段标签' }],
  assertFieldInvalid: [{ key: 'label', label: '字段标签' }],
  assertRoleVisible: [{ key: 'role', label: '控件类型', kind: 'role' }, { key: 'name', label: '控件名称' }],
};
function createEditableStep(action: string): Step {
  const step: Step = { action };
  for (const field of stepFieldSpecs[action] ?? []) step[field.key] = field.kind === 'role' ? 'button' : '';
  return step;
}
function parameterNames(cases: Check[]): string[] {
  const names = new Set<string>();
  for (const item of cases) for (const step of item.steps ?? []) for (const field of ['value', 'text', 'name']) {
    const value = step[field];
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu)) names.add(match[1]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}
type RunProgress = { runId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; stage: string; progress?: { completed: number; total: number; counts: Record<string, number> }; currentCase?: { lane: string; id: string; title: string }; run?: Run; lastError?: string };
type Recovery = { runId: string; startedAt: string; updatedAt: string; stage: 'starting' | 'deterministic' | 'computer-use' | 'awaiting-login' | 'analysis' | 'report' | 'packaging'; resumeCount: number; canResume: boolean; canFinalizePackage?: boolean; lastError?: string; isRunning?: boolean; progress?: { completed: number; total: number; currentCase?: { lane: string; id: string; title: string }; counts: Record<string, number> }; recordedResultCount?: number; recordedResults?: Array<{ lane: 'deterministic' | 'computer-use'; id: string; title: string; status: string; durationMs: number; updatedAt: string; actions?: number }>; reason: string };
const recoveryStageLabel: Record<Recovery['stage'], string> = { starting: '准备浏览器会话', deterministic: '确定性测试执行', 'computer-use': 'AI 视觉测试', 'awaiting-login': '等待同一浏览器窗口登录', analysis: '结果差异分析', report: '撰写结果报告', packaging: '打包报告和复用脚本' };
type PreparationTask = { status: 'running' | 'completed' | 'needs-review' | 'failed'; stage: string; events: Array<{ message: string }>; projectId?: string; error?: string };
type LoginHandoff = { projectId: string; runId: string; status: 'waiting_for_user' | 'ready_to_continue'; targetUrl: string; message: string; requestedAt: string };
type SessionStatus = { state: 'occupied' | 'connected' | 'unavailable' | 'unknown'; occupied: boolean; manualLoginRequired: boolean | null; identityNote?: string; identitySource?: 'user-confirmed'; checkedAt: string; message: string };
type StepProbeResult = { caseId: string; stepIndex: number; action: string; status: 'found' | 'not-found' | 'not-visible' | 'ambiguous' | 'not-required' | 'blocked'; locatorKind?: string; matchCount?: number; visibleCount?: number; elementTypes?: string[]; checkedAt: string; detail: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) { let message = `${response.status} ${response.statusText}`; try { message = (await response.json()).error ?? message; } catch { /* no JSON body */ } throw new Error(message); }
  return response.json() as Promise<T>;
}

function findRelatedCaseCandidates(project: Project, targetCaseIds: string[], existingImpactCaseIds: string[] = []): ImpactCandidate[] {
  const targets = project.cases.filter(item => targetCaseIds.includes(item.id));
  const selectedIds = new Set([...targetCaseIds, ...existingImpactCaseIds]);
  const mappedApis = new Map<string, Set<string>>();
  for (const mapping of project.apiContract?.mappings ?? []) mappedApis.set(mapping.documentCaseId, new Set(mapping.apiCaseIds));
  const shared = (left: string[] = [], right: string[] = []) => {
    const values = new Set(left.map(item => item.trim().toLocaleLowerCase()).filter(Boolean));
    return right.filter(item => values.has(item.trim().toLocaleLowerCase()));
  };
  return project.cases.flatMap(candidate => {
    if (selectedIds.has(candidate.id) || !canSelectCaseForRun(candidate)) return [];
    const reasons = new Set<string>();
    for (const target of targets) {
      const leftRoute = pageEntryRouteSegments(target.entryPath);
      const rightRoute = pageEntryRouteSegments(candidate.entryPath);
      let sharedRouteDepth = 0;
      while (sharedRouteDepth < leftRoute.length && sharedRouteDepth < rightRoute.length && leftRoute[sharedRouteDepth]!.toLocaleLowerCase() === rightRoute[sharedRouteDepth]!.toLocaleLowerCase()) sharedRouteDepth++;
      const sharedRouteIsSpecific = sharedRouteDepth >= 2 || sharedRouteDepth > 0 && sharedRouteDepth === Math.min(leftRoute.length, rightRoute.length);
      if (leftRoute.length && rightRoute.length && sharedRouteDepth === leftRoute.length && sharedRouteDepth === rightRoute.length) reasons.add(`同一页面路由（忽略筛选参数）：/${leftRoute.join('/')}`);
      else if (sharedRouteIsSpecific) reasons.add(`共享页面路由：/${leftRoute.slice(0, sharedRouteDepth).join('/')}`);
      const leftPath = target.modulePath?.filter(Boolean) ?? [];
      const rightPath = candidate.modulePath?.filter(Boolean) ?? [];
      let sharedDepth = 0;
      while (sharedDepth < leftPath.length && sharedDepth < rightPath.length && leftPath[sharedDepth]!.trim().toLocaleLowerCase() === rightPath[sharedDepth]!.trim().toLocaleLowerCase()) sharedDepth++;
      if (leftPath.length > 0 && leftPath.length === rightPath.length && sharedDepth === leftPath.length) reasons.add(`同一功能路径：${leftPath.join(' / ')}`);
      else if (sharedDepth >= 2) reasons.add(`共享上级页面：${leftPath.slice(0, sharedDepth).join(' / ')}`);
      else if (sharedDepth === 1 && leftPath.length === 1 && rightPath.length === 1) reasons.add(`同一业务模块：${leftPath[0]}`);
      const tags = shared(target.tags, candidate.tags);
      if (tags.length) reasons.add(`共享标签：${tags.join('、')}`);
      const refs = shared(target.requirementRefs, candidate.requirementRefs);
      if (refs.length) reasons.add(`关联同一需求引用：${refs[0]!.slice(0, 80)}`);
      const leftApis = mappedApis.get(target.id);
      const rightApis = mappedApis.get(candidate.id);
      const apiIds = leftApis && rightApis ? [...leftApis].filter(id => rightApis.has(id)) : [];
      if (apiIds.length) reasons.add(`映射到相同 API 检查：${apiIds.join('、')}`);
    }
    return reasons.size ? [{ caseId: candidate.id, title: candidate.title, reasons: [...reasons] }] : [];
  }).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

async function startAndWaitForRun(projectId: string, body: Record<string, unknown>, onStatus: (message: string) => void, action: 'start' | 'retest' = 'start', onRunId?: (runId: string) => void): Promise<Run> {
  const started = await request<{ runId?: string; comparisons?: Comparison[]; finalReady?: boolean }>(`/api/document-projects/${projectId}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (Array.isArray(started.comparisons)) return started as Run;
  if (!started.runId) throw new Error('服务未返回 runId，无法继续轮询运行状态。');
  onRunId?.(started.runId);
  let lastStage = '';
  while (true) {
    const progress = await request<RunProgress>(`/api/document-runs/${encodeURIComponent(started.runId)}/progress`);
    if (progress.status === 'completed') {
      if (progress.run) return progress.run;
      return await request<Run>(`/api/document-runs/${encodeURIComponent(started.runId)}`);
    }
    if (progress.status === 'cancelled') return progress.run ?? await request<Run>(`/api/document-runs/${encodeURIComponent(started.runId)}`);
    if (progress.status === 'failed') throw new Error(progress.lastError || `运行 ${started.runId} 中断；可从项目恢复状态检查并安全恢复。`);
    if (progress.stage !== lastStage) {
      lastStage = progress.stage;
      const where = progress.currentCase ? ` · ${progress.currentCase.id} ${progress.currentCase.title}` : '';
      onStatus(progress.stage === 'awaiting-login' ? `测试窗口正在等待登录；完成登录后在此项目提示中继续，运行 ${started.runId} 会复用当前会话。` : `运行中：${progress.stage}${where} · ${progress.progress?.completed ?? 0}/${progress.progress?.total ?? 0}`);
    }
    await new Promise(resolve => window.setTimeout(resolve, 1200));
  }
}

function StepProbeNotice({ result }: { result: StepProbeResult }) {
  const labels: Record<StepProbeResult['status'], string> = {
    found: '定位通过', 'not-found': '没有匹配控件', 'not-visible': '匹配控件不可见',
    ambiguous: '匹配不唯一', 'not-required': '此步骤无需定位', blocked: '定位未执行',
  };
  const failed = ['not-found', 'not-visible', 'ambiguous', 'blocked'].includes(result.status);
  return <p className={`doc-notice ${failed ? 'error' : ''}`}><strong>{labels[result.status]}</strong>{result.matchCount !== undefined ? ` · 匹配 ${result.matchCount} 个，可见 ${result.visibleCount ?? 0} 个${result.elementTypes?.length ? ` · 控件：${result.elementTypes.join('、')}` : ''}` : ''}<br />{result.detail}</p>;
}

export default function DocumentTestsPage({ modelAvailable, computerUseAvailable, computerUseReason, computerUseModel, initialProjectId, initialRunId, embedded = false }: { modelAvailable: boolean; computerUseAvailable: boolean; computerUseReason: string; computerUseModel: string; initialProjectId?: string; initialRunId?: string; embedded?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [siteVersionId, setSiteVersionId] = useState('');
  const [siteVersionLabel, setSiteVersionLabel] = useState('');
  const [siteVersionEnvironment, setSiteVersionEnvironment] = useState('主环境');
  const [siteVersionTargetUrl, setSiteVersionTargetUrl] = useState('');
  const [siteVersionChangeNotes, setSiteVersionChangeNotes] = useState('');
  const [impactAnalysisId, setImpactAnalysisId] = useState('');
  const [impactSelectedCaseIds, setImpactSelectedCaseIds] = useState<string[]>([]);
  const [impactReviewNotes, setImpactReviewNotes] = useState('');
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
  const [baselineRunId, setBaselineRunId] = useState('');
  const [testDataSetId, setTestDataSetId] = useState('');
  const [testDataSetName, setTestDataSetName] = useState('');
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [importExpanded, setImportExpanded] = useState(false);
  const [projectMaterialFile, setProjectMaterialFile] = useState<File | null>(null);
  const [projectMaterialRole, setProjectMaterialRole] = useState<'requirements' | 'coverage-reference' | 'held-out-benchmark'>('requirements');
  const [replaceProjectMaterialId, setReplaceProjectMaterialId] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('已核对用例与需求来源，并确认只读检查预期。');
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const [cancelRequested, setCancelRequested] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});
  const [selectedModuleKeys, setSelectedModuleKeys] = useState<string[]>([]);
  const [selectedPageRouteKeys, setSelectedPageRouteKeys] = useState<string[]>([]);
  const [runScopePlan, setRunScopePlan] = useState<RunScopePlan | null>(null);
  const [impactCandidates, setImpactCandidates] = useState<ImpactCandidate[]>([]);
  const [impactCandidateSelection, setImpactCandidateSelection] = useState<string[]>([]);
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [runMode, setRunMode] = useState<'regression' | 'compare'>('regression');
  const [loginHandoff, setLoginHandoff] = useState<LoginHandoff | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [sessionStatusLoading, setSessionStatusLoading] = useState(false);
  const [sessionStatusError, setSessionStatusError] = useState('');
  const [sessionIdentityDraft, setSessionIdentityDraft] = useState('');
  const [sessionIdentitySaving, setSessionIdentitySaving] = useState(false);
  const [stepProbeResults, setStepProbeResults] = useState<Record<string, StepProbeResult>>({});
  const [stepProbeBusyKey, setStepProbeBusyKey] = useState('');
  const [apiSuites, setApiSuites] = useState<ApiSuiteSummary[]>([]);
  const [apiSuiteDetail, setApiSuiteDetail] = useState<ApiSuiteCandidate | null>(null);
  const [apiSuiteLoading, setApiSuiteLoading] = useState(false);
  const [apiSuiteError, setApiSuiteError] = useState('');
  const notifiedLoginRun = useRef('');
  const caseDetailsRef = useRef<HTMLDetailsElement>(null);
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
  const blockedStepCaseIds = project?.stepAuthoring?.results.filter(item => item.status === 'blocked').map(item => item.caseId) ?? [];
  useEffect(() => {
    if (!project) return;
    const sectionId = window.location.hash.slice(1);
    if (!['doc-session', 'doc-version', 'doc-impact', 'doc-revisions', 'doc-cases', 'doc-execution', 'doc-run-history', 'doc-results'].includes(sectionId)) return;
    document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
  }, [project?.id]);
  const selectedSiteVersion = project?.siteVersions?.find(item => item.id === siteVersionId)
    ?? project?.siteVersions?.find(item => item.id === project.activeSiteVersionId)
    ?? project?.siteVersions?.at(-1);
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
  const selectedImpactAnalysis = selectedSiteVersion
    ? project?.impactAnalyses?.find(item => item.id === impactAnalysisId && item.siteVersionId === selectedSiteVersion.id)
      ?? [...(project?.impactAnalyses ?? [])].reverse().find(item => item.siteVersionId === selectedSiteVersion.id)
    : undefined;
  useEffect(() => {
    if (!selectedImpactAnalysis) {
      setImpactAnalysisId('');
      setImpactSelectedCaseIds([]);
      setImpactReviewNotes('');
      return;
    }
    setImpactAnalysisId(selectedImpactAnalysis.id);
    setImpactSelectedCaseIds(selectedImpactAnalysis.status === 'pending'
      ? selectedImpactAnalysis.suggestions.map(item => item.caseId)
      : selectedImpactAnalysis.selectedCaseIds ?? []);
    setImpactReviewNotes(selectedImpactAnalysis.reviewNotes ?? '');
  }, [project?.id, selectedSiteVersion?.id, selectedImpactAnalysis?.id]);
  const selectedCases = project?.cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false) ?? [];
  const runnableCaseCount = project?.cases.filter(canSelectCaseForRun).length ?? 0;
  const selectedCaseIds = selectedCases.map(item => item.id);
  const selectedCaseIdSet = new Set(selectedCaseIds);
  const plannedTargets = (runScopePlan?.targetCaseIds ?? []).filter(id => selectedCaseIdSet.has(id));
  const plannedImpacts = (runScopePlan?.impactCaseIds ?? []).filter(id => selectedCaseIdSet.has(id) && !plannedTargets.includes(id));
  const unclassifiedSelected = selectedCaseIds.filter(id => !plannedTargets.includes(id) && !plannedImpacts.includes(id));
  const effectiveScopePlan: RunScopePlan = {
    mode: runScopePlan?.mode ?? (selectedCaseIds.length === runnableCaseCount ? 'full' : selectedCaseIds.length === 1 ? 'single' : 'custom'),
    targetCaseIds: [...plannedTargets, ...unclassifiedSelected],
    impactCaseIds: plannedImpacts,
    ...(runScopePlan?.impactReasons ? { impactReasons: Object.fromEntries(Object.entries(runScopePlan.impactReasons).filter(([id]) => plannedImpacts.includes(id))) } : {}),
  };
  const requiredParameterNames = parameterNames(selectedCases);
  const selectedTestDataSet = project?.testDataSets?.find(item => item.id === testDataSetId);
  const pageRouteKey = pageEntryRoute;
  const moduleOptions = (() => {
    const paths = new Map<string, string[]>();
    for (const item of project?.cases ?? []) {
      const path = item.modulePath?.filter(Boolean) ?? [];
      for (let depth = 1; depth <= path.length; depth++) {
        const prefix = path.slice(0, depth);
        paths.set(JSON.stringify(prefix), prefix);
      }
    }
    return [...paths.entries()].sort((a, b) => a[1].join(' / ').localeCompare(b[1].join(' / '), 'zh-CN'));
  })();
  const moduleOptionKeys = moduleOptions.map(([key]) => key).join('\u0000');
  const pageEntryOptions = (() => {
    const counts = new Map<string, { totalCount: number; runnableCount: number }>();
    for (const item of project?.cases ?? []) {
      const route = pageRouteKey(item.entryPath);
      if (route) {
        const count = counts.get(route) ?? { totalCount: 0, runnableCount: 0 };
        count.totalCount += 1;
        if (canSelectCaseForRun(item)) count.runnableCount += 1;
        counts.set(route, count);
      }
    }
    return [...counts.entries()].map(([route, count]) => ({ route, ...count })).sort((a, b) => a.route.localeCompare(b.route, 'zh-CN'));
  })();
  const pageOptionKeys = pageEntryOptions.map(item => item.route).join('\u0000');
  const unassignedPageCaseCount = project?.cases.filter(item => canSelectCaseForRun(item) && !pageRouteKey(item.entryPath)).length ?? 0;
  const selectedPageRouteSet = new Set(selectedPageRouteKeys);
  const selectedPageCaseCount = project?.cases.filter(item => canSelectCaseForRun(item) && selectedPageRouteSet.has(pageRouteKey(item.entryPath))).length ?? 0;
  const stepsReady = selectedCases.length > 0 && selectedCases.every(item => item.steps?.length > 0);
  const selectedCaseCount = selectedCases.length;
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
  const refreshRunHistory = (projectId: string) => {
    void request<RunListItem[]>(`/api/document-projects/${projectId}/runs`).then(setRunHistory).catch(() => undefined);
  };
  const openHistoricalRun = async (item: RunListItem) => {
    if (run?.id === item.id) {
      document.getElementById('doc-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setHistoryLoadingId(item.id); setError('');
    try {
      const detail = await request<Run>(`/api/document-runs/${encodeURIComponent(item.id)}`);
      if (detail.projectId && detail.projectId !== selectedId) throw new Error('这轮运行不属于当前项目，无法在此查看。');
      setRun(detail); setRunMode(detail.runMode ?? 'regression');
      setMessage(`正在查看 ${new Date(item.startedAt).toLocaleString()} 的历史运行结果。`);
      window.setTimeout(() => document.getElementById('doc-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (e) { setError((e as Error).message); }
    finally { setHistoryLoadingId(''); }
  };
  const refreshProjectRevisions = async (projectId: string, offset = 0, append = false) => {
    setProjectRevisionLoading(true); setProjectRevisionError('');
    try {
      const query = new URLSearchParams({ offset: String(offset), limit: '50' });
      if (projectRevisionKind) query.set('kind', projectRevisionKind);
      if (projectRevisionKind && projectRevisionEntity.trim()) query.set('entityId', projectRevisionEntity.trim());
      const page = await request<ProjectRevisionPage>(`/api/document-projects/${projectId}/revisions?${query}`);
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
  const refreshSessionStatus = async (projectId = project?.id, versionId = selectedSiteVersion?.id) => {
    if (!projectId) return;
    setSessionStatusLoading(true); setSessionStatusError('');
    try {
      const query = versionId ? `?siteVersionId=${encodeURIComponent(versionId)}` : '';
      setSessionStatus(await request<SessionStatus>(`/api/document-projects/${projectId}/session-status${query}`));
    } catch (e) { setSessionStatusError((e as Error).message); }
    finally { setSessionStatusLoading(false); }
  };
  const saveSessionIdentity = async () => {
    if (!project) return;
    setSessionIdentitySaving(true); setError('');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/session-identity`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identityNote: sessionIdentityDraft }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setSessionStatus(current => current ? { ...current, identityNote: updated.sessionIdentityNote, identitySource: updated.sessionIdentityNote ? 'user-confirmed' : undefined } : current);
      setMessage(updated.sessionIdentityNote ? '已保存人工确认的身份/角色备注；这不会改变用例审核状态。' : '已清除身份/角色备注。');
    } catch (e) { setError((e as Error).message); }
    finally { setSessionIdentitySaving(false); }
  };
  const probeSavedStep = async (caseId: string, stepIndex: number) => {
    if (!project) return;
    const key = `${caseId}:${stepIndex}`;
    setStepProbeBusyKey(key); setError('');
    try {
      const result = await request<StepProbeResult>(`/api/document-projects/${project.id}/probe-step`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, stepIndex, ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}) }),
      });
      setStepProbeResults(current => ({ ...current, [key]: result }));
    } catch (e) { setError((e as Error).message); }
    finally { setStepProbeBusyKey(''); }
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await refresh(initialProjectId);
        if (!active || !initialRunId) return;
        const savedRun = await request<Run>(`/api/document-runs/${encodeURIComponent(initialRunId)}`);
        if (!active || (savedRun.projectId && initialProjectId && savedRun.projectId !== initialProjectId)) return;
        setRun(savedRun);
        setRunMode(savedRun.runMode ?? 'compare');
        setMessage(savedRun.runMode === 'regression' ? `已打开常规回归结果：${savedRun.overall}。报告和脚本包可下载。` : '已打开本轮 AI 辅助对照结果；报告和脚本包可下载。');
      } catch (e) { if (active) setError((e as Error).message); }
    })();
    return () => { active = false; };
  }, [initialProjectId, initialRunId]);

  useEffect(() => { setSelectedModuleKeys([]); setSelectedPageRouteKeys([]); setRunScopePlan(null); setImpactCandidates([]); setImpactCandidateSelection([]); }, [selectedId]);
  useEffect(() => { setTestDataSetId(''); setTestDataSetName(''); setParameterValues({}); }, [selectedId]);
  useEffect(() => {
    setSessionStatus(null); setSessionStatusError(''); setSessionIdentityDraft(project?.sessionIdentityNote ?? '');
    if (!project) return;
    let live = true;
    void request<SessionStatus>(`/api/document-projects/${project.id}/session-status${selectedSiteVersion?.id ? `?siteVersionId=${encodeURIComponent(selectedSiteVersion.id)}` : ''}`)
      .then(state => { if (live) setSessionStatus(state); })
      .catch(e => { if (live) setSessionStatusError((e as Error).message); });
    return () => { live = false; };
  }, [project?.id, selectedSiteVersion?.id, project?.sessionIdentityNote]);
  useEffect(() => {
    const activeVersion = project?.siteVersions?.find(item => item.id === project.activeSiteVersionId) ?? project?.siteVersions?.at(-1);
    setSiteVersionId(activeVersion?.id ?? '');
    setSiteVersionTargetUrl(activeVersion?.targetUrl ?? project?.targetUrl ?? '');
    setSiteVersionLabel('');
    setSiteVersionEnvironment('主环境');
    setSiteVersionChangeNotes('');
  }, [selectedId]);
  useEffect(() => {
    setBaselineRunId('');
    if (!project) { setRunHistory([]); return; }
    let active = true;
    void request<RunListItem[]>(`/api/document-projects/${project.id}/runs`)
      .then(rows => { if (active) setRunHistory(rows); })
      .catch(() => { if (active) setRunHistory([]); });
    return () => { active = false; };
  }, [project?.id]);
  useEffect(() => {
    setProjectRevisionSnapshots({}); setProjectRevisionOffset(0); setProjectRevisionEntity('');
  }, [project?.id]);
  useEffect(() => {
    setProjectRevisionSnapshots({}); setProjectRevisionOffset(0);
    if (!project) { setProjectRevisions([]); setProjectRevisionTotal(0); return; }
    let active = true;
    setProjectRevisionLoading(true); setProjectRevisionError('');
    const query = new URLSearchParams({ offset: '0', limit: '50' });
    if (projectRevisionKind) query.set('kind', projectRevisionKind);
    if (projectRevisionKind && projectRevisionEntity.trim()) query.set('entityId', projectRevisionEntity.trim());
    void request<ProjectRevisionPage>(`/api/document-projects/${project.id}/revisions?${query}`)
      .then(page => { if (active) { setProjectRevisions(page.items); setProjectRevisionTotal(page.total); setProjectRevisionOffset(page.items.length); } })
      .catch(e => { if (active) setProjectRevisionError((e as Error).message); })
      .finally(() => { if (active) setProjectRevisionLoading(false); });
    return () => { active = false; };
  }, [project?.id, projectRevisionKind, projectRevisionEntity]);
  useEffect(() => { setSelectedModuleKeys(current => current.filter(key => moduleOptions.some(([optionKey]) => optionKey === key))); }, [moduleOptionKeys]);
  useEffect(() => { setSelectedPageRouteKeys(current => current.filter(key => pageEntryOptions.some(option => option.route === key))); }, [pageOptionKeys]);

  useEffect(() => {
    if (!project) { setApiSuites([]); setApiSuiteDetail(null); setApiSuiteError(''); return; }
    let active = true;
    setApiSuiteLoading(true); setApiSuiteError('');
    void (async () => {
      try {
        const candidates = await request<ApiSuiteSummary[]>('/api/api-suites');
        if (!active) return;
        setApiSuites(candidates.filter(item => item.status === 'approved'));
        const suiteId = project.apiContract?.suiteId;
        if (suiteId) {
          const detail = await request<ApiSuiteCandidate>(`/api/api-suites/${encodeURIComponent(suiteId)}`);
          if (active) setApiSuiteDetail(detail);
        } else setApiSuiteDetail(null);
      } catch (e) { if (active) { setApiSuiteDetail(null); setApiSuiteError((e as Error).message); } }
      finally { if (active) setApiSuiteLoading(false); }
    })();
    return () => { active = false; };
  }, [project?.id, project?.apiContract?.suiteId]);

  const saveProjectMaterial = async () => {
    if (!project || !projectMaterialFile) { setError('请选择要加入项目的资料文件。'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const bytesBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取资料文件失败。')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(projectMaterialFile); });
      const result = await request<{ project: Project; updatedMaterialId: string; materialVersion: string }>(`/api/document-projects/${project.id}/materials`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: projectMaterialFile.name, bytesBase64, role: projectMaterialRole, ...(replaceProjectMaterialId ? { replaceMaterialId: replaceProjectMaterialId } : {}) }),
      });
      setProjects(rows => rows.map(item => item.id === result.project.id ? result.project : item));
      setProjectMaterialFile(null); setReplaceProjectMaterialId('');
      void refreshProjectRevisions(result.project.id, 0, false);
      setMessage(`资料已保存为新版本（${result.materialVersion.slice(0, 12)}…）；正式用例未自动改写，请重新检查依据并审核。`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const importFile = async () => {
    if (!file || !targetUrl.trim()) { setError('先选择 PDF/XMind/Markdown/TXT 文件并填写目标网址。'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('读取文件失败')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
      const started = await request<{ preparationId: string }>('/api/document-projects/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, fileName: file.name, bytesBase64: base64, targetUrl, requireConfirmation: confirmBeforeRun }) });
      let task: PreparationTask;
      do {
        task = await request<PreparationTask>(`/api/document-preparation/${started.preparationId}`);
        setMessage(task.events.at(-1)?.message ?? 'Agent 正在准备测试资料…');
        if (task.status === 'running') await new Promise(resolve => window.setTimeout(resolve, 400));
      } while (task.status === 'running');
      if (task.status === 'failed') throw new Error(task.error ?? '资料准备失败。');
      if (!task.projectId) throw new Error('资料准备结束，但没有生成测试项目。');
      const project = (await request<Project[]>(`/api/document-projects`)).find(row => row.id === task.projectId);
      if (!project) throw new Error('测试项目已准备，但无法读取项目详情。');
      await refresh(project.id); setStepDrafts(Object.fromEntries(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)]))); setRun(null); setMessage(project.generationWarning ? `资料已整理。${project.generationWarning}` : `已准备 ${project.cases.length} 条用例；请复核步骤和前置条件，再手动启动回归。`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const editCase = (index: number, key: keyof Check, value: string) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, [key]: value, lifecycleStatus: 'draft' as const, selectedForRegression: false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item)); setRun(null);
  };
  const editCaseList = (index: number, key: 'requirementRefs' | 'preconditions' | 'testData' | 'coverageAreas' | 'modulePath' | 'tags', value: string) => {
    if (!project) return;
    const values = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    const cases = project.cases.map((item, i) => i === index ? { ...item, [key]: values, lifecycleStatus: 'draft' as const, selectedForRegression: false, ...(key === 'preconditions' ? { preconditionsConfirmed: values.length === 0 } : {}) } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item)); setRun(null);
  };
  const setCaseSelection = (predicate: (item: Check) => boolean, mode: RunScopePlan['mode'] = 'custom') => {
    if (!project) return;
    const cases = project.cases.map(item => ({ ...item, selectedForRegression: canSelectCaseForRun(item) && predicate(item) }));
    const targetCaseIds = cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false).map(item => item.id);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
    setRunScopePlan({ mode: mode === 'single' && targetCaseIds.length !== 1 ? 'custom' : mode, targetCaseIds, impactCaseIds: [] });
    setRun(null);
    setImpactCandidates([]); setImpactCandidateSelection([]);
  };
  const toggleModuleSelection = (key: string, checked: boolean) => {
    setSelectedModuleKeys(current => checked ? [...new Set([...current, key])] : current.filter(item => item !== key));
  };
  const togglePageRouteSelection = (route: string, checked: boolean) => {
    setSelectedPageRouteKeys(current => checked ? [...new Set([...current, route])] : current.filter(item => item !== route));
  };
  const applyModuleSelection = () => {
    const selected = new Set(selectedModuleKeys);
    setCaseSelection(item => {
      const path = item.modulePath ?? [];
      return path.some((_segment, index) => selected.has(JSON.stringify(path.slice(0, index + 1))));
    }, 'feature');
  };
  const applyPageSelection = () => {
    if (!project || !selectedPageRouteKeys.length || !selectedPageCaseCount) return;
    const selectedRoutes = new Set(selectedPageRouteKeys);
    setCaseSelection(item => selectedRoutes.has(pageRouteKey(item.entryPath)), selectedPageCaseCount === 1 ? 'single' : 'feature');
    setMessage(`已按页面入口选中 ${selectedPageCaseCount} 条可运行用例；${unassignedPageCaseCount ? `${unassignedPageCaseCount} 条未标注页面入口的用例不会自动纳入。` : '所有可运行用例均已标注页面入口。'}`);
  };
  const toggleCaseSelection = (index: number, checked: boolean) => {
    if (!project) return;
    const target = project.cases[index];
    if (!target || !canSelectCaseForRun(target)) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, selectedForRegression: checked } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
    let currentTargets = effectiveScopePlan.targetCaseIds.filter(id => id !== target.id);
    let currentImpacts = effectiveScopePlan.impactCaseIds.filter(id => id !== target.id);
    if (checked) currentTargets.push(target.id);
    const nextMode: RunScopePlan['mode'] = currentImpacts.length ? 'impact' : currentTargets.length === 1 ? 'single' : 'custom';
    const impactReasons = Object.fromEntries(Object.entries(effectiveScopePlan.impactReasons ?? {}).filter(([id]) => currentImpacts.includes(id)));
    setRunScopePlan({ mode: nextMode, targetCaseIds: currentTargets, impactCaseIds: currentImpacts, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) });
    setImpactCandidates([]); setImpactCandidateSelection([]);
    setRun(null);
  };
  const selectOnlyCase = (caseId: string) => {
    if (!project) return;
    const target = project.cases.find(item => item.id === caseId);
    if (!target || !canSelectCaseForRun(target)) return;
    const cases = project.cases.map(item => ({ ...item, selectedForRegression: item.id === caseId }));
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
    setRunScopePlan({ mode: 'single', targetCaseIds: [caseId], impactCaseIds: [] });
    setRun(null);
    setImpactCandidates([]); setImpactCandidateSelection([]);
  };
  const analyzeRelatedCases = () => {
    if (!project || !effectiveScopePlan.targetCaseIds.length) return;
    const candidates = findRelatedCaseCandidates(project, effectiveScopePlan.targetCaseIds, effectiveScopePlan.impactCaseIds);
    setImpactCandidates(candidates); setImpactCandidateSelection([]);
    setMessage(candidates.length ? `按模块路径、需求引用、标签和 API 映射找到 ${candidates.length} 条关联候选；勾选确认后才会加入本轮。` : '没有找到带有明确模块、需求、标签或 API 关系的用例；其余用例仍显示为未验证。');
  };
  const addSelectedImpactCases = () => {
    if (!project || !impactCandidateSelection.length) return;
    const candidates = new Set(impactCandidateSelection.filter(id => impactCandidates.some(item => item.caseId === id)));
    const targetIds = effectiveScopePlan.targetCaseIds;
    const impactIds = [...new Set([...effectiveScopePlan.impactCaseIds, ...candidates])].filter(id => !targetIds.includes(id));
    const included = new Set([...targetIds, ...impactIds]);
    const cases = project.cases.map(item => canSelectCaseForRun(item) ? { ...item, selectedForRegression: included.has(item.id) } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
    const candidateReasons = Object.fromEntries([...candidates]
      .map(id => [id, (impactCandidates.find(item => item.caseId === id)?.reasons ?? []).slice(0, 10).map(reason => reason.slice(0, 300))] as const)
      .filter(([, reasons]) => reasons.length > 0));
    const impactReasons = { ...effectiveScopePlan.impactReasons, ...candidateReasons };
    setRunScopePlan({ mode: 'impact', targetCaseIds: targetIds, impactCaseIds: impactIds, ...(Object.keys(impactReasons).length ? { impactReasons } : {}) });
    setMessage(`已把 ${candidates.size} 条关联影响用例加入本轮；直接目标与影响检查会分组记录。`);
    setImpactCandidates([]); setImpactCandidateSelection([]);
  };
  const clearImpactCases = () => {
    if (!project || !effectiveScopePlan.impactCaseIds.length) return;
    const targetIds = new Set(effectiveScopePlan.targetCaseIds);
    const cases = project.cases.map(item => canSelectCaseForRun(item) ? { ...item, selectedForRegression: targetIds.has(item.id) } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases } : item));
    setRunScopePlan({ mode: targetIds.size === 1 ? 'single' : 'feature', targetCaseIds: [...targetIds], impactCaseIds: [] });
    setRun(null);
    setImpactCandidates([]); setImpactCandidateSelection([]);
  };
  const setCaseLifecycleStatus = (index: number, lifecycleStatus: NonNullable<Check['lifecycleStatus']>) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, lifecycleStatus, selectedForRegression: lifecycleStatus === 'runnable' ? item.selectedForRegression !== false : false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item)); setRun(null);
  };
  const confirmCasePreconditions = (index: number, checked: boolean) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, preconditionsConfirmed: checked, lifecycleStatus: 'draft' as const, selectedForRegression: false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item)); setRun(null);
  };
  const updateCaseSteps = (index: number, steps: Step[]) => {
    if (!project) return;
    const item = project.cases[index];
    if (!item) return;
    const cases = project.cases.map((row, position) => position === index ? { ...row, steps, lifecycleStatus: 'draft' as const, selectedForRegression: false } : row);
    setProjects(current => current.map(row => row.id === project.id ? { ...row, cases, reviewStatus: 'draft' } : row));
    setStepDrafts(current => ({ ...current, [item.id]: JSON.stringify(steps, null, 2) }));
    setRun(null);
  };
  const changeStep = (caseIndex: number, stepIndex: number, key: string, value: string) => {
    if (!project) return;
    const steps = [...(project.cases[caseIndex]?.steps ?? [])];
    steps[stepIndex] = { ...steps[stepIndex], [key]: value };
    updateCaseSteps(caseIndex, steps);
  };
  const addStep = (caseIndex: number, action: string) => {
    if (!project || !action) return;
    updateCaseSteps(caseIndex, [...(project.cases[caseIndex]?.steps ?? []), createEditableStep(action)]);
  };
  const removeStep = (caseIndex: number, stepIndex: number) => {
    if (!project) return;
    updateCaseSteps(caseIndex, (project.cases[caseIndex]?.steps ?? []).filter((_step, index) => index !== stepIndex));
  };
  const moveStep = (caseIndex: number, stepIndex: number, delta: number) => {
    if (!project) return;
    const steps = [...(project.cases[caseIndex]?.steps ?? [])];
    const destination = stepIndex + delta;
    if (destination < 0 || destination >= steps.length) return;
    [steps[stepIndex], steps[destination]] = [steps[destination]!, steps[stepIndex]!];
    updateCaseSteps(caseIndex, steps);
  };
  const editSteps = (item: Check, value: string) => {
    setStepDrafts(current => ({ ...current, [item.id]: value }));
    try { const steps = JSON.parse(value); if (Array.isArray(steps)) updateCaseSteps(project!.cases.indexOf(item), steps as Step[]); } catch { /* keep invalid editor text until corrected */ }
  };
  const addCase = () => {
    if (!project) return;
    const item: Check = { id: `manual-${Date.now()}`, title: '新测试用例', source: '人工补充', requirementRefs: [], priority: 'P2', category: 'functional', confidence: 'low', coverageAreas: ['functional'], lifecycleStatus: 'draft', selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'unknown', cleanup: '', kind: 'visible', expected: '', steps: [] };
    setProjects(rows => rows.map(row => row.id === project.id ? { ...row, cases: [...row.cases, item], reviewStatus: 'draft' } : row));
    setStepDrafts(current => ({ ...current, [item.id]: '[]' })); setRun(null);
  };
  const removeCase = (caseId: string) => {
    if (!project) return;
    setProjects(rows => rows.map(row => row.id === project.id ? { ...row, cases: row.cases.filter(item => item.id !== caseId), reviewStatus: 'draft' } : row));
    setRun(null);
  };
  const saveDraft = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage('');
    try { const updated = await request<Project>(`/api/document-projects/${project.id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: project.cases, ...((project.siteVersions?.length ?? 0) === 0 ? { targetUrl } : {}), apiContract: { ...project.apiContract, mappings: project.apiContract?.mappings ?? [], allowNetwork: project.apiContract?.allowNetwork === true } }) }); setProjects(rows => rows.map(item => item.id === updated.id ? updated : item)); setStepProbeResults({}); void refreshProjectRevisions(updated.id, 0, false); setMessage('用例与 API 映射草稿已保存。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const saveTestDataSet = async () => {
    if (!project || !testDataSetName.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const now = new Date().toISOString();
      const values = Object.fromEntries(Object.entries(parameterValues).filter(([key]) => parameterNames(project.cases).includes(key)));
      const existing = project.testDataSets?.find(item => item.id === testDataSetId);
      const next: TestDataSet[] = existing
        ? (project.testDataSets ?? []).map(item => item.id === existing.id ? { ...item, name: testDataSetName.trim(), values, updatedAt: now } : item)
        : [...(project.testDataSets ?? []), { id: crypto.randomUUID(), name: testDataSetName.trim(), values, createdAt: now, updatedAt: now }];
      const updated = await request<Project>('/api/document-projects/' + project.id + '/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testDataSets: next }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      void refreshProjectRevisions(updated.id, 0, false);
      const saved = updated.testDataSets?.find(item => item.name === testDataSetName.trim());
      setTestDataSetId(saved?.id ?? '');
      setMessage(saved ? '测试数据组“' + saved.name + '”已保存，可在后续回归中重复使用。' : '测试数据组已保存。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteTestDataSet = async () => {
    if (!project || !selectedTestDataSet) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = (project.testDataSets ?? []).filter(item => item.id !== selectedTestDataSet.id);
      const updated = await request<Project>('/api/document-projects/' + project.id + '/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testDataSets: next }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setTestDataSetId(''); setTestDataSetName(''); setParameterValues({});
      setMessage('测试数据组已删除。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const registerSiteVersion = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/site-versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: siteVersionLabel, environment: siteVersionEnvironment, targetUrl: siteVersionTargetUrl, changeNotes: siteVersionChangeNotes }) });
      const version = updated.siteVersions?.find(item => item.id === updated.activeSiteVersionId) ?? updated.siteVersions?.at(-1);
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setSiteVersionId(version?.id ?? '');
      setTargetUrl(updated.targetUrl);
      setSiteVersionTargetUrl(version?.targetUrl ?? updated.targetUrl);
      setSiteVersionLabel('');
      setSiteVersionChangeNotes('');
      setRun(null);
      setMessage(version ? `已登记网站版本“${version.label}”，后续运行会固定记录此版本。` : '网站版本已登记。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const analyzeIterationImpact = async () => {
    if (!project || !selectedSiteVersion) return;
    setBusy(true); setError(''); setMessage('正在根据本次迭代说明匹配已有用例…');
    try {
      const result = await request<{ project: Project; analysis: ImpactAnalysis }>(`/api/document-projects/${project.id}/impact-reviews`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', siteVersionId: selectedSiteVersion.id }),
      });
      setProjects(rows => rows.map(item => item.id === project.id ? { ...item, impactAnalyses: result.project.impactAnalyses } : item));
      setImpactAnalysisId(result.analysis.id);
      setImpactSelectedCaseIds(result.analysis.suggestions.map(item => item.caseId));
      setImpactReviewNotes('');
      setMessage(`已生成 ${result.analysis.suggestions.length} 条待人工核对的候选用例；关键词匹配不等于语义判断。`);
    } catch (e) { setError((e as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };
  const reviewIterationImpact = async (decision: 'accept' | 'reject') => {
    if (!project || !selectedImpactAnalysis) return;
    if (decision === 'accept' && !impactSelectedCaseIds.length) { setError('请至少选择一条要确认的用例；没有受影响用例时可以拒绝建议。'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<{ project: Project; analysis: ImpactAnalysis }>(`/api/document-projects/${project.id}/impact-reviews`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'review', analysisId: selectedImpactAnalysis.id, decision, ...(decision === 'accept' ? { selectedCaseIds: impactSelectedCaseIds } : {}), ...(impactReviewNotes.trim() ? { notes: impactReviewNotes.trim() } : {}) }),
      });
      setProjects(rows => rows.map(item => item.id === project.id ? { ...item, impactAnalyses: result.project.impactAnalyses } : item));
      setImpactAnalysisId(result.analysis.id);
      setImpactSelectedCaseIds(result.analysis.selectedCaseIds ?? []);
      setMessage(decision === 'accept' ? '已确认影响范围。用例和本轮执行范围尚未更改；如需纳入本轮，请单独选择加入。' : '已拒绝这组影响建议，记录已保留。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
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
  const createIterationCaseDraft = async () => {
    if (!project || !selectedSiteVersion || !selectedSiteVersion.changeNotes.trim()) return;
    const noteSummary = selectedSiteVersion.changeNotes.trim().replace(/\s+/gu, ' ').slice(0, 54);
    const item: Check = {
      id: `iteration-${crypto.randomUUID()}`,
      title: `待补充：${noteSummary}`,
      source: `网站版本 ${selectedSiteVersion.label} 的迭代说明`,
      modulePath: [], requirementRefs: [`网站版本：${selectedSiteVersion.label}`, selectedSiteVersion.changeNotes.slice(0, 500)],
      priority: 'P2', category: 'functional', confidence: 'low', coverageAreas: ['functional'],
      lifecycleStatus: 'draft', selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [],
      sideEffectRisk: 'unknown', cleanup: '', caseOrigin: 'iteration-impact-draft', kind: 'visible', expected: '', steps: [],
    };
    setBusy(true); setError(''); setMessage('正在保存迭代用例草稿…');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/update`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cases: [...project.cases, item] }),
      });
      setProjects(rows => rows.map(row => row.id === updated.id ? updated : row));
      setStepDrafts(current => ({ ...current, [item.id]: '[]' }));
      setRun(null);
      setMessage('迭代用例草稿已保存，处于未选中、待补步骤和预期的状态，不会参与本轮运行。');
    } catch (e) { setError((e as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };
  const generateCases = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage('正在按需求文档整理 AI 候选用例…');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/generate-cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setStepDrafts(Object.fromEntries(updated.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)])));
      setRun(null); setMessage(updated.generationWarning ? `已生成 ${updated.cases.length} 条候选用例。${updated.generationWarning}` : `已生成 ${updated.cases.length} 条候选；请复核步骤和前置条件，再手动启动回归。`);
    } catch (e) { setError((e as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };
  const repairBlockedCases = async () => {
    if (!project || !blockedStepCaseIds.length) return;
    setBusy(true); setError(''); setMessage('Agent 正在读取阻塞原因，并尝试修订可由页面证据支持的步骤…');
    try {
      const result = await request<{ project: Project; attemptedCaseIds: string[]; repairedCaseIds: string[]; blockedCaseIds: string[]; regressionStarted: false }>(`/api/document-projects/${project.id}/repair-steps`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: blockedStepCaseIds }),
      });
      setProjects(rows => rows.map(item => item.id === result.project.id ? result.project : item));
      setStepDrafts(Object.fromEntries(result.project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)])));
      setRun(null);
      setMessage(result.repairedCaseIds.length
        ? `Agent 修订了 ${result.repairedCaseIds.length} 条用例步骤，已保存为未选中的草稿；请逐条复核、补齐前置条件并重新审核。仍有 ${result.blockedCaseIds.length} 条阻塞，原因见对应卡片。没有启动回归测试。`
        : result.attemptedCaseIds.length
          ? `Agent 已尝试复查 ${result.attemptedCaseIds.length} 条阻塞用例，但没有找到通过校验的修订；未修改用例，也没有启动回归测试。其余用例未交给 Agent，因为验收标准或页面证据不足。请按逐条提示补充信息。`
          : `这些用例未交给 Agent，因为验收标准或页面证据不足；未修改用例，也没有启动回归测试。请按逐条提示补充页面入口、控件或验收标准。`);
    } catch (e) { setError((e as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!project) return;
    setBusy(true); setError('');
    try {
      await request<Project>(`/api/document-projects/${project.id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: project.cases, ...((project.siteVersions?.length ?? 0) === 0 ? { targetUrl } : {}), apiContract: { ...project.apiContract, mappings: project.apiContract?.mappings ?? [], allowNetwork: project.apiContract?.allowNetwork === true } }) });
      const updated = await request<Project>(`/api/document-projects/${project.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setStepProbeResults({});
      const selectedCaseIds = updated.cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false).map(item => item.id);
      if (!selectedCaseIds.length) throw new Error('没有选中回归用例；请先选择至少一条再运行。');
      const selectedIds = new Set(selectedCaseIds);
      const targetCaseIds = effectiveScopePlan.targetCaseIds.filter(id => selectedIds.has(id));
      const impactCaseIds = effectiveScopePlan.impactCaseIds.filter(id => selectedIds.has(id) && !targetCaseIds.includes(id));
      const classifiedIds = new Set([...targetCaseIds, ...impactCaseIds]);
      targetCaseIds.push(...selectedCaseIds.filter(id => !classifiedIds.has(id)));
      const approvedScopePlan: RunScopePlan = {
        mode: impactCaseIds.length ? 'impact'
          : effectiveScopePlan.mode === 'impact' ? targetCaseIds.length === 1 ? 'single' : 'feature'
            : effectiveScopePlan.mode === 'single' && targetCaseIds.length !== 1 ? 'custom' : effectiveScopePlan.mode,
        targetCaseIds,
        impactCaseIds,
        ...(effectiveScopePlan.impactReasons ? { impactReasons: Object.fromEntries(Object.entries(effectiveScopePlan.impactReasons).filter(([id]) => impactCaseIds.includes(id))) } : {}),
      };
      setMessage(runMode === 'regression' ? '用例已审核，正在运行确定性常规回归…' : '用例已审核，正在运行 AI 辅助对照…');
      const result = await startAndWaitForRun(project.id, { runMode, selectedCaseIds, scopePlan: approvedScopePlan, ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}), ...(baselineRunId ? { baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues }, setMessage, 'start', setActiveRunId);
      setRun(result); setRunMode(result.runMode ?? runMode); refreshRunHistory(project.id); setMessage(result.overall === 'cancelled' ? '运行已停止；已完成的结果保留，取消或未运行用例可定向重跑。' : result.overall === 'passed' ? '本轮测试通过；报告和脚本包已生成。' : result.overall === 'failed' ? '本轮测试发现失败；已保留逐用例结果和证据。' : '本轮有未验证或阻塞项；已保留部分结果和证据。');
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); setActiveRunId(''); setCancelRequested(false); }
  };

  const updateApiContract = (apiContract: ApiContract) => {
    if (!project) return;
    setProjects(rows => rows.map(item => item.id === project.id ? { ...item, apiContract, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const chooseApiSuite = (suiteId: string) => {
    updateApiContract({ ...(suiteId ? { suiteId } : {}), mappings: [], allowNetwork: false, allowMutations: false, allowConcurrency: false });
    setApiSuiteDetail(null); setApiSuiteError('');
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
  const execute = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage(runMode === 'regression' ? '正在运行确定性常规回归…' : '正在运行确定性脚本与视觉 Computer Use 对照…');
    try { const selectedCaseIds = selectedCases.map(item => item.id); if (!selectedCaseIds.length) throw new Error('没有选中回归用例；请选择至少一条。'); const result = await startAndWaitForRun(project.id, { runMode, selectedCaseIds, scopePlan: effectiveScopePlan, ...(selectedSiteVersion ? { siteVersionId: selectedSiteVersion.id } : {}), ...(baselineRunId ? { baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues }, setMessage, 'start', setActiveRunId); setRun(result); setRunMode(result.runMode ?? runMode); refreshRunHistory(project.id); setMessage(result.overall === 'cancelled' ? '运行已停止；已完成的结果保留，取消或未运行用例可定向重跑。' : result.overall === 'passed' ? '本轮测试通过；报告和脚本包已生成。' : result.overall === 'failed' ? '本轮测试发现失败；已保留逐用例结果和证据。' : '本轮有未验证或阻塞项；已保留部分结果和证据。'); }
    catch (e) { setError((e as Error).message); setMessage(''); } finally { setBusy(false); setActiveRunId(''); setCancelRequested(false); }
  };

  const retestUnresolved = async () => {
    if (!project || !run || !retestCaseIds.length) return;
    setBusy(true); setError('');
    try {
      setMessage(`正在安全校验并定向重测 ${retestCaseIds.length} 条差异或未验证用例…`);
      const result = await startAndWaitForRun(project.id, { parentRunId: run.id, caseIds: retestCaseIds, runMode: run.runMode ?? 'compare', notes: '依据父运行差异/未验证/失败诊断进行定向重测；保留原用例与预期。' }, setMessage, 'retest', setActiveRunId);
      setRun(result); setMessage(result.finalReady ? '定向重测完成；结果已与父运行关联，报告和脚本包已更新。' : '定向重测仍有未对齐项；父运行关系和逐用例证据已写入报告。');
    } catch (e) { setError((e as Error).message); setMessage(''); } finally { setBusy(false); setActiveRunId(''); setCancelRequested(false); }
  };

  const resumeInterrupted = async () => {
    if (!project || !recovery?.canResume) return;
    setBusy(true); setError(''); setMessage('正在复用上次浏览器会话，跳过已完成用例并检查中断项的副作用风险…');
    setActiveRunId(recovery.runId);
    try {
      const result = await request<Run>(`/api/document-projects/${project.id}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: recovery.runId }) });
      setRun(result); setRecovery(null); setMessage(result.finalReady ? '恢复运行完成，两侧结果已对齐；报告和脚本包已生成。' : '恢复运行完成，但存在未对齐项；请查看部分报告与逐用例结果。');
    } catch (e) { setError((e as Error).message); setMessage(''); } finally { setBusy(false); setActiveRunId(''); setCancelRequested(false); }
  };

  const finalizeInterruptedPackage = async () => {
    if (!project || !recovery?.canFinalizePackage) return;
    setBusy(true); setError(''); setMessage('正在使用已保存的执行结果重试报告与脚本包；不会重新打开目标网站。');
    try {
      const result = await request<Run>(`/api/document-runs/${encodeURIComponent(recovery.runId)}/finalize-package`, { method: 'POST' });
      setRun(result); setRecovery(null); refreshRunHistory(project.id);
      setMessage('报告和脚本包已从保存的执行快照完成；本次没有重跑用例。');
    } catch (e) { setError((e as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };

  const cancelRun = async () => {
    if (!activeRunId || cancelRequested) return;
    setCancelRequested(true); setMessage('正在请求停止当前运行并保存部分结果…');
    try {
      const outcome = await request<{ status: string }>(`/api/document-runs/${encodeURIComponent(activeRunId)}/cancel`, { method: 'POST' });
      setMessage(outcome.status === 'requested' ? '已请求停止；正在保存停止前的结果…' : '用例执行已结束，正在完成报告。');
    } catch (e) { setCancelRequested(false); setError((e as Error).message); }
  };

  const continueAfterLogin = async () => {
    if (!project) return;
    try { const state = await request<LoginHandoff>(`/api/document-projects/${project.id}/login/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setLoginHandoff(state); setMessage('收到确认，测试 Agent 正在恢复当前运行…'); }
    catch (e) { setError((e as Error).message); }
  };

  useEffect(() => {
    if (!project) { setLoginHandoff(null); return; }
    let live = true;
    const pollLogin = async () => {
      try {
        const state = await request<LoginHandoff | null>(`/api/document-projects/${project.id}/login`);
        if (!live) return;
        setLoginHandoff(state);
        if (!state) return;
        if (notifiedLoginRun.current !== state.runId) {
          window.focus();
          if ('Notification' in window && Notification.permission === 'granted') new Notification('TestPilot 需要你登录', { body: '测试浏览器窗口已置顶。完成登录后回到 TestPilot 点击“继续测试”。' });
          notifiedLoginRun.current = state.runId;
        }
      } catch { /* the login handoff may not exist for this run */ }
    };
    void pollLogin();
    const timer = window.setInterval(pollLogin, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [project?.id]);

  useEffect(() => {
    if (!project) { setRecovery(null); return; }
    let live = true;
    const checkRecovery = async () => {
      try { const state = await request<Recovery | null>(`/api/document-projects/${project.id}/recovery`); if (live) setRecovery(state); }
      catch { if (live) setRecovery(null); }
    };
    void checkRecovery();
    const timer = window.setInterval(checkRecovery, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [project?.id, project?.reviewStatus]);

  const renderComparison = (item: Comparison) => {
    const scopeLabel = run?.scopePlan
      ? run.scopePlan.targetCaseIds.includes(item.id) ? '直接目标' : run.scopePlan.impactCaseIds.includes(item.id) ? '关联影响' : '范围未分类'
      : run?.caseScopeKnown === false ? '历史范围未标注' : '目标/影响未标注';
    const scopeTone = scopeLabel === '直接目标' ? 'target' : scopeLabel === '关联影响' ? 'impact' : 'unknown';
    const failed = item.deterministic === 'failed' || item.apiContract === 'failed';
    const unresolved = item.resolution === 'unresolved';
    const mismatch = item.resolution === 'mismatch';
    const impactReasons = run?.scopePlan?.impactReasons?.[item.id] ?? [];
    const cancelled = item.deterministic === 'cancelled' || item.computerUse === 'cancelled' || item.apiContract === 'cancelled';
    const notRun = item.deterministic === 'not-run' || item.computerUse === 'not-run' || item.apiContract === 'not-run';
    const resultLabel = cancelled ? 'Ⅱ 已取消'
      : notRun ? '— 未运行'
        : unresolved ? '! 未验证'
          : mismatch ? '⚠ 结果不一致'
            : failed ? '× 回归失败'
              : item.resolution === 'not-applicable' ? '— N/A'
                : run?.runMode === 'regression' ? '✓ 通过'
                  : item.aligned ? '✓ 已对齐' : '! 待处理';
    const resultClass = cancelled || notRun || item.resolution === 'not-applicable'
      ? ''
      : item.aligned && !failed && !mismatch && !unresolved ? 'aligned' : 'mismatch';
    return <article key={item.id} className={`doc-comparison ${resultClass}`}><strong>{resultLabel} · <span className={`doc-run-scope-badge ${scopeTone}`}>{scopeLabel}</span> · {item.title} ({item.id})</strong><p>脚本：{item.deterministic}{run?.runMode !== 'regression' ? `　Computer Use：${item.computerUse}` : ''}</p>{impactReasons.length > 0 && <small className="doc-impact-run-reason">关联影响依据：{impactReasons.join('；')}</small>}{item.issue && <small>{item.issue} 编辑脚本 / 预期后重新审核并重跑。</small>}{item.triage && <small className="doc-triage">初步归类：{triageLabels[item.triage.category]}（{item.triage.confidence === 'evidence-based' ? '有直接证据' : '需复核'}） · {item.triage.detail}</small>}{(failed || mismatch || unresolved) && item.nextAction && <p className="doc-next-action"><strong>下一步可执行动作：</strong>{item.nextAction}</p>}</article>;
  };
  const runTargetComparisons = run?.scopePlan ? run.comparisons.filter(item => run.scopePlan!.targetCaseIds.includes(item.id)) : [];
  const runImpactComparisons = run?.scopePlan ? run.comparisons.filter(item => run.scopePlan!.impactCaseIds.includes(item.id)) : [];
  const baselineGroupOrder: BaselineScopeGroup[] = ['target', 'impact', 'unselected', 'removed', 'unknown'];
  const runBaselineComparisons = run?.baselineComparison ?? [];
  const baselineScopePlan = run?.scopePlan;
  const baselineCaseScopeLabel = (caseId: string) => {
    const scope = run?.baselineRunSnapshot?.scopePlan;
    if (!scope) return '旧版范围未标注';
    if (scope.targetCaseIds.includes(caseId)) return '直接目标';
    if (scope.impactCaseIds.includes(caseId)) return '关联影响';
    return '基线未选';
  };
  const currentBaselineCaseScopeLabel = (item: BaselineComparison) => {
    if (item.disposition === 'removed') return '已从当前项目移除';
    if (run?.scopePlan) {
      if (run.scopePlan.targetCaseIds.includes(item.caseId)) return '直接目标';
      if (run.scopePlan.impactCaseIds.includes(item.caseId)) return '关联影响';
    }
    if (run?.caseScope?.selectedCaseIds.includes(item.caseId)) return '本轮已执行，范围未分类';
    if (run?.caseScopeKnown === false) return '本轮历史范围未标注';
    if (run?.caseScope?.excludedCaseIds.includes(item.caseId)) return '本轮未选';
    return '本轮范围未知';
  };
  const runBaselineGroups = runBaselineComparisons.length ? baselineGroupOrder.map(group => ({
    group,
    label: baselineScopeGroupLabels[group],
    items: runBaselineComparisons.filter(item => baselineScopeGroup(item, baselineScopePlan) === group),
  })).filter(group => group.items.length > 0) : [];
  const runExcludedCaseIds = run?.caseScope?.excludedCaseIds ?? [];
  const runExcludedCaseLabels = runExcludedCaseIds.map(id => ({ id, title: project?.cases.find(item => item.id === id)?.title ?? run?.baselineComparison?.find(item => item.caseId === id)?.title ?? id }));
  const renderHistoryItem = (item: RunListItem) => {
    const scope = item.scopePlan;
    const scopeDetail = scope ? `直接目标 ${scope.targetCaseIds.length} 条 · 关联影响 ${scope.impactCaseIds.length} 条` : '历史记录未标注目标/影响范围';
    const targetNames = scope?.targetCaseIds.map(id => item.caseTitles?.[id] ?? id) ?? [];
    const impactNames = scope?.impactCaseIds.map(id => item.caseTitles?.[id] ?? id) ?? [];
    const conciseNames = (names: string[]) => `${names.slice(0, 2).join('、') || '无'}${names.length > 2 ? ` 等 ${names.length} 项` : ''}`;
    const namedScope = scope ? `目标：${conciseNames(targetNames)} · 影响：${conciseNames(impactNames)}` : '';
    const baselineDetail = item.baselineRunId
      ? `基线 ${item.baselineSiteVersionSnapshot ? `${item.baselineSiteVersionSnapshot.environment} · ${item.baselineSiteVersionSnapshot.label}` : item.baselineRunId.slice(0, 8)}${item.baselineEnvironmentComparison === 'different' ? ' · 跨环境' : item.baselineEnvironmentComparison === 'unknown' ? ' · 环境未知' : ''}${item.baselineRunModeComparison === 'different' ? ' · 测试方式不同' : item.baselineRunModeComparison === 'unknown' ? ' · 测试方式未知' : ''}`
      : '';
    const executionStateLabel = item.executionState === 'running' ? '运行中' : item.executionState === 'failed' ? '运行失败' : item.executionState === 'interrupted' ? '运行中断' : '';
    const resultCounts = item.resultCounts ?? {};
    const recordedResults = item.recordedCaseCount === undefined ? '' : ` · 已记录 ${item.recordedCaseCount}/${item.selectedCaseCount} 条结果（通过 ${resultCounts.passed ?? 0}、失败 ${resultCounts.failed ?? 0}、阻塞 ${resultCounts.blocked ?? 0}）`;
    return <article className={run?.id === item.id ? 'current' : ''} key={item.id} aria-current={run?.id === item.id ? 'true' : undefined}>
      <div><strong>{executionStateLabel ? `${executionStateLabel} · ` : ''}{item.parentRunId ? '定向重测 · ' : ''}{scope ? runScopeLabels[scope.mode] : '旧版运行'} · {executionStateLabel ? recoveryStageLabel[item.stage ?? 'starting'] : runOutcomeLabels[item.overall] ?? item.overall}</strong><span>{item.siteVersionSnapshot ? `${item.siteVersionSnapshot.environment} · ${item.siteVersionSnapshot.label}` : '未登记网站版本'} · {new Date(item.startedAt).toLocaleString()}</span><small>{scopeDetail}{namedScope ? ` · ${namedScope}` : ''}{item.parentRunId ? ` · 父运行 ${item.parentRunId.slice(0, 8)}` : ''}{baselineDetail ? ` · ${baselineDetail}` : ''} · 本轮 {item.selectedCaseCount}/{item.totalCases} 条{item.baselineEligible ? ' · 可作比较基线' : ''}{recordedResults}</small>{item.lastError && <small className="doc-run-history-error">收尾错误：{item.lastError}</small>}</div>
      {executionStateLabel ? <button className="button-secondary" disabled={Boolean(historyLoadingId)} onClick={() => { const banner = document.getElementById('doc-run-recovery'); if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'center' }); else setError(item.lastError ?? '该运行尚未归档为完整结果。'); }}>{item.canFinalizePackage ? '查看打包恢复' : '查看运行状态'}</button> : <button className="button-secondary" disabled={Boolean(historyLoadingId)} onClick={() => void openHistoricalRun(item)}>{historyLoadingId === item.id ? '读取中…' : run?.id === item.id ? '当前结果' : '查看结果'}</button>}
    </article>;
  };

  return <div className={`secondary-page doc-tests-page ${embedded ? 'doc-tests-embedded' : ''}`}>
    {!embedded && <div className="page-heading"><div><div className="eyebrow">WEB REGRESSION</div><h1>网页回归测试</h1><p>按版本运行用例，快速发现回归。</p></div></div>}
    {error && <div className="doc-notice error">{error}</div>}{message && <div className="doc-notice">{message}</div>}
    {recovery && <section id="doc-run-recovery" className="login-handoff" role="status"><div><strong>{recovery.isRunning ? recovery.stage === 'packaging' ? '正在生成报告和脚本包' : '测试正在运行' : recovery.stage === 'packaging' ? '执行结束，报告打包未完成' : '发现一轮未完成的测试'}</strong><p>{recovery.reason} {recovery.isRunning ? `当前阶段：${recoveryStageLabel[recovery.stage]}。` : ''} {recovery.isRunning && recovery.progress ? `已记录 ${recovery.progress.completed}/${recovery.progress.total} 项：通过 ${recovery.progress.counts.passed ?? 0}，失败 ${recovery.progress.counts.failed ?? 0}，阻塞 ${recovery.progress.counts.blocked ?? 0}。` : ''} {recovery.isRunning && recovery.progress?.currentCase ? `当前：${recovery.progress.currentCase.id} ${recovery.progress.currentCase.title}（${recovery.progress.currentCase.lane}）。` : ''} {!recovery.isRunning && recovery.stage === 'awaiting-login' ? '上次中断在登录接力阶段。恢复时会检查原 Edge 标签页中的当前登录状态；若仍需登录，才会再次提醒。恢复会重用原运行编号与 Edge 会话，跳过已完成用例；中断项只在风险可确认时重试。' : ''}</p>{recovery.lastError && <small>上次错误：{recovery.lastError}</small>}<small>{recovery.isRunning ? '页面每 3 秒更新进度' : `上次开始：${new Date(recovery.startedAt).toLocaleString()} · 已恢复 ${recovery.resumeCount} 次`}</small>{!recovery.isRunning && (recovery.recordedResults?.length ?? 0) > 0 && <details className="recovery-result-details"><summary>查看已记录的逐用例结果（{recovery.recordedResultCount ?? recovery.recordedResults!.length} 条）</summary><ul>{recovery.recordedResults!.map((item, index) => <li key={`${item.lane}-${item.id}-${item.updatedAt}-${index}`}><span className={`recovery-result-status status-${item.status}`}>{recoveryCaseStatusLabels[item.status] ?? item.status}</span><strong>{item.id} · {item.title}</strong><small>{item.lane === 'deterministic' ? '确定性脚本' : '视觉 Computer Use'} · {item.durationMs} ms</small></li>)}</ul>{(recovery.recordedResultCount ?? 0) > recovery.recordedResults!.length && <small>只显示最近 {recovery.recordedResults!.length} 条；共记录 {recovery.recordedResultCount} 条。</small>}</details>}</div>{recovery.canFinalizePackage && !recovery.isRunning ? <button className="button-primary" disabled={busy} onClick={finalizeInterruptedPackage}>{busy ? '正在打包…' : '重试报告与脚本包'}</button> : recovery.canResume && !recovery.isRunning && <button className="button-primary" disabled={busy} onClick={resumeInterrupted}>{busy ? '正在恢复…' : '恢复上次运行'}</button>}</section>}
    {loginHandoff && <section className="login-handoff" role="alert"><div><strong>请在测试浏览器中完成登录</strong><p>{loginHandoff.status === 'ready_to_continue' ? '已收到完成登录的确认，正在恢复测试。' : '测试窗口已置顶。请在那个窗口里自行完成登录；TestPilot 不会查看或保存你的密码。登录成功后回到此处点击继续。'}</p><small>{loginHandoff.targetUrl}</small></div><button className="button-primary" disabled={loginHandoff.status === 'ready_to_continue'} onClick={continueAfterLogin}>{loginHandoff.status === 'ready_to_continue' ? '正在继续…' : '我已登录，继续测试'}</button></section>}
    {!embedded && <section className={project && !importExpanded ? 'doc-import-card doc-import-card-collapsed' : 'doc-import-card'}><h2>{project ? <button type="button" className="doc-import-toggle" aria-expanded={importExpanded} onClick={() => setImportExpanded(value => !value)}>导入或更新项目资料 <span>{importExpanded ? '收起' : '展开'}</span></button> : '1 · 导入需求与目标应用'}</h2><div className="doc-import-grid"><label>用例集名称<input value={name} onChange={e => setName(e.target.value)} placeholder="例如：部门申样书" /></label><label>{project?.siteVersions?.length ? '当前项目目标网址' : '目标应用网址'}<input value={targetUrl} readOnly={(project?.siteVersions?.length ?? 0) > 0} onChange={e => { setTargetUrl(e.target.value); if (project && !(project.siteVersions?.length)) setProjects(rows => rows.map(item => item.id === project.id ? { ...item, reviewStatus: 'draft' } : item)); }} placeholder="https://example.com/" />{project?.siteVersions?.length ? <small>该项目已启用版本管理；请在下方登记新版本来变更部署网址。</small> : null}</label><label className="doc-file-field">需求文档<input type="file" accept=".pdf,.xmind,.md,.markdown,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} /><small>支持 PDF、XMind、Markdown、TXT，最大 9 MB。扫描版 PDF 暂不支持 OCR。</small></label><label className="review-policy"><input type="checkbox" checked={confirmBeforeRun} onChange={e => setConfirmBeforeRun(e.target.checked)} /><span>运行前需要我确认</span></label><button className="button-primary" disabled={busy || !file} onClick={importFile}>{busy ? '处理中…' : '导入并准备测试'}</button></div></section>}
    {!embedded && projects.length > 0 && <label className="doc-project-select">已导入项目<select value={selectedId} onChange={e => { setSelectedId(e.target.value); const item = projects.find(row => row.id === e.target.value); if (item) setTargetUrl(item.targetUrl); setRun(null); }}><option value="">选择项目</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name} · {item.fileName}</option>)}</select></label>}
    {project && <nav className="doc-project-nav" aria-label="测试项目分区">
      <a href="#doc-version">版本</a>
      <a href="#doc-impact">影响</a>
      <a href="#doc-cases">用例</a>
      <a href="#doc-execution">运行</a>
      <a href="#doc-run-history">运行记录</a>
      {run && <a href="#doc-results">本轮结果</a>}
    </nav>}
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
        <div className="doc-buttons"><button className="button-secondary" disabled={sessionIdentitySaving} onClick={saveSessionIdentity}>{sessionIdentitySaving ? '正在保存…' : '保存身份备注'}</button><button className="button-secondary" disabled={sessionStatusLoading} onClick={() => void refreshSessionStatus()}>{sessionStatusLoading ? '正在检查…' : '刷新会话状态'}</button></div>
      </section>
      </details>
      <section className="doc-site-version-card" id="doc-version">
        <div className="doc-section-head"><div><h2>网站版本与迭代</h2><p>每轮测试固定使用一个版本和环境。</p></div><span className={`table-status ${selectedSiteVersion ? 'status-passed' : 'status-running'}`}>{selectedSiteVersion ? `${selectedSiteVersion.environment} · ${selectedSiteVersion.label}` : '尚未登记版本'}</span></div>
        {(project.siteVersions?.length ?? 0) > 0
          ? <>
            <label>测试版本<select aria-label="本轮测试的网站版本" value={selectedSiteVersion?.id ?? ''} onChange={event => { const version = project.siteVersions?.find(item => item.id === event.target.value); setSiteVersionId(event.target.value); if (version) { setTargetUrl(version.targetUrl); setSiteVersionTargetUrl(version.targetUrl); } setRun(null); }}>
              {project.siteVersions?.map(version => <option key={version.id} value={version.id}>{version.environment} · {version.label}</option>)}
            </select></label>
            {selectedSiteVersion && <div className="doc-site-version-meta"><div><strong>本轮目标</strong><span>{selectedSiteVersion.targetUrl}</span></div><div><strong>迭代说明</strong><span>{selectedSiteVersion.changeNotes || '未填写'}</span></div><small>登记时间：{new Date(selectedSiteVersion.createdAt).toLocaleString()}</small></div>}
          </>
          : <p className="doc-notice">当前项目尚无版本记录。登记后，运行将明确绑定网站版本；之前的旧运行仍显示为未登记。</p>}
        <details className="doc-site-version-form"><summary>登记一个网站版本</summary><div className="doc-site-version-fields">
          <label>版本标识<input value={siteVersionLabel} onChange={event => setSiteVersionLabel(event.target.value)} maxLength={80} placeholder="例如 v1.8.2 或 2026.10.21-rc1" /></label>
          <label>测试环境<input value={siteVersionEnvironment} onChange={event => setSiteVersionEnvironment(event.target.value)} maxLength={80} placeholder="主环境" /></label>
          <label>部署网址<input value={siteVersionTargetUrl} onChange={event => setSiteVersionTargetUrl(event.target.value)} maxLength={2000} placeholder="https://test.example.com/" /></label>
          <label className="doc-site-version-notes">本次迭代说明<textarea value={siteVersionChangeNotes} onChange={event => setSiteVersionChangeNotes(event.target.value)} maxLength={2000} placeholder="说明本次更新内容，供运行历史和回归差异复核" /></label>
          <button className="button-secondary" disabled={busy || !siteVersionLabel.trim() || !siteVersionEnvironment.trim() || !siteVersionTargetUrl.trim()} onClick={registerSiteVersion}>{busy ? '正在登记…' : '保存网站版本'}</button>
        </div></details>
      </section>
      <section className="doc-impact-card" id="doc-impact">
        <div className="doc-section-head"><div><h2>迭代影响建议</h2><p>按变更说明推荐用例，确认后再加入本轮。</p></div>{selectedImpactAnalysis && <span className={`table-status ${selectedImpactAnalysis.status === 'accepted' ? 'status-passed' : selectedImpactAnalysis.status === 'rejected' ? 'status-running' : 'status-running'}`}>{selectedImpactAnalysis.status === 'pending' ? '待人工审核' : selectedImpactAnalysis.status === 'accepted' ? '已确认' : '已拒绝'}</span>}</div>
        {!selectedSiteVersion && <p className="doc-notice">先登记并选择一个网站版本，再分析迭代影响。</p>}
        {selectedSiteVersion && !selectedSiteVersion.changeNotes.trim() && <p className="doc-notice">当前版本没有迭代说明。登记新版本时补充变更内容后，才能生成有依据的影响建议。</p>}
        {selectedSiteVersion && <div className="doc-impact-actions">
          <button className="button-secondary" disabled={busy || !selectedSiteVersion.changeNotes.trim()} onClick={analyzeIterationImpact}>分析迭代影响</button>
          <button className="text-button" disabled={busy || !selectedSiteVersion.changeNotes.trim()} onClick={createIterationCaseDraft}>新增待完善用例</button>
          <small>补全步骤和预期后才能运行。</small>
        </div>}
        {selectedImpactAnalysis && <div className="doc-impact-results">
          <div className="doc-impact-note"><strong>分析依据 · {selectedImpactAnalysis.siteVersionLabel}</strong><span>{selectedImpactAnalysis.changeNotesSnapshot}</span><small>确定性关键词匹配 · {new Date(selectedImpactAnalysis.analyzedAt).toLocaleString()} · 仅为候选建议，不代表语义覆盖或产品缺陷结论。</small></div>
          {selectedImpactAnalysis.suggestions.length > 0 ? <fieldset className="doc-impact-suggestions" disabled={busy || selectedImpactAnalysis.status !== 'pending'}>
            <legend>可能受影响的用例（可调整本次确认范围）</legend>
            {selectedImpactAnalysis.suggestions.map(suggestion => <label className="doc-impact-suggestion" key={suggestion.caseId}>
              <input type="checkbox" checked={impactSelectedCaseIds.includes(suggestion.caseId)} onChange={event => setImpactSelectedCaseIds(ids => event.target.checked ? [...new Set([...ids, suggestion.caseId])] : ids.filter(id => id !== suggestion.caseId))} />
              <span><strong>{suggestion.title}</strong><small>{suggestion.caseId} · 匹配分 {suggestion.score.toFixed(1)} · 词项：{suggestion.matchedTerms.join('、')}</small><small>依据：{suggestion.evidence.join('；')}</small></span>
            </label>)}
          </fieldset> : <p className="doc-notice">没有找到足够匹配的现有用例。请检查未匹配词项，必要时手工新增草稿。</p>}
          {selectedImpactAnalysis.status === 'pending' && <details className="doc-impact-manual-picker">
            <summary>手动补充其他用例</summary>
            <div>{project.cases.map(item => <label key={item.id}><input type="checkbox" checked={impactSelectedCaseIds.includes(item.id)} disabled={busy} onChange={event => setImpactSelectedCaseIds(ids => event.target.checked ? [...new Set([...ids, item.id])] : ids.filter(id => id !== item.id))} /><span>{item.title}<small>{item.id}{item.modulePath?.length ? ` · ${item.modulePath.join(' / ')}` : ''}</small></span></label>)}</div>
          </details>}
          {selectedImpactAnalysis.unmatchedTerms.length > 0 && <div className="doc-impact-unmatched"><strong>没有匹配到用例的变更词</strong><span>{selectedImpactAnalysis.unmatchedTerms.join('、')}</span><small>这些词可能代表新功能或当前用例信息不足，请人工判断是否新增或修改用例。</small></div>}
          {selectedImpactAnalysis.status === 'pending' && <>
            <label className="doc-impact-review-notes">审核备注（可选）<textarea value={impactReviewNotes} maxLength={1000} onChange={event => setImpactReviewNotes(event.target.value)} placeholder="记录为什么确认或拒绝这些用例" /></label>
            <div className="doc-buttons"><button className="button-primary" disabled={busy || impactSelectedCaseIds.length === 0} onClick={() => reviewIterationImpact('accept')}>确认所选影响用例</button><button className="button-secondary" disabled={busy} onClick={() => reviewIterationImpact('reject')}>拒绝本次建议</button></div>
          </>}
          {selectedImpactAnalysis.status === 'accepted' && <div className="doc-impact-confirmed"><strong>已确认 {selectedImpactAnalysis.selectedCaseIds?.length ?? 0} 条影响用例</strong>{selectedImpactAnalysis.reviewNotes && <span>审核备注：{selectedImpactAnalysis.reviewNotes}</span>}<button className="button-secondary" disabled={busy || !(selectedImpactAnalysis.selectedCaseIds?.length)} onClick={addAcceptedImpactToRun}>将已确认用例加入本轮范围</button><small>只调整本轮选择，不改用例步骤或预期；实际运行仍由你手动启动。</small></div>}
          {selectedImpactAnalysis.status === 'rejected' && <p className="doc-notice">本次建议已拒绝并留档。需要重新判断时，可重新分析当前版本。</p>}
        </div>}
      </section>
      <details className="doc-revision-disclosure" id="doc-revisions">
        <summary>项目修订历史 <span>{projectRevisionTotal} 条</span></summary>
        <section className="doc-site-version-card doc-revision-card">
        <div className="doc-section-head"><div><h2>用例、步骤与资料修订</h2><p>保存项目时自动留存不可覆盖的快照；运行开始时的快照仍以运行记录为准。资料正文保存在本机修订存储中。</p></div><span className="table-status status-passed">{projectRevisionTotal} 条修订</span></div>
        <details className="doc-material-upload">
          <summary>追加或替换项目资料</summary>
          <p>支持 PDF、XMind、Markdown、TXT，单份最多 9 MB。更新后会新增资料版本并将项目转为待审核；正式用例和历史运行不会被自动改写。</p>
          <div className="doc-material-upload-fields">
            <label>资料操作<select aria-label="资料操作" value={replaceProjectMaterialId} onChange={event => {
              const id = event.target.value; setReplaceProjectMaterialId(id);
              const material = project.sourceMaterials?.find(item => item.id === id);
              if (material && ['requirements', 'coverage-reference', 'held-out-benchmark'].includes(material.role)) setProjectMaterialRole(material.role as 'requirements' | 'coverage-reference' | 'held-out-benchmark');
            }}><option value="">新增资料</option>{(project.sourceMaterials ?? []).filter(item => item.role !== 'website-content').map(item => <option key={item.id} value={item.id}>替换：{item.fileName} · {item.role}</option>)}</select></label>
            <label>资料用途<select aria-label="资料用途" value={projectMaterialRole} onChange={event => setProjectMaterialRole(event.target.value as 'requirements' | 'coverage-reference' | 'held-out-benchmark')}><option value="requirements">需求资料</option><option value="coverage-reference">覆盖参考</option><option value="held-out-benchmark">留出基准</option></select></label>
            <label>新资料文件<input type="file" accept=".pdf,.xmind,.md,.markdown,.txt" onChange={event => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ''; setProjectMaterialFile(next); }} /><small>{projectMaterialFile ? `${projectMaterialFile.name} · ${Math.ceil(projectMaterialFile.size / 1024)} KB` : '选好文件后保存为该项目的新资料版本。'}</small></label>
            <button className="button-secondary" disabled={busy || !projectMaterialFile || (!replaceProjectMaterialId && (project.sourceMaterials ?? []).filter(item => item.role !== 'website-content').length >= 5)} onClick={() => void saveProjectMaterial()}>{busy ? '正在保存…' : replaceProjectMaterialId ? '保存替换版本' : '加入项目资料'}</button>
          </div>
        </details>
        <div className="doc-revision-filters">
          <label>类型<select aria-label="修订类型" value={projectRevisionKind} onChange={event => setProjectRevisionKind(event.target.value as ProjectRevisionKind | '')}><option value="">全部</option><option value="case">用例</option><option value="steps">执行步骤</option><option value="case-set">用例清单</option><option value="materials">测试资料</option><option value="test-data">测试数据组</option></select></label>
          <label>用例 / 数据组 ID<input aria-label="修订实体 ID" value={projectRevisionEntity} disabled={!projectRevisionKind || projectRevisionKind === 'materials' || projectRevisionKind === 'case-set'} onChange={event => setProjectRevisionEntity(event.target.value.replace(/[^A-Za-z0-9_.:-]/gu, '').replace(/^[^A-Za-z0-9]+/gu, '').slice(0, 80))} placeholder="筛选具体用例或数据组" /></label>
        </div>
        {projectRevisionError && <p className="doc-notice error">读取修订失败：{projectRevisionError}</p>}
        {projectRevisionLoading && <p className="doc-notice">正在读取修订历史…</p>}
        {!projectRevisionLoading && !projectRevisionError && projectRevisions.length === 0 && <p className="doc-notice">当前筛选没有修订记录；保存项目后会自动记录用例、步骤和资料快照。</p>}
        <div className="doc-revision-list">{projectRevisions.map(revision => {
          const detail = projectRevisionSnapshots[revision.id];
          const kindLabel = { case: '用例', steps: '执行步骤', 'case-set': '用例清单', materials: '测试资料', 'test-data': '测试数据组' }[revision.kind];
          return <article key={revision.id}>
            <div><strong>{kindLabel} · {revision.summary}</strong><small>{revision.kind === 'case-set' || revision.kind === 'materials' ? '' : `ID ${revision.entityId} · `}v{revision.version} · {new Date(revision.createdAt).toLocaleString()}</small><small>来源：{revision.source === 'run-snapshot' ? '旧运行快照回填' : '项目保存'} · SHA-256 {revision.digest}</small></div>
            <button className="text-button" disabled={projectRevisionBusyId === revision.id} onClick={() => void toggleProjectRevision(revision)}>{projectRevisionBusyId === revision.id ? '校验中…' : detail ? '隐藏快照' : '查看快照'}</button>
            {detail && <pre>{JSON.stringify(detail.snapshot, null, 2)}</pre>}
          </article>;
        })}</div>
        {projectRevisionOffset < projectRevisionTotal && <button className="button-secondary" disabled={projectRevisionLoading} onClick={() => void refreshProjectRevisions(project.id, projectRevisionOffset, true)}>{projectRevisionLoading ? '读取中…' : `加载更多（${projectRevisionOffset}/${projectRevisionTotal}）`}</button>}
      </section>
      </details>
      {embedded && <WorkflowRail stages={[
        { label: '读取资料与搜索', state: 'done' },
        { label: '生成用例与步骤', state: project.generationWarning ? 'warning' : stepsReady ? 'done' : 'current' },
        { label: '人工启动回归', state: executeState },
        { label: '查看运行结果', state: compareState },
        { label: '报告与脚本包', state: reportState },
      ]} />}
      <section className="doc-cases-card" id="doc-cases"><div className="doc-section-head"><div><h2>测试用例</h2><p>{project.cases.length} 条 · 已选 {selectedCaseCount} 条</p></div><div className="doc-buttons">{blockedStepCaseIds.length > 0 && <button className="button-secondary" disabled={busy || !modelAvailable} title={!modelAvailable ? '请先配置模型 API Key' : '将逐条失败原因反馈给 Agent，限次修订步骤并重新校验；不会运行测试'} onClick={repairBlockedCases}>{busy ? 'Agent 复查中…' : `Agent 复查阻塞项（${blockedStepCaseIds.length}）`}</button>}{project.caseMode !== 'existing' && <button className="button-secondary" disabled={busy || !modelAvailable} title={!modelAvailable ? '请先配置模型 API Key' : undefined} onClick={generateCases}>重新生成用例</button>}<span className={`table-status status-${project.reviewStatus === 'approved' ? 'passed' : 'running'}`}>{project.reviewStatus === 'approved' ? (project.confirmationRequired ? '已确认' : '已准备') : project.generationWarning ? '需处理' : project.confirmationRequired ? '待你确认' : '准备中'}</span></div></div>
        {project.generationWarning && <div className="doc-notice error">{project.generationWarning.includes('条用例没有形成可执行步骤：') ? '部分用例尚未形成可执行步骤；具体原因见各条用例下方的“步骤状态”，可尝试让 Agent 复查阻塞项。' : project.generationWarning}</div>}
        {safetyReviewCount > 0 && <div className="doc-notice">{safetyReviewCount} 条用例需确认只读和前置条件；未知或有副作用的用例会阻止运行。</div>}
        {lowConfidenceCount > 0 && <div className="doc-notice">有 {lowConfidenceCount} 条入选用例的预期置信度为低；请先补充可判定的验收标准，或复核后再批准执行。</div>}
        <details className="doc-api-contract">
          <summary>API 契约 <span>{project.apiContract?.suiteId ? '已关联' : '可选'}</span></summary>
          <p>只映射已审核的 API 套件；候选项需人工确认。</p>
          {apiSuiteError && <div className="doc-notice error">无法读取 API suite：{apiSuiteError}</div>}
          <label className="doc-api-suite-select">已审核 API suite
            <select aria-label="已审核 API suite" value={project.apiContract?.suiteId ?? ''} disabled={apiSuiteLoading && apiSuites.length === 0} onChange={event => chooseApiSuite(event.target.value)}>
              <option value="">不关联 API suite</option>
              {apiSuites.map(item => <option key={item.id} value={item.id}>{item.suiteName} · {item.caseCount} 条 · v{item.revision}</option>)}
              {project.apiContract?.suiteId && !apiSuites.some(item => item.id === project.apiContract?.suiteId) && <option value={project.apiContract.suiteId}>当前关联候选（未在已审核列表中）</option>}
            </select>
            {apiSuiteLoading && <small>正在读取候选…</small>}
            {!apiSuiteLoading && apiSuites.length === 0 && <small>暂无已审核套件。请先在“新建测试 → API 服务”导入并审核；不要猜接口。</small>}
          </label>
          {project.apiContract?.suiteId && apiSuiteDetail?.id === project.apiContract.suiteId && apiSuiteDetail.status === 'approved' && <>
            <div className="doc-api-suite-meta"><strong>{apiSuiteDetail.suite.name}</strong><span>{apiSuiteDetail.suite.cases.length} 条 API case · SHA-256 {apiSuiteDetail.digest.slice(0, 12)}…</span></div>
            <div className="doc-api-authorizations" aria-label="API 执行单独授权">
              <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowNetwork === true} onChange={event => updateApiContract({ ...project.apiContract, allowNetwork: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许访问非本机 API 目标</span></label>
              <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowMutations === true} onChange={event => updateApiContract({ ...project.apiContract, allowMutations: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许执行已审核 suite 声明的 POST / PUT / PATCH / DELETE 与 fixture 生命周期请求</span></label>
              <label className="review-policy doc-api-network"><input type="checkbox" checked={project.apiContract?.allowConcurrency === true} onChange={event => updateApiContract({ ...project.apiContract, allowConcurrency: event.target.checked, mappings: project.apiContract?.mappings ?? [] })} /><span>允许执行已审核 suite 声明的并发请求</span></label>
            </div>
            <small className="doc-api-help">授权默认关闭；写请求仅用于隔离、可清理的测试环境。</small>
            <div className="doc-api-mapping-list" aria-label="文档用例到 API case 映射">
              {project.cases.map(item => {
                const mapped = project.apiContract?.mappings?.find(entry => entry.documentCaseId === item.id)?.apiCaseIds ?? [];
                const candidates = suggestApiMappingCandidates(item, apiSuiteDetail.suite.cases);
                const candidateIds = new Set(candidates.map(candidate => candidate.id));
                return <fieldset className="doc-api-mapping" key={item.id}>
                  <legend>{!canSelectCaseForRun(item) ? `${item.lifecycleStatus === 'disabled' ? '已停用' : '草稿'} · ` : item.selectedForRegression === false ? '本轮不执行 · ' : ''}{item.id} · {item.title}</legend>
                  {candidates.length > 0 && <small className="doc-api-help">映射候选（需人工核对）：{candidates.map(candidate => candidate.id).join('、')}</small>}
                  {apiSuiteDetail.suite.cases.map(apiCase => <label key={apiCase.id} className={`doc-api-case-option ${candidateIds.has(apiCase.id) ? 'mapping-candidate' : ''}`}><input type="checkbox" checked={mapped.includes(apiCase.id)} onChange={event => setApiMapping(item.id, apiCase.id, event.target.checked)} /><span><strong>{apiCase.id}</strong> · {apiCase.title}{candidateIds.has(apiCase.id) && <em>映射候选 · 仅供参考</em>}<small>{apiCase.request.method} {apiCase.request.path}</small></span></label>)}
                  {mapped.length === 0 && <small className="doc-api-unmapped">尚未映射；不会为此文档用例执行 API 请求。</small>}
                </fieldset>;
              })}
              {!project.cases.length && <small>项目还没有文档测试用例。</small>}
            </div>
          </>}
          {project.apiContract?.suiteId && !apiSuiteLoading && (apiSuiteDetail?.id !== project.apiContract.suiteId || apiSuiteDetail.status !== 'approved') && <div className="doc-notice error">关联的 suite 尚未通过审核，或当前无法读取。只有已审核且可读取的套件才能映射。</div>}
          <div className="doc-api-actions"><button className="button-secondary" disabled={busy} onClick={saveDraft}>保存 API 映射与安全选项</button><small>保存会调用项目更新接口并遵循项目当前的审核/确认策略；修改后需要按项目策略重新审核。</small></div>
        </details>
        <div className="doc-regression-toolbar"><span>本轮执行 {selectedCaseCount}/{runnableCaseCount} 条可运行用例</span><button className="text-button" onClick={() => setCaseSelection(() => true, 'full')}>全量回归</button><button className="text-button" onClick={() => setCaseSelection(item => item.priority === 'P0' || item.priority === 'P1')}>只选 P0/P1</button><button className="text-button" onClick={() => setCaseSelection(() => false)}>清空选择</button>
          {moduleOptions.length > 0 && <details className="doc-module-picker"><summary>按模块选择</summary><div className="doc-module-picker-list">{moduleOptions.map(([key, path]) => <label key={key} style={{ paddingInlineStart: `${(path.length - 1) * 18}px` }}><input type="checkbox" checked={selectedModuleKeys.includes(key)} onChange={event => toggleModuleSelection(key, event.target.checked)} /><span>{path.at(-1)} <small>{path.join(' / ')}</small></span></label>)}</div><button className="button-secondary" disabled={!selectedModuleKeys.length} onClick={applyModuleSelection}>应用模块范围（{selectedModuleKeys.length}）</button></details>}
          <details className="doc-module-picker doc-page-picker"><summary>按页面入口选择{pageEntryOptions.length ? ` · ${pageEntryOptions.length} 个页面` : ' · 尚未标注'}</summary>{pageEntryOptions.length ? <div className="doc-module-picker-list">{pageEntryOptions.map(option => <label key={option.route}><input type="checkbox" checked={selectedPageRouteKeys.includes(option.route)} disabled={option.runnableCount === 0} onChange={event => togglePageRouteSelection(option.route, event.target.checked)} /><span>{option.route}<small>{option.runnableCount} 条可运行 · 共 {option.totalCount} 条；query 参数不同的入口按同一路由归组</small></span></label>)}</div> : <div className="doc-page-picker-empty"><p className="doc-page-picker-hint">当前项目还没有标注页面入口。补充入口并重新审核后，即可按页面单独运行；未标注用例不会自动混入该范围。</p><button className="button-secondary" onClick={openCaseEditor}>补充页面入口</button></div>}{pageEntryOptions.length > 0 && unassignedPageCaseCount > 0 && <div className="doc-page-picker-unassigned"><small className="doc-page-picker-hint">另有 {unassignedPageCaseCount} 条可运行用例未标注页面入口；应用页面范围时不会自动纳入。</small><button className="text-button" onClick={openCaseEditor}>补充入口</button></div>}<button className="button-secondary" disabled={!selectedPageRouteKeys.length || selectedPageCaseCount === 0} onClick={applyPageSelection}>应用页面范围（{selectedPageCaseCount}）</button></details>
        </div>
        <section className="doc-scope-panel" aria-label="本轮回归范围">
          <div className="doc-scope-summary"><div><strong>{effectiveScopePlan.mode === 'single' ? '单项测试' : effectiveScopePlan.mode === 'feature' ? '功能范围' : effectiveScopePlan.mode === 'impact' ? effectiveScopePlan.targetCaseIds.length ? '功能与影响检查' : '纯影响检查' : effectiveScopePlan.mode === 'full' ? '全量回归' : '自定义范围'}</strong><span>直接目标 {effectiveScopePlan.targetCaseIds.length} 条 · 关联影响 {effectiveScopePlan.impactCaseIds.length} 条 · 本轮合计 {selectedCaseCount} 条</span></div><div className="doc-scope-actions"><button className="button-secondary" onClick={openCaseEditor}>选择具体用例</button><button className="button-secondary" disabled={!effectiveScopePlan.targetCaseIds.length || !project.cases.some(item => canSelectCaseForRun(item) && !selectedCaseIdSet.has(item.id))} onClick={analyzeRelatedCases}>识别关联影响</button>{effectiveScopePlan.impactCaseIds.length > 0 && <button className="text-button" onClick={clearImpactCases}>移除关联用例</button>}</div></div>
          {impactCandidates.length > 0 && <div className="doc-impact-candidate-panel"><header><strong>关联候选 · {impactCandidates.length} 条</strong><span>依据用例资料中的显式关系生成，逐条勾选后才会运行。</span></header><div className="doc-impact-candidates">{impactCandidates.map(candidate => <label key={candidate.caseId}><input type="checkbox" checked={impactCandidateSelection.includes(candidate.caseId)} onChange={event => setImpactCandidateSelection(current => event.target.checked ? [...new Set([...current, candidate.caseId])] : current.filter(id => id !== candidate.caseId))} /><span><strong>{candidate.title} · {candidate.caseId}</strong><small>{candidate.reasons.join('；')}</small></span></label>)}</div><button className="button-secondary" disabled={!impactCandidateSelection.length} onClick={addSelectedImpactCases}>加入本轮影响检查（{impactCandidateSelection.length}）</button></div>}
        </section>
        <details className="doc-case-details" ref={caseDetailsRef} open={project.reviewStatus !== 'approved'}><summary>查看或修改 {project.cases.length} 条用例</summary>
          {project.workflowPlan?.length ? <details className="agent-plan"><summary>资料来源与规划记录</summary><ol>{project.workflowPlan.map(item => <li key={item}>{item}</li>)}</ol><div className="agent-source-list">{(project.sourceFiles ?? [project.fileName]).map(item => <span key={item}>本地资料：{item}</span>)}{project.researchExamples?.map(item => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">公开参考：{item.title}</a>)}</div>{project.researchExamples?.length ? <small>公开案例仅用于启发测试覆盖，未被视为目标产品事实。</small> : <small>本次没有搜索到可用的公开案例；用例仍依据本地资料生成。</small>}</details> : null}
          <div className="doc-case-list">{project.cases.map((item, index) => <article className={`doc-case ${!canSelectCaseForRun(item) || item.selectedForRegression === false ? 'case-excluded' : ''}`} key={item.id}>
            <header><label className="doc-case-select"><input type="checkbox" checked={canSelectCaseForRun(item) && item.selectedForRegression !== false} disabled={!canSelectCaseForRun(item)} onChange={e => toggleCaseSelection(index, e.target.checked)} /><span>本轮执行</span></label><span>用例 {String(index + 1).padStart(2, '0')}</span><input aria-label="用例标题" value={item.title} onChange={e => editCase(index, 'title', e.target.value)} />{canSelectCaseForRun(item) && <button className="text-button" onClick={() => selectOnlyCase(item.id)}>单独测试</button>}<button className="text-button" onClick={() => removeCase(item.id)}>移除</button></header>
            {effectiveScopePlan.targetCaseIds.includes(item.id) && <span className="doc-case-scope-badge target">直接目标</span>}{effectiveScopePlan.impactCaseIds.includes(item.id) && <span className="doc-case-scope-badge impact">关联影响</span>}
            <p className="doc-source">需求依据：{item.source}</p>
            {item.caseOrigin === 'iteration-impact-draft' && <p className="doc-notice"><strong>迭代待完善草稿</strong> · 默认不纳入本轮；请补充模块、可判定的预期、步骤、前置条件和测试数据后再考虑启用。</p>}
            {item.executionRoute && <p className="doc-notice"><strong>执行路径：{{ 'browser-ui': '网页 UI', 'api-contract': 'API / 后端契约', 'fixture-or-role': '测试数据 / 身份夹具', 'source-review': '源码 / 安全审查', clarification: '待澄清', 'out-of-scope': '范围外', 'manual-analysis': '人工补充需求' }[item.executionRoute] ?? item.executionRoute}</strong> · {item.executionReason ?? '待分析'}<br />下一步：{item.nextAction ?? '补充执行依据后重新生成'}</p>}
            <div className="doc-case-fields"><label>附加断言<select value={item.kind} onChange={e => editCase(index, 'kind', e.target.value)}><option value="text">页面含有文本</option><option value="visible">文本可见</option><option value="field">标签字段可见</option></select></label><label>预期文本 / 字段标签<input value={item.expected} onChange={e => editCase(index, 'expected', e.target.value)} /></label></div>
            <div className="doc-case-metadata">
              <label>用例状态<select aria-label={`用例状态 ${item.id}`} value={item.lifecycleStatus ?? 'runnable'} onChange={e => setCaseLifecycleStatus(index, e.target.value as NonNullable<Check['lifecycleStatus']>)}><option value="draft">草稿 · 尚未纳入运行</option><option value="runnable">可运行 · 可加入本轮</option><option value="disabled">停用 · 暂不执行</option></select><small>修改用例内容后会退回草稿；标记为可运行后仍需单独勾选本轮范围。</small></label>
              <label>优先级<select value={item.priority ?? 'P2'} onChange={e => editCase(index, 'priority', e.target.value)}><option value="P0">P0 · 阻断级</option><option value="P1">P1 · 高</option><option value="P2">P2 · 普通</option><option value="P3">P3 · 低</option></select></label>
              <label>主要分类<select value={item.category ?? 'functional'} onChange={e => editCase(index, 'category', e.target.value)}>{categoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>预期置信度<select value={item.confidence ?? 'medium'} onChange={e => editCase(index, 'confidence', e.target.value)}><option value="high">高 · 需求明确且可直接验证</option><option value="medium">中 · 需要按上下文解释</option><option value="low">低 · 需求含糊或预期待补充</option></select></label>
              <label>副作用风险<select value={item.sideEffectRisk ?? 'unknown'} onChange={e => editCase(index, 'sideEffectRisk', e.target.value)}><option value="none">无外部副作用（只读）</option><option value="reversible">可逆副作用</option><option value="irreversible">不可逆副作用</option><option value="unknown">未知，需先评估</option></select></label>
              <label>业务模块路径（每行一层）<textarea value={(item.modulePath ?? []).join('\n')} onChange={e => editCaseList(index, 'modulePath', e.target.value)} placeholder="例如：申请流程\n权限控制" /><small>可从 XMind 主题路径导入；允许在此调整层级。模块路径用于整组选例和单模块运行。</small></label>
              <label>页面入口路径（可选）<input value={item.entryPath ?? ''} onChange={e => editCase(index, 'entryPath', e.target.value)} placeholder="例如：/apply/orders" /><small>可直接从本轮网站版本打开同源页面；留空时从版本首页开始。不要填写外站地址或凭证参数。</small></label>
              <label>标签（每行一项）<textarea value={(item.tags ?? []).join('\n')} onChange={e => editCaseList(index, 'tags', e.target.value)} placeholder="例如：冒烟、核心链路、迭代回归" /><small>每条用例最多 20 个标签；会进入用例版本与运行快照。</small></label>
              <label>覆盖领域（每行一项）<textarea value={(item.coverageAreas ?? [item.category ?? 'functional']).join('\n')} onChange={e => editCaseList(index, 'coverageAreas', e.target.value)} placeholder="例如：authorization、boundary；主要分类会自动纳入" /></label>
              <label>需求追溯（每行一条）<textarea value={(item.requirementRefs ?? [item.source]).join('\n')} onChange={e => editCaseList(index, 'requirementRefs', e.target.value)} placeholder="需求章节 / XMind 路径 / 用例 ID" /></label>
              <label>前置条件（每行一条）<textarea value={(item.preconditions ?? []).join('\n')} onChange={e => editCaseList(index, 'preconditions', e.target.value)} placeholder="例如：使用已准备的测试账号，且申请表为空" />{(item.preconditions ?? []).length > 0 && <span className="case-precondition-confirm"><input type="checkbox" checked={item.preconditionsConfirmed === true} onChange={e => confirmCasePreconditions(index, e.target.checked)} />我确认本次测试环境已满足以上条件</span>}</label>
              <label>测试数据 / fixture 引用（每行一条）<textarea value={(item.testData ?? []).join('\n')} onChange={e => editCaseList(index, 'testData', e.target.value)} placeholder="写合成数据说明或 fixture 名称；不要填写真实密码或个人资料" /></label>
              <label>清理步骤<textarea value={item.cleanup ?? ''} onChange={e => editCase(index, 'cleanup', e.target.value)} placeholder="可逆副作用如何恢复；无副作用可留空" /></label>
            </div>
            <section className="doc-step-editor" aria-label={item.title + ' 的可视化步骤编辑器'}>
              <div className="doc-step-editor-head"><strong>操作与检查步骤</strong><span>{item.steps.length} 步 · 可拖动顺序按钮调整</span></div>
              {item.steps.map((step, stepIndex) => <article className="doc-step-row" key={stepIndex}>
                <header><span>第 {stepIndex + 1} 步</span><select aria-label={'步骤 ' + (stepIndex + 1) + ' 动作'} value={step.action} onChange={event => { const steps = [...item.steps]; steps[stepIndex] = createEditableStep(event.target.value); updateCaseSteps(index, steps); }}>
                  {!editableStepActions.some(option => option.value === step.action) && <option value={step.action}>高级动作 · {step.action}</option>}
                  {editableStepActions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select><button className="text-button" disabled={stepIndex === 0} onClick={() => moveStep(index, stepIndex, -1)}>上移</button><button className="text-button" disabled={stepIndex === item.steps.length - 1} onClick={() => moveStep(index, stepIndex, 1)}>下移</button><button className="text-button" disabled={busy || !!stepProbeBusyKey || project.reviewStatus !== 'approved'} title={project.reviewStatus !== 'approved' ? '请先保存并审核步骤，才能试定位已保存版本' : undefined} onClick={() => void probeSavedStep(item.id, stepIndex)}>{stepProbeBusyKey === `${item.id}:${stepIndex}` ? '定位中…' : '试定位'}</button><button className="text-button" onClick={() => removeStep(index, stepIndex)}>删除步骤</button></header>
                {stepProbeResults[`${item.id}:${stepIndex}`] && project.reviewStatus === 'approved' && <StepProbeNotice result={stepProbeResults[`${item.id}:${stepIndex}`]!} />}
                {stepFieldSpecs[step.action]?.length ? <div className="doc-step-fields">{stepFieldSpecs[step.action]!.map(field => <label key={field.key}>{field.label}{field.kind === 'role'
                  ? <select aria-label={'步骤 ' + (stepIndex + 1) + ' ' + field.label} value={step[field.key] ?? 'button'} onChange={event => changeStep(index, stepIndex, field.key, event.target.value)}><option value="button">按钮</option><option value="link">链接</option><option value="radio">单选框</option><option value="checkbox">复选框</option><option value="tab">标签页</option></select>
                  : <input aria-label={'步骤 ' + (stepIndex + 1) + ' ' + field.label} value={step[field.key] ?? ''} onChange={event => changeStep(index, stepIndex, field.key, event.target.value)} />}</label>)}</div>
                  : <small className="doc-step-advanced-hint">该动作的详细参数可在下方高级 JSON 中编辑。</small>}
              </article>)}
              <label className="doc-step-add">添加步骤或断言<select aria-label={'添加步骤 ' + item.id} value="" onChange={event => addStep(index, event.target.value)}><option value="">选择动作类型…</option>{editableStepActions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </section>
            {project.stepAuthoring?.results.filter(result => result.caseId === item.id).map(result => <p key={`${result.caseId}-${project.stepAuthoring?.generatedAt}`} className={`doc-notice ${result.status === 'blocked' ? 'error' : ''}`}><strong>步骤状态：{result.status === 'generated' ? '已生成' : result.status === 'partial' ? '部分生成' : '阻塞'} · {result.stepCount} 步</strong><br />{result.detail}</p>)}
            <details className="doc-steps-json"><summary>高级 JSON 步骤（可选）</summary><label className="doc-steps-label">浏览器步骤<textarea spellCheck={false} value={stepDrafts[item.id] ?? JSON.stringify(item.steps ?? [], null, 2)} onChange={e => editSteps(item, e.target.value)} /><small>普通操作建议使用上方可视化编辑器；更复杂动作可在此编辑 JSON。文本输入和预期检查可引用 {'{{param:名称}}'}，运行前填写参数或选择测试数据组。提交、保存、删除、支付、确认等动作会被拦截。</small></label></details>
          </article>)}</div>
        </details>
        <div className="doc-review" id="doc-execution">
          <div className="doc-section-head"><div><h2>运行回归测试</h2><p>在这里选择单条用例或一组模块，审核后手动启动本轮回归。</p></div></div>
          <button className="button-secondary doc-add-case" onClick={addCase}>＋ 添加测试用例</button>
          <label>测试备注<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></label>
          <label>运行方式<select value={runMode} onChange={e => setRunMode(e.target.value as 'regression' | 'compare')}><option value="regression">常规回归 · 不调用模型</option><option value="compare">AI 辅助对照 · 确定性 + 视觉</option></select></label>
          {requiredParameterNames.length > 0 && <fieldset className="doc-parameter-panel">
            <legend>本轮测试参数</legend>
            <p>账号使用 Edge 登录态；测试数据请用合成数据。</p>
            <label>复用已保存的数据组<select aria-label="复用已保存的数据组" value={testDataSetId} onChange={event => { const id = event.target.value; const item = project.testDataSets?.find(row => row.id === id); setTestDataSetId(id); setTestDataSetName(item?.name ?? ''); setParameterValues(item?.values ?? {}); }}>
              <option value="">手动填写本轮参数</option>
              {project.testDataSets?.map(item => <option key={item.id} value={item.id}>{item.name} · 更新于 {new Date(item.updatedAt).toLocaleString()}</option>)}
            </select></label>
            <div className="doc-parameter-fields">{requiredParameterNames.map(key => <label key={key}>{key}<input aria-label={'参数 ' + key} value={parameterValues[key] ?? selectedTestDataSet?.values[key] ?? ''} maxLength={500} onChange={event => setParameterValues(values => ({ ...values, [key]: event.target.value }))} /></label>)}</div>
            <div className="doc-parameter-save"><label>{selectedTestDataSet ? '数据组名称' : '保存为数据组'}<input aria-label="数据组名称" value={testDataSetName} onChange={event => setTestDataSetName(event.target.value)} maxLength={80} placeholder="例如：有效申请数据" /></label>
              <button className="button-secondary" disabled={busy || !testDataSetName.trim()} onClick={saveTestDataSet}>{selectedTestDataSet ? '更新当前数据组' : '保存为新数据组'}</button>
              {selectedTestDataSet && <button className="text-button" disabled={busy} onClick={deleteTestDataSet}>删除当前数据组</button>}
            </div>
          </fieldset>}
          <label>历史回归基线（可选）<select aria-label="历史回归基线" value={baselineRunId} onChange={event => setBaselineRunId(event.target.value)}>
            <option value="">不与历史运行比较</option>
            {runHistory.filter(item => item.baselineEligible).map(item => <option key={item.id} value={item.id}>{item.siteVersionSnapshot ? `${item.siteVersionSnapshot.environment} · ${item.siteVersionSnapshot.label}` : '未登记网站版本'} · {item.runMode === 'regression' ? '常规回归' : item.runMode === 'compare' ? 'AI 对照' : '方式未知'} · {new Date(item.startedAt).toLocaleString()} · {runOutcomeLabels[item.overall] ?? item.overall} · {item.scopePlan ? `${runScopeLabels[item.scopePlan.mode]} ${item.scopePlan.targetCaseIds.length}目标/${item.scopePlan.impactCaseIds.length}影响` : '旧版范围未标注'} · {item.selectedCaseCount}/{item.totalCases} 条</option>)}
          </select><small>{runHistory.some(item => item.baselineEligible) ? '修改过的用例会单独标记。' : '完成一轮可判定的运行后可设为基线。'}</small></label>
          {baselineEnvironmentReview === 'different' && <p className="doc-notice">当前与基线的环境标识或目标站点来源不同；结果变化不能单独归因于本次迭代。</p>}
          {baselineEnvironmentReview === 'unknown' && <p className="doc-notice">当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致；结果中会保留此限制。</p>}
          {baselineRunModeReview === 'different' && <p className="doc-notice">当前验证方式与基线不同；请确认脚本回归和 AI 辅助对照之间的差异不会解释本轮状态变化。</p>}
          {baselineRunModeReview === 'unknown' && <p className="doc-notice">基线未记录验证方式，无法确认两轮使用相同的验证方法。</p>}
          <div className="doc-buttons">
            {busy && activeRunId && <button className="button-secondary" disabled={cancelRequested} onClick={cancelRun}>{cancelRequested ? '正在停止…' : '停止当前运行'}</button>}
            <button className="button-secondary" disabled={busy} onClick={saveDraft}>保存修改</button>
            {project.reviewStatus !== 'approved'
              ? <button className="button-primary" disabled={busy || !selectedCaseCount || project.cases.some(item => (!item.expected.trim() || item.expected.startsWith('[请在') || item.expected.startsWith('[需澄清]')) && canSelectCaseForRun(item) && item.selectedForRegression !== false && !(item.steps ?? []).some(step => ['assertText','assertVisible','assertExactVisible','assertRoleVisible','assertValue','assertDisabled'].includes(step.action))) || project.cases.some(item => { try { return canSelectCaseForRun(item) && item.selectedForRegression !== false && !Array.isArray(JSON.parse(stepDrafts[item.id] ?? JSON.stringify(item.steps))); } catch { return canSelectCaseForRun(item) && item.selectedForRegression !== false; } }) || (runMode === 'compare' && !computerUseAvailable)} title={runMode === 'compare' && !computerUseAvailable ? computerUseReason : undefined} onClick={approve}>{runMode === 'regression' ? `审核并运行所选范围（${selectedCaseCount}）` : `审核并对照所选范围（${selectedCaseCount}）`}</button>
              : <button className="button-primary" disabled={busy || !selectedCaseCount || (runMode === 'compare' && !computerUseAvailable)} title={runMode === 'compare' && !computerUseAvailable ? computerUseReason : undefined} onClick={execute}>{runMode === 'regression' ? `运行所选范围（${selectedCaseCount}）` : `对照所选范围（${selectedCaseCount}）`}</button>}
          </div>
          <small className="doc-run-scope-note">当前勾选只用于本轮运行；如需改变以后默认选择，再点“保存修改”。</small>
          <small>手动启动；常规回归不调用模型。Edge 复用登录态，高影响操作会拦截。{runMode === 'compare' ? computerUseAvailable ? ` 已配置：${computerUseModel}。` : ` 当前不可用：${computerUseReason}` : ''} {modelAvailable ? '模型已配置。' : '尚未配置模型密钥。'}</small>
        </div>
      </section>
    </>}
    {project && <section className="doc-run-history" id="doc-run-history">
      <div className="doc-section-head"><div><h2>运行记录</h2><p>按网站版本和本轮范围回看历史结果；也可打开报告核对旧版本证据。</p></div><span className="table-status status-running">{runHistory.length} 轮</span></div>
      {runHistory.length === 0 ? <p className="doc-run-history-empty">当前项目还没有运行记录。启动一轮后，版本、执行范围和结果会保存在这里。</p> : <>
        <div className="doc-run-history-list">{runHistory.slice(0, 3).map(renderHistoryItem)}</div>
        {runHistory.length > 3 && <details className="doc-run-history-older"><summary>更早运行 · {runHistory.length - 3} 轮</summary><div className="doc-run-history-list">{runHistory.slice(3).map(renderHistoryItem)}</div></details>}
      </>}
    </section>}
    {run && <section className="doc-run-card" id="doc-results">
      <header><div><h2>{run.runMode === 'regression' ? '常规回归结果' : 'AI 辅助对照结果'}</h2><p>{run.overall === 'cancelled' ? '本轮已取消；部分结果已保存' : run.runMode === 'regression' ? run.overall === 'passed' ? '本轮通过' : run.overall === 'failed' ? '本轮发现失败' : '本轮存在未验证或阻塞项' : run.finalReady ? `本轮范围已对齐 · ${run.overall === 'passed' ? '用例全部通过' : '两侧一致发现失败'}` : `本轮有未对齐结果 · ${run.comparisons.filter(item => item.aligned).length}/${run.comparisons.length} 条已对齐；blocked 不代表失败或通过`}{run.caseScope ? ` · ${run.caseScopeKnown === false ? '历史范围未知' : `实际选中 ${run.caseScope.selectedCaseIds.length}/${run.caseScope.totalCases} 条`}` : ''}</p>{run.scopePlan && <small>本轮范围：{run.scopePlan.mode === 'single' ? '单项测试' : run.scopePlan.mode === 'feature' ? '功能测试' : run.scopePlan.mode === 'impact' ? run.scopePlan.targetCaseIds.length ? '功能与影响检查' : '纯影响检查' : run.scopePlan.mode === 'full' ? '全量回归' : '自定义'} · 直接目标 {run.scopePlan.targetCaseIds.length} 条 · 关联影响 {run.scopePlan.impactCaseIds.length} 条</small>}{run.siteVersionSnapshot && <small>网站版本：{run.siteVersionSnapshot.environment} · {run.siteVersionSnapshot.label} · {run.siteVersionSnapshot.targetUrl}{run.siteVersionSnapshot.changeNotes ? ` · 迭代：${run.siteVersionSnapshot.changeNotes}` : ''}</small>}{!run.siteVersionSnapshot && <small>网站版本：未登记（旧运行）</small>}{run.caseVersion && <small>用例/脚本版本：{run.caseVersion}</small>}{run.materialVersion && <small>需求/测试资料版本：{run.materialVersion}</small>}{run.testDataVersion && <small>本轮测试数据版本：{run.testDataVersion}</small>}{run.sourceMaterialsSnapshot?.map(item => <small key={item.id}>资料快照：{item.fileName} · {item.role} · SHA-256 {item.sha256}</small>)}{run.parentRunId && <small>定向重测 · 父运行 {run.parentRunId}{run.retestSelection ? ` · 本次 ${run.retestSelection.join('、')}` : ''}{run.retestNotes ? ` · ${run.retestNotes}` : ''}</small>}</div>
        <div className="doc-buttons">{retestCaseIds.length > 0 && <button className="button-secondary" disabled={busy} onClick={retestUnresolved}>重测失败 / 未验证项（{retestCaseIds.length}）</button>}{(run.reportReady || run.report) && <a className="button-secondary" href={`/api/document-runs/${run.id}/report`} download>{run.reportReady ? '下载本轮报告' : '下载部分运行报告'}</a>}{(run.packageReady || run.finalReady) && <a className="button-primary" href={`/api/document-runs/${run.id}/package`} download>下载可复用脚本包 ZIP</a>}</div></header>
      {run.parameterValues && Object.keys(run.parameterValues).length > 0 && <p className="doc-notice">本轮参数{run.testDataSetId ? '（数据组 ' + (project?.testDataSets?.find(item => item.id === run.testDataSetId)?.name ?? run.testDataSetId) + '）' : '（手动输入）'}：{Object.entries(run.parameterValues).map(([key, value]) => key + '=' + JSON.stringify(value)).join(' · ')}</p>}
      {(!run.finalReady || (run.caseScope && run.caseScope.selectedCaseIds.length < run.caseScope.totalCases)) && <p className="doc-notice">{!run.finalReady ? '报告和脚本包保留了本轮结果并标注未验证项；请复核证据后再决定是否重跑。' : '本轮只执行了所选回归子集；未选用例不在本次结果范围内。'}</p>}
      {run.coverageSummary && <p className="doc-notice">已识别领域：{run.coverageSummary.projectAreas.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}；本轮覆盖：{run.coverageSummary.selectedAreas.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}；本轮未覆盖：{run.coverageSummary.notCoveredThisRun.map(area => categoryOptions.find(option => option.value === area)?.label ?? area).join('、') || '无'}。这是整理后用例的分类汇总，不代表需求完整性审计。</p>}
      {run.caseScopeKnown === false && <p className="doc-notice">这是旧版运行记录，原始执行范围信息缺失；页面仅按留存的逐用例结果统计，不能据此判断全量覆盖。</p>}
      {run.baselineRunId && <section className="doc-baseline-comparison">
        <div><h3>历史基线对比</h3><p>基线运行：{run.baselineRunId}</p>
          {run.baselineRunSnapshot && <>
            <p>基线版本：{run.baselineRunSnapshot.siteVersionSnapshot ? `${run.baselineRunSnapshot.siteVersionSnapshot.environment} · ${run.baselineRunSnapshot.siteVersionSnapshot.label}` : '未登记网站版本'} · {new Date(run.baselineRunSnapshot.startedAt).toLocaleString()}</p>
            <p>基线目标网址：{run.baselineRunSnapshot.siteVersionSnapshot?.targetUrl ?? '未登记'} · 验证方式：{run.baselineRunSnapshot.runMode === 'regression' ? '常规回归' : run.baselineRunSnapshot.runMode === 'compare' ? 'AI 辅助对照' : '历史运行未记录'}</p>
            <p>基线范围：{run.baselineRunSnapshot.scopePlan ? `直接目标 ${run.baselineRunSnapshot.scopePlan.targetCaseIds.length} 条 · 关联影响 ${run.baselineRunSnapshot.scopePlan.impactCaseIds.length} 条` : `旧记录范围未分类 · 本轮 ${run.baselineRunSnapshot.selectedCaseCount}/${run.baselineRunSnapshot.totalCases} 条`}</p>
            <small>基线用例版本 {run.baselineRunSnapshot.caseVersion?.slice(0, 12) ?? '未记录'} · 资料版本 {run.baselineRunSnapshot.materialVersion?.slice(0, 12) ?? '未记录'} · 测试数据版本 {run.baselineRunSnapshot.testDataVersion?.slice(0, 12) ?? '未记录'}</small>
          </>}
          {run.baselineEnvironmentComparison === 'different' && <p className="doc-notice">当前与基线的环境标识或目标站点来源不同。状态变化不能单独归因于本次迭代。</p>}
          {run.baselineEnvironmentComparison === 'unknown' && <p className="doc-notice">当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致。</p>}
          {run.baselineRunModeComparison === 'different' && <p className="doc-notice">本次验证方式与基线不同；通道差异可能影响结果变化判断。</p>}
          {run.baselineRunModeComparison === 'unknown' && <p className="doc-notice">本次或基线未记录验证方式，无法确认两轮方法一致。</p>}
          {run.baselineMaterialChanged && <p className="doc-notice">需求/测试资料版本与基线不同。状态变化已列出，请先复核新旧测试依据是否等价。</p>}
          {run.baselineRunSnapshot && (!run.materialVersion || !run.baselineRunSnapshot.materialVersion) && <p className="doc-notice">本轮或基线缺少需求/测试资料版本记录，无法确认资料是否一致。</p>}
          {run.baselineTestDataChanged && <p className="doc-notice">本轮测试数据版本与基线不同，变化结果可能同时受输入数据影响。</p>}
          {run.baselineRunSnapshot && (!run.testDataVersion || !run.baselineRunSnapshot.testDataVersion) && <p className="doc-notice">本轮或基线缺少测试数据版本记录，无法确认测试数据是否一致。</p>}
        </div>
        {runBaselineGroups.length ? <div className="doc-baseline-groups">{runBaselineGroups.map(group => <section className={`doc-baseline-group baseline-group-${group.group}`} key={group.group}><h4>{group.label} · {group.items.length}</h4><div className="doc-baseline-list">{group.items.map(item => <article key={item.caseId} className={`baseline-${item.disposition}`}><strong>{baselineDispositionLabels[item.disposition]} · {item.title} ({item.caseId})</strong><span>基线：{baselineStatusLabels[item.baselineStatus ?? ''] ?? '无结果'} → 本次：{baselineStatusLabels[item.currentStatus ?? ''] ?? '无结果'}</span><small>范围：基线 {baselineCaseScopeLabel(item.caseId)} → 本轮 {currentBaselineCaseScopeLabel(item)}</small>{item.caseChanged && <small>用例步骤或预期已修改；请先复核用例变化，再判断是否为产品回归。</small>}</article>)}</div></section>)}</div> : <p className="doc-notice">本次运行未形成可比较的逐用例结果。</p>}
      </section>}
      <div className={`doc-lanes ${run.runMode === 'regression' ? 'single' : ''}`}><Lane title="确定性脚本" lane={run.deterministic} scopePlan={run.scopePlan} caseScopeKnown={run.caseScopeKnown}/>{run.runMode !== 'regression' && <Lane title="视觉 Computer Use" lane={run.ai} scopePlan={run.scopePlan} caseScopeKnown={run.caseScopeKnown}/>}</div>
      <div className="doc-comparisons"><h3>{run.runMode === 'regression' ? '逐用例回归结果' : '逐用例结果对照'}</h3>{run.scopePlan ? <>
        <section className="doc-comparison-group target"><h4>直接测试目标 · {run.scopePlan.targetCaseIds.length} 条</h4>{runTargetComparisons.length ? runTargetComparisons.map(renderComparison) : <p className="doc-scope-empty">没有留存直接目标的逐用例结果。</p>}</section>
        {run.scopePlan.impactCaseIds.length > 0 && <section className="doc-comparison-group impact"><h4>关联影响检查 · {run.scopePlan.impactCaseIds.length} 条</h4>{runImpactComparisons.length ? runImpactComparisons.map(renderComparison) : <p className="doc-scope-empty">没有留存关联影响用例的逐用例结果。</p>}</section>}
        {runExcludedCaseIds.length > 0 && <section className="doc-comparison-group unverified"><h4>本轮未验证 · {runExcludedCaseIds.length} 条</h4><p>这些用例没有在本轮执行；当前结果不能说明它们未受影响。</p><ul>{runExcludedCaseLabels.slice(0, 20).map(item => <li key={item.id}>{item.title} · {item.id}</li>)}</ul>{runExcludedCaseLabels.length > 20 && <small>另有 {runExcludedCaseLabels.length - 20} 条未验证用例。</small>}</section>}
      </> : run.comparisons.map(renderComparison)}</div>
      {run.analysis && <div className="doc-analysis"><h3>{run.runMode === 'regression' ? '运行说明' : 'Agent 对差异的分析建议'}</h3><p>{run.analysis}</p>{run.runMode !== 'regression' && !run.finalReady && <small>分析只给出复核建议，不会未经审核修改用例或自动把失败改成通过。修订并重新审核后，可在上方再次运行。</small>}</div>}
    </section>}
  </div>;
}

function Lane({ title, lane, scopePlan, caseScopeKnown }: { title: string; lane: Lane; scopePlan?: RunScopePlan; caseScopeKnown?: boolean }) {
  const scopeLabel = (id: string) => scopePlan
    ? scopePlan.targetCaseIds.includes(id) ? '直接目标' : scopePlan.impactCaseIds.includes(id) ? '关联影响' : '范围未分类'
    : caseScopeKnown === false ? '历史范围未标注' : '目标/影响未标注';
  return <article className="doc-lane"><h3>{title} · {lane.status}</h3><p>{lane.summary}</p>{lane.results.map(item => {
    const label = scopeLabel(item.id);
    const tone = label === '直接目标' ? 'target' : label === '关联影响' ? 'impact' : 'unknown';
    return <div className={`doc-result ${item.status}`} key={item.id}><strong>{item.status === 'passed' ? '✓' : item.status === 'blocked' ? '!' : item.status === 'not-applicable' ? '—' : item.status === 'cancelled' ? 'Ⅱ' : item.status === 'not-run' ? '·' : '×'} <span className={`doc-run-scope-badge ${tone}`}>{label}</span> · {item.status === 'not-applicable' ? 'N/A · ' : item.status === 'cancelled' ? '已取消 · ' : item.status === 'not-run' ? '未运行 · ' : ''}{item.title} ({item.id})</strong><small>{item.detail}</small></div>;
  })}</article>;
}

function WorkflowRail({ stages }: { stages: Array<{ label: string; state: 'done' | 'current' | 'waiting' | 'warning' }> }) {
  const stateLabel = (state: string) => state === 'done' ? '完成' : state === 'current' ? '进行中' : state === 'warning' ? '需处理' : '等待';
  return <section className="workflow-rail" aria-label="测试流程进度"><div className="workflow-rail-head"><h2>测试流程</h2><span>手动启动</span></div><ol>{stages.map((stage, index) => <li className={`workflow-stage ${stage.state}`} key={stage.label} aria-current={stage.state === 'current' ? 'step' : undefined}><span className="workflow-marker">{String(index + 1)}</span><span className="workflow-stage-label">{stage.label}</span><small>{stateLabel(stage.state)}</small></li>)}</ol></section>;
}

