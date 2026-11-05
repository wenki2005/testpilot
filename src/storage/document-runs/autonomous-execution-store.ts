import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const safeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type AutonomousExecutionState = 'pending' | 'submitted' | 'uncertain' | 'completed' | 'failed';
export interface AutonomousExecutionRecord {
  planId: string;
  projectId: string;
  runId: string;
  state: AutonomousExecutionState;
  createdAt: string;
  updatedAt: string;
  frozenCaseIds: string[];
  contextDigest: string;
  error?: string;
}
export class AutonomousExecutionStorageError extends Error {
  readonly code = 'AUTONOMOUS_EXECUTION_STORAGE_ERROR';
  constructor(message = '自主执行状态存储损坏或不可用。') { super(message); this.name = 'AutonomousExecutionStorageError'; }
}

function valid(value: unknown): value is AutonomousExecutionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as AutonomousExecutionRecord;
  return typeof r.planId === 'string' && safeId.test(r.planId) && typeof r.projectId === 'string' && r.projectId.length > 0
    && typeof r.runId === 'string' && safeId.test(r.runId)
    && ['pending', 'submitted', 'uncertain', 'completed', 'failed'].includes(r.state)
    && typeof r.createdAt === 'string' && Number.isFinite(Date.parse(r.createdAt))
    && typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt))
    && Date.parse(r.updatedAt) >= Date.parse(r.createdAt)
    && Array.isArray(r.frozenCaseIds) && r.frozenCaseIds.length > 0 && r.frozenCaseIds.every(id => typeof id === 'string' && id.length > 0)
    && new Set(r.frozenCaseIds).size === r.frozenCaseIds.length
    && typeof r.contextDigest === 'string' && /^[a-f0-9]{64}$/iu.test(r.contextDigest)
    && (r.error === undefined || r.error === 'executor-submit-failed');
}
function terminal(state: AutonomousExecutionState) { return state === 'completed' || state === 'failed'; }

export function createDocumentAutonomousExecutionStore(directory: string) {
  const file = (id: string) => path.join(directory, `${id}.json`);
  async function read(planId: string): Promise<AutonomousExecutionRecord | undefined> {
    if (!safeId.test(planId)) return undefined;
    let raw: string;
    try { raw = await readFile(file(planId), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new AutonomousExecutionStorageError(); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new AutonomousExecutionStorageError('自主执行状态记录损坏，已拒绝重试。'); }
    if (!valid(parsed) || parsed.planId !== planId) throw new AutonomousExecutionStorageError('自主执行状态记录损坏，已拒绝重试。');
    return parsed;
  }
  async function withLock<T>(planId: string, action: () => Promise<T>): Promise<T> {
    const lock = `${file(planId)}.lock`;
    await mkdir(directory, { recursive: true });
    let handle;
    for (let i = 0; i < 500; i++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new AutonomousExecutionStorageError(); await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    if (!handle) throw new AutonomousExecutionStorageError('自主执行状态正被其他进程更新。');
    try { return await action(); }
    finally { await handle.close().catch(() => undefined); await unlink(lock).catch(() => undefined); }
  }
  return {
    get: read,
    async createIntent(planId: string, record: AutonomousExecutionRecord): Promise<boolean> {
      if (!safeId.test(planId) || !valid(record) || record.planId !== planId || record.state !== 'pending') throw new AutonomousExecutionStorageError('自主执行意图无效。');
      await mkdir(directory, { recursive: true });
      let handle;
      try { handle = await open(file(planId), 'wx', 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw new AutonomousExecutionStorageError(); }
      try { await handle.writeFile(JSON.stringify(record), 'utf8'); await handle.sync(); }
      catch { await handle.close().catch(() => undefined); throw new AutonomousExecutionStorageError('自主执行意图保存失败。'); }
      await handle.close();
      return true;
    },
    async save(record: AutonomousExecutionRecord): Promise<void> {
      if (!valid(record)) throw new AutonomousExecutionStorageError('自主执行状态无效。');
      await withLock(record.planId, async () => {
        const previous = await read(record.planId);
        if (!previous) throw new AutonomousExecutionStorageError('自主执行意图不存在，拒绝写入。');
        if (previous.projectId !== record.projectId || previous.runId !== record.runId || previous.contextDigest !== record.contextDigest
          || previous.createdAt !== record.createdAt || JSON.stringify(previous.frozenCaseIds) !== JSON.stringify(record.frozenCaseIds))
          throw new AutonomousExecutionStorageError('自主执行记录归属不匹配。');
        if (Date.parse(record.updatedAt) < Date.parse(previous.updatedAt)) throw new AutonomousExecutionStorageError('拒绝写入过期的自主执行状态。');
        if (terminal(previous.state) && !terminal(record.state)) throw new AutonomousExecutionStorageError('拒绝覆盖已完成的自主执行记录。');
        const destination = file(record.planId), temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify(record), 'utf8'); await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, destination);
        } catch { await unlink(temporary).catch(() => undefined); throw new AutonomousExecutionStorageError('自主执行状态保存失败。'); }
      });
    },
  };
}
