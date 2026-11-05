export interface ActiveDocumentRun {
    readonly runId: string;
    readonly projectId: string;
    readonly controller: AbortController;
    readonly userDataDir: string;
    readonly browserChoice?: 'chromium' | 'edge';
    readonly isolatedProfileKey?: string;
    readonly parallelProfileRun?: boolean;
    acceptingCancel: boolean;
    pauseRequested?: boolean;
    paused?: boolean;
    continuePause?: () => void;
    pauseMode?: "step" | "external-analysis";
    pageContextId?: string;
    validatePageContext?: () => boolean | Promise<boolean>;
    captureBeforeCancel?: () => Promise<void>;
}
/** The process-wide source of truth for active run and browser-page ownership. */
export class ActiveDocumentRunRegistry {
    private readonly runs = new Map<string, ActiveDocumentRun>();
    private readonly browserProjects = new Set<string>();
    private readonly pageLeases = new Set<string>();
    private readonly browserResources = new Set<string>();
    private readonly pageResources = new Set<string>();
    private readonly packageFinalizations = new Set<string>();
    getRun(runId: string): ActiveDocumentRun | undefined { return this.runs.get(runId); }
    isRunActive(runId: string): boolean { return this.runs.has(runId); }
    isProjectRunActive(projectId: string): boolean { return [...this.runs.values()].some(run => run.projectId === projectId); }
    isPackageFinalizing(runId: string): boolean { return this.packageFinalizations.has(runId); }
    isBrowserActive(projectId: string): boolean { return this.browserProjects.has(projectId); }
    isPageLeased(projectId: string): boolean { return this.pageLeases.has(projectId); }
    isBrowserOccupied(projectId: string): boolean { return this.isBrowserActive(projectId) || this.isPageLeased(projectId) || this.isProjectRunActive(projectId); }
    beginRun(entry: ActiveDocumentRun): void {
        if (this.runs.has(entry.runId))
            throw new Error(`运行 ${entry.runId} 已注册。`);
        this.runs.set(entry.runId, entry);
    }
    endRun(runId: string): void { this.runs.delete(runId); }
    setEvidenceCapture(runId: string, capture?: () => Promise<void>): void {
        const run = this.runs.get(runId);
        if (!run)
            return;
        if (capture)
            run.captureBeforeCancel = capture;
        else
            delete run.captureBeforeCancel;
    }
    requestPause(runId: string): "requested" | "already-paused" | "not-active" {
        const run = this.runs.get(runId);
        if (!run)
            return "not-active";
        if (run.paused || run.pauseRequested)
            return "already-paused";
        run.pauseRequested = true;
        return "requested";
    }
    async continueRun(runId: string): Promise<"continued" | "context-lost" | "cancelled" | "not-paused" | "not-active"> {
        const run = this.runs.get(runId);
        if (!run)
            return "not-active";
        if (!run.paused && !run.pauseRequested)
            return "not-paused";
        const externalAnalysis = run.pauseMode === "external-analysis";
        if (externalAnalysis || run.paused && run.validatePageContext) {
            const contextValid = run.validatePageContext ? await safeValidateAsync(run.validatePageContext) : false;
            if (run.controller.signal.aborted)
                return "cancelled";
            if (!contextValid) {
                run.controller.abort(new Error(externalAnalysis ? "external analysis page context lost" : "paused page context lost"));
                return "context-lost";
            }
        }
        run.pauseRequested = false;
        run.paused = false;
        run.continuePause?.();
        delete run.continuePause;
        return "continued";
    }
    async waitAtStepBoundary(runId: string, signal: AbortSignal, validateContext?: () => boolean | Promise<boolean>): Promise<void> {
        const run = this.runs.get(runId);
        if (!run?.pauseRequested || signal.aborted)
            return;
        run.paused = true;
        if (validateContext)
            run.validatePageContext = validateContext;
        await new Promise<void>(resolve => {
            const finish = () => { signal.removeEventListener("abort", finish); delete run.continuePause; delete run.validatePageContext; run.paused = false; resolve(); };
            run.continuePause = finish;
            signal.addEventListener("abort", finish, { once: true });
            if (signal.aborted)
                finish();
        });
    }
    /** Pause the original run while an external observer inspects the same live page context. */
    async waitForExternalAnalysis(runId: string, pageContextId: string, validateContext: () => boolean | Promise<boolean>): Promise<"continued" | "context-lost" | "cancelled" | "not-active"> {
        const run = this.runs.get(runId);
        if (!run)
            return "not-active";
        if (run.controller.signal.aborted)
            return "cancelled";
        if (!pageContextId) {
            run.controller.abort(new Error("external analysis page context lost"));
            return "context-lost";
        }
        const initialContextValid = await safeValidateAsync(validateContext);
        if (run.controller.signal.aborted)
            return "cancelled";
        if (!initialContextValid) {
            run.controller.abort(new Error("external analysis page context lost"));
            return "context-lost";
        }
        if (run.paused || run.pauseRequested)
            throw new Error("运行已经在普通暂停或前置分析暂停状态，不能重复建立接管等待。");
        run.paused = true;
        run.pauseMode = "external-analysis";
        run.pageContextId = pageContextId;
        run.validatePageContext = validateContext;
        const result = await new Promise<"continued" | "context-lost" | "cancelled">(resolve => {
            let settled = false;
            const finish = (value: "continued" | "context-lost" | "cancelled") => {
                if (settled)
                    return;
                settled = true;
                run.controller.signal.removeEventListener("abort", onAbort);
                delete run.continuePause;
                delete run.pauseMode;
                delete run.pageContextId;
                delete run.validatePageContext;
                run.paused = false;
                resolve(value);
            };
            const onAbort = () => finish(run.controller.signal.reason instanceof Error && run.controller.signal.reason.message === "external analysis page context lost" ? "context-lost" : "cancelled");
            run.continuePause = () => {
                if (run.controller.signal.aborted)
                    return finish("cancelled");
                void safeValidateAsync(validateContext).then(valid => finish(valid ? "continued" : "context-lost"));
            };
            run.controller.signal.addEventListener("abort", onAbort, { once: true });
            // Abort may race with listener registration; AbortSignal does not replay earlier events.
            if (run.controller.signal.aborted)
                onAbort();
        });
        if (result === "context-lost" && !run.controller.signal.aborted)
            run.controller.abort(new Error("external analysis page context lost"));
        return result;
    }
    beginBrowser(projectId: string): void {
        if (this.isBrowserOccupied(projectId))
            throw new Error("该项目已有运行或会话操作占用浏览器。");
        this.browserProjects.add(projectId);
    }
    /** Profile-level guards prevent two projects from opening the same persistent browser directory. */
    isResourceOccupied(resourceKey: string): boolean { return this.browserResources.has(resourceKey) || this.pageResources.has(resourceKey); }
    beginResource(resourceKey: string): void {
        if (this.isResourceOccupied(resourceKey))
            throw new Error("该浏览器身份档案已被其他项目占用。");
        this.browserResources.add(resourceKey);
    }
    endResource(resourceKey: string): void { this.browserResources.delete(resourceKey); }
    acquireResource(resourceKey: string): (() => void) | undefined {
        if (this.isResourceOccupied(resourceKey))
            return undefined;
        this.pageResources.add(resourceKey);
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.pageResources.delete(resourceKey);
            }
        };
    }
    /** Allows distinct profile runs for one project; legacy browser/page owners remain exclusive. */
    acquireParallelProfile(projectId: string, profileKey: string): (() => void) | undefined {
        if (!profileKey || this.browserProjects.has(projectId) || this.pageLeases.has(projectId))
            return undefined;
        if ([...this.runs.values()].some(run => run.projectId === projectId && !run.parallelProfileRun))
            return undefined;
        const releaseResource = this.acquireResource(profileKey);
        if (!releaseResource)
            return undefined;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                releaseResource();
            }
        };
    }
    markBrowserActive(projectId: string): void { this.browserProjects.add(projectId); }
    endBrowser(projectId: string): void { this.browserProjects.delete(projectId); }
    acquirePage(projectId: string): (() => void) | undefined {
        if (this.isBrowserOccupied(projectId))
            return undefined;
        this.pageLeases.add(projectId);
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.pageLeases.delete(projectId);
            }
        };
    }
    beginPackageFinalization(runId: string): boolean {
        if (this.packageFinalizations.has(runId))
            return false;
        this.packageFinalizations.add(runId);
        return true;
    }
    endPackageFinalization(runId: string): void { this.packageFinalizations.delete(runId); }
}
/** Production composition imports this singleton once; tests can instantiate isolated registries. */
export const activeDocumentRunRegistry = new ActiveDocumentRunRegistry();
async function safeValidateAsync(validate: () => boolean | Promise<boolean>): Promise<boolean> {
    try {
        return await validate();
    }
    catch {
        return false;
    }
}
