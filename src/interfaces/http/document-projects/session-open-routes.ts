import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';
import { DocumentSessionOpenError } from '../../../application/projects/document-session-open-service.js';

export interface DocumentSessionOpenRouteDependencies {
  open(projectId: string, siteVersionId?: string): Promise<unknown>;
  getStatus(projectId: string, siteVersionId?: string): Promise<unknown> | unknown;
}

function handleError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof DocumentSessionOpenError)) throw error;
  const status = error.code === 'not-found' ? 404 : error.code === 'occupied' ? 409 : 400;
  fail(res, status, error.message);
}

function decodeProjectId(raw: string): string | undefined {
  try {
    const id = decodeURIComponent(raw);
    return /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : undefined;
  } catch { return undefined; }
}

export async function handleDocumentSessionOpenRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: DocumentSessionOpenRouteDependencies): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session\/open$/u);
  if (!match) return false;
  const projectId = decodeProjectId(match[1]!);
  if (!projectId) { fail(res, 400, '项目 ID 格式无效。'); return true; }

  if (req.method === 'GET') {
    const siteVersionId = url.searchParams.get('siteVersionId') ?? undefined;
    if (siteVersionId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(siteVersionId)) { fail(res, 400, 'siteVersionId 格式无效。'); return true; }
    json(res, 200, await deps.getStatus(projectId, siteVersionId) ?? null);
    return true;
  }
  if (req.method !== 'POST') return false;

  let body: unknown;
  try { body = await bodyJson(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => key !== 'siteVersionId')
    || ('siteVersionId' in body && (typeof (body as { siteVersionId?: unknown }).siteVersionId !== 'string'
      || !/^[A-Za-z0-9_-]{1,128}$/u.test((body as { siteVersionId: string }).siteVersionId))))) {
    fail(res, 400, '请求仅接受格式正确的可选 siteVersionId。');
    return true;
  }
  try {
    const siteVersionId = body ? (body as { siteVersionId?: string }).siteVersionId : undefined;
    json(res, 202, await deps.open(projectId, siteVersionId));
  } catch (error) { handleError(res, error); }
  return true;
}
