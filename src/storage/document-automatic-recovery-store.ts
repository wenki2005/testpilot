import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AutomaticRecoveryRecord } from '../application/runs/document-automatic-recovery-service.js';
export type { AutomaticRecoveryRecord } from '../application/runs/document-automatic-recovery-service.js';

export class AutomaticRecoveryStorageError extends Error {
  readonly code = 'AUTOMATIC_RECOVERY_STORAGE_ERROR';
  constructor(message = '自动恢复状态记录损坏或不可用。') { super(message); this.name = 'AutomaticRecoveryStorageError'; }
}
const parentIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function valid(value: unknown): value is AutomaticRecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as AutomaticRecoveryRecord;
  const dates = typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt)) && typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)) && Date.parse(r.updatedAt) >= Date.parse(r.createdAt);
  const overall = r.overall === undefined || ['passed', 'failed', 'partial', 'unresolved', 'cancelled'].includes(r.overall);
  return typeof r.parentRunId === 'string' && parentIdPattern.test(r.parentRunId) && typeof r.projectId === 'string' && r.projectId.length > 0 && r.projectId.length <= 256
    && typeof r.childRunId === 'string' && uuidPattern.test(r.childRunId) && typeof r.adviceRecordId === 'string' && uuidPattern.test(r.adviceRecordId)
    && typeof r.runDigest === 'string' && /^[a-f0-9]{64}$/iu.test(r.runDigest)
    && typeof r.caseId === 'string' && r.caseId.length > 0 && r.caseId.length <= 512 && Number.isSafeInteger(r.stepIndex) && r.stepIndex >= 0
    && r.policyVersion === 1 && ['pending', 'completed', 'failed'].includes(r.state) && dates && overall
    && (r.state === 'completed' ? r.overall !== undefined : r.overall === undefined)
    && (r.error === undefined || (r.state === 'failed' && r.error === 'submission-failed'));
}
function key(id: string) { return createHash('sha256').update(id).digest('hex'); }
export function createDocumentAutomaticRecoveryStore(directory: string) {
  const file = (id: string) => path.join(directory, `${key(id)}.json`);
  async function get(parentRunId: string): Promise<AutomaticRecoveryRecord | undefined> {
    if (!parentIdPattern.test(parentRunId)) return undefined;
    let raw: string;
    try { raw = await readFile(file(parentRunId), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new AutomaticRecoveryStorageError(); }
    let record: unknown;
    try { record = JSON.parse(raw); } catch { throw new AutomaticRecoveryStorageError('自动恢复状态记录损坏，已拒绝重放。'); }
    if (!valid(record) || record.parentRunId !== parentRunId) throw new AutomaticRecoveryStorageError('自动恢复状态记录损坏，已拒绝重放。');
    return record;
  }
  async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true }); const lockPath = `${file(id)}.lock`; let handle;
    for (let i = 0; i < 500; i++) { try { handle = await open(lockPath, 'wx', 0o600); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new AutomaticRecoveryStorageError(); await new Promise(resolve => setTimeout(resolve, 10)); } }
    if (!handle) throw new AutomaticRecoveryStorageError('自动恢复状态正被其他进程更新。');
    try { return await action(); } finally { await handle.close().catch(() => undefined); await unlink(lockPath).catch(() => undefined); }
  }
  return {
    get,
    async createIntent(record: AutomaticRecoveryRecord): Promise<boolean> {
      if (!valid(record) || record.state !== 'pending') throw new AutomaticRecoveryStorageError('自动恢复意图无效。');
      await mkdir(directory, { recursive: true }); let handle;
      try { handle = await open(file(record.parentRunId), 'wx', 0o600); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw new AutomaticRecoveryStorageError(); }
      try { await handle.writeFile(JSON.stringify(record), 'utf8'); await handle.sync(); } catch { await handle.close().catch(() => undefined); throw new AutomaticRecoveryStorageError('自动恢复意图保存失败。'); }
      await handle.close(); return true;
    },
    async save(record: AutomaticRecoveryRecord): Promise<void> {
      if (!valid(record)) throw new AutomaticRecoveryStorageError('自动恢复状态无效。');
      await locked(record.parentRunId, async () => {
        const previous = await get(record.parentRunId); if (!previous) throw new AutomaticRecoveryStorageError('自动恢复意图不存在，拒绝写入。');
        const immutable = ['parentRunId','projectId','childRunId','adviceRecordId','runDigest','caseId','stepIndex','policyVersion','createdAt'] as const;
        if (immutable.some(k => previous[k] !== record[k])) throw new AutomaticRecoveryStorageError('自动恢复记录归属不匹配。');
        if (Date.parse(record.updatedAt) < Date.parse(previous.updatedAt)) throw new AutomaticRecoveryStorageError('拒绝写入过期的自动恢复状态。');
        if (previous.state !== 'pending' && (record.state !== previous.state || (record.state === 'completed' && record.overall !== previous.overall) || record.error !== previous.error)) throw new AutomaticRecoveryStorageError('拒绝覆盖终态自动恢复记录。');
        const dest = file(record.parentRunId), temp = `${dest}.${randomUUID()}.tmp`;
        try { const h = await open(temp, 'wx', 0o600); try { await h.writeFile(JSON.stringify(record), 'utf8'); await h.sync(); } finally { await h.close(); } await rename(temp, dest); }
        catch { await unlink(temp).catch(() => undefined); throw new AutomaticRecoveryStorageError('自动恢复状态保存失败。'); }
      });
    },
  };
}
