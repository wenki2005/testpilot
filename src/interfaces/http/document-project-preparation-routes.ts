import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from './http-utils.js';
import type { DocumentPreparationTask, DocumentProjectPreparationInput } from '../../application/projects/document-project-preparation-service.js';

export interface DocumentProjectPreparationRouteDependencies {
  start(input: DocumentProjectPreparationInput): Promise<DocumentPreparationTask>;
  getTask(id: string): Promise<DocumentPreparationTask | undefined>;
}

/** HTTP adapter for starting document project preparation asynchronously. */
export async function handleDocumentProjectPreparationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: DocumentProjectPreparationRouteDependencies,
): Promise<boolean> {
  const taskStatus = pathname.match(/^\/api\/document-preparation\/([^/]+)$/u);
  if (req.method === 'GET' && taskStatus) {
    const id = decodeURIComponent(taskStatus[1]!);
    if (!/^[0-9a-f-]{36}$/iu.test(id)) { fail(res, 400, '资料准备任务 ID 格式无效。'); return true; }
    const task = await deps.getTask(id);
    if (!task) { fail(res, 404, '资料准备任务不存在。'); return true; }
    json(res, 200, task);
    return true;
  }
  if (req.method !== 'POST' || pathname !== '/api/document-projects/import') return false;
  let data: any;
  try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  const files: DocumentProjectPreparationInput['files'] = Array.isArray(data?.files)
    ? data.files
    : [{ fileName: data?.fileName, bytesBase64: data?.bytesBase64, role: data?.role }];
  if (!data || typeof data.targetUrl !== 'string' || !files.length || files.length > 5
    || data.platform !== undefined && !['pc-web', 'mobile-web', 'wecom-workbench'].includes(data.platform)
    || files.some(file => !file || typeof file.fileName !== 'string' || typeof file.bytesBase64 !== 'string' || file.bytesBase64.length > 13_000_000 || file.role !== undefined && !['auto', 'requirements', 'coverage-reference', 'held-out-benchmark'].includes(file.role))
    || data.contextText !== undefined && (typeof data.contextText !== 'string' || data.contextText.length > 8_000)) {
    fail(res, 400, '需要目标网址和 1–5 个有效资料文件；每个文件不能超过 9 MB，role 仅支持 auto、requirements、coverage-reference 或 held-out-benchmark，补充说明最多 8000 字。');
    return true;
  }
  const task = await deps.start({ targetUrl: data.targetUrl, files, name: data.name, contextText: data.contextText, caseMode: data.caseMode, requireConfirmation: data.requireConfirmation, platform: data.platform });
  json(res, 202, { preparationId: task.id, status: task.status });
  return true;
}
