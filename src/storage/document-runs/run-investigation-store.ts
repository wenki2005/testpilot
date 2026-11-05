import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentRunInvestigationRecord } from '../../application/runs/results/investigation-service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const runKey = (id: string) => createHash('sha256').update(id).digest('hex');
function valid(value: unknown): value is DocumentRunInvestigationRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as DocumentRunInvestigationRecord;
  if (typeof r.id !== 'string' || !uuid.test(r.id) || typeof r.runId !== 'string' || !r.runId
    || typeof r.projectId !== 'string' || !r.projectId || typeof r.runDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(r.runDigest)
    || r.provisional !== true || !['complete', 'partial'].includes(r.coverage) || typeof r.createdAt !== 'string'
    || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.facts) || !r.facts.length || !Array.isArray(r.hypotheses) || !r.hypotheses.length) return false;
  if (r.facts.some(f => !f || typeof f.factId !== 'string' || typeof f.caseId !== 'string' || typeof f.text !== 'string'
    || !['result', 'step-log', 'frozen-expected', 'evidence-metadata', 'comparison'].includes(f.kind))
    || new Set(r.facts.map(f => f.factId)).size !== r.facts.length) return false;
  return r.hypotheses.every(h => h && typeof h.caseId === 'string' && ['product', 'test', 'environment', 'unknown'].includes(h.category)
    && typeof h.summary === 'string' && Boolean(h.summary.trim()) && typeof h.nextAction === 'string' && Boolean(h.nextAction.trim())
    && Array.isArray(h.evidence) && (h.category === 'unknown' || h.evidence.length > 0)
    && h.evidence.every(ref => ref && typeof ref.factId === 'string' && typeof ref.quote === 'string' && Boolean(ref.quote.trim())
      && r.facts.some(f => f.factId === ref.factId && f.caseId === h.caseId && f.text.includes(ref.quote))));
}

/** Each saved investigation is a separate advisory revision; original runs are never rewritten. */
export function createDocumentRunInvestigationStore(directory: string) {
  return {
    async save(record: DocumentRunInvestigationRecord) {
      if (!valid(record)) throw new Error('调查记录无效，未保存。');
      const folder = path.join(directory, runKey(record.runId));
      await mkdir(folder, { recursive: true });
      const destination = path.join(folder, `${record.id}.json`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    },
    async getLatest(runId: string): Promise<DocumentRunInvestigationRecord | null> {
      const folder = path.join(directory, runKey(runId));
      const names = await readdir(folder).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
      const records: DocumentRunInvestigationRecord[] = [];
      for (const name of names) {
        if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
        let value: unknown;
        try { value = JSON.parse(await readFile(path.join(folder, name), 'utf8')); }
        catch (error) { if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (valid(value) && value.id === name.slice(0, -5) && value.runId === runId) records.push(value);
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    },
  };
}
