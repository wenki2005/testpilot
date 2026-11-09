import { scriptSupport } from '../resources/script-coverage.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { DifyWebModuleStore, moduleDigest, moduleTarget, type WebModuleDependencies, type WebModuleJob } from '../execution/module-execution-service.js';
import type { DocumentProject } from '../../documents/execution/workflow-facade.js';
import type { TestedSystem, FixedModule, BatchEntry, RegressionBatch, BatchView, AccountView, SystemModuleState } from '../../../domain/regression/module-catalog-contract.js';
import { supportsDepartmentDatabase } from '../../../domain/database/regression-database-contract.js';
import { difyScriptPackage, difySelectionScriptPackage, type DifyScriptModuleInput } from '../exports/script-package.js';
import { difyScriptName } from '../../../domain/regression/script-package-layout.js';
import { mysqlBrowserStatus } from '../../database/mysql-browser.js';
import { assertDifyExportSafe } from '../exports/export-policy.js';
import { difyBlocker } from '../authoring/case-readiness.js';
import { DifyBatchNotifier } from '../notifications/batch-notifier.js';
import type { CaseDependency, CaseEditorCatalog, EditableCase } from '../../../domain/cases/case-script-contract.js';
import { departmentCoreChains } from '../../../domain/regression/core-chain-definitions.js';
import { validateProjectResources, compareProjectResources, resourceDigest, resourceKey, type ProjectResources } from '../resources/project-resource-contract.js';
const uuid = z.string().uuid();
const terminal = new Set(['completed', 'error', 'blocked', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
const systemInput = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(120), environment: z.string().trim().min(1).max(80), targetUrl: z.string().min(1).max(2000), databaseBinding: z.literal('department-supply-readonly').nullable().optional(), notifyFailures: z.boolean().optional(), notifyScreenshots: z.boolean().optional() });
/** Catalog identities are stable; versions and each batch's scope are immutable. */
export class SystemModuleRegression {
    private db: DatabaseSync;
    private active = new Map<string, AbortController>();
    private connections = new Map<string, AbortController>();
    private accounts: Record<string, AccountView> = {};
    private closed = false;
    constructor(root: string, private store: DifyWebModuleStore, private deps: WebModuleDependencies, private notifier = new DifyBatchNotifier(root)) {
        const dir = path.join(root, 'system-module-regression');
        mkdirSync(dir, { recursive: true });
        this.db = new DatabaseSync(path.join(dir, 'catalog.sqlite'));
        this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,batch_id TEXT NOT NULL)');
        this.store.editorPrerequisiteGuard = (versionId, selected, profileId) => {
            const m = this.list<FixedModule>('module').find(m => m.versions.some(v => v.id === versionId));
            if (!m)
                throw Error('前置用例所在项目不存在。');
            const system = this.getSystem(m.systemId);
            if (profileId && profileId !== (system.activeAccountId ?? system.profileId))
                throw Error('前置用例需要在当前项目账号下核验，请切换到对应账号。');
            const v = m.versions.find(v => v.id === versionId)!;
            this.assertEditorPrerequisites(system, [{ moduleId: m.id, moduleName: m.name, versionId, version: v.version, digest: v.digest, caseCount: v.caseCount, selectedCaseIds: selected }]);
        };
        for (const batch of this.list<RegressionBatch>('batch'))
            if (['queued', 'running'].includes(batch.phase)) {
                batch.phase = 'interrupted';
                batch.message = '服务已重启，已保存本轮结果；不会自动重放。';
                this.save('batch', batch);
            }
        for (const batch of this.list<RegressionBatch>('batch'))
            if (batch.notification?.status === 'sending') {
                batch.notification.status = 'uncertain';
                for (const item of batch.notification.items)
                    if (item.status === 'sending') {
                        item.status = 'uncertain';
                        item.detail = '服务重启前未确认接收结果；请先核对测试群，不自动重发。';
                    }
                this.save('batch', batch);
            }
        // Login storage lives in the local browser profile, never in bundled
        // resources. Restore metadata immediately, then verify only a live tab.
        for (const system of this.list<TestedSystem>('system'))
            this.restoreAccount(system);
    }
    private list<T>(kind: string): T[] { return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(String(r.payload))); }
    private save<T extends {
        id: string;
    }>(kind: string, value: T): T {
        if (this.closed)
            throw Error('服务已停止。');
        this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, JSON.stringify(value));
        return value;
    }
    private get<T>(kind: string, key: string): T {
        uuid.parse(key);
        const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind, key);
        if (!row)
            throw Error('系统、模块或回归批次不存在。');
        return JSON.parse(String(row.payload));
    }
    getSystem(key: string) { return this.get<TestedSystem>('system', key); }
    private rememberAccount(system: TestedSystem, account: AccountView) {
        this.accounts[system.id] = account;
        this.save('account-session', { id: 'account-session:' + system.id + ':' + account.profileId,
            profileId: account.profileId, targetUrl: system.targetUrl, environment: system.environment, checkedAt: account.checkedAt });
    }
    private restoreAccount(system: TestedSystem) {
        const profileId = this.accountProfile(system).id;
        const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get('account-session', 'account-session:' + system.id + ':' + profileId);
        const saved = row ? JSON.parse(String(row.payload)) : undefined;
        if (saved?.targetUrl === system.targetUrl && saved.environment === system.environment)
            this.accounts[system.id] = { state: 'saved', message: '本机登录信息已保存；打开时自动复用并检查有效性。', profileId, checkedAt: saved.checkedAt };
        if (!this.deps.savedSessionStatus) return;
        const project = { id: profileId, name: system.name, targetUrl: system.targetUrl, browserProfileIsolation: true } as DocumentProject;
        void this.deps.savedSessionStatus(project).then(status => {
            if (this.closed || this.occupied(system.id) || this.accountProfile(this.getSystem(system.id)).id !== profileId) return;
            if (status === 'connected')
                this.rememberAccount(system, { state: 'connected', message: '已复用本机登录会话；无需重复扫码。', profileId, checkedAt: now() });
            else if (status === 'expired')
                this.accounts[system.id] = { state: 'unknown', message: '登录已失效，请打开被测系统重新登录。', profileId };
        }).catch(() => { /* Preserve saved status; a temporary CDP failure is not logout. */ });
    }
    getModule(key: string) { return this.get<FixedModule>('module', key); }
    connectionSettings() {
        return { systems: this.list<TestedSystem>('system').map(s => ({ id: s.id, name: s.name, environment: s.environment, targetUrl: s.targetUrl, profileId: s.profileId, activeAccountId: s.activeAccountId ?? s.profileId, accountProfiles: s.accountProfiles ?? [], ...(s.databaseBinding ? { databaseBinding: s.databaseBinding } : {}), account: this.accounts[s.id] ?? { state: 'unknown', message: '尚未检查当前账号。' } })), services: { fixedExecution: 'local', aiAuthoringConfigured: !!process.env.TESTPILOT_DIFY_API_KEY, aiExecutionConfigured: !!process.env.TESTPILOT_DIFY_EXECUTION_API_KEY } };
    }
    private occupied(systemId: string) { return [...this.active.keys()].some(key => this.get<RegressionBatch>('batch', key).systemId === systemId) || this.connections.has(systemId); }
    saveSystem(input: unknown) {
        const data = systemInput.parse(input);
        const targetUrl = moduleTarget(data.targetUrl);
        const old = data.id ? this.getSystem(data.id) : undefined;
        if (old && this.occupied(old.id))
            throw Error('系统窗口正在使用，请结束当前运行或账号连接后再修改。');
        // A different environment/URL gets an isolated browser profile, never inherited cookies.
        const changed = old && (old.targetUrl !== targetUrl || old.environment !== data.environment);
        const value: TestedSystem = { id: old?.id ?? randomUUID(), name: data.name, environment: data.environment, targetUrl, profileId: old && !changed ? old.profileId : randomUUID(), selectedModuleIds: old?.selectedModuleIds ?? [], createdAt: old?.createdAt ?? now(), updatedAt: now() };
        if (old && !changed) {
            if (old.accountProfiles)
                value.accountProfiles = old.accountProfiles;
            if (old.activeAccountId)
                value.activeAccountId = old.activeAccountId;
        }
        const binding = data.databaseBinding === undefined ? (changed ? undefined : old?.databaseBinding) : data.databaseBinding;
        if (binding) {
            if (!supportsDepartmentDatabase(targetUrl))
                throw Error('该测试库只允许绑定部门申样测试环境。');
            value.databaseBinding = binding;
        }
        value.notifyFailures = data.notifyFailures ?? old?.notifyFailures ?? false;
        value.notifyScreenshots = data.notifyScreenshots ?? old?.notifyScreenshots ?? false;
        if (value.notifyScreenshots && !value.notifyFailures)
            throw Error('请先开启异常通知，再选择附带截图。');
        if (value.notifyFailures && !this.notifier.configured())
            throw Error('本机尚未配置有效的测试群机器人地址；未开启通知。');
        if (changed)
            delete this.accounts[value.id];
        return this.save('system', value);
    }
    private accountProfile(system: TestedSystem) { const id = system.activeAccountId ?? system.profileId; return id === system.profileId ? { id, name: '我的账号' } : system.accountProfiles?.find(a => a.id === id) ?? { id: system.profileId, name: '我的账号' }; }
    addAccount(key: string, input: unknown) {
        const data = z.object({ name: z.string().trim().min(1).max(40) }).parse(input);
        const s = this.getSystem(key);
        if (this.occupied(key))
            throw Error('请结束本系统运行或账号连接后再添加账号。');
        s.accountProfiles ??= [];
        if (s.accountProfiles.length >= 10)
            throw Error('每个系统最多添加 10 个额外账号。');
        if (data.name === '我的账号' || s.accountProfiles.some(a => a.name === data.name))
            throw Error('账号名称已存在。');
        s.accountProfiles.push({ id: randomUUID(), name: data.name });
        s.updatedAt = now();
        return this.save('system', s);
    }
    selectAccount(key: string, input: unknown) {
        const accountId = uuid.parse(input);
        const s = this.getSystem(key);
        if (this.occupied(key))
            throw Error('当前运行或账号连接尚未结束，不能切换账号。');
        if (accountId !== s.profileId && !s.accountProfiles?.some(a => a.id === accountId))
            throw Error('账号不属于当前系统。');
        s.activeAccountId = accountId;
        s.updatedAt = now();
        delete this.accounts[key];
        const updated = this.save('system', s);
        this.restoreAccount(updated);
        return updated;
    }
    private hasProfile(system: TestedSystem, profileId: string) { return system.profileId === profileId || system.accountProfiles?.some(a => a.id === profileId); }
    saveSelection(systemId: string, input: unknown) {
        const selected = z.array(uuid).max(100).parse(input);
        if (new Set(selected).size !== selected.length)
            throw Error('模块选择不能重复。');
        const system = this.getSystem(systemId);
        for (const key of selected) {
            const m = this.getModule(key);
            if (m.systemId !== systemId || m.archived)
                throw Error('选择包含其他系统或已归档模块。');
        }
        system.selectedModuleIds = selected;
        system.updatedAt = now();
        return this.save('system', system);
    }
    async importModule(input: unknown) {
        const data = z.object({ systemId: uuid, moduleId: uuid.optional(), name: z.string().trim().min(1).max(120), fileName: z.string(), bytesBase64: z.string() }).parse(input);
        const system = this.getSystem(data.systemId);
        const old = data.moduleId ? this.getModule(data.moduleId) : undefined;
        if (old && old.systemId !== system.id)
            throw Error('不能将其他系统模块的更新包导入此系统。');
        if (!old && this.list<FixedModule>('module').some(m => m.systemId === system.id && m.name === data.name))
            throw Error('已有同名模块，请选择该模块更新用例包。');
        const version = await this.store.import({ fileName: data.fileName, bytesBase64: data.bytesBase64, targetUrl: system.targetUrl, name: data.name });
        return this.attach(system.id, old ? this.getModule(old.id) : undefined, version.id, data.name);
    }
    /** Explicitly assign a legacy package; never guess its business system from a hostname. */
    attachLegacy(input: unknown) {
        const data = z.object({ systemId: uuid, versionId: uuid, name: z.string().trim().min(1).max(120) }).parse(input);
        this.getSystem(data.systemId);
        if (this.list<FixedModule>('module').some(m => m.systemId === data.systemId && m.name === data.name))
            throw Error('已有同名模块，请更新该模块。');
        return this.attach(data.systemId, undefined, data.versionId, data.name);
    }
    private attach(systemId: string, old: FixedModule | undefined, versionId: string, name: string) {
        if (this.list<FixedModule>('module').some(m => m.id !== old?.id && m.systemId === systemId && m.name === name))
            throw Error('已有同名模块，请更新该模块。');
        const source = this.store.getModule(versionId);
        const latest = old?.versions.at(-1);
        if (latest?.id === source.id) {
            old!.name = name;
            old!.updatedAt = now();
            return this.save('module', old!);
        }
        const before = latest ? this.store.getModule(latest.id).project.cases : [];
        const previous = new Map(before.map(c => [c.id, c]));
        const current = new Map(source.project.cases.map(c => [c.id, c]));
        const value: FixedModule = old ?? { id: randomUUID(), systemId, name, archived: false, versions: [], createdAt: now(), updatedAt: now() };
        value.name = name;
        value.updatedAt = now();
        value.versions.push({ id: source.id, version: (latest?.version ?? 0) + 1, digest: source.digest, caseCount: source.project.cases.length, createdAt: now(), added: [...current.keys()].filter(k => !previous.has(k)).length, removed: [...previous.keys()].filter(k => !current.has(k)).length, changed: [...current.keys()].filter(k => previous.has(k) && moduleDigest(previous.get(k)) !== moduleDigest(current.get(k))).length });
        return this.save('module', value);
    }
    archiveModule(key: string, input: unknown) {
        const archived = z.boolean().parse(input);
        const m = this.getModule(key);
        m.archived = archived;
        m.updatedAt = now();
        this.save('module', m);
        if (archived) {
            const s = this.getSystem(m.systemId);
            s.selectedModuleIds = s.selectedModuleIds.filter(id => id !== key);
            this.save('system', s);
        }
        return m;
    }
    saveCore(key: string, input: unknown) {
        const data = z.object({ versionId: uuid, caseIds: z.array(z.string()).max(200), scope: z.enum(['core', 'starter']).default('core') }).parse(input);
        const m = this.getModule(key);
        if (m.versions.at(-1)?.id !== data.versionId)
            throw Error('模块已更新，请重新查看当前版本后保存范围。');
        const cases = this.store.getModule(data.versionId).project.cases;
        const known = new Set(cases.map(c => c.id));
        if (new Set(data.caseIds).size !== data.caseIds.length || data.caseIds.some(id => !known.has(id)))
            throw Error('范围包含重复或未知用例。');
        if (data.scope === 'starter') {
            if (cases.some(c => data.caseIds.includes(c.id) && difyBlocker(c, '').blockerCode === 'write-required'))
                throw Error('只读起步集合不能包含要求真实提交或落库的用例；原用例仍保留。');
            m.starterCaseIds = data.caseIds;
            m.starterVersionId = data.versionId;
        }
        else {
            m.coreCaseIds = data.caseIds;
            m.coreVersionId = data.versionId;
        }
        m.updatedAt = now();
        return this.save('module', m);
    }
    markdown(key: string, versionId?: string) { return this.store.markdown(this.cases(key, versionId).version.id); }
    cases(key: string, versionId?: string) {
        const m = this.getModule(key);
        const v = versionId ? m.versions.find(v => /^\d+$/.test(versionId) ? v.version === Number(versionId) : v.id === uuid.parse(versionId)) : m.versions.at(-1);
        if (!v)
            throw Error('用例版本不存在。');
        return { module: m, version: v, cases: this.store.getModule(v.id).project.cases, readiness: this.store.readiness(v.id) };
    }
    editorCatalog(systemId?: string): CaseEditorCatalog {
        const systems = this.list<TestedSystem>('system'), system = systemId ? this.getSystem(systemId) : systems[0];
        if (!system)
            return { systems: [], systemId: '', modules: [], cases: [], chains: [] };
        const modules = this.list<FixedModule>('module').filter(m => m.systemId === system.id && !m.archived).reverse();
        const cases = modules.flatMap(m => this.editorCases(m, undefined, system));
        const short = ['申请提交与申请记录', '申请撤销与订单取消', '库存不足与定时补锁', '企微通知与后台追踪'];
        const chains = departmentCoreChains.map((c, i) => ({ id: c.id, title: short[i]!, caseKeys: [...new Set(c.steps.flatMap(s => s.caseIds))].flatMap(id => cases.filter(v => v.id === id).map(v => v.moduleId + ':' + id)) })).filter(c => c.caseKeys.length);
        return { systems: systems.map(s => ({ id: s.id, name: s.name })), systemId: system.id, modules: modules.map(m => ({ id: m.id, name: m.name, caseKeys: cases.filter(c => c.moduleId === m.id).map(c => c.moduleId + ':' + c.id) })), cases, chains };
    }
    editorRevision(systemId: string) {
        this.getSystem(systemId);
        return this.list<FixedModule>('module').filter(m => m.systemId === systemId && !m.archived).map(m => m.id + ':' + m.versions.at(-1)?.id).sort().join('|');
    }
    private editorCases(m: FixedModule, versionId?: string, system = this.getSystem(m.systemId)): EditableCase[] {
        const v = versionId ? m.versions.find(v => v.id === versionId) : m.versions.at(-1);
        if (!v)
            throw Error('版本不存在。');
        const pack = this.store.getModule(v.id), original = this.store.getModule(m.versions[0]!.id);
        const batches = this.list<RegressionBatch>('batch').filter(b => b.systemId === system.id && b.profileId === (system.activeAccountId ?? system.profileId) && b.targetUrl === system.targetUrl && b.environment === system.environment);
        const history = batches.flatMap(b => b.entries.filter(e => e.moduleId === m.id && e.jobId).map(e => ({ job: this.store.getJob(e.jobId!) })));
        return pack.project.cases.map(c => {
            const cache = pack.cachedSteps?.[c.id], steps = (!c.steps.length || cache?.reviewKind) && cache?.sourceDigest === moduleDigest(c) ? cache.steps : c.steps;
            let status = 'not_executed', resultAt: string | undefined;
            // The latest attempt wins; an old positive result cannot mask a newer failure or edit.
            for (const { job } of history) {
                const row = job.results.find(r => r.caseId === c.id);
                if (!row)
                    continue;
                const old = job.snapshot.cases.find(v => v.id === c.id);
                if (!old || moduleDigest(old) !== moduleDigest(c))
                    break;
                // Dependency annotation changes do not rerun or erase the original business assertion.
                status = row.outOfScope ? 'outside' : row.status;
                resultAt = job.updatedAt;
                break;
            }
            const prerequisites = pack.prerequisiteCases?.[c.id] ?? [];
            return { ...(pack.resourceSources?.[c.id]?.priority ? { priority: pack.resourceSources[c.id]!.priority } : {}), executionSupport: scriptSupport({ title: c.title, expected: c.expected, sourcePath: pack.resourceSources?.[c.id]?.sourcePath ?? c.modulePath ?? [], script: { caseId: c.id, dependsOn: prerequisites.map(d => ({ ...d, requiredStatus: 'passed' as const })), steps } }), ...(pack.resourceSources?.[c.id]?.sourceId ? { sourceId: pack.resourceSources[c.id]!.sourceId } : {}), ...(pack.scriptReviews?.[c.id] ? { scriptReview: pack.scriptReviews[c.id] } : {}), ...(v.source ? { changeSource: v.source } : {}), moduleId: m.id, versionId: v.id, version: v.version, id: c.id, title: c.title, expected: c.expected, manualSteps: pack.manualSteps?.[c.id] ?? [], prerequisites, ...(pack.prerequisiteReviews?.[c.id] ? { prerequisiteReview: pack.prerequisiteReviews[c.id] } : {}), script: { caseId: c.id, dependsOn: prerequisites.map(d => ({ ...d, requiredStatus: 'passed' as const })), steps }, sourcePath: pack.resourceSources?.[c.id]?.sourcePath ?? c.modulePath ?? [], sourceExpected: pack.resourceSources?.[c.id]?.sourceExpected ?? original.project.cases.find(v => v.id === c.id)?.expected ?? c.expected, scriptPath: `/api/system-module-regression/case-editor/${m.id}/${c.id}/script?version=${v.id}`, status, ...(resultAt ? { resultAt } : {}) };
        });
    }
    editorHistory(moduleId: string, caseId: string) { const m = this.getModule(moduleId); return m.versions.map(v => ({ version: v.version, createdAt: v.createdAt, data: this.editorCases(m, v.id).find(c => c.id === caseId) })).filter(v => v.data).reverse(); }
    /** New-machine initialization imports definitions only, never another user's data. */
    async initializeResources(input: unknown, configuration: { targetUrl: string; environment: string }) {
        const resources = validateProjectResources(input);
        const existing = this.list<TestedSystem>('system').find(s => s.id === resources.project.id);
        if (existing) return { initialized: false, systemId: existing.id, reason: 'existing' as const };
        const targetUrl = moduleTarget(configuration.targetUrl), environment = z.string().trim().min(1).max(80).parse(configuration.environment);
        for (const m of resources.modules) if (this.db.prepare('SELECT id FROM records WHERE id=?').get(m.id)) throw Error('初始化模块编号与本机已有记录冲突。');
        const supportedChains = departmentCoreChains.filter(c => c.steps.every(s => s.caseIds.every(id => resources.cases.some(c => c.id === id)))).map(c => ({ id: c.id, title: c.title, description: c.description, steps: c.steps.map(s => ({ id: s.id, title: s.title, expected: s.expected, caseIds: s.caseIds })) }));
        if (resourceDigest(resources.chains) !== resourceDigest(supportedChains)) throw Error('资源的核心链路模板与当前工具版本不兼容。');
        const packs = resources.modules.map(m => ({ module: m, pack: this.store.prepareResourceModule(undefined, m.name, targetUrl, resources.cases.filter(c => c.moduleId === m.id)) }));
        for (const p of packs) await this.store.commitResourceModule(p.pack);
        if (this.list<TestedSystem>('system').some(s => s.id === resources.project.id)) return { initialized: false, systemId: resources.project.id, reason: 'existing' as const };
        const system: TestedSystem = { id: resources.project.id, name: resources.project.name, environment, targetUrl, profileId: randomUUID(), selectedModuleIds: resources.modules.map(m => m.id), createdAt: now(), updatedAt: now(), notifyFailures: false, notifyScreenshots: false };
        if (supportsDepartmentDatabase(targetUrl)) system.databaseBinding = 'department-supply-readonly';
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.save('system', system);
            for (const { module: m, pack } of packs) {
                const value: FixedModule = { id: m.id, systemId: system.id, name: m.name, archived: false, versions: [{ id: pack.id, version: 1, digest: pack.digest, caseCount: pack.project.cases.length, createdAt: now(), added: pack.project.cases.length, removed: 0, changed: 0 }], createdAt: now(), updatedAt: now(), ...(m.coreCaseIds ? { coreCaseIds: m.coreCaseIds, coreVersionId: pack.id } : {}), ...(m.starterCaseIds ? { starterCaseIds: m.starterCaseIds, starterVersionId: pack.id } : {}) };
                this.save('module', value);
            }
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        return { initialized: true, systemId: system.id, modules: packs.length, cases: resources.cases.length, chains: resources.chains.length, resourceRevision: resourceDigest(resources) };
    }
    exportResources(systemId: string) {
        const catalog = this.editorCatalog(systemId);
        const resources: ProjectResources = {
            schema: 1, project: { id: catalog.systemId, name: this.getSystem(systemId).name },
            modules: catalog.modules.map(m => {
                const module = this.getModule(m.id);
                return { id: m.id, name: m.name, ...(module.coreCaseIds ? { coreCaseIds: module.coreCaseIds } : {}), ...(module.starterCaseIds ? { starterCaseIds: module.starterCaseIds } : {}) };
            }),
            cases: catalog.cases.map(c => ({ ...(c.priority ? { priority: c.priority } : {}), ...(c.sourceId ? { sourceId: c.sourceId } : {}), ...(c.scriptReview ? { scriptReview: c.scriptReview } : {}), id: c.id, moduleId: c.moduleId, title: c.title, expected: c.expected, manualSteps: c.manualSteps, prerequisites: c.prerequisites, ...(c.prerequisiteReview ? { prerequisiteReview: c.prerequisiteReview } : {}), sourcePath: c.sourcePath, sourceExpected: c.sourceExpected, script: c.script })),
            chains: departmentCoreChains.filter(chain => chain.steps.every(s => s.caseIds.every(id => catalog.cases.some(c => c.id === id)))).map(c => ({ id: c.id, title: c.title, description: c.description, steps: c.steps.map(s => ({ id: s.id, title: s.title, expected: s.expected, caseIds: s.caseIds })) })),
        };
        const checked = validateProjectResources(resources);
        const versionSelections = Object.fromEntries(catalog.modules.map(m => [m.id, this.getModule(m.id).versions.at(-1)!.id]));
        return { resources: checked, revision: resourceDigest({ resources: checked, versionSelections }), versionSelections };
    }
    previewResources(input: unknown) {
        const resources = validateProjectResources(input), current = this.exportResources(resources.project.id);
        for (const m of resources.modules) {
            const existing = this.list<FixedModule>('module').find(v => v.id === m.id);
            if (existing && existing.systemId !== resources.project.id) throw Error('模块编号已属于其他项目。');
            if (existing?.archived) throw Error('该模块编号已归档，请先恢复模块或使用新的模块编号。');
        }
        if (resourceDigest(resources.chains) !== resourceDigest(current.resources.chains)) throw Error('核心链路执行模板由程序维护，本次资源更新不能改写链路定义。');
        // Validate executable steps now, before a preview can be accepted.
        for (const m of resources.modules) {
            const source = current.versionSelections[m.id];
            this.store.prepareResourceModule(source, m.name, this.getSystem(resources.project.id).targetUrl, resources.cases.filter(c => c.moduleId === m.id));
        }
        return { revision: current.revision, definitionRevision: resourceDigest(current.resources), incomingRevision: resourceDigest(resources), ...compareProjectResources(current.resources, resources), modulesAdded: resources.modules.filter(m => !current.resources.modules.some(v => v.id === m.id)).map(m => m.id), modulesRemoved: current.resources.modules.filter(m => !resources.modules.some(v => v.id === m.id)).map(m => m.id) };
    }
    async applyResources(input: unknown, source: 'resources' | 'mcp' = 'resources') {
        const data = z.object({ resources: z.unknown(), baseRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(input);
        const resources = validateProjectResources(data.resources), system = this.getSystem(resources.project.id);
        if (this.occupied(system.id)) throw Error('项目正在运行或连接，请结束后更新资源。');
        const preview = this.previewResources(resources);
        if (preview.revision !== data.baseRevision) throw Error('资源版本冲突，请重新预览后保存。');
        if (preview.incomingRevision === preview.definitionRevision) return { ...preview, applied: false };
        const before = this.exportResources(system.id);
        const prepared = resources.modules.map(m => {
            const old = before.resources.modules.find(v => v.id === m.id);
            const oldCases = before.resources.cases.filter(c => c.moduleId === m.id), cases = resources.cases.filter(c => c.moduleId === m.id);
            return { module: m, old, changed: !old || resourceDigest({ module: old, cases: oldCases }) !== resourceDigest({ module: m, cases }), pack: this.store.prepareResourceModule(before.versionSelections[m.id], m.name, system.targetUrl, cases) };
        });
        for (const p of prepared) if (p.changed) await this.store.commitResourceModule(p.pack);
        if (this.exportResources(system.id).revision !== data.baseRevision || this.occupied(system.id)) throw Error('导入期间项目状态已变化，未切换资源版本，请重新预览。');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const p of prepared) {
                const old = p.old ? structuredClone(this.getModule(p.module.id)) : undefined;
                let saved: FixedModule;
                if (p.changed) {
                    const pack = p.pack, previous = old?.versions.at(-1);
                    const rows = resources.cases.filter(c => c.moduleId === p.module.id);
                    saved = old ?? { id: p.module.id, systemId: system.id, name: p.module.name, archived: false, versions: [], createdAt: now(), updatedAt: now() };
                    saved.name = p.module.name; saved.archived = false; saved.updatedAt = now();
                    saved.versions.push({ source, id: pack.id, version: (previous?.version ?? 0) + 1, digest: pack.digest, caseCount: rows.length, createdAt: now(), added: preview.added.filter(k => k.startsWith(p.module.id + ':')).length, removed: preview.removed.filter(k => k.startsWith(p.module.id + ':')).length, changed: preview.changed.filter(k => k.startsWith(p.module.id + ':')).length });
                } else saved = old!;
                const versionId = saved.versions.at(-1)!.id;
                if (p.module.coreCaseIds) { saved.coreCaseIds = p.module.coreCaseIds; saved.coreVersionId = versionId; } else { delete saved.coreCaseIds; delete saved.coreVersionId; }
                if (p.module.starterCaseIds) { saved.starterCaseIds = p.module.starterCaseIds; saved.starterVersionId = versionId; } else { delete saved.starterCaseIds; delete saved.starterVersionId; }
                this.save('module', saved);
            }
            for (const id of preview.modulesRemoved) {
                const m = this.getModule(id); m.archived = true; m.updatedAt = now(); this.save('module', m);
            }
            system.name = resources.project.name;
            system.selectedModuleIds = system.selectedModuleIds.filter(id => resources.modules.some(m => m.id === id));
            system.updatedAt = now(); this.save('system', system);
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        return { ...preview, applied: true, revision: this.exportResources(system.id).revision };
    }
    editorScript(moduleId: string, caseId: string, versionId?: string) {
        const value = this.editorCases(this.getModule(moduleId), versionId).find(c => c.id === caseId);
        if (!value)
            throw Error('用例不存在。');
        return value.script;
    }
    savePrerequisitePlan(input: unknown) {
        const dep = z.object({ moduleId: uuid, caseId: z.string().min(1).max(80) }).strict();
        const data = z.object({ systemId: uuid, versionSelections: z.record(z.string(), uuid), cases: z.array(dep.extend({ prerequisites: z.array(dep).max(30), review: z.object({ status: z.enum(['reviewed', 'pending']), note: z.string().trim().min(1).max(2000) }).strict() })).min(1).max(600) }).strict().parse(input);
        this.getSystem(data.systemId);
        if (this.occupied(data.systemId))
            throw Error('项目正在运行或连接，请结束后再整理前置。');
        const modules = this.list<FixedModule>('module').filter(m => m.systemId === data.systemId && !m.archived), key = (d: {
            moduleId: string;
            caseId: string;
        }) => d.moduleId + ':' + d.caseId;
        const known = new Set(modules.flatMap(m => this.store.getModule(m.versions.at(-1)!.id).project.cases.map(c => key({ moduleId: m.id, caseId: c.id }))));
        const rows = new Map(data.cases.map(c => [key(c), c]));
        if (rows.size !== data.cases.length || rows.size !== known.size || [...known].some(k => !rows.has(k)))
            throw Error('前置计划必须逐条覆盖当前项目全部用例且不能重复。');
        for (const m of modules)
            if (data.versionSelections[m.id] !== m.versions.at(-1)!.id)
                throw Error('模块版本已更新，请重新整理。');
        const done = new Set<string>(), visiting = new Set<string>();
        const visit = (id: string) => {
            if (visiting.has(id))
                throw Error('前置编号形成循环：' + id);
            if (done.has(id))
                return;
            visiting.add(id);
            const row = rows.get(id)!;
            const ids = row.prerequisites.map(key);
            if (new Set(ids).size !== ids.length)
                throw Error('前置编号重复。');
            for (const d of ids) {
                if (!known.has(d) || d === id)
                    throw Error('前置编号无效或引用自身。');
                visit(d);
            }
            visiting.delete(id);
            done.add(id);
        };
        for (const id of known)
            visit(id);
        const updates = modules.map(m => {
            const changes = data.cases.filter(c => c.moduleId === m.id), source = m.versions.at(-1)!, revised = this.store.revisePrerequisites(source.id, changes);
            if (revised.id === source.id)
                return m;
            const next = structuredClone(m);
            next.updatedAt = now();
            next.versions.push({ id: revised.id, version: source.version + 1, digest: revised.digest, caseCount: source.caseCount, createdAt: now(), added: 0, removed: 0, changed: changes.length });
            if (next.coreVersionId === source.id)
                next.coreVersionId = revised.id;
            if (next.starterVersionId === source.id)
                next.starterVersionId = revised.id;
            return next;
        });
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const m of updates)
                this.save('module', m);
            this.db.exec('COMMIT');
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
        return { systemId: data.systemId, cases: rows.size, withPrerequisites: data.cases.filter(c => c.prerequisites.length).length, pending: data.cases.filter(c => c.review.status === 'pending').length, versions: updates.map(m => ({ moduleId: m.id, versionId: m.versions.at(-1)!.id, version: m.versions.at(-1)!.version })) };
    }
    async saveEditorCase(moduleId: string, input: unknown, source: 'manual' | 'mcp' = 'manual') {
        const dep = z.object({ moduleId: uuid, caseId: z.string().min(1).max(80) }).strict();
        const data = z.object({ versionId: uuid, caseId: z.string().min(1).max(80), title: z.string().trim().min(1).max(500), expected: z.string().trim().min(1).max(2000), manualSteps: z.array(z.string().max(2000)).max(100), prerequisites: z.array(dep).max(30), script: z.object({ caseId: z.string(), dependsOn: z.array(dep.extend({ requiredStatus: z.literal('passed') })).max(30), steps: z.array(z.unknown()).max(100) }).strict() }).strict().parse(input);
        const m = this.getModule(moduleId);
        if (m.archived || this.occupied(m.systemId))
            throw Error('模块已归档或正在运行，请结束后保存。');
        if (m.versions.at(-1)?.id !== data.versionId)
            throw Error('版本已更新，请刷新后重新修改。');
        if (data.script.caseId !== data.caseId)
            throw Error('脚本编号与用例不一致。');
        const key = (d: CaseDependency) => d.moduleId + ':' + d.caseId, keys = data.prerequisites.map(key);
        if (new Set(keys).size !== keys.length || JSON.stringify([...keys].sort()) !== JSON.stringify(data.script.dependsOn.map(key).sort()))
            throw Error('脚本与前置用例不一致或重复。');
        const catalog = this.editorCatalog(m.systemId), all = new Map(catalog.cases.map(c => [key({ moduleId: c.moduleId, caseId: c.id }), c]));
        const current = key({ moduleId, caseId: data.caseId });
        if (!all.has(current))
            throw Error('当前用例不存在。');
        for (const d of keys)
            if (!all.has(d) || d === current)
                throw Error('前置用例必须属于同一项目，且不能引用自身。');
        const visiting = new Set<string>(), done = new Set<string>();
        const visit = (id: string) => {
            if (visiting.has(id))
                throw Error('前置用例形成循环，请调整。');
            if (done.has(id))
                return;
            visiting.add(id);
            for (const d of id === current ? data.prerequisites : all.get(id)?.prerequisites ?? [])
                visit(key(d));
            visiting.delete(id);
            done.add(id);
        };
        visit(current);
        const existing = all.get(current)!;
        if (moduleDigest({ title: existing.title, expected: existing.expected, manualSteps: existing.manualSteps, prerequisites: existing.prerequisites, script: existing.script }) === moduleDigest({ title: data.title, expected: data.expected, manualSteps: data.manualSteps, prerequisites: data.prerequisites, script: data.script }))
            return existing;
        const revised = await this.store.reviseCase(data.versionId, data.caseId, { ...data, steps: data.script.steps as EditableCase['script']['steps'] });
        const fresh = this.getModule(moduleId);
        if (fresh.versions.at(-1)?.id !== data.versionId || this.occupied(m.systemId))
            throw Error('保存期间模块状态发生变化，请刷新重试。');
        const saved = this.attach(m.systemId, fresh, revised.id, m.name);
        saved.versions.at(-1)!.source = source;
        if (saved.coreVersionId === data.versionId)
            saved.coreVersionId = revised.id;
        if (saved.starterVersionId === data.versionId)
            saved.starterVersionId = revised.id;
        this.save('module', saved);
        return this.editorCases(saved).find(c => c.id === data.caseId)!;
    }
    private assertEditorPrerequisites(system: TestedSystem, entries: BatchEntry[]) {
        if (!entries.some(e => Object.keys(this.store.getModule(e.versionId).prerequisiteCases ?? {}).length))
            return;
        const catalog = this.editorCatalog(system.id), key = (d: CaseDependency) => d.moduleId + ':' + d.caseId, byKey = new Map(catalog.cases.map(c => [key({ moduleId: c.moduleId, caseId: c.id }), c]));
        for (const e of entries) {
            const pack = this.store.getModule(e.versionId);
            for (const c of pack.project.cases) {
                if (e.selectedCaseIds && !e.selectedCaseIds.includes(c.id))
                    continue;
                for (const d of pack.prerequisiteCases?.[c.id] ?? []) {
                    if (byKey.get(key(d))?.status !== 'passed')
                        throw Error(`${c.id} 的前置用例 ${d.caseId} 尚未通过，请先执行前置用例。`);
                }
            }
        }
    }
    state(): SystemModuleState {
        const old = this.store.state();
        const modules = this.list<FixedModule>('module');
        const assigned = new Set(modules.flatMap(m => m.versions.map(v => v.id)));
        const visibleModules = modules.map(m => {
            const latest = m.versions.at(-1);
            // Polling must not rebuild editorCatalog and scan every historical
            // job for every module: that blocks the event loop and starves CDP.
            const pack = latest ? this.store.getModule(latest.id) : undefined;
            const latestCases = pack?.project.cases ?? [];
            const hasSteps = (c: typeof latestCases[number]) => c.steps.length > 0 || !!(pack?.cachedSteps?.[c.id]?.steps.length && pack.cachedSteps[c.id]!.sourceDigest === moduleDigest(c));
            const pendingScriptReviewCount = latestCases.filter(c => pack?.scriptReviews?.[c.id]?.status === 'pending' && hasSteps(c)).length;
            const missingScriptCount = latestCases.filter(c => !hasSteps(c)).length;
            return pendingScriptReviewCount || missingScriptCount ? { ...m, ...(pendingScriptReviewCount ? { pendingScriptReviewCount } : {}), ...(missingScriptCount ? { missingScriptCount } : {}) } : m;
        });
        return { systems: this.list<TestedSystem>('system'), modules: visibleModules, batches: this.list<RegressionBatch>('batch').map(b => this.view(b)), accounts: this.accounts, legacyModules: old.modules.filter(m => !assigned.has(m.id)).map(m => ({ id: m.id, name: m.name, targetUrl: m.targetUrl, caseCount: m.caseCount })), configured: old.configured, database: { connected: mysqlBrowserStatus().connected }, notificationConfigured: this.notifier.configured() };
    }
    getBatch(key: string) { return this.view(this.get<RegressionBatch>('batch', key)); }
    private view(batch: RegressionBatch): BatchView {
        const jobs = batch.entries.flatMap(e => {
            if (!e.jobId)
                return [];
            const { snapshot, executionProject, ...j } = this.store.getJob(e.jobId);
            return [j];
        });
        const counts = { passed: 0, failed: 0, blocked: 0, error: 0, not_executed: 0, outside: 0 };
        for (const entry of batch.entries) {
            const job = jobs.find(j => j.id === entry.jobId);
            if (!job) {
                counts.not_executed += entry.selectedCaseIds?.length ?? entry.caseCount;
                continue;
            }
            for (const row of job.results)
                if (row.outOfScope)
                    counts.outside++;
                else
                    counts[row.status]++;
        }
        return { ...batch, jobs, counts };
    }
    /**
     * Documented contract: a case whose script is still marked "pending review"
     * must not be executed. Cases without saved steps are left to the executor,
     * which already reports them as "待补脚本" instead of running them.
     */
    private assertScriptReviewsResolved(entries: Array<{ moduleId: string; versionId: string; selectedCaseIds?: string[] }>) {
        const blocked: string[] = [];
        for (const entry of entries) {
            const module = this.store.getModule(entry.versionId);
            const reviews = module.scriptReviews ?? {};
            const ids = entry.selectedCaseIds ?? module.project.cases.map(c => c.id);
            for (const id of ids) {
                if (reviews[id]?.status !== 'pending')
                    continue;
                const steps = module.project.cases.find(c => c.id === id)?.steps ?? [];
                if (!steps.length)
                    continue;
                blocked.push(id);
            }
        }
        if (blocked.length)
            throw Error('脚本待核对：' + blocked.length + ' 条用例的脚本尚未核对，请先在“用例与脚本”中核对脚本后再执行（' + blocked.slice(0, 5).join('、') + (blocked.length > 5 ? ' 等' : '') + '）。');
    }
    start(input: unknown) {
        const data = z.object({ systemId: uuid, moduleIds: z.array(uuid).min(1).max(100), requestId: uuid, runMode: z.enum(['fixed', 'assist']).optional(), scope: z.enum(['core', 'all', 'custom', 'starter']).optional(), caseSelections: z.record(z.string(), z.array(z.string()).min(1).max(200)).optional(), versionSelections: z.record(z.string(), uuid).optional() }).parse(input);
        const fingerprint = moduleDigest(data);
        const replay = this.replay(data.requestId, fingerprint);
        if (replay)
            return replay;
        const system = this.getSystem(data.systemId);
        if (new Set(data.moduleIds).size !== data.moduleIds.length)
            throw Error('模块选择不能重复。');
        const entries = data.moduleIds.map(key => {
            const m = this.getModule(key);
            if (m.systemId !== system.id || m.archived)
                throw Error('模块不属于当前系统或已归档。');
            const v = m.versions.at(-1)!;
            if (data.versionSelections?.[m.id] && data.versionSelections[m.id] !== v.id)
                throw Error('模块已更新，请刷新后再执行。');
            return { moduleId: m.id, moduleName: m.name, versionId: v.id, version: v.version, digest: v.digest, caseCount: v.caseCount };
        });
        for (const entry of entries) {
            const m = this.getModule(entry.moduleId);
            const cases = this.store.getModule(entry.versionId).project.cases;
            const preset = data.scope === 'starter' ? { ids: m.starterCaseIds, version: m.starterVersionId, label: '只读起步集合' } : { ids: m.coreCaseIds, version: m.coreVersionId, label: '核心范围' };
            if (data.scope === 'core' || data.scope === 'starter') {
                if (preset.ids === undefined)
                    throw Error('请在“查看用例”中保存该模块的' + preset.label + '，或选择全部用例。');
                if (preset.version !== entry.versionId)
                    throw Error(preset.label + '属于旧版本，请重新保存范围。');
            }
            const chosen = data.scope === 'custom' ? data.caseSelections?.[m.id] : data.scope === 'core' || data.scope === 'starter' ? preset.ids : undefined;
            if (data.scope === 'custom' && !chosen?.length)
                throw Error('请选择要执行的用例。');
            if (chosen) {
                if (!chosen.length || new Set(chosen).size !== chosen.length || chosen.some(id => !cases.some(c => c.id === id)))
                    throw Error('执行范围为空、重复或包含未知用例。');
                Object.assign(entry, { selectedCaseIds: cases.filter(c => chosen.includes(c.id)).map(c => c.id) });
            }
        }
        this.assertScriptReviewsResolved(entries);
        const account = this.accountProfile(system);
        const batch = this.create({ ...system, profileId: account.id }, entries, data.requestId, fingerprint, undefined, { runMode: data.runMode ?? 'assist', scope: data.scope ?? 'all', accountName: account.name });
        this.saveSelection(system.id, data.moduleIds);
        return batch;
    }
    retest(key: string, input: unknown) {
        const data = z.object({ requestId: uuid, mode: z.enum(['failed', 'unfinished', 'all', 'selected', 'pending', 'checkpoint']).default('failed'), moduleId: uuid.optional(), caseIds: z.array(z.string()).min(1).max(200).optional() }).parse(input);
        const fingerprint = moduleDigest({ parent: key, ...data });
        const replay = this.replay(data.requestId, fingerprint);
        if (replay)
            return replay;
        const parent = this.getBatch(key);
        if (['queued', 'running'].includes(parent.phase))
            throw Error('本轮尚未结束。');
        // Retests always use the parent's version, target and environment, even after updates.
        if (data.caseIds && new Set(data.caseIds).size !== data.caseIds.length)
            throw Error('选择不能包含重复用例。');
        if (data.mode === 'selected' && (!data.moduleId || !data.caseIds))
            throw Error('请选择模块和用例。');
        const entries = parent.entries.flatMap(e => {
            const j = parent.jobs.find(j => j.id === e.jobId);
            const { jobId, ...snapshot } = e;
            if (data.mode === 'all')
                return [snapshot];
            if (data.mode === 'selected') {
                if (e.moduleId !== data.moduleId)
                    return [];
                if (data.caseIds!.some(id => !j?.results.some(r => r.caseId === id)))
                    throw Error('选择包含不属于原轮范围的用例。');
                return [{ ...snapshot, selectedCaseIds: data.caseIds!, confirmedCaseIds: (e.confirmedCaseIds ?? []).filter(id => data.caseIds!.includes(id)) }];
            }
            if (!j)
                return ['unfinished', 'pending', 'checkpoint'].includes(data.mode) ? [snapshot] : [];
            const ids = j.results.filter(r => !r.outOfScope && (data.mode === 'failed' ? r.status === 'failed' : ['pending', 'checkpoint'].includes(data.mode) ? r.status === 'not_executed' : ['blocked', 'error', 'not_executed'].includes(r.status))).map(r => r.caseId);
            return ids.length ? [{ ...snapshot, selectedCaseIds: ids, confirmedCaseIds: (e.confirmedCaseIds ?? []).filter(id => ids.includes(id)) }] : [];
        });
        if (!entries.length)
            throw Error('没有符合条件的模块。');
        this.assertScriptReviewsResolved(entries);
        const system = this.getSystem(parent.systemId);
        if (!this.hasProfile(system, parent.profileId))
            throw Error('系统环境已变更；请恢复原环境后重测历史批次，或在新环境新建回归。');
        return this.create({ ...system, profileId: parent.profileId, name: parent.systemName, environment: parent.environment, targetUrl: parent.targetUrl, ...{ databaseBinding: parent.databaseBinding } }, entries, data.requestId, fingerprint, parent.id, { runMode: parent.runMode ?? 'assist', scope: parent.scope ?? 'all', ...(parent.accountName ? { accountName: parent.accountName } : {}) });
    }
    private replay(requestId: string, fingerprint: string) {
        const r = this.db.prepare('SELECT fingerprint,batch_id FROM requests WHERE id=?').get(requestId);
        if (!r)
            return undefined;
        if (r.fingerprint !== fingerprint)
            throw Error('同一请求编号不能对应不同范围。');
        return this.getBatch(String(r.batch_id));
    }
    confirmCase(key: string, input: unknown) {
        const data = z.object({ requestId: uuid, moduleId: uuid, caseId: z.string().min(1), confirmed: z.literal(true) }).parse(input);
        const fingerprint = moduleDigest({ parent: key, ...data });
        const replay = this.replay(data.requestId, fingerprint);
        if (replay)
            return replay;
        const parent = this.getBatch(key);
        if (['queued', 'running'].includes(parent.phase))
            throw Error('请等待本轮结束后确认并重测。');
        const entry = parent.entries.find(e => e.moduleId === data.moduleId);
        const job = parent.jobs.find(j => j.id === entry?.jobId);
        const row = job?.results.find(r => r.caseId === data.caseId);
        if (!entry || !row?.needsConfirmation)
            throw Error('该用例没有等待前置数据确认。');
        const system = this.getSystem(parent.systemId);
        if (!this.hasProfile(system, parent.profileId))
            throw Error('系统环境已变更，请恢复原环境后重测。');
        this.assertScriptReviewsResolved([{ moduleId: entry.moduleId, versionId: entry.versionId, selectedCaseIds: [data.caseId] }]);
        const { jobId, ...snapshot } = entry;
        return this.create({ ...system, profileId: parent.profileId, name: parent.systemName, environment: parent.environment, targetUrl: parent.targetUrl, ...{ databaseBinding: parent.databaseBinding } }, [{ ...snapshot, selectedCaseIds: [data.caseId], confirmedCaseIds: [data.caseId] }], data.requestId, fingerprint, parent.id, { runMode: parent.runMode ?? 'assist', scope: parent.scope ?? 'all', ...(parent.accountName ? { accountName: parent.accountName } : {}) });
    }
    private create(system: TestedSystem, entries: BatchEntry[], requestId: string, fingerprint: string, parentBatchId?: string, options?: {
        runMode: 'fixed' | 'assist';
        scope: 'core' | 'all' | 'custom' | 'starter';
        accountName?: string;
    }) {
        if (this.occupied(system.id))
            throw Error('该系统正在运行或连接账号，请等待或取消。');
        this.assertEditorPrerequisites(system, entries);
        const batch: RegressionBatch = { id: randomUUID(), requestId, systemId: system.id, systemName: system.name, environment: system.environment, targetUrl: system.targetUrl, profileId: system.profileId, notifyFailures: system.notifyFailures ?? false, notifyScreenshots: system.notifyScreenshots ?? false, ...(system.databaseBinding ? { databaseBinding: system.databaseBinding } : {}), createdAt: now(), updatedAt: now(), phase: 'queued', entries, ...(options ?? {}), message: '等待开始。', ...(parentBatchId ? { parentBatchId } : {}) };
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.save('batch', batch);
            this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, fingerprint, batch.id);
            this.db.exec('COMMIT');
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
        const controller = new AbortController();
        this.active.set(batch.id, controller);
        void this.run(batch, controller.signal).finally(() => this.active.delete(batch.id));
        return this.getBatch(batch.id);
    }
    private async run(batch: RegressionBatch, signal: AbortSignal) {
        try {
            batch.phase = 'running';
            batch.message = '按模块顺序执行。';
            this.save('batch', batch);
            for (const entry of batch.entries) {
                if (signal.aborted || this.closed)
                    return;
                const job = this.store.start({ moduleId: entry.versionId, requestId: randomUUID(), ...(batch.runMode ? { runMode: batch.runMode } : {}), ...(entry.selectedCaseIds ? { selectedCaseIds: entry.selectedCaseIds } : {}), ...(entry.confirmedCaseIds ? { confirmedCaseIds: entry.confirmedCaseIds } : {}) }, { profileId: batch.profileId, targetUrl: batch.targetUrl, moduleName: entry.moduleName, ...(batch.databaseBinding ? { databaseBinding: batch.databaseBinding } : {}) });
                entry.jobId = job.id;
                batch.updatedAt = now();
                batch.message = `正在回归：${entry.moduleName}`;
                this.save('batch', batch);
                while (!terminal.has(this.store.getJob(job.id).phase)) {
                    if (signal.aborted || this.closed)
                        return;
                    await new Promise(r => setTimeout(r, 100));
                }
                if (signal.aborted || this.closed)
                    return;
                const done = this.store.getJob(job.id);
                if (done.phase === 'completed')
                    this.accounts[batch.systemId] = { state: 'connected', message: '测试窗口已连接；权限以各用例实际结果为准。', profileId: batch.profileId, checkedAt: now(), ...(done.databaseEvidence ? { databaseEvidence: done.databaseEvidence } : {}) };
            }
            if (!signal.aborted && !this.closed) {
                batch.phase = 'completed';
                batch.updatedAt = now();
                batch.message = '本轮结束，请查看各模块实际结果。';
                this.save('batch', batch);
                await this.notify(batch);
            }
        }
        catch (error) {
            if (!signal.aborted && !this.closed) {
                batch.phase = 'interrupted';
                batch.updatedAt = now();
                batch.message = error instanceof Error ? error.message : '本轮未完成。';
                this.save('batch', batch);
                await this.notify(batch);
            }
        }
    }
    async cancel(key: string) {
        const batch = this.get<RegressionBatch>('batch', key);
        const controller = this.active.get(key);
        if (!controller || !['queued', 'running'].includes(batch.phase))
            throw Error('本轮已结束，不能取消或改写历史结果。');
        controller.abort();
        batch.phase = 'cancelled';
        batch.updatedAt = now();
        batch.message = '本轮已取消，未启动的模块保持未执行。';
        this.save('batch', batch);
        for (const e of batch.entries)
            if (e.jobId && !terminal.has(this.store.getJob(e.jobId).phase))
                await this.store.cancel(e.jobId);
        return this.getBatch(key);
    }
    async continueBatch(key: string) {
        const batch = this.getBatch(key);
        const waiting = batch.jobs.find(j => j.phase === 'awaiting-login');
        if (!waiting)
            throw Error('本轮当前没有等待登录。');
        await this.store.continue(waiting.id);
        return this.getBatch(key);
    }
    connect(key: string) {
        const system = this.getSystem(key);
        if (this.occupied(key))
            throw Error('系统窗口正在使用，请在当前运行中继续登录。');
        const profile = this.accountProfile(system);
        const controller = new AbortController();
        this.connections.set(key, controller);
        this.accounts[key] = { state: 'connecting', message: '正在打开系统测试窗口。', profileId: profile.id };
        const project: DocumentProject = { id: profile.id, name: system.name, fileName: 'system-session', format: 'text', browserProfileIsolation: true, targetUrl: system.targetUrl, sourceText: '', cases: [], createdAt: now(), updatedAt: now() };
        // inspect only uses the job identity for login handoff; no test or cloud call is started.
        const identity = { id: randomUUID() } as WebModuleJob;
        void this.deps.inspect(project, identity, controller.signal, waiting => {
            if (!this.closed && !controller.signal.aborted)
                this.accounts[key] = { state: waiting ? 'awaiting-login' : 'connecting', message: waiting ? '请在系统测试窗口登录。' : '正在检查系统页面。', profileId: profile.id };
        }).then(async () => {
            if (this.closed || controller.signal.aborted)
                return;
            let databaseEvidence: AccountView['databaseEvidence'];
            if (system.databaseBinding) {
                this.accounts[key] = { state: 'connecting', message: '正在只读核验当前账号的数据准备。', profileId: profile.id };
                try {
                    databaseEvidence = await this.deps.database?.(project, controller.signal);
                }
                catch { }
                databaseEvidence ??= { binding: system.databaseBinding, capturedAt: now(), status: 'blocked', checks: [{ id: 'connection', title: '测试库准备', status: 'blocked', detail: '未完成本机只读核验；不会将未检查的数据当成已准备。' }] };
            }
            if (!this.closed && !controller.signal.aborted)
                this.rememberAccount(system, { state: 'connected', message: '已登录；本机自动保存并复用登录信息。', profileId: profile.id, checkedAt: now(), ...(databaseEvidence ? { databaseEvidence } : {}) });
        }, (error: unknown) => {
            if (!this.closed && !controller.signal.aborted)
                this.accounts[key] = { state: 'error', message: error instanceof Error ? error.message : '未完成窗口连接；本机已保存的登录信息仍保留。', profileId: profile.id };
        }).finally(() => this.connections.delete(key));
        return this.accounts[key];
    }
    async continueConnection(key: string) {
        const s = this.getSystem(key);
        if (this.accounts[key]?.state !== 'awaiting-login')
            throw Error('当前没有等待登录的账号连接。');
        await this.deps.continueLogin(this.accountProfile(s).id);
        return this.accounts[key];
    }
    async cancelConnection(key: string) { const s = this.getSystem(key); this.connections.get(key)?.abort(); await this.deps.cancel(this.accountProfile(s).id); delete this.accounts[key]; return { state: 'unknown', message: '已取消连接。' }; }
    retryReports(key: string) {
        const batch = this.getBatch(key);
        if (this.occupied(batch.systemId))
            throw Error('系统窗口正在使用。');
        const jobs = batch.entries.flatMap(e => e.jobId ? [this.store.getJob(e.jobId)] : []).filter(j => ['error', 'interrupted', 'blocked'].includes(j.phase) && j.executionFinished);
        if (!jobs.length)
            throw Error('没有可单独重试的汇总阶段。');
        const controller = new AbortController();
        this.active.set(batch.id, controller);
        batch.phase = 'running';
        batch.message = '恢复 Dify 汇总，不重跑网页。';
        this.save('batch', batch);
        void (async () => {
            try {
                for (const job of jobs) {
                    if (controller.signal.aborted || this.closed)
                        return;
                    await this.store.retry(job.id);
                    while (!terminal.has(this.store.getJob(job.id).phase)) {
                        if (controller.signal.aborted || this.closed)
                            return;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                if (!this.closed && !controller.signal.aborted) {
                    batch.phase = 'completed';
                    batch.updatedAt = now();
                    batch.message = '汇总重试结束，网页原结果保留。';
                    this.save('batch', batch);
                    await this.notify(batch);
                }
            }
            catch (error) {
                if (!this.closed && !controller.signal.aborted) {
                    batch.phase = 'interrupted';
                    batch.message = error instanceof Error ? error.message : '汇总未完成。';
                    this.save('batch', batch);
                }
            }
            finally {
                this.active.delete(batch.id);
            }
        })();
        return this.getBatch(batch.id);
    }
    private async notify(batch: RegressionBatch) {
        if (this.closed)
            return;
        // A user's later disable takes effect even for an older enabled batch.
        if (!this.getSystem(batch.systemId).notifyFailures)
            return;
        try {
            await this.notifier.deliver(this.view(batch), batch.notification, record => {
                if (!this.closed) {
                    batch.notification = record;
                    this.save('batch', batch);
                }
            });
        }
        catch {
            if (!this.closed) {
                batch.notification = { status: 'uncertain', updatedAt: now(), items: [{ id: 'summary', type: 'summary', status: 'uncertain', attempts: 0, detail: '通知准备未完成；未改变原始测试结果。' }] };
                this.save('batch', batch);
            }
        }
    }
    async retryNotification(key: string) {
        const batch = this.get<RegressionBatch>('batch', key);
        if (this.active.has(key) || ['queued', 'running'].includes(batch.phase))
            throw Error('本轮仍在处理，请等待结束。');
        if (!batch.notifyFailures || !this.getSystem(batch.systemId).notifyFailures)
            throw Error('本轮未开启通知或系统通知已关闭。');
        if (!this.notifier.configured())
            throw Error('本机测试群机器人未配置，不能重试通知。');
        if (!batch.notification?.items.some(i => i.status === 'failed' || i.status === 'pending'))
            throw Error('没有明确失败的通知可重试；接收结果不明的消息请先核对测试群。');
        const controller = new AbortController();
        this.active.set(key, controller);
        try {
            await this.notify(batch);
            return this.getBatch(key);
        }
        finally {
            this.active.delete(key);
        }
    }
    async scripts(key: string) {
        const b = this.getBatch(key);
        if (['queued', 'running'].includes(b.phase))
            throw Error('请等待本轮结束后导出固定脚本。');
        return difyScriptPackage(b.entries.flatMap(e => e.jobId ? [this.store.getJob(e.jobId)] : []), { batchId: b.id, systemId: b.systemId, systemName: b.systemName, createdAt: b.createdAt, modules: b.entries });
    }
    async selectionScripts(input: unknown) {
        const data = z.object({ systemId: uuid, moduleIds: z.array(uuid).min(1).max(100), scope: z.enum(['all', 'starter', 'custom']), versionSelections: z.record(z.string(), uuid), caseSelections: z.record(z.string(), z.array(z.string()).min(1).max(200)).optional() }).parse(input);
        if (new Set(data.moduleIds).size !== data.moduleIds.length)
            throw Error('模块不能重复。');
        const system = this.getSystem(data.systemId);
        const profileId = system.activeAccountId ?? system.profileId;
        const history = this.list<RegressionBatch>('batch').filter(b => b.systemId === system.id && b.profileId === profileId && b.targetUrl === system.targetUrl && b.environment === system.environment)
            .flatMap(batch => batch.entries.flatMap(entry => entry.jobId ? [{ batch, entry, job: this.store.getJob(entry.jobId) }] : []));
        const donors = history.flatMap(item => item.job.documentRunId && item.job.executionFinished ? [item.job.documentRunId] : []);
        if (!donors.length)
            throw Error('当前系统尚无可复用的独立执行器，请先导出用例 Markdown；本操作不会为了导出而启动测试。');
        const modules: DifyScriptModuleInput[] = [];
        const entries: BatchEntry[] = [];
        for (const key of data.moduleIds) {
            const module = this.getModule(key);
            const version = module.versions.at(-1)!;
            if (module.systemId !== system.id || module.archived)
                throw Error('选择包含其他系统或已归档模块。');
            if (data.versionSelections[key] !== version.id)
                throw Error('模块版本已变化，请刷新后重新下载。');
            const stored = this.store.getModule(version.id);
            const project = structuredClone(stored.project);
            project.targetUrl = system.targetUrl;
            const ids = data.scope === 'all' ? project.cases.map(c => c.id) : data.scope === 'starter' ? (module.starterVersionId === version.id ? module.starterCaseIds : undefined) : data.caseSelections?.[key];
            if (!ids?.length || new Set(ids).size !== ids.length || ids.some(id => !project.cases.some(c => c.id === id)))
                throw Error('所选模块的用例范围未设置、已过期或包含未知用例。');
            const newest = new Map<string, {
                job: WebModuleJob;
                batchId: string;
                time: number;
                result: WebModuleJob['results'][number];
            }>();
            for (const item of history) {
                if (item.entry.moduleId !== key || item.entry.versionId !== version.id)
                    continue;
                const time = Date.parse(item.job.createdAt) || Date.parse(item.batch.createdAt) || 0;
                for (const result of item.job.results) {
                    if (result.status === 'not_executed' && !result.outOfScope)
                        continue;
                    const old = newest.get(result.caseId);
                    if (!old || time >= old.time)
                        newest.set(result.caseId, { job: item.job, batchId: item.batch.id, time, result });
                }
            }
            for (const c of project.cases) {
                const record = newest.get(c.id);
                const executed = (record?.job.executionProject ?? record?.job.snapshot)?.cases.find(row => row.id === c.id);
                const cache = stored.cachedSteps?.[c.id];
                if (executed)
                    c.steps = structuredClone(executed.steps);
                else if (cache?.sourceDigest === moduleDigest(c))
                    c.steps = structuredClone(cache.steps);
            }
            const results = project.cases.filter(c => ids.includes(c.id)).map(c => structuredClone(newest.get(c.id)?.result ?? { caseId: c.id, title: c.title, expected: c.expected, priority: c.priority, status: 'not_executed' as const, detail: '当前账号、环境和模块版本下尚无执行结果。' }));
            const resultSources = ids.flatMap(caseId => { const record = newest.get(caseId); return record ? [{ caseId, batchId: record.batchId, jobId: record.job.id, createdAt: record.job.createdAt }] : []; });
            modules.push({ moduleId: version.id, moduleName: module.name, moduleDigest: version.digest, snapshot: project, selectedCaseIds: ids, results, resultSources });
            entries.push({ moduleId: key, moduleName: module.name, versionId: version.id, version: version.version, digest: version.digest, caseCount: ids.length, selectedCaseIds: ids });
        }
        const createdAt = now();
        const count = entries.reduce((sum, entry) => sum + entry.caseCount, 0);
        const scopeName = { all: '全部用例', starter: '日常用例', custom: '自选用例' }[data.scope];
        const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(createdAt)).replace(/[-: ]/g, '');
        const fileName = `Dify_${difyScriptName(system.name, 24)}_${scopeName}_${entries.length}模块${count}条_导出${stamp}.zip`;
        return { fileName, bytes: await difySelectionScriptPackage(modules, donors, { systemId: system.id, systemName: system.name, createdAt, selectionScope: data.scope, modules: entries }) };
    }
    report(key: string) { const b = this.getBatch(key); const report = [`# ${b.systemName} 模块回归报告`, `批次：${b.id}`, `环境：${b.environment}`, `账号：${b.accountName ?? '历史默认账号'}`, `目标：${b.targetUrl}`, `时间：${b.createdAt}`, `批次状态：${b.phase}`, `异常通知：${b.notification?.status ?? '未启用'}（独立于用例结果）`, ...(b.notification?.items.map(i => `- ${i.type === 'summary' ? '异常摘要' : '失败截图'}：${i.status}${i.detail ? '；' + i.detail : ''}`) ?? []), `通过 ${b.counts.passed}；失败 ${b.counts.failed}；阻塞 ${b.counts.blocked}；异常 ${b.counts.error}；未执行 ${b.counts.not_executed}；范围外 ${b.counts.outside}`, ...b.entries.map(e => `\n## ${e.moduleName} · v${e.version}\n版本指纹：${e.digest}\n${e.jobId ? this.store.renderReport(this.store.getJob(e.jobId)) : '本模块未启动，不计为通过。'}`)].join('\n\n'); assertDifyExportSafe(report); return report; }
    close() {
        if (this.closed)
            return;
        for (const [key, c] of this.active) {
            c.abort();
            const b = this.get<RegressionBatch>('batch', key);
            if (!['queued', 'running'].includes(b.phase))
                continue;
            b.phase = 'interrupted';
            b.updatedAt = now();
            b.message = '服务已停止，记录已保存，不会自动重放。';
            this.save('batch', b);
        }
        for (const c of this.connections.values())
            c.abort();
        this.closed = true;
        this.db.close();
    }
}
