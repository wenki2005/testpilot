import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json, migrationBody } from './http-utils.js';

export interface SqliteMigrationRouteDependencies {
  listCandidates(): Promise<unknown>;
  createCandidate(suite: unknown, files: unknown): Promise<unknown>;
  updateCandidate(id: string, suite: unknown, files: unknown): Promise<unknown>;
  reviewCandidate(id: string, decision: 'approve' | 'reject', notes: string): Promise<unknown>;
  executeApproved(id: string): Promise<{ record: unknown }>;
  readArtifact(id: string, fileName: string): Promise<Buffer | undefined>;
  getRun(id: string): Promise<unknown | undefined>;
  getCandidate(id: string): Promise<unknown | undefined>;
}

/** HTTP adapter for SQLite migration candidate review, execution, and evidence. */
export async function handleSqliteMigrationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: SqliteMigrationRouteDependencies,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/sqlite-migration-suites') {
    json(res, 200, await deps.listCandidates());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/sqlite-migration-suites') {
    let data: any;
    try { data = await migrationBody(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!isSuiteFilesPayload(data)) { fail(res, 400, 'A migration candidate requires exactly suite and files fields.'); return true; }
    try { json(res, 201, await deps.createCandidate(data.suite, data.files)); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : 'SQLite migration suite is invalid.'); }
    return true;
  }

  const update = pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/update$/u);
  if (req.method === 'POST' && update) {
    let data: any;
    try { data = await migrationBody(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!isSuiteFilesPayload(data)) { fail(res, 400, 'An update requires exactly suite and files fields.'); return true; }
    try { json(res, 200, await deps.updateCandidate(decodeURIComponent(update[1]!), data.suite, data.files)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'SQLite migration suite revision failed.'); }
    return true;
  }

  const review = pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/review$/u);
  if (req.method === 'POST' && review) {
    let data: any;
    try { data = await bodyJson(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['decision', 'notes'].includes(key)) || !['approve', 'reject'].includes(data.decision) || typeof data.notes !== 'string' || data.notes.length > 2000) {
      fail(res, 400, 'Review requires decision=approve/reject and notes up to 2000 characters.'); return true;
    }
    try { json(res, 200, await deps.reviewCandidate(decodeURIComponent(review[1]!), data.decision, data.notes)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'SQLite migration review failed.'); }
    return true;
  }

  const runAction = pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/run$/u);
  if (req.method === 'POST' && runAction) {
    let data: any;
    try { data = await bodyJson(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) { fail(res, 400, 'SQLite migration runs do not accept execution options.'); return true; }
    try { json(res, 201, (await deps.executeApproved(decodeURIComponent(runAction[1]!))).record); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : 'SQLite migration suite execution failed.'); }
    return true;
  }

  const artifactRoute = pathname.match(/^\/api\/sqlite-migration-runs\/([^/]+)\/(report|package)$/u);
  if (req.method === 'GET' && artifactRoute) {
    const id = decodeURIComponent(artifactRoute[1]!);
    const name = artifactRoute[2] === 'report' ? 'report.md' : 'testpilot-sqlite-migration-suite.zip';
    const artifact = await deps.readArtifact(id, name);
    if (!artifact) { fail(res, 404, 'SQLite migration run artifact does not exist.'); return true; }
    const zip = name.endsWith('.zip');
    res.writeHead(200, {
      'content-type': zip ? 'application/zip' : 'text/markdown; charset=utf-8',
      'content-length': artifact.length,
      'content-disposition': `attachment; filename="testpilot-${id}.${zip ? 'zip' : 'md'}"`,
      'cache-control': 'no-store',
    });
    res.end(artifact);
    return true;
  }

  const runRoute = pathname.match(/^\/api\/sqlite-migration-runs\/([^/]+)$/u);
  if (req.method === 'GET' && runRoute) {
    const run = await deps.getRun(decodeURIComponent(runRoute[1]!));
    run ? json(res, 200, run) : fail(res, 404, 'SQLite migration run does not exist.');
    return true;
  }

  const candidateRoute = pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)$/u);
  if (req.method === 'GET' && candidateRoute) {
    const candidate = await deps.getCandidate(decodeURIComponent(candidateRoute[1]!));
    candidate ? json(res, 200, candidate) : fail(res, 404, 'SQLite migration suite candidate does not exist or failed validation.');
    return true;
  }

  return false;
}

function isSuiteFilesPayload(value: unknown): value is { suite: unknown; files: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some(key => !['suite', 'files'].includes(key))
    && Object.hasOwn(value, 'suite') && Object.hasOwn(value, 'files'));
}
