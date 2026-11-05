import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AutonomousPlanRepository, SavedAutonomousPlan } from '../../application/cases/document-autonomous-plan-service.js';

const safeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function valid(value: unknown): value is SavedAutonomousPlan {
  if (!value || typeof value !== 'object') return false;
  const record = value as SavedAutonomousPlan;
  return typeof record.id === 'string' && safeId.test(record.id) && typeof record.projectId === 'string'
    && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt))
    && typeof record.contextDigest === 'string' && /^[a-f0-9]{64}$/u.test(record.contextDigest)
    && typeof record.siteVersionId === 'string' && typeof record.targetUrlSnapshot === 'string'
    && Array.isArray(record.blockers) && record.blockers.every(item => typeof item === 'string')
    && record.plan?.projectId === record.projectId && record.plan.execution === 'not-started'
    && Array.isArray(record.plan.orderedCaseIds) && Array.isArray(record.plan.selectedCaseIds)
    && validOutcome(record.plan);
}
function validOutcome(plan: SavedAutonomousPlan['plan']): boolean {
  const outcome = plan.outcome === undefined ? 'selected' : plan.outcome;
  if (outcome === 'selected') return plan.selectedCaseIds.length > 0 && plan.orderedCaseIds.length > 0;
  if (!['no-relevant-cases', 'needs-clarification'].includes(outcome)) return false;
  return plan.selectedCaseIds.length === 0 && plan.orderedCaseIds.length === 0
    && Array.isArray(plan.prerequisiteCaseIds) && plan.prerequisiteCaseIds.length === 0
    && Array.isArray(plan.decisions) && plan.decisions.length === 0
    && typeof plan.assessmentReason === 'string' && Boolean(plan.assessmentReason.trim())
    && Array.isArray(plan.assessmentEvidence) && plan.assessmentEvidence.length > 0
    && plan.assessmentEvidence.every(item => item.source === 'change-notes' && typeof item.quote === 'string'
      && Boolean(item.quote.trim()) && typeof plan.changeNotesSnapshot === 'string' && plan.changeNotesSnapshot.includes(item.quote));
}
export function createDocumentAutonomousPlanStore(directory: string): AutonomousPlanRepository {
  async function get(id: string) {
    if (!safeId.test(id)) return undefined;
    try {
      const value: unknown = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
      return valid(value) && value.id === id ? value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }
  return {
    get,
    async save(record) {
      if (!valid(record)) throw new Error('无效的自主回归计划记录。');
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `${record.id}.json`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
    },
    async list(projectId) {
      const names = await readdir(directory).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; });
      const result: SavedAutonomousPlan[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const record = await get(name.slice(0, -5));
        if (record?.projectId === projectId) result.push(record);
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    },
  };
}
