import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from '../shared/http-utils.js';
import { DocumentSiteVersionError } from '../../../application/projects/document-site-version-service.js';
import type { DocumentProject } from '../../../domain/documents/shared/test-model.js';

export async function handleDocumentSiteVersionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  register: (projectId: string, input: unknown) => Promise<DocumentProject>,
): Promise<boolean> {
  const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/site-versions$/u);
  if (req.method !== 'POST' || !route) return false;
  let input: unknown;
  try { input = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  try { json(res, 201, await register(decodeURIComponent(route[1]!), input)); }
  catch (error) {
    if (!(error instanceof DocumentSiteVersionError)) throw error;
    const status = error.code === 'invalid-input' ? 400
      : error.code === 'not-found' ? 404
      : error.code === 'duplicate-version' ? 409 : 422;
    fail(res, status, error.message);
  }
  return true;
}
