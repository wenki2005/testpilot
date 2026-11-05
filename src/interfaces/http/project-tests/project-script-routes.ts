import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';
import type { ProjectScriptVersion, ProjectScriptView } from '../../../domain/projects/script-contract.js';
export type { ProjectScriptVersion, ProjectScriptView } from '../../../domain/projects/script-contract.js';
export interface ProjectScriptRouteDependencies {
    scripts: Map<string, ProjectScriptVersion>;
    view(script: ProjectScriptVersion): ProjectScriptView;
    persist(): Promise<void>;
    isRunActive(): boolean;
    launchApproved(script: ProjectScriptVersion): Promise<unknown>;
}
/** HTTP adapter for versioned local profile scripts, review decisions, and approved execution. */
export function handleProjectScriptRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: ProjectScriptRouteDependencies): boolean | Promise<boolean> {
    if (req.method === 'GET' && pathname === '/api/project-scripts') {
        json(res, 200, [...deps.scripts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(deps.view));
        return true;
    }
    const review = pathname.match(/^\/api\/project-scripts\/([^/]+)\/review$/u);
    if (req.method === 'POST' && review)
        return reviewProjectScript(req, res, review[1]!, deps);
    const run = pathname.match(/^\/api\/project-scripts\/([^/]+)\/run$/u);
    if (req.method === 'POST' && run)
        return runProjectScript(res, run[1]!, deps);
    return false;
}
async function reviewProjectScript(req: IncomingMessage, res: ServerResponse, encodedId: string, deps: ProjectScriptRouteDependencies): Promise<boolean> {
    let id: string;
    try {
        id = decodeURIComponent(encodedId);
    }
    catch {
        fail(res, 400, 'invalid script candidate id');
        return true;
    }
    const script = deps.scripts.get(id);
    if (!script) {
        fail(res, 404, 'script candidate not found');
        return true;
    }
    let data: unknown;
    try {
        data = await bodyJson(req);
    }
    catch (error) {
        fail(res, 400, String((error as Error).message));
        return true;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        fail(res, 400, 'review requires decision approve/reject and optional notes (up to 2000 characters)');
        return true;
    }
    const value = data as {
        decision?: unknown;
        notes?: unknown;
    };
    const decision = value.decision;
    const notes = value.notes;
    if (Object.keys(value).some(key => !['decision', 'notes'].includes(key)) || (decision !== 'approve' && decision !== 'reject')
        || (notes !== undefined && typeof notes !== 'string') || (typeof notes === 'string' && notes.length > 2000)) {
        fail(res, 400, 'review requires decision approve/reject and optional notes (up to 2000 characters)');
        return true;
    }
    if (script.status !== 'candidate') {
        fail(res, 409, 'only a candidate version can be reviewed');
        return true;
    }
    script.status = decision === 'approve' ? 'approved' : 'rejected';
    script.reviewDecision = decision;
    script.reviewedAt = new Date().toISOString();
    script.reviewerNotes = (notes as string | undefined ?? '').trim();
    await deps.persist();
    json(res, 200, deps.view(script));
    return true;
}
async function runProjectScript(res: ServerResponse, encodedId: string, deps: ProjectScriptRouteDependencies): Promise<boolean> {
    let id: string;
    try {
        id = decodeURIComponent(encodedId);
    }
    catch {
        fail(res, 400, 'invalid approved script id');
        return true;
    }
    const script = deps.scripts.get(id);
    if (!script) {
        fail(res, 404, 'approved script not found');
        return true;
    }
    if (script.status !== 'approved') {
        fail(res, 409, 'only an approved script version can run');
        return true;
    }
    if (deps.isRunActive()) {
        fail(res, 409, 'another test run is already active');
        return true;
    }
    try {
        json(res, 202, await deps.launchApproved(script));
    }
    catch (error) {
        fail(res, 500, error instanceof Error ? error.message : String(error));
    }
    return true;
}
