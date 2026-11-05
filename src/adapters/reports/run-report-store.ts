import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { SystemModuleRegression } from '../regression/catalog/module-regression-service.js';
import type { DepartmentCoreChainStore } from '../regression/chains/core-chain-store.js';
import type { BatchView, TestedSystem } from '../../domain/regression/module-catalog-contract.js';
import type { CoreRun } from '../../domain/regression/core-chain-definitions.js';
import { batchReportScope, emptyReportCounts, type ReportKind, type ReportMetadata, type RunReport, type RunReportCatalog, type RunReportDetail, type ReportGroup, type ReportStep, type ReportCounts } from '../../domain/reports/run-report-contract.js';
const id = z.string().uuid(), kindSchema = z.enum(['batch', 'core']);
const update = z.object({ systemId: id, revision: z.number().int().nonnegative(), name: z.string().trim().max(100), note: z.string().trim().max(1000), important: z.boolean() }).strict();
const metadataDefault = (): ReportMetadata => ({ name: '', note: '', important: false, revision: 0, updatedAt: '' });
export class ReportMetadataConflict extends Error {
}
/** Annotations only. Execution records, verdicts and module versions stay in their original stores. */
export class RunReportStore {
    private db: DatabaseSync;
    constructor(root: string, private modules: SystemModuleRegression, private cores: DepartmentCoreChainStore) { const dir = path.join(root, 'run-report-metadata'); mkdirSync(dir, { recursive: true }); this.db = new DatabaseSync(path.join(dir, 'records.sqlite')); this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS metadata(kind TEXT NOT NULL,run_id TEXT NOT NULL,system_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,run_id));'); }
    private source(kind: ReportKind, runId: string) { id.parse(runId); return kind === 'batch' ? this.modules.getBatch(runId) : this.cores.get(runId); }
    private metadata(kind: ReportKind, runId: string): ReportMetadata { const row = this.db.prepare('SELECT payload FROM metadata WHERE kind=? AND run_id=?').get(kind, runId); return row ? JSON.parse(String(row.payload)) as ReportMetadata : metadataDefault(); }
    private summary(kind: ReportKind, run: BatchView | CoreRun): RunReport {
        const metadata = this.metadata(kind, run.id), base = { key: kind + ':' + run.id, id: run.id, kind, systemId: run.systemId, systemName: run.systemName, metadata, createdAt: run.createdAt, phase: run.phase };
        if (kind === 'batch') {
            const b = run as BatchView;
            return { ...base, scope: batchReportScope(b), name: metadata.name || (b.parentBatchId ? '用例复测' : batchReportScope(b) === 'all' ? '模块回归' : '自选用例回归'), size: b.entries.reduce((n, e) => n + (e.selectedCaseIds?.length ?? e.caseCount), 0), groupCount: b.entries.length, unit: '条', counts: b.counts, parentBatchId: b.parentBatchId ?? '' };
        }
        const r = run as CoreRun, counts = emptyReportCounts();
        for (const step of r.chains.flatMap(c => c.steps))
            counts[step.status]++;
        return { ...base, scope: 'core', name: metadata.name || '核心链路回归', size: r.chains.reduce((n, c) => n + c.steps.length, 0), groupCount: r.chains.length, unit: '步', counts, parentBatchId: '' };
    }
    catalog(systemId?: string): RunReportCatalog { const state = this.modules.state(), selected = systemId ? this.modules.getSystem(id.parse(systemId)) : state.systems[0]; return { systems: state.systems.map(s => ({ id: s.id, name: s.name })), systemId: selected?.id ?? '', reports: selected ? [...state.batches.filter(b => b.systemId === selected.id).map(b => this.summary('batch', b)), ...this.cores.historyForSystem(selected.id).map(r => this.summary('core', r))].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key)) : [] }; }
    private account(system: TestedSystem, profileId: string, name?: string) { return name || system.accountProfiles?.find(a => a.id === profileId)?.name || (system.profileId === profileId ? '我的账号' : '账号 ' + profileId); }
    detail(inputKind: unknown, runId: string, systemId: string): RunReportDetail {
        const kind = kindSchema.parse(inputKind), run = this.source(kind, runId);
        if (run.systemId !== id.parse(systemId))
            throw Error('报告不属于当前项目。');
        const system = this.modules.getSystem(run.systemId), groups: ReportGroup[] = [];
        if (kind === 'core') {
            for (const chain of (run as CoreRun).chains) {
                const counts = emptyReportCounts();
                const steps: ReportStep[] = chain.steps.map(s => { counts[s.status]++; return { id: s.id, title: s.title, expected: s.expected, actual: s.detail, status: s.status, caseIds: s.sources.map(c => c.caseId), evidencePath: s.evidence && /^[0-9a-f]{64}\.png$/i.test(s.evidence) ? `/api/system-module-regression/core-chains/runs/${run.id}/evidence/${s.evidence}` : '', evidenceNote: s.evidenceKind === 'historical-submission' ? '历史提交凭证与本轮读回' : '', nextAction: '' }; });
                groups.push({ id: chain.id, title: chain.title, version: (run as CoreRun).definitionDigest, size: chain.steps.length, counts, steps });
            }
        }
        else {
            const batch = run as BatchView;
            for (const entry of batch.entries) {
                const job = batch.jobs.find(j => j.id === entry.jobId), counts = emptyReportCounts();
                let steps: ReportStep[] = [];
                if (job)
                    steps = job.results.map(s => { const status = s.outOfScope ? 'outside' : s.status; counts[status]++; return { id: s.caseId, title: s.title, expected: s.expected, actual: s.detail, status, caseIds: [s.caseId], evidencePath: s.evidence && /^[0-9a-f]{64}\.png$/i.test(s.evidence) ? `/api/dify-web-modules/jobs/${job.id}/evidence/${s.evidence}` : '', evidenceNote: s.evidenceNote ?? '', nextAction: s.nextAction ?? '' }; });
                else {
                    counts.not_executed = entry.selectedCaseIds?.length ?? entry.caseCount;
                    try {
                        steps = this.modules.cases(entry.moduleId, entry.versionId).cases.filter(c => !entry.selectedCaseIds || entry.selectedCaseIds.includes(c.id)).map(c => ({ id: c.id, title: c.title, expected: c.expected, actual: '本批次未执行。', status: 'not_executed', caseIds: [c.id], evidencePath: '', evidenceNote: '', nextAction: '' }));
                    }
                    catch { /* Keep unavailable historical source visible through the version identifier. */ }
                }
                groups.push({ id: entry.moduleId, title: entry.moduleName, version: 'v' + entry.version + ' · ' + entry.versionId, size: entry.selectedCaseIds?.length ?? entry.caseCount, counts, steps });
            }
        }
        return { report: this.summary(kind, run), environment: run.environment, account: this.account(system, run.profileId, 'accountName' in run ? run.accountName : undefined), profileId: run.profileId, groups, message: run.message };
    }
    saveMetadata(inputKind: unknown, runId: string, input: unknown): ReportMetadata {
        const kind = kindSchema.parse(inputKind), data = update.parse(input), run = this.source(kind, runId);
        if (run.systemId !== data.systemId)
            throw Error('报告不属于当前项目。');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const current = this.metadata(kind, runId);
            if (current.revision !== data.revision)
                throw new ReportMetadataConflict('报告信息已被其他窗口修改，请刷新后重试。');
            const next: ReportMetadata = { name: data.name, note: data.note, important: data.important, revision: current.revision + 1, updatedAt: new Date().toISOString() };
            this.db.prepare('INSERT INTO metadata(kind,run_id,system_id,revision,payload) VALUES(?,?,?,?,?) ON CONFLICT(kind,run_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(kind, runId, data.systemId, next.revision, JSON.stringify(next));
            this.db.exec('COMMIT');
            return next;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
