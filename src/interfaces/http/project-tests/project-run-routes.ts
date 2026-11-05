import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';
import type { ProjectProfileSummary, ProjectRunView } from '../../../domain/projects/profile-contract.js';
export type { ProjectProfileSummary, ProjectRunView } from '../../../domain/projects/profile-contract.js';
export interface ProjectRunRouteDependencies {
    runs: Map<string, ProjectRunView>;
    controllers: Map<string, AbortController>;
    profiles: ProjectProfileSummary[];
    isRunActive(): boolean;
    launch(profileId: string): Promise<ProjectRunView>;
    persist(run: ProjectRunView): Promise<void>;
    readArtifact(runId: string, relativePath: string): Promise<Buffer>;
    readReport(runId: string, recordRunId: string, format: 'md' | 'json'): Promise<Buffer>;
}
/** HTTP adapter for project-profile execution history and its downloaded evidence. */
export async function handleProjectRunRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, searchParams: URLSearchParams, deps: ProjectRunRouteDependencies): Promise<boolean> {
    if (req.method === 'GET' && pathname === '/api/project-runs') {
        json(res, 200, [...deps.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
        return true;
    }
    if (req.method === 'POST' && pathname === '/api/project-runs') {
        let data: unknown;
        try {
            data = await bodyJson(req);
        }
        catch (error) {
            fail(res, 400, String((error as Error).message));
            return true;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || typeof (data as {
            profileId?: unknown;
        }).profileId !== 'string') {
            fail(res, 400, 'body must contain only a registered profileId');
            return true;
        }
        const profileId = (data as {
            profileId: string;
        }).profileId;
        if (!deps.profiles.some(profile => profile.id === profileId)) {
            fail(res, 404, 'project profile is not registered');
            return true;
        }
        if (deps.isRunActive()) {
            fail(res, 409, 'another test run is already active');
            return true;
        }
        try {
            json(res, 202, await deps.launch(profileId));
        }
        catch (error) {
            fail(res, 500, error instanceof Error ? error.message : String(error));
        }
        return true;
    }
    const cancel = pathname.match(/^\/api\/project-runs\/([^/]+)\/cancel$/u);
    if (req.method === 'POST' && cancel) {
        let id: string;
        try {
            id = decodeURIComponent(cancel[1]!);
        }
        catch {
            fail(res, 400, 'invalid project run id');
            return true;
        }
        const run = deps.runs.get(id);
        if (!run) {
            fail(res, 404, 'project run not found');
            return true;
        }
        if (['queued', 'running'].includes(run.status)) {
            run.summary = '已请求取消运行，正在清理临时副本。';
            deps.controllers.get(run.id)?.abort(new Error('cancelled'));
            await deps.persist(run);
        }
        json(res, 200, run);
        return true;
    }
    const artifact = pathname.match(/^\/api\/project-runs\/([^/]+)\/artifacts\/(.+)$/u);
    if (req.method === 'GET' && artifact) {
        let id: string;
        let artifactPath: string;
        try {
            id = decodeURIComponent(artifact[1]!);
            artifactPath = decodeURIComponent(artifact[2]!);
        }
        catch {
            fail(res, 400, 'invalid artifact path');
            return true;
        }
        const run = deps.runs.get(id);
        if (!run) {
            fail(res, 404, 'project run not found');
            return true;
        }
        const normalized = artifactPath.split('\\').join('/');
        if (!run.artifactFiles.includes(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
            fail(res, 404, 'artifact not found');
            return true;
        }
        try {
            const content = await deps.readArtifact(id, normalized);
            const name = normalized.split('/').at(-1)!.replace(/["\r\n]/gu, '_');
            const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
            const contentType: Record<string, string> = { '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
            res.writeHead(200, { 'content-type': contentType[ext] ?? 'application/octet-stream', 'content-length': content.byteLength, 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' });
            res.end(content);
        }
        catch {
            fail(res, 404, 'artifact not found');
        }
        return true;
    }
    const report = pathname.match(/^\/api\/project-runs\/([^/]+)\/report$/u);
    if (req.method === 'GET' && report) {
        let id: string;
        try {
            id = decodeURIComponent(report[1]!);
        }
        catch {
            fail(res, 400, 'invalid project run id');
            return true;
        }
        const run = deps.runs.get(id);
        if (!run) {
            fail(res, 404, 'project run not found');
            return true;
        }
        const format = searchParams.get('format') ?? 'md';
        if (format !== 'md' && format !== 'json') {
            fail(res, 400, 'format must be md or json');
            return true;
        }
        if (!run.recordRunId) {
            fail(res, 409, 'normalized report is not ready yet');
            return true;
        }
        try {
            const content = await deps.readReport(id, run.recordRunId, format);
            res.writeHead(200, { 'content-type': format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="project-${id}.${format}"` });
            res.end(content);
        }
        catch {
            fail(res, 409, 'normalized report is not ready yet');
        }
        return true;
    }
    const detail = pathname.match(/^\/api\/project-runs\/([^/]+)$/u);
    if (req.method === 'GET' && detail) {
        let id: string;
        try {
            id = decodeURIComponent(detail[1]!);
        }
        catch {
            fail(res, 400, 'invalid project run id');
            return true;
        }
        const run = deps.runs.get(id);
        run ? json(res, 200, run) : fail(res, 404, 'project run not found');
        return true;
    }
    return false;
}
