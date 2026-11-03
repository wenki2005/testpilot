import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from './http-utils.js';
import type { AutomaticRecoveryStatus } from '../../application/runs/document-automatic-recovery-service.js';

/** Observation only: neither GET nor an unsupported method can trigger a recovery. */
export async function handleDocumentAutomaticRecoveryRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
  get(runId: string): Promise<AutomaticRecoveryStatus | undefined>;
}): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/document-runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/automatic-recovery$/u);
  if (!match) return false;
  if (req.method !== 'GET') { fail(res, 405, '自动恢复状态仅供读取，不能通过此接口提交恢复。'); return true; }
  try {
    const status = await service.get(match[1]!);
    if (!status) fail(res, 404, '运行不存在。'); else json(res, 200, status);
  } catch { fail(res, 503, '暂时无法核验自动恢复状态；不会据此重放运行。'); }
  return true;
}
