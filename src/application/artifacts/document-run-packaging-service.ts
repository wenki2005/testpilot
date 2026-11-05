import type { DocumentProject, DocumentRun, ExecutionJournal } from '../../domain/documents/shared/test-model.js';
import type { DocumentRunRepository } from '../ports/document-run-repository.js';
import type { ActiveDocumentRunRegistry } from '../runs/execution/active-document-run-registry.js';
export interface DocumentRunPackagingDependencies {
    repository: DocumentRunRepository;
    registry: ActiveDocumentRunRegistry;
    getProject(projectId: string): Promise<DocumentProject | undefined>;
    projectDigest(project: DocumentProject): string;
    readPackageInput(runId: string): Promise<Uint8Array>;
    packageExists(path: string): Promise<boolean>;
    finalizePackage(project: DocumentProject, run: DocumentRun, journal: ExecutionJournal, packageInput: Uint8Array): Promise<DocumentRun>;
    saveRun(run: DocumentRun, journal: ExecutionJournal): Promise<void>;
}
export function createDocumentRunPackagingService(deps: DocumentRunPackagingDependencies) {
    return {
        async retry(runId: string): Promise<DocumentRun> {
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId))
                throw new Error('运行 ID 无效。');
            if (deps.registry.isPackageFinalizing(runId))
                throw new Error('该运行的报告与脚本包正在重新生成；请稍后刷新运行记录。');
            const journal = await deps.repository.readJournal(runId);
            const run = journal.finalizationRun;
            if (journal.version !== 1 || journal.runId !== runId || journal.stage !== 'packaging' || !['running', 'failed'].includes(journal.status) || !run || run.id !== runId || !run.reportReady || !run.report) {
                throw new Error('没有可单独恢复的报告/打包快照；为避免再次访问目标网站，本次不会重跑用例。');
            }
            if (run.packageReady && run.packagePath && await deps.packageExists(run.packagePath))
                return run;
            const project = await deps.getProject(journal.projectId);
            if (!project || project.reviewStatus !== 'approved' || deps.projectDigest(project) !== journal.projectDigest || journal.targetUrl !== project.targetUrl) {
                throw new Error('项目、网址或审核版本已变化；不能用当前项目状态完成旧运行的报告/打包。');
            }
            if (journal.siteVersionSnapshot && project.targetUrl !== journal.siteVersionSnapshot.targetUrl)
                throw new Error('网站版本快照与项目当前网址不一致；拒绝打包。');
            if (journal.siteVersionSnapshot
                ? !project.siteVersions?.some(item => item.id === journal.siteVersionSnapshot!.id && JSON.stringify(item) === JSON.stringify(journal.siteVersionSnapshot))
                : (project.siteVersions?.length ?? 0) > 0)
                throw new Error('登记的网站版本与本轮快照不一致；拒绝用新版本完成旧报告。');
            const packageInput = await deps.readPackageInput(runId);
            if (!deps.registry.beginPackageFinalization(runId))
                throw new Error('该运行的报告与脚本包正在重新生成；请稍后刷新运行记录。');
            try {
                journal.status = 'running';
                journal.updatedAt = new Date().toISOString();
                delete journal.lastError;
                await deps.repository.writeJournal(journal);
                return await deps.finalizePackage(project, run, journal, packageInput);
            }
            catch (error) {
                journal.status = 'failed';
                journal.updatedAt = new Date().toISOString();
                journal.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
                run.packagePath = '';
                run.packageReady = false;
                await deps.saveRun(run, journal).catch(() => undefined);
                throw error;
            }
            finally {
                deps.registry.endPackageFinalization(runId);
            }
        },
    };
}
