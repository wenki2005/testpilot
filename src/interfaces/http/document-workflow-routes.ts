import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from './http-utils.js';

type WorkflowStatus = 'running' | 'waiting' | 'failed' | 'completed' | 'cancelled';
export interface DocumentWorkflowRouteDependencies<TWorkflow> {
  list(input: { projectId?: string; status?: WorkflowStatus }): Promise<TWorkflow[]>;
  get(id: string): Promise<TWorkflow | undefined>;
}

/** HTTP adapter for listing and reading persisted workflow records. */
export async function handleDocumentWorkflowRoutes<TWorkflow>(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: DocumentWorkflowRouteDependencies<TWorkflow>,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/document-workflows') {
    const projectId = url.searchParams.get('projectId') ?? undefined;
    const statusValue = url.searchParams.get('status') ?? undefined;
    if (statusValue && !['running', 'waiting', 'failed', 'completed', 'cancelled'].includes(statusValue)) { fail(res, 400, 'workflow status filter is invalid.'); return true; }
    const status = statusValue as WorkflowStatus | undefined;
    try { json(res, 200, await deps.list({ ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) })); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : 'Could not read workflows.'); }
    return true;
  }
  const match = url.pathname.match(/^\/api\/document-workflows\/([^/]+)$/u);
  if (req.method !== 'GET' || !match) return false;
  const id = decodeURIComponent(match[1]!);
  if (!/^[0-9a-f-]{36}$/iu.test(id)) { fail(res, 400, 'workflow ID must be a UUID.'); return true; }
  try {
    const workflow = await deps.get(id);
    workflow ? json(res, 200, workflow) : fail(res, 404, 'document workflow not found.');
  } catch (error) { fail(res, 422, error instanceof Error ? error.message : 'workflow validation failed.'); }
  return true;
}
