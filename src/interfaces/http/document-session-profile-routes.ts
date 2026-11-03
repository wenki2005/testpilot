import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import { DocumentSessionProfileError } from '../../application/projects/document-session-profile-service.js';

export interface DocumentSessionProfileRouteDependencies {
  list(projectId: string): Promise<unknown>;
  add(projectId: string, data: unknown): Promise<unknown>;
  select(projectId: string, profileId: string|null): Promise<unknown>;
}
function handleError(res: ServerResponse,error:unknown) {
  if (!(error instanceof DocumentSessionProfileError)) throw error;
  fail(res,error.code==='not-found'?404:error.code==='occupied'?409:400,error.message);
}
export async function handleDocumentSessionProfileRoutes(req: IncomingMessage,res: ServerResponse,url: URL,deps: DocumentSessionProfileRouteDependencies): Promise<boolean> {
  const match=url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-profiles?$/u);
  const select=url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-profile$/u);
  if (match && req.method==='GET') { try { json(res,200,await deps.list(decodeURIComponent(match[1]!))); } catch(e) { handleError(res,e); } return true; }
  if (match && req.method==='POST' && match[0].endsWith('session-profiles')) {
    let body:unknown; try { body=await bodyJson(req); } catch(e) { fail(res,400,String((e as Error).message)); return true; }
    try { json(res,201,await deps.add(decodeURIComponent(match[1]!),body)); } catch(e) { handleError(res,e); } return true;
  }
  if (select && req.method==='PUT') {
    let body:unknown; try { body=await bodyJson(req); } catch(e) { fail(res,400,String((e as Error).message)); return true; }
    if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>k!=='profileId') || !('profileId' in body) || ((body as any).profileId!==null && typeof (body as any).profileId!=='string')) { fail(res,400,'profileId 必须是档案 ID 或 null。'); return true; }
    try { json(res,200,await deps.select(decodeURIComponent(select[1]!), (body as any).profileId)); } catch(e) { handleError(res,e); } return true;
  }
  return false;
}
