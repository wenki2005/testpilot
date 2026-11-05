import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from '../shared/http-utils.js';
import type { DocumentProject, DocumentRunRecovery } from '../../../domain/documents/shared/test-model.js';

export interface DocumentRunHandoffRouteDependencies {
  getProject(projectId: string): Promise<DocumentProject | undefined>;
  getRecovery(project: DocumentProject): Promise<DocumentRunRecovery | undefined>;
  getHandoff(projectId: string): unknown;
  continueLogin(projectId: string): Promise<unknown>;
  runSessionKey?(runId: string): string | undefined;
}

/** HTTP adapter for resumable run state and the human-controlled login handoff. */
export async function handleDocumentRunHandoffRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: DocumentRunHandoffRouteDependencies,
): Promise<boolean> {
  const runLogin = pathname.match(/^\/api\/document-runs\/([A-Za-z0-9_-]{1,128})\/login(?:\/(continue))?$/u);
  if (runLogin && (req.method === 'GET' || req.method === 'POST' && runLogin[2])) {
    const key = deps.runSessionKey?.(runLogin[1]!);
    if (!key) { fail(res, 404, '该运行没有活动登录会话。'); return true; }
    if (req.method === 'GET') json(res, 200, deps.getHandoff(key) ?? null);
    else { try { json(res, 200, await deps.continueLogin(key)); } catch { fail(res, 409, '登录状态尚未就绪，请在该档案窗口完成扫码。'); } }
    return true;
  }
  const login = pathname.match(/^\/api\/document-projects\/([^/]+)\/login(?:\/(continue))?$/u);
  const recovery = pathname.match(/^\/api\/document-projects\/([^/]+)\/recovery$/u);
  if (req.method === 'GET' && recovery) {
    const project = await deps.getProject(decodeURIComponent(recovery[1]!));
    if (!project) { fail(res, 404, '文档测试项目不存在。'); return true; }
    json(res, 200, await deps.getRecovery(project) ?? null);
    return true;
  }
  if (login && req.method === 'GET' && !login[2]) {
    json(res, 200, deps.getHandoff(decodeURIComponent(login[1]!)) ?? null);
    return true;
  }
  if (login && req.method === 'POST' && login[2] === 'continue') {
    try { json(res, 200, await deps.continueLogin(decodeURIComponent(login[1]!))); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : '登录状态尚未就绪。'); }
    return true;
  }
  return false;
}
