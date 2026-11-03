import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import type { DemoAssertion, DemoCheck, DemoRequest, DemoRun } from '../../domain/demo-contracts.js';
import type { DemoRunService } from '../../application/runs/demo-run-service.js';

export interface DemoRunRouteDependencies {
  service: DemoRunService;
  regressions: DemoCheck[];
  defaultRequirements: string;
  validRequest(value: unknown): value is DemoRequest;
  modelAvailable(): boolean;
  persistRegressions(): Promise<void>;
  renderMarkdown(run: DemoRun): string;
}

/** HTTP adapter for the local demo run and reusable regression endpoints. */
export async function handleDemoRunRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams,
  deps: DemoRunRouteDependencies,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/runs') {
    json(res, 200, deps.service.list().sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/regressions') {
    json(res, 200, deps.regressions);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/runs') {
    let data: unknown;
    try { data = await bodyJson(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!deps.validRequest(data)) { fail(res, 400, 'invalid demo request'); return true; }
    if (data.mode === 'deterministic') data.provider = 'offline';
    if (data.provider === 'model' && !deps.modelAvailable()) { fail(res, 409, 'model provider is not configured'); return true; }
    if (deps.service.isRunActive()) { fail(res, 409, 'a demo run is already active'); return true; }
    const run = await deps.service.launch(data);
    json(res, 202, run);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/regressions/run') {
    if (!deps.regressions.length) { fail(res, 409, 'no saved regressions'); return true; }
    if (deps.service.isRunActive()) { fail(res, 409, 'a demo run is already active'); return true; }
    const request: DemoRequest = { mode: 'deterministic', provider: 'offline', requirements: deps.defaultRequirements, maxActions: Math.min(100, Math.max(deps.regressions.length, 10)), target: 'sample' };
    const run = await deps.service.launch(request, deps.regressions.map(check => structuredClone(check)));
    json(res, 202, run);
    return true;
  }

  const cancel = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/u);
  if (req.method === 'POST' && cancel) {
    const run = await deps.service.cancel(decodeURIComponent(cancel[1]!));
    if (!run) { fail(res, 404, 'run not found'); return true; }
    if (!['queued', 'running'].includes(run.status)) { json(res, 200, run); return true; }
    json(res, 200, run);
    return true;
  }

  const report = pathname.match(/^\/api\/runs\/([^/]+)\/report$/u);
  if (req.method === 'GET' && report) {
    const run = deps.service.get(decodeURIComponent(report[1]!));
    if (!run) { fail(res, 404, 'run not found'); return true; }
    const format = searchParams.get('format') ?? 'md';
    if (format === 'json') {
      const data = JSON.stringify(run, null, 2);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${run.id}.json"` });
      res.end(data);
      return true;
    }
    if (format === 'md') {
      const data = deps.renderMarkdown(run);
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${run.id}.md"` });
      res.end(data);
      return true;
    }
    fail(res, 400, 'format must be json or md');
    return true;
  }

  const detail = pathname.match(/^\/api\/runs\/([^/]+)$/u);
  if (req.method === 'GET' && detail) {
    const run = deps.service.get(decodeURIComponent(detail[1]!));
    run ? json(res, 200, run) : fail(res, 404, 'run not found');
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/regressions') {
    let data: unknown;
    try { data = await bodyJson(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || typeof (data as { runId?: unknown }).runId !== 'string' || typeof (data as { assertionId?: unknown }).assertionId !== 'string') {
      fail(res, 400, 'runId and assertionId are required'); return true;
    }
    const requestData = data as { runId: string; assertionId: string };
    const run = deps.service.get(requestData.runId);
    if (!run) { fail(res, 404, 'run not found'); return true; }
    const assertion: DemoAssertion | undefined = run.assertions.find(item => item.id === requestData.assertionId);
    if (!assertion) { fail(res, 404, 'assertion not found'); return true; }
    if (assertion.status !== 'failed') { fail(res, 409, 'only failed assertions can be saved as regressions'); return true; }
    const expected: unknown = assertion.expected;
    if (!expected || typeof expected !== 'object' || !Number.isInteger((expected as { status?: unknown }).status)) {
      fail(res, 400, 'failed assertion has no reusable HTTP expectation'); return true;
    }
    const check: DemoCheck = {
      id: `reg-${randomUUID()}`,
      title: `回归：${assertion.title}`,
      source: 'regression',
      method: assertion.reproduction.method,
      path: assertion.reproduction.path,
      expect: structuredClone(expected) as DemoCheck['expect'],
      ...(assertion.reproduction.body === undefined ? {} : { body: structuredClone(assertion.reproduction.body) }),
      ...(assertion.reproduction.headers === undefined ? {} : { headers: structuredClone(assertion.reproduction.headers) }),
    };
    deps.regressions.push(check);
    await deps.persistRegressions();
    json(res, 201, check);
    return true;
  }

  return false;
}
