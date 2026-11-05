import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';
import { renderDocumentRunInvestigationMarkdown } from '../../../reporters/document-run-investigation-report.js';
import { redactSensitiveExportData } from '../../../adapters/documents/evidence/sensitive-data.js';
export async function handleDocumentRunInvestigationRoutes(req: IncomingMessage, res: ServerResponse, url: URL, service: {
    investigate(runId: string): Promise<unknown>;
    get(runId: string): Promise<unknown | null>;
    isInvestigating?(runId: string): boolean;
    imageAnalysis?: {
        get(runId: string, evidenceId: string): Promise<unknown>;
        analyze(runId: string, evidenceId: string): Promise<unknown>;
    };
}): Promise<boolean> {
    const imageMatch = url.pathname.match(/^\/api\/document-runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/evidence\/([0-9a-f-]{36})\/image-analysis$/iu);
    if (imageMatch) {
        if (!service.imageAnalysis) {
            fail(res, 503, '截图视觉分析服务不可用。');
            return true;
        }
        const [, runId, evidenceId] = imageMatch;
        if (req.method === 'GET') {
            res.setHeader('cache-control', 'no-store');
            try {
                const result = await service.imageAnalysis.get(runId!, evidenceId!);
                result ? json(res, 200, result) : fail(res, 404, '该截图尚无视觉分析记录。');
            }
            catch {
                fail(res, 422, '无法读取该截图的视觉分析。');
            }
            return true;
        }
        if (req.method !== 'POST') {
            fail(res, 405, 'method not allowed');
            return true;
        }
        let body: unknown;
        try {
            body = await bodyJson(req);
        }
        catch {
            fail(res, 400, '确认请求格式无效。');
            return true;
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || (body as {
            confirm?: unknown;
        }).confirm !== true) {
            fail(res, 400, '必须明确确认将此截图发送给当前配置的视觉模型。');
            return true;
        }
        try {
            json(res, 200, await service.imageAnalysis.analyze(runId!, evidenceId!));
        }
        catch {
            fail(res, 422, '截图视觉分析失败或被阻断；请检查截图完整性和视觉模型能力配置。');
        }
        return true;
    }
    const match = url.pathname.match(/^\/api\/document-runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/investigation$/u);
    const reportMatch = url.pathname.match(/^\/api\/document-runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/investigation\/report$/u);
    if (reportMatch) {
        if (req.method !== 'GET') {
            fail(res, 405, 'method not allowed');
            return true;
        }
        const runId = reportMatch[1]!;
        if (service.isInvestigating?.(runId)) {
            json(res, 202, { state: 'running' });
            return true;
        }
        try {
            const record = await service.get(runId);
            if (!record) {
                fail(res, 404, '该运行尚无已保存的调查结论。');
                return true;
            }
            const body = renderDocumentRunInvestigationMarkdown(redactSensitiveExportData(record) as import('../../../application/runs/results/investigation-service.js').DocumentRunInvestigationRecord);
            res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-length': Buffer.byteLength(body), 'content-disposition': `attachment; filename="investigation-${runId}.md"`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
            res.end(body);
        }
        catch {
            fail(res, 503, '暂时无法读取已保存的调查报告。');
        }
        return true;
    }
    if (!match)
        return false;
    try {
        if (req.method === 'GET') {
            if (service.isInvestigating?.(match[1]!)) {
                json(res, 202, { state: 'running' });
                return true;
            }
            const record = await service.get(match[1]!);
            if (record)
                json(res, 200, record);
            else
                fail(res, 404, '该运行尚无已保存的调查结论。');
        }
        else if (req.method === 'POST') {
            let body: unknown;
            try {
                body = await bodyJson(req);
            }
            catch {
                fail(res, 400, '调查请求需要空的 JSON 对象。');
                return true;
            }
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
                fail(res, 400, '调查只使用当前运行已保存的证据，不接受替换事实或测试结果。');
                return true;
            }
            json(res, 200, await service.investigate(match[1]!));
        }
        else
            fail(res, 405, 'method not allowed');
    }
    catch {
        fail(res, req.method === 'GET' ? 503 : 422, '暂时无法形成有效调查结论；原运行结果不变，请检查已保存证据和模型配置。');
    }
    return true;
}
