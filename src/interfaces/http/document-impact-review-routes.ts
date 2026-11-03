import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from './http-utils.js';
import { DocumentImpactReviewError, type DocumentImpactReviewResult } from '../../application/cases/document-impact-review-service.js';

export async function handleDocumentImpactReviewRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  execute: (projectId: string, input: unknown) => Promise<DocumentImpactReviewResult>,
): Promise<boolean> {
  const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/impact-reviews$/u);
  if (req.method !== 'POST' || !route) return false;
  let input: unknown;
  try { input = await documentBody(req); }
  catch (error) { fail(res, 400, String((error as Error).message)); return true; }
  try {
    const result = await execute(decodeURIComponent(route[1]!), input);
    json(res, result.action === 'analyze' ? 201 : 200, { project: result.project, analysis: result.analysis });
  } catch (error) {
    if (!(error instanceof DocumentImpactReviewError)) throw error;
    const status = error.code === 'invalid-request' ? 400
      : error.code === 'not-found' || error.code === 'missing-version' || error.code === 'review-not-found' ? 404
      : error.code === 'already-reviewed' || error.code === 'stale-review' ? 409
      : 422;
    fail(res, status, error.message);
  }
  return true;
}
