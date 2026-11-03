import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from './http-utils.js';
import { DocumentProjectSessionError } from '../../application/projects/document-project-session-service.js';
import type { DocumentProject } from '../../domain/document-test-model.js';

export interface DocumentProjectSessionRouteDependencies {
  getProject(projectId: string): Promise<unknown | undefined>;
  getStatus(projectId: string, siteVersionId?: string): Promise<unknown>;
  saveIdentity(projectId: string, data: unknown): Promise<DocumentProject>;
  listRuns(projectId: string): Promise<unknown>;
}

function handleSessionError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof DocumentProjectSessionError)) throw error;
  const status = error.code === 'not-found' ? 404 : error.code === 'invalid-identity' ? 400 : 422;
  fail(res, status, error.message);
}

export async function handleDocumentProjectSessionRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: DocumentProjectSessionRouteDependencies): Promise<boolean> {
  const sessionStatus = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-status$/u);
  if (req.method === 'GET' && sessionStatus) {
    try { json(res, 200, await deps.getStatus(decodeURIComponent(sessionStatus[1]!), url.searchParams.get('siteVersionId') ?? undefined)); }
    catch (error) { handleSessionError(res, error); }
    return true;
  }
  const sessionIdentity = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-identity$/u);
  if (req.method === 'POST' && sessionIdentity) {
    let data: unknown;
    try { data = await documentBody(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    try { json(res, 200, await deps.saveIdentity(decodeURIComponent(sessionIdentity[1]!), data)); }
    catch (error) { handleSessionError(res, error); }
    return true;
  }
  const projectRuns = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/runs$/u);
  if (req.method === 'GET' && projectRuns) {
    const projectId = decodeURIComponent(projectRuns[1]!);
    if (!await deps.getProject(projectId)) { fail(res, 404, '文档测试项目不存在。'); return true; }
    json(res, 200, await deps.listRuns(projectId));
    return true;
  }
  return false;
}
