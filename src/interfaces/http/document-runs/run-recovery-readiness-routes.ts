import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from '../shared/http-utils.js';

export async function handleDocumentRunRecoveryReadinessRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  get(runId: string): Promise<unknown | undefined>;
}): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/recovery-readiness$/u);
  if (!match) return false;
  if (req.method !== 'GET') { fail(res, 405, 'method not allowed'); return true; }
  try {
    const readiness = await service.get(match[1]!);
    if (!readiness) fail(res, 404, '父运行不存在，无法核对恢复条件。');
    else json(res, 200, readiness);
  } catch { fail(res, 503, '暂时无法核对恢复条件；请刷新检查，不能据此启动恢复。'); }
  return true;
}
