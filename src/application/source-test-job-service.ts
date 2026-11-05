import type { SourceTestJob, SourceTestMode, SourceTestRun } from '../domain/source-tests/source-test-contract.js';
export interface SourceTestJobStore {
    list(): SourceTestJob[];
    get(id: string): SourceTestJob | undefined;
    activeCount(): number;
    launch(profileId: string, goal: string, mode: SourceTestMode, sourceRoot: string, candidateFiles?: string[]): SourceTestJob;
    cancel(id: string): void;
}
export function createSourceTestJobService(input: {
    outputRoot: string;
    run(input: {
        sourceRoot: string;
        goal: string;
        mode: SourceTestMode;
        outputRoot: string;
        candidateFiles?: string[];
        signal: AbortSignal;
        onProgress(event: SourceTestJob['events'][number]): void;
    }): Promise<SourceTestRun>;
    createId(): string;
    now(): string;
    onFailure?(errorName: string): void;
    maxJobs?: number;
}): SourceTestJobStore {
    const jobs = new Map<string, SourceTestJob>();
    const controllers = new Map<string, AbortController>();
    const maxJobs = input.maxJobs ?? 100;
    return {
        list: () => [...jobs.values()],
        get: id => jobs.get(id),
        activeCount: () => controllers.size,
        launch(profileId, goal, mode, sourceRoot, candidateFiles = []) {
            const id = input.createId();
            const controller = new AbortController();
            const job: SourceTestJob = { id, profileId, mode, status: 'running', startedAt: input.now(), events: [] };
            jobs.set(id, job);
            controllers.set(id, controller);
            while (jobs.size > maxJobs) {
                const oldest = jobs.keys().next().value;
                if (oldest)
                    jobs.delete(oldest);
            }
            void input.run({
                sourceRoot, goal, mode, outputRoot: input.outputRoot, candidateFiles: [...candidateFiles], signal: controller.signal,
                onProgress: event => {
                    job.events.push(event);
                    if (job.events.length > 100)
                        job.events.shift();
                },
            }).then(result => {
                job.result = result;
                job.status = controller.signal.aborted ? 'cancelled' : result.status;
            }).catch(error => {
                job.status = controller.signal.aborted ? 'cancelled' : 'blocked';
                job.error = '测试任务未完成，请检查 TestPilot 模型设置和目标项目配置。';
                input.onFailure?.(error instanceof Error ? error.name : 'unknown');
            }).finally(() => controllers.delete(id));
            return job;
        },
        cancel: id => { controllers.get(id)?.abort(); },
    };
}
