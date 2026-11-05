import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';
import { AutonomousPlanServiceError } from '../../../application/cases/document-autonomous-plan-service.js';

export async function handleDocumentAutonomousPlanRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  create(projectId: string, input: unknown): Promise<unknown>;
  get(projectId: string, id: string): Promise<unknown>;
  list(projectId: string): Promise<unknown>;
}): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/autonomous-regression-plans(?:\/([0-9a-f-]{36}))?$/u);
  if (!match) return false;
  try {
    if (req.method === 'GET') { json(res, 200, match[2] ? await service.get(match[1]!, match[2]) : await service.list(match[1]!)); return true; }
    if (req.method === 'POST' && !match[2]) {
      let input: unknown;
      try { input = await bodyJson(req); } catch { fail(res, 400, '规划请求需要有效 JSON。'); return true; }
      json(res, 201, await service.create(match[1]!, input)); return true;
    }
    fail(res, 405, 'method not allowed');
  } catch (error) {
    if (error instanceof AutonomousPlanServiceError) fail(res, error.status, error.message);
    else fail(res, 500, '无法保存或读取自主回归计划。');
  }
  return true;
}
