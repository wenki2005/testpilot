import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from '../shared/http-utils.js';
import type { DocumentRun } from '../../../domain/documents/shared/test-model.js';
export interface DocumentRunRouteDependencies {
    getRun(runId: string): Promise<DocumentRun | undefined>;
    getProgress(runId: string): Promise<unknown | undefined>;
    cancelRun(runId: string): Promise<'requested' | 'already-terminal' | string>;
    pauseRun(runId: string): Promise<string>;
    continueRun(runId: string): Promise<string>;
    cancelWorkflow(workflowId: string, reason: string): Promise<unknown>;
    retryPackaging(runId: string): Promise<DocumentRun>;
    readPackage(runId: string): Promise<Uint8Array>;
    readEvidence(runId: string, evidenceId: string): Promise<Uint8Array>;
}
export async function handleDocumentRunRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentRunRouteDependencies): Promise<boolean> {
    const finalize = pathname.match(/^\/api\/document-runs\/([^/]+)\/finalize-package$/u);
    if (req.method === 'POST' && finalize) {
        try {
            json(res, 200, await deps.retryPackaging(decodeURIComponent(finalize[1]!)));
        }
        catch (error) {
            fail(res, 409, error instanceof Error ? error.message : '无法完成本轮报告和脚本包。');
        }
        return true;
    }
    const artifact = pathname.match(/^\/api\/document-runs\/([^/]+)\/(report|package)$/u);
    if (req.method === 'GET' && artifact) {
        const id = decodeURIComponent(artifact[1]!);
        const run = await deps.getRun(id);
        if (!run) {
            fail(res, 404, '文档测试运行不存在。');
            return true;
        }
        if (artifact[2] === 'package') {
            if (!run.packageReady && !run.packagePath) {
                fail(res, 409, '本轮尚无可复用脚本包。');
                return true;
            }
            let bytes: Uint8Array;
            try {
                bytes = await deps.readPackage(id);
            }
            catch {
                fail(res, 404, '本轮记录了脚本包，但 ZIP 文件缺失或不可读取；请重新运行以重新生成脚本包。');
                return true;
            }
            res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="testpilot-${id}.zip"`, 'content-length': bytes.byteLength });
            res.end(bytes);
            return true;
        }
        if (!run.reportReady && !run.report) {
            fail(res, 409, '本轮报告尚未生成。');
            return true;
        }
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="testpilot-${id}.md"` });
        res.end(run.report);
        return true;
    }
    const evidence = pathname.match(/^\/api\/document-runs\/([^/]+)\/evidence\/([^/]+)$/u);
    if (req.method === 'GET' && evidence) {
        const runId = decodeURIComponent(evidence[1]!);
        const evidenceId = decodeURIComponent(evidence[2]!);
        const run = await deps.getRun(runId);
        if (!run) {
            fail(res, 404, '文档测试运行不存在。');
            return true;
        }
        if (!run.evidence?.some(item => item.evidenceId === evidenceId && item.type === 'screenshot')) {
            fail(res, 404, '本轮没有这份可读取截图。');
            return true;
        }
        try {
            const bytes = await deps.readEvidence(runId, evidenceId);
            res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': `inline; filename="testpilot-${evidenceId}.png"`, 'content-length': bytes.byteLength, 'cache-control': 'private, max-age=0, must-revalidate' });
            res.end(bytes);
        }
        catch {
            fail(res, 404, '截图证据不存在、校验失败或不可读取。');
        }
        return true;
    }
    const detail = pathname.match(/^\/api\/document-runs\/([^/]+)$/u);
    if (req.method === 'GET' && detail) {
        const run = await deps.getRun(decodeURIComponent(detail[1]!));
        run ? json(res, 200, run) : fail(res, 404, '文档测试运行不存在。');
        return true;
    }
    const progressRoute = pathname.match(/^\/api\/document-runs\/([^/]+)\/progress$/u);
    if (req.method === 'GET' && progressRoute) {
        const progress = await deps.getProgress(decodeURIComponent(progressRoute[1]!));
        progress ? json(res, 200, progress) : fail(res, 404, '文档测试运行不存在。可能尚未启动，或记录已清理。');
        return true;
    }
    const cancelRoute = pathname.match(/^\/api\/document-runs\/([^/]+)\/cancel$/u);
    if (req.method === 'POST' && cancelRoute) {
        const runId = decodeURIComponent(cancelRoute[1]!);
        const progress = await deps.getProgress(runId) as {
            workflowId?: string;
        } | undefined;
        if (!progress) {
            fail(res, 404, '文档测试运行不存在或尚未启动。');
            return true;
        }
        try {
            const status = await deps.cancelRun(runId);
            if (status === 'requested' && progress.workflowId)
                await deps.cancelWorkflow(progress.workflowId, '文档测试运行由用户手动停止。');
            json(res, status === 'requested' ? 202 : 200, { runId, status });
        }
        catch (error) {
            fail(res, 409, error instanceof Error ? error.message : '无法停止当前运行。');
        }
        return true;
    }
    const pauseRoute = pathname.match(/^\/api\/document-runs\/([^/]+)\/(pause|continue)$/u);
    if (req.method === 'POST' && pauseRoute) {
        const runId = decodeURIComponent(pauseRoute[1]!);
        const status = pauseRoute[2] === 'pause' ? await deps.pauseRun(runId) : await deps.continueRun(runId);
        const accepted = status === 'requested' || status === 'continued';
        json(res, accepted ? 202 : status === 'not-active' || status === 'context-lost' ? 409 : 200, { runId, status, message: status === 'requested' ? '暂停将在当前步骤安全完成后生效。' : status === 'continued' ? '运行已从当前页面会话继续。' : status === 'context-lost' ? '页面或运行上下文已变化；已阻断继续。' : undefined });
        return true;
    }
    return false;
}
