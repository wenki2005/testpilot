import type { DemoCheck, DemoEvent, DemoRequest, DemoRun, RunContext } from '../../domain/demo-contracts.js';

export interface DemoRunService {
  list(): DemoRun[];
  get(id: string): DemoRun | undefined;
  restore(run: DemoRun): void;
  isRunActive(): boolean;
  activateRun(id: string): void;
  finishRun(id: string): void;
  launch(request: DemoRequest, checks?: DemoCheck[]): Promise<DemoRun>;
  cancel(id: string): Promise<DemoRun | undefined>;
}

export function createDemoRunService(input: {
  fixedTarget(): boolean;
  availableRoutes: string[];
  defaultRequirements: string;
  baseUrl: string;
  timeoutMs: number;
  framework: string;
  createId(): string;
  now(): string;
  modelLabel(request: DemoRequest): string;
  persist(run: DemoRun): Promise<void>;
  execute(context: RunContext, request: DemoRequest, checks?: DemoCheck[]): Promise<void>;
}): DemoRunService {
  const runs = new Map<string, DemoRun>();
  const controllers = new Map<string, AbortController>();
  let activeRunId: string | undefined;

  function finishRun(id: string): void {
    if (activeRunId === id) activeRunId = undefined;
    controllers.delete(id);
  }

  function createRun(request: DemoRequest, checks?: DemoCheck[]): DemoRun {
    const now = input.now();
    return {
      id: input.createId(), mode: request.mode, provider: request.provider, status: 'queued', startedAt: now,
      durationMs: 0, framework: input.framework, modelLabel: input.modelLabel(request),
      input: { requirements: request.requirements, target: request.target }, maxActions: request.maxActions,
      actionCount: 0, plan: [], events: [], evidence: [], assertions: [],
      coverage: { visited: [], available: [...input.availableRoutes], untested: [...input.availableRoutes] },
      limitations: ['本演示仅针对预置订单 API；不代表跨栈、浏览器或生产环境评估。', '未知新增需求没有样例服务行为支撑，不能视为已验证。'],
      summary: '运行已排队。', fixedTarget: input.fixedTarget(),
      ...(checks ? { regressionChecks: checks } as unknown as Partial<DemoRun> : {}),
    };
  }

  return {
    list: () => [...runs.values()],
    get: id => runs.get(id),
    restore: run => { runs.set(run.id, run); },
    isRunActive: () => Boolean(activeRunId),
    activateRun: id => { activeRunId = id; },
    finishRun,
    async launch(request, checks) {
      const run = createRun(request, checks);
      runs.set(run.id, run);
      activeRunId = run.id;
      const controller = new AbortController();
      controllers.set(run.id, controller);
      try { await input.persist(run); }
      catch (error) { runs.delete(run.id); finishRun(run.id); throw error; }
      void (async () => {
        const started = Date.now();
        const timeout = setTimeout(() => controller.abort(new Error('Demo run exceeded 90 second deadline')), input.timeoutMs);
        run.status = 'running';
        run.startedAt = input.now();
        const emit = (kind: DemoEvent['kind'], title: string, detail: string) => {
          run.events.push({ id: input.createId(), at: input.now(), kind, title, detail });
        };
        const context: RunContext = { run, signal: controller.signal, baseUrl: input.baseUrl, emit };
        const isCancelled = () => run.status === 'cancelled';
        try {
          await input.execute(context, request, checks);
          if (controller.signal.aborted && controller.signal.reason?.message !== 'cancelled') {
            run.status = 'blocked';
            run.summary = '运行达到时间上限；已执行证据已保留，未执行部分未判为通过。';
          } else if (run.status === 'running') {
            run.status = run.assertions.length === 0 ? 'blocked' : run.assertions.some(assertion => assertion.status === 'failed') ? 'failed' : run.assertions.every(assertion => assertion.status === 'passed') ? 'passed' : 'blocked';
          }
          run.summary ||= run.status === 'passed' ? '所有断言通过。' : `运行结束：${run.status}`;
        } catch (error) {
          if (controller.signal.aborted && isCancelled()) { /* cancellation already recorded */ }
          else if (controller.signal.aborted) { run.status = 'blocked'; run.error = '运行超过 90 秒期限，已停止。'; }
          else { run.status = 'error'; run.error = error instanceof Error ? error.message : String(error); emit('error', '运行异常', run.error); }
          run.summary = run.error ?? '运行已取消。';
        } finally {
          clearTimeout(timeout);
          run.durationMs = Date.now() - started;
          run.completedAt = input.now();
          finishRun(run.id);
          await input.persist(run).catch(() => undefined);
        }
      })();
      return run;
    },
    async cancel(id) {
      const run = runs.get(id);
      if (!run) return undefined;
      if (!['queued', 'running'].includes(run.status)) return run;
      run.status = 'cancelled';
      run.summary = '运行已取消。';
      run.completedAt = input.now();
      controllers.get(id)?.abort(new Error('cancelled'));
      await input.persist(run);
      return run;
    },
  };
}
