import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import { ParallelRunError } from '../../application/runs/document-parallel-run-service.js';
import { DocumentProjectRunPreparationError } from '../../application/runs/document-project-run-preparation-service.js';

export async function handleDocumentParallelRunRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  start(projectId: string, input: unknown): Promise<unknown>;
  get(projectId: string, id: string): Promise<unknown>;
  list?(projectId: string): Promise<unknown>;
}): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/parallel-runs(?:\/([0-9a-f-]{36}))?$/u);
  if (!match) return false;
  if (req.method === 'GET' && !match[2]) {
    if (!service.list) { json(res, 200, []); return true; }
    json(res, 200, await service.list(match[1]!));
    return true;
  }
  if (req.method === 'GET' && match[2]) {
    const group = await service.get(match[1]!, match[2]);
    if (!group) fail(res, 404, '并行批次不存在。'); else json(res, 200, group);
    return true;
  }
  if (req.method === 'POST' && !match[2]) {
    let input: unknown;
    try { input = await bodyJson(req); } catch { fail(res, 400, '并行配置请求无效。'); return true; }
    try { json(res, 202, await service.start(match[1]!, input)); }
    catch (error) { if (error instanceof ParallelRunError || error instanceof DocumentProjectRunPreparationError) fail(res, error.status, error.message); else throw error; }
    return true;
  }
  fail(res, 405, 'method not allowed'); return true;
}
