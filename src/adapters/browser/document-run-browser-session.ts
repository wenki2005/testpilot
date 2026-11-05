import type { Page } from 'playwright';
import { configureDocumentPagePlatform } from './document-page-platform.js';
import type { ActiveDocumentRunRegistry } from '../../application/runs/execution/active-document-run-registry.js';
import type { DocumentProjectExecutionConfig } from '../../domain/documents/shared/test-model.js';
export interface DocumentRunBrowserSessionCoordinatorPorts<TSession extends {
    page: Page;
}> {
    registry: Pick<ActiveDocumentRunRegistry, 'isBrowserActive' | 'isProjectRunActive' | 'acquirePage' | 'beginRun' | 'markBrowserActive' | 'endBrowser' | 'endRun'> & Partial<Pick<ActiveDocumentRunRegistry, 'acquireParallelProfile'>>;
    userDataDirectory(projectId: string): string;
    launch(userDataDir: string, config?: Pick<DocumentProjectExecutionConfig, 'browser'> & {
        isolated?: boolean;
    }): Promise<TSession>;
    prepareTargetPage(url: string, projectId: string, runId: string, page: Page, onLoginWait: (waiting: boolean) => Promise<void>): Promise<void>;
    clearLoginHandoff(projectId: string): void;
    beginProfile?(profileKey: string): void;
    endProfile?(profileKey: string): void;
    acquireProfile?(profileKey: string): (() => void) | undefined;
}
/** Coordinates one run's browser ownership without owning lane execution or journal policy. */
export function createDocumentRunBrowserSessionCoordinator<TSession extends {
    page: Page;
}>(ports: DocumentRunBrowserSessionCoordinatorPorts<TSession>) {
    return {
        begin(input: {
            projectId: string;
            browserProfileIsolation?: boolean;
            runId: string;
            targetUrl: string;
            executionConfig?: DocumentProjectExecutionConfig;
            onLoginWait(waiting: boolean): Promise<void>;
            profileKey?: string;
            allowParallelSessions?: boolean;
        }) {
            if (input.executionConfig?.hostApp === 'wecom')
                throw new Error('企微工作台宿主自动控制尚未接通；请使用已验证的独立企微工作台浏览器接入后再运行。本次不会启动浏览器、打开企微或执行登录。');
            const { projectId, runId } = input;
            const profileKey = input.profileKey ?? projectId;
            const parallel = input.allowParallelSessions === true;
            if (!parallel && (ports.registry.isBrowserActive(projectId) || ports.registry.isProjectRunActive(projectId)))
                throw new Error('该项目已有测试正在使用浏览器会话；请等待当前运行结束后再启动下一轮。');
            if (parallel && !input.profileKey)
                throw new Error('并行会话必须指定独立身份档案。');
            const releaseProfileLease = parallel
                ? ports.registry.acquireParallelProfile?.(projectId, profileKey)
                : ports.acquireProfile?.(profileKey);
            if (parallel && !releaseProfileLease)
                throw new Error('项目已有不兼容的浏览器操作，或该身份档案正在使用。');
            if (ports.acquireProfile && !releaseProfileLease)
                throw new Error('该浏览器身份档案正被其他项目占用；请等待当前操作结束后重试。');
            const releasePageLease = parallel ? undefined : ports.registry.acquirePage(projectId);
            if (!parallel && !releasePageLease) {
                releaseProfileLease?.();
                throw new Error('该项目的共享浏览器页面正用于步骤生成或另一轮测试；请等待当前操作结束后重试。');
            }
            const controller = new AbortController();
            const userDataDir = ports.userDataDirectory(input.browserProfileIsolation ? `isolated-${profileKey}` : profileKey);
            try {
                ports.registry.beginRun({ runId, projectId, controller, userDataDir, acceptingCancel: true, ...(input.executionConfig?.browser ? { browserChoice: input.executionConfig.browser } : {}), ...(parallel ? { isolatedProfileKey: profileKey, parallelProfileRun: true } : {}) });
            }
            catch (error) {
                releasePageLease?.();
                releaseProfileLease?.();
                throw error;
            }
            if (!parallel)
                ports.registry.markBrowserActive(projectId);
            let released = false;
            return {
                controller,
                userDataDir,
                async initialize(): Promise<TSession> {
                    const session = await ports.launch(userDataDir, { ...input.executionConfig, ...(input.browserProfileIsolation ? { isolated: true } : {}) });
                    if (controller.signal.aborted)
                        throw controller.signal.reason ?? new Error('cancelled by user');
                    await configureDocumentPagePlatform(session.page, input.executionConfig);
                    await ports.prepareTargetPage(input.targetUrl, parallel ? profileKey : projectId, runId, session.page, input.onLoginWait);
                    if (controller.signal.aborted)
                        throw controller.signal.reason ?? new Error('cancelled by user');
                    return session;
                },
                release(): void {
                    if (released)
                        return;
                    released = true;
                    ports.clearLoginHandoff(parallel ? profileKey : projectId);
                    if (!parallel)
                        ports.registry.endBrowser(projectId);
                    ports.registry.endRun(runId);
                    releasePageLease?.();
                    releaseProfileLease?.();
                },
            };
        },
    };
}
