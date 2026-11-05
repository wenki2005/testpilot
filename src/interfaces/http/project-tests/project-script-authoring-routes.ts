import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, documentBody, fail, json } from '../shared/http-utils.js';
import type { ProjectProfileSummary } from './project-run-routes.js';
import type { ProjectScriptVersion, ProjectScriptView } from './project-script-routes.js';
import type { GrammarStep } from '../../../adapters/exports/generated-test-script.js';

export interface ProjectScriptAuthoringDependencies {
  profiles: ProjectProfileSummary[];
  scripts: Map<string, ProjectScriptVersion>;
  modelAvailable(): boolean;
  extractDocument(fileName: string, bytes: Buffer): Promise<{ text: string }>;
  generateCandidate(requirement: string): Promise<{ title: string; summary: string; steps: GrammarStep[] }>;
  createCandidate(profileId: string, generated?: { requirement: string; title: string; summary: string; steps: GrammarStep[] }): Promise<ProjectScriptView>;
}

/** Request adapter for local profile snapshots and optional AI generated candidates. */
export async function handleProjectScriptAuthoringRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  deps: ProjectScriptAuthoringDependencies,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/project-profiles') {
    json(res, 200, deps.profiles);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/project-scripts/candidates') {
    let data: unknown;
    try { data = await bodyJson(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || typeof (data as { profileId?: unknown }).profileId !== 'string') {
      fail(res, 400, 'body must contain only a registered profileId'); return true;
    }
    const profileId = (data as { profileId: string }).profileId;
    if (!deps.profiles.some(profile => profile.id === profileId)) { fail(res, 404, 'project profile is not registered'); return true; }
    try { json(res, 201, await deps.createCandidate(profileId)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : String(error)); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/project-scripts/ai-candidates') {
    let data: unknown;
    try { data = await documentBody(req); }
    catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    if (!isAuthoringRequest(data)) {
      fail(res, 400, 'need a registered profile, a requirement (up to 2000 characters), and an optional supported document up to 9 MB'); return true;
    }
    if (!deps.profiles.some(profile => profile.id === data.profileId)) { fail(res, 404, 'project profile is not registered'); return true; }
    if (!deps.modelAvailable()) { fail(res, 409, 'AI authoring requires a configured model provider'); return true; }
    if ([...deps.scripts.values()].some(item => item.profileId === data.profileId && item.status === 'candidate')) {
      fail(res, 409, 'review the existing candidate before authoring another'); return true;
    }
    try {
      let requirement = data.requirement.trim();
      if (typeof data.bytesBase64 === 'string') {
        if (typeof data.fileName !== 'string') { fail(res, 400, 'fileName is required with document bytes'); return true; }
        const bytes = Buffer.from(data.bytesBase64, 'base64');
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) { fail(res, 400, 'document must be non-empty and no larger than 9 MB'); return true; }
        const document = await deps.extractDocument(data.fileName, bytes);
        requirement = `${requirement}\n\n需求资料摘录：\n${document.text.slice(0, Math.max(0, 12_000 - requirement.length))}`;
        if (requirement.length < 8) requirement = `请根据以下需求资料为项目整理关键测试场景：\n${document.text.slice(0, 12_000)}`;
      }
      const generated = await deps.generateCandidate(requirement);
      json(res, 201, await deps.createCandidate(data.profileId, { requirement, ...generated }));
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
    return true;
  }

  return false;
}

function isAuthoringRequest(value: unknown): value is { profileId: string; requirement: string; fileName?: string; bytesBase64?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return !Object.keys(data).some(key => !['profileId', 'requirement', 'fileName', 'bytesBase64'].includes(key))
    && typeof data.profileId === 'string' && typeof data.requirement === 'string'
    && (data.requirement.trim().length >= 8 || typeof data.bytesBase64 === 'string') && data.requirement.length <= 2000
    && (data.fileName === undefined || typeof data.fileName === 'string')
    && (data.bytesBase64 === undefined || typeof data.bytesBase64 === 'string' && data.bytesBase64.length <= 13_000_000);
}
