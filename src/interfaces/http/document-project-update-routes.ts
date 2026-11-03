import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from './http-utils.js';
import type { DocumentProject } from '../../domain/document-test-model.js';

export async function handleDocumentProjectUpdateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: {
    getProject(projectId: string): Promise<DocumentProject | undefined>;
    update(project: DocumentProject, input: unknown): Promise<DocumentProject>;
  },
): Promise<boolean> {
  const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/update$/u);
  if (req.method !== 'POST' || !route) return false;
  const project = await deps.getProject(decodeURIComponent(route[1]!));
  if (!project) { fail(res, 404, '文档测试项目不存在。'); return true; }
  let input: unknown;
  try { input = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  try { json(res, 200, await deps.update(project, input)); }
  catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
  return true;
}
