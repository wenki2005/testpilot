import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import { AutonomousPlanExecutionError } from '../../application/runs/document-autonomous-plan-execution-service.js';

export async function handleDocumentAutonomousExecutionRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  start(projectId: string, planId: string, options?: { confirmBeforeStart?: boolean }): Promise<{ state: string }>;
  get(projectId: string, planId: string): Promise<unknown | undefined>;
}): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/autonomous-regression-plans\/([0-9a-f-]{36})\/execution$/u);
  if (!match) return false;
  try {
    if (req.method === 'GET') {
      const record = await service.get(match[1]!, match[2]!);
      if (!record) fail(res, 404, '该计划尚无已提交的执行记录。');
      else json(res, 200, record);
    } else if (req.method === 'POST') {
      let body: unknown;
      try { body = await bodyJson(req); } catch { fail(res, 400, '执行请求需要空的 JSON 对象。'); return true; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { fail(res, 400, '执行范围由保存的计划确定，请勿覆盖用例或运行 ID。'); return true; }
      const payload = body as Record<string, unknown>;
      const keys = Object.keys(payload);
      const confirmBeforeStart = keys.length === 1 && payload.confirmBeforeStart === true;
      if (keys.length > 0 && !confirmBeforeStart) { fail(res, 400, '只接受空请求，或显式确认本轮执行；执行范围由已保存的计划确定。'); return true; }
      const record = await service.start(match[1]!, match[2]!, { confirmBeforeStart });
      json(res, record.state === 'pending' || record.state === 'submitted' ? 202 : 200, record);
    } else fail(res, 405, 'method not allowed');
  } catch (error) {
    if (error instanceof AutonomousPlanExecutionError) fail(res, error.status, error.message);
    else fail(res, 503, '无法确认计划执行状态；请先查询状态，不要重复提交。');
  }
  return true;
}
