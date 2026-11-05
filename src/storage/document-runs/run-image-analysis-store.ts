import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentRunImageAnalysis, DocumentRunImageAnalysisRepository } from '../../application/runs/results/image-analysis-service.js';
export function createDocumentRunImageAnalysisStore(directory: string): DocumentRunImageAnalysisRepository {
    const file = (runId: string, evidenceId: string) => path.join(directory, `${Buffer.from(JSON.stringify([runId, evidenceId])).toString('hex')}.json`);
    return {
        async get(runId, evidenceId, imageSha256) {
            try {
                const rows = JSON.parse(await readFile(file(runId, evidenceId), 'utf8')) as DocumentRunImageAnalysis[];
                return [...rows].reverse().find(row => row.imageSha256 === imageSha256) ?? null;
            }
            catch {
                return null;
            }
        },
        async save(record) {
            await mkdir(directory, { recursive: true });
            const target = file(record.runId, record.evidenceId);
            let rows: DocumentRunImageAnalysis[] = [];
            try {
                rows = JSON.parse(await readFile(target, 'utf8')) as DocumentRunImageAnalysis[];
            }
            catch { /* first analysis */ }
            rows.push(record);
            await writeFile(target, JSON.stringify(rows, null, 2), { flag: 'w' });
        },
    };
}
