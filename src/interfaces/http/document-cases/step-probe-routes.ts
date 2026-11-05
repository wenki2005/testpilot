import type { IncomingMessage, ServerResponse } from 'node:http';
import { documentBody, fail, json } from '../shared/http-utils.js';
import type { DocumentProject } from '../../../domain/documents/shared/test-model.js';
export interface DocumentStepProbeRouteDependencies {
    getProject(projectId: string): Promise<DocumentProject | undefined>;
    probe(project: DocumentProject, caseId: string, stepIndex: number, targetUrl: string): Promise<unknown>;
}
export async function handleDocumentStepProbeRoute(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentStepProbeRouteDependencies): Promise<boolean> {
    const route = pathname.match(/^\/api\/document-projects\/([^/]+)\/probe-step$/u);
    if (req.method !== 'POST' || !route)
        return false;
    const project = await deps.getProject(decodeURIComponent(route[1]!));
    if (!project) {
        fail(res, 404, '文档测试项目不存在。');
        return true;
    }
    let data: unknown;
    try {
        data = await documentBody(req);
    }
    catch (error) {
        fail(res, 400, String((error as Error).message));
        return true;
    }
    const input = data as {
        caseId?: unknown;
        stepIndex?: unknown;
        siteVersionId?: unknown;
    } | null;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['caseId', 'stepIndex', 'siteVersionId'].includes(key)) || typeof input.caseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(input.caseId) || !Number.isInteger(input.stepIndex) || (input.stepIndex as number) < 0 || (input.stepIndex as number) > 99 || input.siteVersionId !== undefined && (typeof input.siteVersionId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(input.siteVersionId))) {
        fail(res, 400, '试定位需要有效的用例 ID、0–99 的步骤序号和可选网站版本 ID。');
        return true;
    }
    const selectedVersion = input.siteVersionId
        ? project.siteVersions?.find(item => item.id === input.siteVersionId)
        : project.siteVersions?.find(item => item.id === project.activeSiteVersionId);
    if (input.siteVersionId && !selectedVersion) {
        fail(res, 422, '试定位的网站版本不属于当前项目。');
        return true;
    }
    try {
        json(res, 200, await deps.probe(project, input.caseId, input.stepIndex as number, selectedVersion?.targetUrl ?? project.targetUrl));
    }
    catch (error) {
        fail(res, 422, error instanceof Error ? error.message : '试定位请求无效。');
    }
    return true;
}
