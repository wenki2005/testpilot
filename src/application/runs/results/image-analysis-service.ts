import { createHash, randomUUID } from 'node:crypto';
import type { DocumentRun } from '../../../domain/documents/shared/test-model.js';
export type DocumentRunImageAnalysis = {
    id: string;
    runId: string;
    projectId: string;
    evidenceId: string;
    imageSha256: string;
    createdAt: string;
    status: 'complete' | 'blocked';
    observations: string[];
    uncertainty: string;
    provisional: true;
};
export interface DocumentRunImageAnalysisRepository {
    get(runId: string, evidenceId: string, imageSha256: string): Promise<DocumentRunImageAnalysis | null>;
    save(record: DocumentRunImageAnalysis): Promise<void>;
}
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function createDocumentRunImageAnalysisService(deps: {
    getRun(runId: string): Promise<DocumentRun | undefined>;
    readEvidence(runId: string, evidenceId: string): Promise<Uint8Array>;
    evaluate(input: {
        runId: string;
        projectId: string;
        evidenceId: string;
        imageSha256: string;
        pngBase64: string;
    }): Promise<{
        observations: string[];
        uncertainty: string;
    }>;
    repository: DocumentRunImageAnalysisRepository;
    redactText(text: string): string;
    now?: () => string;
}) {
    const inflight = new Map<string, Promise<DocumentRunImageAnalysis>>();
    return {
        async get(runId: string, evidenceId: string) {
            const { run, digest } = await load(runId, evidenceId);
            const prior = await deps.repository.get(runId, evidenceId, digest);
            return prior && prior.runId === run.id && prior.projectId === run.projectId && prior.evidenceId === evidenceId && prior.imageSha256 === digest && prior.provisional === true ? prior : null;
        },
        async analyze(runId: string, evidenceId: string) {
            const key = JSON.stringify([runId, evidenceId]);
            const active = inflight.get(key);
            if (active)
                return active;
            const task = analyzeOnce(runId, evidenceId).finally(() => inflight.delete(key));
            inflight.set(key, task);
            return task;
        },
    };
    async function analyzeOnce(runId: string, evidenceId: string) {
        const { run, bytes, digest } = await load(runId, evidenceId);
        const prior = await deps.repository.get(runId, evidenceId, digest);
        if (prior && prior.runId === run.id && prior.projectId === run.projectId && prior.evidenceId === evidenceId && prior.imageSha256 === digest && prior.provisional === true && prior.status === 'complete')
            return prior;
        let result: {
            observations: string[];
            uncertainty: string;
        };
        let status: DocumentRunImageAnalysis['status'] = 'complete';
        try {
            result = await deps.evaluate({ runId, projectId: run.projectId!, evidenceId, imageSha256: digest, pngBase64: Buffer.from(bytes).toString('base64') });
            if (!result || !Array.isArray(result.observations) || result.observations.length > 30 || result.observations.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000) || typeof result.uncertainty !== 'string' || !result.uncertainty.trim() || result.uncertainty.length > 2000)
                throw new Error('invalid vision result');
        }
        catch {
            status = 'blocked';
            result = { observations: [], uncertainty: '视觉模型未提供有效分析；请检查模型是否支持图片输入及其配置。' };
        }
        const record: DocumentRunImageAnalysis = { id: randomUUID(), runId, projectId: run.projectId!, evidenceId, imageSha256: digest, createdAt: (deps.now ?? (() => new Date().toISOString()))(), status, observations: result.observations.map(value => deps.redactText(value).slice(0, 1000)), uncertainty: deps.redactText(result.uncertainty).slice(0, 2000), provisional: true };
        await deps.repository.save(record);
        return record;
    }
    async function load(runId: string, evidenceId: string) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId) || !/^[0-9a-f-]{36}$/iu.test(evidenceId))
            throw new Error('invalid evidence reference');
        const run = await deps.getRun(runId);
        const evidence = run?.evidence?.find(item => item.evidenceId === evidenceId && item.type === 'screenshot');
        if (!run || !run.projectId || !evidence || !evidence.sha256)
            throw new Error('screenshot evidence unavailable');
        const bytes = await deps.readEvidence(runId, evidenceId);
        const png = Buffer.from(bytes);
        if (bytes.byteLength > MAX_PNG_BYTES || bytes.byteLength < 45 || !png.subarray(0, 8).equals(PNG_SIGNATURE)
            || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' || png.subarray(-8, -4).toString('ascii') !== 'IEND')
            throw new Error('screenshot PNG invalid or too large');
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== evidence.sha256)
            throw new Error('screenshot digest mismatch');
        return { run, bytes, digest };
    }
}
