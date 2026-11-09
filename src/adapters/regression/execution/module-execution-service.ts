import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { extractDocument, type ImportedDocument } from '../../documents/resources/importer.js';
import { validateDifyOutput, type RegressionSourceItem } from '../authoring/case-baseline-store.js';
import { callDifyWorkflow, cloudSafe, DifyWorkflowError } from '../../integrations/dify/workflow-client.js';
import { checkDispatch, resultCounts, type ExecutionManifest } from './execution-manifest-store.js';
import { validateCases, makeDocumentProject, isSafeReadOnlyBrowserCase, browserStepDraftBlockReason, canAuthorReadOnlyBrowserSteps, actionablePreconditions, type BrowserCheck, type DocumentProject, type DocumentRun } from '../../documents/execution/workflow-facade.js';
import { parseDifyMarkdown, formatDifyMarkdown } from '../authoring/markdown-case-pack.js';
import { difyBlocker, reviewedDifyReadOnlyPlan, type DifyBlockerCode, type DifyReviewKind } from '../authoring/case-readiness.js';
import { difyCoverageGap } from '../authoring/case-quality.js';
import { assertDifyExportSafe } from '../exports/export-policy.js';
import { missingDirectAssertion } from '../../documents/cases/case-quality.js';
import { isDifyRecordIndependent } from '../scenarios/scenario-planner.js';
import { isSensitiveExportField } from '../../documents/evidence/sensitive-data.js';
import { excludedCaseReason } from '../../documents/cases/case-scope.js';
import { connectedEvidenceKind } from '../evidence/connected-evidence-contract.js';
import { departmentBlockerDiagnostic } from '../evidence/blocker-diagnostics.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { CaseDependency, PrerequisiteReview } from '../../../domain/cases/case-script-contract.js';
import type { RegressionDatabaseBinding, RegressionDatabaseEvidence } from '../../../domain/database/regression-database-contract.js';
import type { ResourceCase } from '../resources/project-resource-contract.js';
import { supportsDepartmentDatabase } from '../../../domain/database/regression-database-contract.js';
export const moduleDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const id = z.string().uuid();
const assertions = new Set(['assertText', 'assertVisible', 'assertNotVisible', 'assertExactVisible', 'assertRoleVisible', 'assertRoleDisabled', 'assertValue', 'assertValueByPlaceholder', 'assertSelectedByRoleIndex', 'assertDisabled', 'assertFieldInvalid', 'assertMaxLengthOrMessage', 'assertNoHorizontalOverflow', 'assertNoFetchOrXhr']);
type Outcome = 'passed' | 'failed' | 'blocked' | 'error' | 'not_executed';
export type WebModule = {
    id: string;
    name: string;
    fileName: string;
    digest: string;
    createdAt: string;
    project: DocumentProject;
    sourceCases?: ImportedDocument['testCases'];
    resourceSources?: Record<string, { sourcePath: string[]; sourceExpected: string; sourceId?: string; priority?: BrowserCheck['priority'] }>;
    scriptReviews?: Record<string, { status: 'pending' | 'reviewed'; note: string }>;
    manualSteps?: Record<string, string[]>;
    prerequisiteCases?: Record<string, CaseDependency[]>;
    prerequisiteReviews?: Record<string, PrerequisiteReview>;
    editedSteps?: Record<string, string>;
    cachedSteps?: Record<string, {
        sourceDigest: string;
        steps: BrowserCheck['steps'];
        reviewKind?: DifyReviewKind;
    }>;
};
export type WebModuleResult = {
    caseId: string;
    title: string;
    expected: string;
    priority?: BrowserCheck['priority'];
    status: Outcome;
    detail: string;
    outOfScope?: boolean;
    evidence?: string | undefined;
    evidenceOrigin?: 'document-run' | 'preflight' | 'authorized-write';
    evidenceNote?: string | undefined;
    proposal?: {
        steps: string[];
        preconditions: string[];
        questions: string[];
    };
    steps?: BrowserCheck['steps'];
    needsConfirmation?: boolean;
    blockerCode?: DifyBlockerCode;
    nextAction?: string;
    preparationReview?: string;
};
function moduleOutcome(results: WebModuleResult[]): Outcome { const scoped = results.filter(r => !r.outOfScope); return !scoped.length ? 'not_executed' : scoped.some(r => r.status === 'failed') ? 'failed' : scoped.some(r => r.status !== 'passed') ? 'blocked' : 'passed'; }
function independentRecordScope(job: WebModuleJob): boolean { const checks = job.databaseEvidence?.checks ?? []; const selected = job.snapshot.cases.filter(c => job.selectedCaseIds.includes(c.id)); return !!selected.length && selected.every(isDifyRecordIndependent) && ['connection', 'fixtures', 'relations', 'account-scope'].every(id => checks.some(c => c.id === id && c.status === 'passed')) && checks.every(c => c.status === 'passed' || ['account-list', 'account-detail'].includes(c.id) && c.status === 'blocked'); }
function jobOutcome(job: WebModuleJob): Outcome { const outcome = moduleOutcome(job.results); return job.databaseEvidence?.status === 'failed' ? 'failed' : job.databaseEvidence?.status === 'blocked' && outcome === 'passed' && !independentRecordScope(job) ? 'blocked' : outcome; }
function executionDigest(job: WebModuleJob) { return moduleDigest(job.databaseBinding ? { execution: job.executionProject, databaseBinding: job.databaseBinding, databaseEvidenceDigest: job.databaseEvidenceDigest } : job.executionProject); }
type Phase = 'queued' | 'preflight' | 'awaiting-login' | 'preparing' | 'dispatching' | 'executing' | 'reporting' | 'completed' | 'blocked' | 'error' | 'cancelled' | 'interrupted';
export type WebModuleJob = {
    id: string;
    moduleId: string;
    moduleName: string;
    moduleDigest: string;
    requestId: string;
    parentJobId?: string | undefined;
    createdAt: string;
    updatedAt: string;
    phase: Phase;
    outcome: Outcome;
    message: string;
    selectedCaseIds: string[];
    confirmedCaseIds: string[];
    snapshot: DocumentProject;
    runMode?: 'fixed' | 'assist';
    databaseBinding?: RegressionDatabaseBinding;
    databaseEvidence?: RegressionDatabaseEvidence;
    databaseEvidenceDigest?: string;
    planDigest?: string;
    executionProject?: DocumentProject;
    documentRunId?: string;
    authorizedWriteCaseIds?: string[];
    executionStarted?: boolean;
    executionFinished?: boolean;
    difyRuns: Array<{
        phase: string;
        batch: number;
        id?: string | undefined;
        status: 'succeeded' | 'failed';
        inputDigest: string;
        caseIds: string[];
        tokens?: number;
    }>;
    results: WebModuleResult[];
    events: Array<{
        at: string;
        phase: Phase;
        message: string;
    }>;
    report?: string;
    errorCode?: string;
};
export type WebModuleDependencies = {
    cloud: typeof callDifyWorkflow;
    authorizedWrites?: (project: DocumentProject, jobId: string, checks: BrowserCheck[], signal: AbortSignal, progress: (message: string) => void) => Promise<Array<{
        caseId: string;
        status: 'passed' | 'failed' | 'blocked';
        detail: string;
        evidence?: string;
        evidenceNote?: string;
    }>>;
    database?: (project: DocumentProject, signal: AbortSignal) => Promise<RegressionDatabaseEvidence>;
    inspect: (project: DocumentProject, job: WebModuleJob, signal: AbortSignal, onLogin: (waiting: boolean) => void) => Promise<string>;
    author: (project: DocumentProject, item: BrowserCheck, evidence: string, proposal: string[]) => Promise<BrowserCheck['steps']>;
    execute: (project: DocumentProject, runId: string, selected: string[], onStage?: (stage: string) => void, onResult?: (result: {
        id: string;
        status: string;
        detail: string;
        evidence?: string | undefined;
        evidenceNote?: string;
    }) => void) => Promise<DocumentRun>;
    captureBlockedEvidence?: (project: DocumentProject, jobId: string, item: BrowserCheck, signal: AbortSignal) => Promise<{
        evidence: string;
        evidenceNote: string;
    } | undefined>;
    cancel: (projectId: string, runId?: string) => Promise<void>;
    continueLogin: (projectId: string) => Promise<void>;
    recover: (runId: string) => Promise<DocumentRun | undefined>;
    saveProject: (project: DocumentProject) => Promise<void>;
};
/** Preserve SPA routes, but never persist one-use OAuth credentials. */
export function moduleTarget(value: string) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('请输入不含账号密码的 HTTP/HTTPS 被测网址。');
    for (const key of [...url.searchParams.keys()])
        if (/^(?:code|access_token|refresh_token|id_token|token|secret|api_key|password)$/i.test(key))
            url.searchParams.delete(key);
    if (/(?:[?&])(?:code|token|access_token|password)=/i.test(url.hash))
        throw new Error('页面路由中包含登录凭据，请使用登录后的稳定页面地址。');
    return url.href;
}
export function checkModulePlan(job: WebModuleJob) {
    if (!job.executionProject || !job.planDigest || executionDigest(job) !== job.planDigest)
        throw new Error('执行计划指纹不一致，已停止派发。');
    if (job.databaseBinding && (!job.databaseEvidence || moduleDigest(job.databaseEvidence) !== job.databaseEvidenceDigest || !supportsDepartmentDatabase(job.snapshot.targetUrl)))
        throw new Error('数据库证据指纹或目标环境不一致，已停止派发。');
    const source = new Map(job.snapshot.cases.map(c => [c.id, c]));
    if (JSON.stringify(job.snapshot.cases.map(c => c.id)) !== JSON.stringify(job.executionProject.cases.map(c => c.id)))
        throw new Error('执行计划的用例顺序或集合发生变化。');
    for (const c of job.executionProject.cases) {
        const original = source.get(c.id);
        if (!original || c.expected !== original.expected || c.source !== original.source || c.title !== original.title)
            throw new Error('执行计划改动了原始用例或预期。');
    }
    if (job.executionProject.targetUrl !== job.snapshot.targetUrl || job.executionProject.id !== job.snapshot.id)
        throw new Error('执行计划目标或项目身份发生变化。');
    if (job.executionProject.cases.length !== job.snapshot.cases.length)
        throw new Error('执行计划遗漏用例。');
}
export class DifyWebModuleStore {
    editorPrerequisiteGuard?: (versionId: string, selected: string[], profileId?: string) => void;
    private db: DatabaseSync;
    private active = new Map<string, AbortController>();
    private closed = false;
    constructor(root: string, private deps: WebModuleDependencies) {
        mkdirSync(path.join(root, 'dify-web-modules'), { recursive: true });
        this.db = new DatabaseSync(path.join(root, 'dify-web-modules', 'records.sqlite'));
        this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,job_id TEXT NOT NULL)');
        for (const job of this.list<WebModuleJob>('job'))
            if (!['completed', 'blocked', 'error', 'cancelled', 'interrupted'].includes(job.phase)) {
                job.phase = 'interrupted';
                job.message = '服务已重启；已保存记录。恢复汇总不会重复执行，未完成执行可新建重测。';
                this.save('job', job);
            }
    }
    close() {
        if (this.closed)
            return;
        for (const [key, controller] of this.active) {
            controller.abort();
            const job = this.getJob(key);
            if (!['completed', 'cancelled'].includes(job.phase))
                this.event(job, 'interrupted', '服务已停止；记录已保存，不会自动重复执行。');
        }
        this.closed = true;
        this.db.close();
    }
    private list<T>(kind: string): T[] { return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(String(r.payload))); }
    private save<T extends {
        id: string;
    }>(kind: string, value: T): T {
        if (!this.closed)
            this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, JSON.stringify(value));
        return value;
    }
    private get<T>(kind: string, key: string): T {
        const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind, key);
        if (!row)
            throw new Error('模块或任务不存在。');
        return JSON.parse(String(row.payload));
    }
    state() { return { modules: this.list<WebModule>('module').map(({ project, cachedSteps, sourceCases, ...m }) => ({ ...m, targetUrl: project.targetUrl, caseCount: project.cases.length })), jobs: this.list<WebModuleJob>('job').map(({ snapshot, executionProject, ...j }) => j), configured: { prepare: !!process.env.TESTPILOT_DIFY_API_KEY, execution: !!process.env.TESTPILOT_DIFY_EXECUTION_API_KEY } }; }
    getModule(key: string) { return this.get<WebModule>('module', id.parse(key)); }
    getJob(key: string) { return this.get<WebModuleJob>('job', id.parse(key)); }
    /** Prepare without persisting: all modules must validate before pointers change. */
    prepareResourceModule(sourceId: string | undefined, name: string, targetUrl: string, cases: ResourceCase[]): WebModule {
        const source = sourceId ? this.getModule(sourceId) : undefined;
        const document: ImportedDocument = { format: 'markdown', text: cases.map(c => c.title + '\n' + c.expected).join('\n'), testCases: cases.map(c => ({ id: c.id, title: c.title, source: c.sourcePath.join(' > ') || c.id, expected: c.expected })) };
        const project = source ? structuredClone(source.project) : makeDocumentProject({ name, fileName: 'project-resources.json', document, targetUrl, caseMode: 'existing' });
        const defaults = makeDocumentProject({ name, fileName: 'project-resources.json', document, targetUrl, caseMode: 'existing' });
        const previous = new Map(source?.project.cases.map(c => [c.id, c]));
        project.id = randomUUID(); project.name = name; project.updatedAt = now(); project.targetUrl = moduleTarget(targetUrl);
        project.cases = validateCases(cases.map((c, index) => ({ ...(previous.get(c.id) ?? defaults.cases[index]!), id: c.id, title: c.title, expected: c.expected, steps: c.script.steps, modulePath: c.sourcePath, ...(c.priority ? { priority: c.priority } : {}) })));
        for (const c of project.cases) {
            delete c.authorizedWriteOperationId;
            delete c.writeResultOperationId;
            delete c.writeResultSourceRunId;
        }
        const value: WebModule = {
            id: randomUUID(), name, fileName: 'project-resources.json', digest: '', createdAt: now(), project,
            manualSteps: Object.fromEntries(cases.map(c => [c.id, c.manualSteps])),
            prerequisiteCases: Object.fromEntries(cases.map(c => [c.id, c.prerequisites])),
            prerequisiteReviews: Object.fromEntries(cases.filter(c => c.prerequisiteReview).map(c => [c.id, c.prerequisiteReview!])),
            scriptReviews: Object.fromEntries(cases.filter(c => c.scriptReview).map(c => [c.id, c.scriptReview!])),
            sourceCases: document.testCases!,
            resourceSources: Object.fromEntries(cases.map(c => [c.id, { sourcePath: c.sourcePath, sourceExpected: c.sourceExpected, ...(c.priority ? { priority: c.priority } : {}), ...(c.sourceId ? { sourceId: c.sourceId } : {}) }])),
        };
        // Imported steps are explicitly authored; never generate over them later.
        value.editedSteps = Object.fromEntries(project.cases.filter(c => c.steps.length).map(c => [c.id, moduleDigest(c)]));
        value.digest = moduleDigest({ project: value.project, manualSteps: value.manualSteps, prerequisites: value.prerequisiteCases });
        return value;
    }
    async commitResourceModule(value: WebModule) {
        await this.deps.saveProject(value.project);
        return this.save('module', value);
    }
    revisePrerequisites(key: string, changes: Array<{
        caseId: string;
        prerequisites: CaseDependency[];
        review: PrerequisiteReview;
    }>) {
        const source = this.getModule(key), next = structuredClone(source);
        next.prerequisiteCases = { ...next.prerequisiteCases };
        next.prerequisiteReviews = { ...next.prerequisiteReviews };
        for (const c of changes) {
            if (!next.project.cases.some(v => v.id === c.caseId))
                throw Error('前置计划包含未知用例。');
            next.prerequisiteCases[c.caseId] = structuredClone(c.prerequisites);
            next.prerequisiteReviews[c.caseId] = structuredClone(c.review);
        }
        if (moduleDigest({ deps: source.prerequisiteCases, reviews: source.prerequisiteReviews }) === moduleDigest({ deps: next.prerequisiteCases, reviews: next.prerequisiteReviews }))
            return source;
        next.id = randomUUID();
        next.createdAt = now();
        next.digest = moduleDigest({ source: source.digest, prerequisites: next.prerequisiteCases, reviews: next.prerequisiteReviews });
        // Only workflow metadata changes; original cases, scripts, cache and projects remain byte-identical.
        return this.save('module', next);
    }
    /** Editor revisions never change existing packages or job snapshots. */
    async reviseCase(key: string, caseId: string, change: {
        title: string;
        expected: string;
        steps: BrowserCheck['steps'];
        manualSteps: string[];
        prerequisites: CaseDependency[];
    }) {
        const source = this.getModule(key), next = structuredClone(source), index = next.project.cases.findIndex(c => c.id === caseId);
        if (index < 0)
            throw Error('用例不存在。');
        const original = next.project.cases[index]!;
        const checked = validateCases([{ ...original, title: change.title, expected: change.expected, steps: change.steps }])[0]!;
        const cache = source.cachedSteps?.[caseId], effective = (!original.steps.length || cache?.reviewKind) && cache?.sourceDigest === moduleDigest(original) ? cache.steps : original.steps;
        const stepsChanged = moduleDigest(effective) !== moduleDigest(checked.steps);
        // Keep existing provenance and business gates; only explicitly edited fields change.
        next.project.cases[index] = { ...original, title: checked.title, expected: checked.expected, ...(stepsChanged ? { steps: checked.steps } : {}) };
        next.id = randomUUID();
        next.createdAt = now();
        next.project.id = randomUUID();
        next.manualSteps = { ...next.manualSteps, [caseId]: change.manualSteps };
        next.prerequisiteCases = { ...next.prerequisiteCases, [caseId]: change.prerequisites };
        if (moduleDigest(source.prerequisiteCases?.[caseId] ?? []) !== moduleDigest(change.prerequisites))
            next.prerequisiteReviews = { ...next.prerequisiteReviews, [caseId]: { status: 'reviewed', note: '前置编号已由用户更新；执行前仍需核对当前账号和对应业务记录。' } };
        if (stepsChanged || source.editedSteps?.[caseId] === moduleDigest(original))
            next.editedSteps = { ...next.editedSteps, [caseId]: moduleDigest(next.project.cases[index]) };
        next.cachedSteps = { ...next.cachedSteps };
        if (cache?.sourceDigest === moduleDigest(original))
            next.cachedSteps[caseId] = { ...cache, sourceDigest: moduleDigest(next.project.cases[index]), steps: checked.steps };
        else
            delete next.cachedSteps[caseId];
        const sourceCase = next.sourceCases?.find(c => c.id === caseId);
        if (sourceCase) {
            sourceCase.title = checked.title;
            sourceCase.expected = checked.expected;
            sourceCase.steps = checked.steps;
        }
        next.digest = moduleDigest({ project: next.project, manualSteps: next.manualSteps, prerequisiteCases: next.prerequisiteCases });
        await this.deps.saveProject(next.project);
        return this.save('module', next);
    }
    async import(input: unknown) {
        const data = z.object({ fileName: z.string().min(1).max(200), bytesBase64: z.string().min(1).max(5600000), targetUrl: z.string().min(1).max(2000), name: z.string().max(120).optional() }).parse(input);
        if (!/\.(?:csv|md|markdown)$/i.test(data.fileName))
            throw new Error('请上传 CSV 或 Markdown 模块用例包。');
        const bytes = Buffer.from(data.bytesBase64, 'base64');
        if (!bytes.length || bytes.length > 4 * 1024 * 1024)
            throw new Error('用例包须为 1 字节到 4 MB。');
        const targetUrl = moduleTarget(data.targetUrl);
        const digest = moduleDigest({ file: bytes.toString('base64'), targetUrl });
        const existing = this.list<WebModule>('module').find(m => m.digest === digest);
        if (existing)
            return existing;
        const parsed = /\.(?:md|markdown)$/i.test(data.fileName) ? parseDifyMarkdown(bytes.toString('utf8')) : undefined;
        const document = parsed?.document ?? await extractDocument(data.fileName, bytes);
        if (!document.testCases?.length)
            throw new Error('没有识别到测试用例。');
        if (document.testCases.some(c => (c.preconditions?.length ?? 0) > 10 || c.preconditions?.some(v => v.length > 500)))
            throw new Error('每条用例最多支持 10 个前置条件，每项最多 500 字；请拆分，原文不会被截断。');
        const ids = new Set<string>();
        for (const c of document.testCases) {
            if (!c.id || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(c.id) || ids.has(c.id))
                throw new Error('case_id 必须唯一，且为 1–80 位字母、数字、点、冒号、下划线或连字符。');
            ids.add(c.id);
            if (!c.title.trim() || !c.expected.trim())
                throw new Error('每条用例都需要标题和明确的原始预期。');
        }
        const project = makeDocumentProject({ name: data.name || data.fileName.replace(/\.(?:csv|md|markdown)$/i, ''), fileName: data.fileName, document, targetUrl, caseMode: 'existing' });
        project.cases = validateCases(project.cases.map((item, index) => {
            const source = document.testCases![index]!;
            const steps = source.steps ?? [];
            const held = /^(?:hold|blocked|needs?[-_])/i.test(source.status ?? '');
            const runnable = !held && steps.some(step => typeof step === 'object' && step !== null && String((step as {
                action?: unknown;
            }).action).startsWith('assert'));
            const preconditions = source.preconditions ?? [];
            return { ...item, id: source.id!, steps, preconditions, preconditionsConfirmed: preconditions.length === 0, testData: source.testData ?? [], lifecycleStatus: runnable ? 'runnable' : 'draft', selectedForRegression: runnable, ...(held ? { coverageGap: '原包状态：' + source.status + '；需先确认账号、环境或副作用条件。' } : {}) };
        }));
        project.confirmationRequired = false;
        await this.deps.saveProject(project);
        const value: WebModule = { id: randomUUID(), name: project.name, fileName: data.fileName, digest, createdAt: now(), project, sourceCases: structuredClone(document.testCases), ...(parsed ? { manualSteps: parsed.manualSteps } : {}) };
        return this.save('module', value);
    }
    start(input: unknown, context?: {
        profileId: string;
        targetUrl: string;
        moduleName?: string;
        databaseBinding?: RegressionDatabaseBinding;
    }) {
        const data = z.object({ moduleId: id, requestId: id, selectedCaseIds: z.array(z.string()).min(1).max(200).optional(), confirmedCaseIds: z.array(z.string()).max(200).default([]), parentJobId: id.optional(), runMode: z.enum(['fixed', 'assist']).optional() }).parse(input);
        if (data.parentJobId && !context) {
            const parent = this.getJob(data.parentJobId);
            if (parent.snapshot.browserProfileIsolation)
                context = { profileId: parent.snapshot.id, targetUrl: parent.snapshot.targetUrl, moduleName: parent.moduleName, ...(parent.databaseBinding ? { databaseBinding: parent.databaseBinding } : {}) };
        }
        const fingerprint = moduleDigest(context ? { data, context } : data);
        const previous = this.db.prepare('SELECT fingerprint,job_id FROM requests WHERE id=?').get(data.requestId);
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw new Error('同一请求编号不能对应不同测试范围。');
            return this.getJob(String(previous.job_id));
        }
        const module = this.getModule(data.moduleId);
        const selected = data.selectedCaseIds ?? module.project.cases.map(c => c.id);
        // A pending script review is recorded on each result, but it must not
        // prevent a full run from producing evidence. The run itself decides
        // whether the saved steps are executable; cases without reliable steps
        // are recorded as blocked instead of being silently skipped.
        const known = new Set(module.project.cases.map(c => c.id));
        if (new Set(selected).size !== selected.length || selected.some(c => !known.has(c)) || data.confirmedCaseIds.some(c => !selected.includes(c)))
            throw new Error('选择范围包含重复或不属于当前模块的用例。');
        if (selected.some(c => (module.prerequisiteCases?.[c]?.length ?? 0) > 0)) {
            if (!this.editorPrerequisiteGuard)
                throw Error('当前入口无法核验前置用例，请从执行测试运行。');
            this.editorPrerequisiteGuard(module.id, selected, context?.profileId);
        }
        if (data.parentJobId) {
            const parent = this.getJob(data.parentJobId);
            if (parent.moduleId !== module.id)
                throw new Error('重测必须属于同一个模块版本。');
        }
        if ([...this.active.keys()].some(key => this.getJob(key).snapshot.id === (context?.profileId ?? module.project.id)))
            throw new Error('该模块或系统测试窗口已有运行，请等待或取消后再试。');
        const job: WebModuleJob = { id: randomUUID(), moduleId: module.id, moduleName: module.name, moduleDigest: module.digest, requestId: data.requestId, parentJobId: data.parentJobId, createdAt: now(), updatedAt: now(), phase: 'queued', outcome: 'not_executed', message: '已保存任务，正在准备。', selectedCaseIds: selected, confirmedCaseIds: data.confirmedCaseIds, snapshot: structuredClone(module.project), difyRuns: [], results: selected.map(key => { const c = module.project.cases.find(c => c.id === key)!; return { caseId: c.id, title: c.title, expected: c.expected, priority: c.priority, status: 'not_executed', detail: '尚未执行。' }; }), events: [] };
        job.runMode = data.runMode ?? (data.parentJobId ? this.getJob(data.parentJobId).runMode : undefined) ?? 'assist';
        if (context) {
            job.snapshot.id = id.parse(context.profileId);
            job.snapshot.targetUrl = moduleTarget(context.targetUrl);
            job.snapshot.browserProfileIsolation = true;
            job.moduleName = context.moduleName ?? job.moduleName;
            job.snapshot.name = job.moduleName;
        }
        if (context?.databaseBinding) {
            if (!supportsDepartmentDatabase(job.snapshot.targetUrl))
                throw Error('数据库绑定与被测环境不匹配。');
            job.databaseBinding = context.databaseBinding;
        }
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.save('job', job);
            this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(data.requestId, fingerprint, job.id);
            this.db.exec('COMMIT');
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
        this.launch(job);
        return job;
    }
    markdown(key: string) {
        const module = this.getModule(key);
        const cases = structuredClone(module.project.cases);
        for (const c of cases) {
            const cache = module.cachedSteps?.[c.id];
            if ((!c.steps.length || cache?.reviewKind) && cache?.sourceDigest === moduleDigest(c))
                c.steps = cache.steps;
        }
        return formatDifyMarkdown(module.name, cases, module.manualSteps);
    }
    reportForExport(key: string) { const job = this.getJob(key); const report = job.report ?? this.renderReport(job); assertDifyExportSafe(report); return report; }
    readiness(key: string) {
        const module = this.getModule(key);
        return module.project.cases.map(original => {
            const c = structuredClone(original);
            const cache = module.cachedSteps?.[c.id];
            if ((!c.steps.length || cache?.reviewKind) && cache?.sourceDigest === moduleDigest(c))
                c.steps = cache.steps;
            const legacyGap = /^原包状态：needs?[-_]login/i.test(c.coverageGap ?? '') ? undefined : c.coverageGap;
            const reason = difyCoverageGap(c, cache?.sourceDigest === moduleDigest(original) ? cache.reviewKind : undefined) ?? missingDirectAssertion(c) ?? (cache?.reviewKind && cache.sourceDigest === moduleDigest(original) ? undefined : legacyGap) ?? (!c.steps.length ? '尚无固定步骤' : undefined);
            return { caseId: c.id, priority: c.priority, hasFixedSteps: c.steps.length > 0, coverageGap: reason, ...(reason ? difyBlocker(c, reason) : {}) };
        });
    }
    private event(job: WebModuleJob, phase: Phase, message: string) { job.phase = phase; job.message = message; job.updatedAt = now(); job.events.push({ at: job.updatedAt, phase, message }); this.save('job', job); }
    private launch(job: WebModuleJob, reportOnly = false) { const controller = new AbortController(); this.active.set(job.id, controller); void this.run(job, controller.signal, reportOnly).finally(() => this.active.delete(job.id)); }
    async cancel(key: string) {
        const job = this.getJob(key);
        if (!this.active.has(key))
            throw new Error('任务已结束，不能取消或改写历史结果。');
        this.active.get(job.id)!.abort();
        await this.deps.cancel(job.snapshot.id, job.documentRunId);
        this.event(job, 'cancelled', '已取消；已完成的结果仍保留。');
        return this.getJob(key);
    }
    async continue(key: string) {
        const job = this.getJob(key);
        if (job.phase !== 'awaiting-login')
            throw new Error('该任务当前没有等待登录。');
        await this.deps.continueLogin(job.snapshot.id);
        return this.getJob(key);
    }
    async retry(key: string) {
        const job = this.getJob(key);
        if (this.active.has(key))
            throw new Error('任务仍在运行。');
        if (!['error', 'blocked', 'interrupted'].includes(job.phase))
            throw new Error('当前任务无需重试；可创建新一轮重测。');
        if (job.executionStarted && !job.executionFinished) {
            const recovered = job.documentRunId ? await this.deps.recover(job.documentRunId) : undefined;
            if (!recovered)
                throw new Error('上轮执行中断且没有完整结果，请新建一轮重测，避免重复执行。');
            this.capture(job, recovered);
        }
        this.launch(job, job.executionFinished === true);
        return job;
    }
    private async cloud(job: WebModuleJob, phase: string, batch: number, inputs: Record<string, string>, caseIds: string[], signal: AbortSignal, kind: 'prepare' | 'execution') {
        const record = { phase, batch, inputDigest: moduleDigest(inputs), caseIds };
        for (let attempt = 0;; attempt++) {
            try {
                const result = await this.deps.cloud(kind, inputs, `testpilot-web-${job.id}`, signal);
                job.difyRuns.push({ ...record, id: result.workflowRunId, status: 'succeeded', ...(typeof result.tokens === 'number' ? { tokens: result.tokens } : {}) });
                this.save('job', job);
                return result.output;
            }
            catch (error) {
                job.difyRuns.push({ ...record, id: error instanceof DifyWorkflowError ? error.workflowRunId : undefined, status: 'failed' });
                this.save('job', job);
                if (phase !== 'prepare' && error instanceof DifyWorkflowError && /^http_(502|503|504)$/.test(error.code) && attempt < 2 && !signal.aborted) {
                    this.event(job, job.phase, `Dify 当前${phase}阶段临时不可用，正在重试 ${attempt + 1}/2；不重复执行已完成的网页用例。`);
                    await delay(1000 * (attempt + 1), undefined, { signal });
                    continue;
                }
                throw error;
            }
        }
    }
    private capture(job: WebModuleJob, run: DocumentRun) {
        for (const row of job.results) {
            const actual = run.deterministic.results.find(c => c.id === row.caseId);
            if (actual) {
                row.status = actual.status === 'passed' || actual.status === 'failed' ? actual.status : actual.status === 'blocked' ? 'blocked' : 'not_executed';
                row.detail = actual.detail;
                row.evidence = actual.evidence;
                row.evidenceOrigin = 'document-run';
                row.evidenceNote = (actual as typeof actual & {
                    evidenceNote?: string;
                }).evidenceNote ?? row.evidenceNote;
            }
        }
        job.executionFinished = true;
        job.outcome = jobOutcome(job);
        this.save('job', job);
    }
    private async report(job: WebModuleJob, signal: AbortSignal) {
        if (job.runMode === 'fixed') {
            signal.throwIfAborted();
            checkModulePlan(job);
            if (job.databaseEvidence && moduleDigest(job.databaseEvidence) !== job.databaseEvidenceDigest) throw Error('数据库证据指纹不一致，未完成汇总。');
            this.event(job, 'reporting', '正在本机汇总真实执行结果。');
            job.outcome = jobOutcome(job); job.report = this.renderReport(job);
            this.event(job, 'completed', job.outcome === 'passed' ? '本轮实际执行全部通过。' : job.outcome === 'failed' ? '本轮发现失败，请查看证据。' : '本轮存在阻塞或未执行项。');
            return;
        }
        this.event(job, 'reporting', 'Dify 正在汇总真实执行结果。');
        if (job.databaseEvidence) {
            if (moduleDigest(job.databaseEvidence) !== job.databaseEvidenceDigest)
                throw Error('数据库证据指纹不一致，未完成汇总。');
            const rows = job.databaseEvidence.checks;
            const manifest: ExecutionManifest = { schema: 1, run_id: job.id, module_id: job.moduleId, plan_digest: job.databaseEvidenceDigest!, suite_digest: job.moduleDigest, case_ids: rows.map(r => `database:${r.id}`) };
            const output = await this.cloud(job, 'database-summary', 0, { execution_json: JSON.stringify({ ...manifest, phase: 'report', results: rows.map(r => ({ case_id: `database:${r.id}`, status: r.status })), database_evidence: job.databaseEvidence }) }, manifest.case_ids, signal, 'execution');
            for (const key of ['schema', 'run_id', 'module_id', 'plan_digest', 'suite_digest', 'case_ids'] as const)
                if (JSON.stringify(output[key]) !== JSON.stringify(manifest[key]))
                    throw Error('Dify 数据库汇总身份或证据不一致。');
            if (output.phase !== 'report' || JSON.stringify(output.counts) !== JSON.stringify(resultCounts(rows)))
                throw Error('Dify 数据库汇总与本机核验不一致。');
        }
        for (let offset = 0; offset < job.results.length; offset += 20) {
            const rows = job.results.slice(offset, offset + 20);
            const manifest: ExecutionManifest = { schema: 1, run_id: job.id, module_id: job.moduleId, plan_digest: job.planDigest ?? moduleDigest(job.snapshot), suite_digest: job.moduleDigest, case_ids: rows.map(r => r.caseId) };
            const results = rows.map(r => ({ case_id: r.caseId, status: r.status }));
            const output = await this.cloud(job, 'report', offset / 20, { execution_json: JSON.stringify({ ...manifest, phase: 'report', results }) }, manifest.case_ids, signal, 'execution');
            for (const key of ['schema', 'run_id', 'module_id', 'plan_digest', 'suite_digest', 'case_ids'] as const)
                if (JSON.stringify(output[key]) !== JSON.stringify(manifest[key]))
                    throw new Error('Dify 汇总身份或范围不一致。');
            if (output.phase !== 'report' || JSON.stringify(output.counts) !== JSON.stringify(resultCounts(rows)))
                throw new Error('Dify 汇总统计与实际执行结果不一致。');
        }
        job.outcome = jobOutcome(job);
        job.report = this.renderReport(job);
        this.event(job, 'completed', job.outcome === 'passed' ? '本轮实际执行全部通过。' : job.outcome === 'failed' ? '本轮发现失败，请查看证据。' : '本轮存在阻塞或未执行项。');
    }
    renderReport(job: WebModuleJob) { const counts = resultCounts(job.results); return [`# ${job.moduleName} 模块测试报告`, `任务：${job.id}`, `模块版本：${job.moduleDigest}`, `目标：${job.snapshot.targetUrl}`, `范围：${job.results.length} / ${job.snapshot.cases.length} 条`, `执行模式：${job.runMode === 'fixed' ? '固定回归（未调用模型整理）' : 'AI 辅助整理'}`, `实际结果：通过 ${counts.passed}，失败 ${counts.failed}，阻塞 ${counts.blocked}，异常 ${counts.error}，未执行 ${counts.not_executed}（其中范围外 ${job.results.filter(r => r.outOfScope).length}）`, `网页执行：${job.documentRunId ?? (job.authorizedWriteCaseIds?.length ? '专用授权业务提交（见逐条结果及本机写入日志）' : '没有启动网页执行')}`, `\n## Dify 阶段`, ...job.difyRuns.map(r => `- ${r.phase} 第 ${r.batch + 1} 批：${r.status}；运行 ${r.id ?? '未取得运行编号'}`), ...(job.databaseEvidence ? [`\n## 本轮数据库补充核验（不计入 XMind 用例通过数）`, `证据指纹：${job.databaseEvidenceDigest}`, `采集时间：${job.databaseEvidence.capturedAt}`, `状态：${job.databaseEvidence.status}`, ...(independentRecordScope(job) ? ["适用范围：本轮只读空态/输入校验不要求已有本人记录；本人列表、详情的缺项仍保留，不影响本轮用例结果。"] : []), ...job.databaseEvidence.checks.map(c => `- ${c.title}：${c.status}；${c.detail}`)] : []), `\n## 逐条结果`, ...job.results.map(r => `\n### ${r.title} (${r.caseId} · ${r.priority ?? '未记录优先级'})\n状态：${r.outOfScope ? '范围外（未执行）' : r.status}\n\n原始预期：${r.expected}\n\n实际观察：${r.detail}${r.blockerCode ? '\n\n阻塞类别：' + r.blockerCode : ''}${r.nextAction ? '\n\n处理方式：' + r.nextAction : ''}${r.preparationReview ? '\n\n执行准备审核：' + r.preparationReview : ''}${r.evidence ? `\n\n页面证据：/api/dify-web-modules/jobs/${job.id}/evidence/${r.evidence}` : ''}${r.evidenceNote ? '\n\n截图说明：' + r.evidenceNote : ''}`)].join('\n\n'); }
    private async run(job: WebModuleJob, signal: AbortSignal, reportOnly: boolean) {
        try {
            if (reportOnly) {
                await this.report(job, signal);
                return;
            }
            this.event(job, 'preflight', '正在连接测试窗口。');
            const evidence = await this.deps.inspect(job.snapshot, job, signal, waiting => this.event(job, waiting ? 'awaiting-login' : 'preflight', waiting ? '请在测试窗口登录，然后点击“我已登录”。' : '已连接目标页面。'));
            signal.throwIfAborted();
            if (job.databaseBinding) {
                this.event(job, 'preflight', '正在核验本轮测试库与当前账号数据。');
                job.databaseEvidence = this.deps.database ? await this.deps.database(job.snapshot, signal) : { binding: job.databaseBinding, capturedAt: now(), status: 'blocked', checks: [{ id: 'connection', title: '测试库只读连接', status: 'blocked', detail: '本机尚未配置数据库核验适配器。' }] };
                signal.throwIfAborted();
                job.databaseEvidenceDigest = moduleDigest(job.databaseEvidence);
                this.save('job', job);
            }
            this.event(job, 'preparing', job.runMode === 'fixed' ? '正在检查固定计划与执行范围。' : 'Dify 正在整理模块内容。');
            const selected = job.snapshot.cases.filter(c => job.selectedCaseIds.includes(c.id));
            const sha = moduleDigest({ module: job.moduleDigest, caseIds: job.selectedCaseIds });
            const observed = JSON.parse(evidence) as {
                controls?: Array<{
                    role?: string;
                    tag?: string;
                    name?: string;
                    placeholder?: string;
                }>;
            };
            const sourceWords = JSON.stringify(cloudSafe(selected));
            const capabilities = { controlTypes: [...new Set((observed.controls ?? []).map(c => c.role ?? c.tag).filter(Boolean))], referencedControls: (observed.controls ?? []).filter(c => c.name && sourceWords.includes(c.name)).map(c => ({ role: c.role ?? c.tag, name: c.name })).slice(0, 40) };
            const sourcesFor = (batch: BrowserCheck[]): RegressionSourceItem[] => cloudSafe(batch.map(c => ({ case_id: c.id, title: c.title, source_path: c.modulePath?.length ? [...c.modulePath, c.title] : [job.moduleName, c.title], source_expected_verbatim: c.expected, source_sha256: sha, preconditions_proposed: c.preconditions, steps_proposed: c.steps.length ? cloudSafe(c.steps).map(s => JSON.stringify(s)) : cloudSafe(this.getModule(job.moduleId).manualSteps?.[c.id] ?? []), needs_confirmation: [] })));
            const inputFor = (batch: BrowserCheck[]) => JSON.stringify({ baseline_sha256: sha, cases: sourcesFor(batch), page_capabilities: capabilities, ...(job.databaseEvidence ? { database_context: job.databaseEvidence, database_context_sha256: job.databaseEvidenceDigest } : {}) });
            const batches: BrowserCheck[][] = [];
            let pending: BrowserCheck[] = [];
            for (const item of job.runMode === 'fixed' ? [] : selected) {
                if (pending.length && (pending.length >= 6 || inputFor([...pending, item]).length > 59000)) {
                    batches.push(pending);
                    pending = [];
                }
                if (inputFor([item]).length > 59000)
                    throw new Error(`用例 ${item.id} 超过 Dify 单次输入容量，请拆分这条用例；未截断内容。`);
                pending.push(item);
            }
            if (pending.length)
                batches.push(pending);
            let prepared = 0;
            if (job.runMode !== 'fixed') {
                for (const [batchIndex, batch] of batches.entries()) {
                    signal.throwIfAborted();
                    const sources = sourcesFor(batch);
                    const input = inputFor(batch);
                    const output = await this.cloud(job, 'prepare', batchIndex, { source_json: input }, batch.map(c => c.id), signal, 'prepare');
                    const proposals = validateDifyOutput(output, sha, sources);
                    for (const c of batch) {
                        const p = proposals.find(p => p.case_id === c.id)!;
                        job.results.find(r => r.caseId === c.id)!.proposal = { steps: p.steps_proposed, preconditions: p.preconditions_proposed, questions: p.needs_confirmation };
                    }
                    prepared += batch.length;
                    this.event(job, 'preparing', `Dify 已整理 ${prepared} / ${selected.length} 条用例。`);
                }
            }
            else
                this.event(job, 'preparing', '使用已保存脚本，本机校验、执行与汇总。');
            const execution = structuredClone(job.snapshot);
            execution.reviewStatus = 'approved';
            execution.confirmationRequired = false;
            const module = this.getModule(job.moduleId);
            module.cachedSteps ??= {};
            const writeResults = await this.deps.authorizedWrites?.(job.snapshot, job.id, selected, signal, message => { job.executionStarted = true; this.event(job, 'executing', message); }) ?? [];
            const writtenIds = new Set(writeResults.map(r => r.caseId));
            for (const actual of writeResults) {
                const row = job.results.find(r => r.caseId === actual.caseId);
                if (!row)
                    throw Error('授权写入返回了未选择的用例。');
                Object.assign(row, actual);
                if (actual.evidence)
                    row.evidenceOrigin = 'authorized-write';
                row.preparationReview = '用户已授权此测试环境的真实业务写入；专用执行路径限定账号窗口、原始用例、唯一标记、提交数量和落库核对，保留执行日志，不重复提交结果未知的请求。';
            }
            if (writeResults.length) {
                job.authorizedWriteCaseIds = [...writtenIds];
                job.executionFinished = true;
                this.save('job', job);
            }
            for (const c of execution.cases) {
                if (!job.selectedCaseIds.includes(c.id)) {
                    c.selectedForRegression = false;
                    continue;
                }
                if (writtenIds.has(c.id)) {
                    c.lifecycleStatus = 'draft';
                    c.selectedForRegression = false;
                    continue;
                }
                signal.throwIfAborted();
                const row = job.results.find(r => r.caseId === c.id)!;
                const excluded = excludedCaseReason(c);
                if (excluded) {
                    row.outOfScope = true;
                    row.status = 'not_executed';
                    row.detail = excluded;
                    c.lifecycleStatus = 'disabled';
                    c.selectedForRegression = false;
                    continue;
                }
                if (job.confirmedCaseIds.includes(c.id))
                    c.preconditionsConfirmed = true;
                const edited = module.editedSteps?.[c.id] === moduleDigest(job.snapshot.cases.find(v => v.id === c.id));
                const reviewed = reviewedDifyReadOnlyPlan(c, evidence, job.snapshot.targetUrl);
                if (reviewed) {
                    if (!edited)
                        c.steps = reviewed.steps;
                    if (reviewed.executionData)
                        c.testData = [...(c.testData ?? []), ...reviewed.executionData];
                    row.preparationReview = (edited ? '使用已保存的编辑脚本；' : '') + reviewed.detail;
                    if (/^原包状态：hold-account-or-effect-review/.test(c.coverageGap ?? '') || connectedEvidenceKind(c) && /^原包状态：/.test(c.coverageGap ?? ''))
                        delete c.coverageGap;
                }
                const cache = module.cachedSteps[c.id];
                if (!c.steps.length && cache?.sourceDigest === moduleDigest(job.snapshot.cases.find(v => v.id === c.id)))
                    c.steps = cache.steps;
                let reason: string | undefined = cache?.reviewKind && !reviewed ? '当前页面未重新核对到已审核只读计划所需的唯一控件。' : !c.steps.length && !canAuthorReadOnlyBrowserSteps(c) ? browserStepDraftBlockReason(c) : undefined;
                if (c.steps.some(s => s.action.startsWith('fill') && isSensitiveExportField('label' in s ? s.label : 'placeholder' in s ? s.placeholder : '')))
                    reason = '账号密码和验证码由你在测试窗口输入，不能放入自动执行步骤。';
                if (!reason && !c.steps.length && job.runMode === 'fixed')
                    reason = '尚无固定步骤，请选择 AI 辅助整理一次后再执行固定回归。';
                if (!reason && !c.steps.length) {
                    try {
                        c.steps = await this.deps.author(job.snapshot, c, evidence, row.proposal?.steps ?? []);
                        c.steps = validateCases([{ ...c, steps: c.steps }])[0]!.steps;
                    }
                    catch {
                        reason = '没有形成基于当前页面证据的可靠步骤，请检查登录、用例预期或前置数据后重试。';
                    }
                }
                if (!reason)
                    reason = difyCoverageGap(c, reviewed?.kind);
                if (!reason && c.coverageGap && !/^原包状态：needs?[-_]login/i.test(c.coverageGap))
                    reason = c.coverageGap;
                if (!reason && actionablePreconditions(c).length && !c.preconditionsConfirmed) {
                    reason = '请确认这条用例需要的前置数据和权限已准备。';
                    row.needsConfirmation = true;
                }
                if (!actionablePreconditions(c).length)
                    c.preconditionsConfirmed = true;
                if (!reason && !c.steps.some(s => assertions.has(s.action)))
                    reason = '缺少可判定原始预期的页面断言。';
                if (!reason)
                    reason = missingDirectAssertion(c);
                if (!reason && !isSafeReadOnlyBrowserCase(c))
                    reason = '该用例需要身份、服务端证据或非只读操作，当前不能自动验证完整预期。';
                if (reason) {
                    const blocked = difyBlocker(c, reason);
                    row.status = 'blocked';
                    row.detail = blocked.detail;
                    row.blockerCode = blocked.blockerCode;
                    row.nextAction = blocked.nextAction;
                    c.lifecycleStatus = 'draft';
                    c.selectedForRegression = false;
                    continue;
                }
                c.sideEffectRisk = 'none';
                c.lifecycleStatus = 'runnable';
                c.selectedForRegression = true;
                delete c.coverageGap;
                row.steps = c.steps;
                module.cachedSteps[c.id] = { sourceDigest: moduleDigest(job.snapshot.cases.find(v => v.id === c.id)), steps: c.steps, ...(reviewed ? { reviewKind: reviewed.kind } : {}) };
            }
            const prerequisiteRows = job.results.filter(row => row.status === 'blocked' && !row.evidence);
            let checkedPrerequisites = 0;
            for (const row of prerequisiteRows) {
                signal.throwIfAborted();
                const item = job.snapshot.cases.find(item => item.id === row.caseId)!;
                try {
                    const shot = await this.deps.captureBlockedEvidence?.(job.snapshot, job.id, item, signal);
                    if (shot) {
                        row.evidence = shot.evidence;
                        row.evidenceOrigin = 'preflight';
                        row.evidenceNote = shot.evidenceNote;
                    }
                    else
                        row.evidenceNote = '前置条件阻塞，未取得本轮可安全采集的现场截图；业务断言未执行。';
                }
                catch {
                    row.evidenceNote = '本轮前置阻塞截图采集失败；没有借用历史截图，业务断言未执行。';
                }
                this.event(job, 'preflight', `已记录 ${++checkedPrerequisites} / ${prerequisiteRows.length} 条前置阻塞及证据情况；随后执行具备条件的用例。`);
            }
            this.save('module', module);
            job.executionProject = execution;
            job.planDigest = executionDigest(job);
            this.save('job', job);
            checkModulePlan(job);
            const runnable = execution.cases.filter(c => job.selectedCaseIds.includes(c.id) && c.lifecycleStatus === 'runnable' && c.selectedForRegression);
            if (runnable.length) {
                this.event(job, 'dispatching', job.runMode === 'fixed' ? `本机派发 ${runnable.length} 条可执行用例。` : `Dify 正在派发 ${runnable.length} 条可执行用例。`);
                for (let offset = 0; job.runMode !== 'fixed' && offset < runnable.length; offset += 20) {
                    const manifest: ExecutionManifest = { schema: 1, run_id: job.id, module_id: job.moduleId, plan_digest: job.planDigest!, suite_digest: job.moduleDigest, case_ids: runnable.slice(offset, offset + 20).map(c => c.id) };
                    checkDispatch(await this.cloud(job, 'dispatch', offset / 20, { execution_json: JSON.stringify({ ...manifest, phase: 'dispatch' }) }, manifest.case_ids, signal, 'execution'), manifest);
                }
                signal.throwIfAborted();
                checkModulePlan(job);
                await this.deps.saveProject(execution);
                job.documentRunId = randomUUID();
                job.executionStarted = true;
                this.event(job, 'executing', `正在测试 ${runnable.length} 条用例。`);
                const executionPromise = this.deps.execute(execution, job.documentRunId, runnable.map(c => c.id), stage => {
                    if (stage === 'awaiting-login')
                        this.event(job, 'awaiting-login', '测试窗口需要重新登录，请登录后继续。');
                    else if (job.phase === 'awaiting-login')
                        this.event(job, 'executing', '登录已接续，继续测试。');
                }, actual => {
                    const row = job.results.find(r => r.caseId === actual.id);
                    if (row) {
                        row.status = actual.status === 'passed' || actual.status === 'failed' ? actual.status : actual.status === 'blocked' ? 'blocked' : 'not_executed';
                        row.detail = actual.detail;
                        row.evidence = actual.evidence;
                        row.evidenceOrigin = 'document-run';
                        row.evidenceNote = actual.evidenceNote;
                        job.updatedAt = now();
                        this.save('job', job);
                    }
                });
                // A browser adapter must never hold an entire multi-module
                // regression forever. Release the document run after a bounded
                // window, retain any per-case results already recorded, and let
                // the batch continue to the next module with an explicit error.
                const laneResult = await new Promise<Awaited<typeof executionPromise>>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        void Promise.race([
                            this.deps.cancel(job.snapshot.id, job.documentRunId).catch(() => undefined),
                            new Promise<void>(done => setTimeout(done, 5000)),
                        ]).finally(() => {
                            for (const row of job.results) {
                                if (job.selectedCaseIds.includes(row.caseId) && row.status === 'not_executed') {
                                    row.status = 'blocked';
                                    row.detail = '网页执行超过 2 分钟；本条未完成实际操作，已停止当前模块并记录为阻塞，不再另开补跑批次。';
                                }
                            }
                            this.save('job', job);
                            reject(new Error('网页执行超过 2 分钟，已停止当前模块并保留已记录结果。'));
                        });
                    }, 120_000);
                    executionPromise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
                });
                this.capture(job, laneResult);
            }
            else {
                job.executionFinished = true;
                this.save('job', job);
            }
            for (const row of job.results) {
                if (row.status !== 'blocked' || row.outOfScope)
                    continue;
                const source = job.snapshot.cases.find(c => c.id === row.caseId);
                const diagnosis = source && departmentBlockerDiagnostic(source, job.databaseEvidence);
                if (diagnosis)
                    row.detail += ' 本轮数据库排查：' + diagnosis;
            }
            signal.throwIfAborted();
            await this.report(job, signal);
        }
        catch (error) {
            if (signal.aborted) {
                this.event(job, 'cancelled', '已取消；已完成的实际结果仍保留。');
                return;
            }
            if (job.executionStarted)
                job.outcome = jobOutcome(job);
            job.errorCode = error instanceof DifyWorkflowError ? error.code : 'execution_failed';
            this.event(job, 'error', error instanceof DifyWorkflowError ? error.message : error instanceof Error ? String(cloudSafe(error.message)).slice(0, 500) : '任务未完成，可以重试当前阶段。');
        }
    }
}
