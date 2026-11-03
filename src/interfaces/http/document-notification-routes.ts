import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import { NotificationConfigurationError } from '../../application/runs/document-run-notification-service.js';
import type { DocumentRun } from '../../domain/document-test-model.js';

export async function handleDocumentNotificationRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  getConfig(): Promise<unknown>;
  configure(input: unknown): Promise<unknown>;
  getRunStatus(run: DocumentRun): Promise<unknown>;
  preview(run: DocumentRun): Promise<unknown>;
  sendOnce(run: DocumentRun, input: unknown): Promise<unknown>;
}, runs: { getRun(runId: string): Promise<DocumentRun | undefined> }): Promise<boolean> {
  const receiptRoute = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/notification(?:\/(preview|send))?$/u);
  if (receiptRoute) {
    const action = receiptRoute[2];
    if (req.method !== (action === 'send' ? 'POST' : 'GET')) { fail(res, 405, 'method not allowed'); return true; }
    let runId: string;
    try { runId = decodeURIComponent(receiptRoute[1]!); }
    catch { fail(res, 400, '运行 ID 编码无效。'); return true; }
    try {
      const run = await runs.getRun(runId);
      if (!run) { fail(res, 404, '文档测试运行不存在。'); return true; }
      if (action === 'preview') json(res, 200, await service.preview(run));
      else if (action === 'send') {
        let input: unknown;
        try { input = await bodyJson(req); } catch { fail(res, 400, '试发请求无效。'); return true; }
        json(res, 200, await service.sendOnce(run, input));
      } else json(res, 200, await service.getRunStatus(run));
    } catch (error) {
      if (error instanceof NotificationConfigurationError) { fail(res, 422, error.message); return true; }
      fail(res, 500, '无法读取通知送达状态。');
    }
    return true;
  }
  if (url.pathname !== '/api/document-notifications') return false;
  if (req.method === 'GET') { json(res, 200, await service.getConfig()); return true; }
  if (req.method === 'PUT') {
    let input: unknown;
    try { input = await bodyJson(req); } catch { fail(res, 400, '通知配置请求无效。'); return true; }
    try { json(res, 200, await service.configure(input)); }
    catch (error) { if (error instanceof NotificationConfigurationError) fail(res, 422, error.message); else throw error; }
    return true;
  }
  fail(res, 405, 'method not allowed');
  return true;
}
