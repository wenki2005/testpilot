import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from './http-utils.js';
import { DocumentCaseSelectionError, type DocumentCaseSelectionResult } from '../../application/cases/document-case-selection-service.js';

export async function handleDocumentCaseSelectionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  select: (projectId: string, input: unknown) => Promise<DocumentCaseSelectionResult>,
): Promise<boolean> {
  const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/selection$/u);
  if (req.method !== 'POST' || !route) return false;
  let input: unknown;
  try { input = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  try { json(res, 200, await select(decodeURIComponent(route[1]!), input)); }
  catch (error) {
    if (!(error instanceof DocumentCaseSelectionError)) throw error;
    const status = error.code === 'not-found' || error.code === 'unknown-cases' ? 404
      : error.code === 'invalid-selection' ? 400 : 422;
    fail(res, status, error.message);
  }
  return true;
}
