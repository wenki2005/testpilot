import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from './http-utils.js';
import type { DocumentProjectRevisionKind } from '../../domain/document-test-model.js';

export interface DocumentProjectRevisionRouteDependencies {
  getDocumentProject(projectId: string): Promise<unknown | undefined>;
  getDocumentProjectRevision(projectId: string, revisionId: string): Promise<unknown | undefined>;
  listDocumentProjectRevisions(projectId: string, query: { kind?: DocumentProjectRevisionKind; entityId?: string; offset: number; limit: number }): Promise<unknown>;
}

export async function handleDocumentProjectRevisionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: DocumentProjectRevisionRouteDependencies,
): Promise<boolean> {
  const detailRoute = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/revisions\/([^/]+)$/u);
  if (req.method === 'GET' && detailRoute) {
    const projectId = decodeURIComponent(detailRoute[1]!);
    const revisionId = decodeURIComponent(detailRoute[2]!);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId) || !/^[0-9a-f-]{36}$/iu.test(revisionId)) {
      fail(res, 400, '项目或修订 ID 无效。');
      return true;
    }
    try {
      const revision = await dependencies.getDocumentProjectRevision(projectId, revisionId);
      revision ? json(res, 200, revision) : fail(res, 404, '找不到该项目修订。修订 ID 必须属于当前项目。');
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : '项目修订校验失败。'); }
    return true;
  }

  const listRoute = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/revisions$/u);
  if (req.method !== 'GET' || !listRoute) return false;
  const projectId = decodeURIComponent(listRoute[1]!);
  const kind = url.searchParams.get('kind');
  const entityId = url.searchParams.get('entityId');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number(url.searchParams.get('limit') ?? '100');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId) || kind !== null && !['case', 'steps', 'step-evidence', 'case-set', 'case-generation', 'materials', 'test-data'].includes(kind) || entityId !== null && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(entityId) || !kind) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    fail(res, 400, '修订查询条件无效；limit 为 1–500，entityId 需同时指定 kind。');
    return true;
  }
  try {
    if (!await dependencies.getDocumentProject(projectId)) { fail(res, 404, '文档测试项目不存在。'); return true; }
    json(res, 200, await dependencies.listDocumentProjectRevisions(projectId, { ...(kind ? { kind: kind as DocumentProjectRevisionKind } : {}), ...(entityId ? { entityId } : {}), offset, limit }));
  } catch (error) { fail(res, 422, error instanceof Error ? error.message : '读取项目修订失败。'); }
  return true;
}
