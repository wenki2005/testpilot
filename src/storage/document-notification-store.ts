import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { NotificationConfig, NotificationReceipt, RunNotificationRepository } from '../application/runs/document-run-notification-service.js';

export function createDocumentNotificationStore(directory: string): RunNotificationRepository {
  async function read<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await readFile(path.join(directory, file), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Notification storage read failed.'); }
  }
  async function save(file: string, data: unknown) {
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, file);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { await rename(temporary, destination); return; }
        catch (error) {
          lastError = error;
          const code = (error as NodeJS.ErrnoException).code;
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 4) throw new Error('Notification storage write failed.');
          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
      throw lastError;
    } catch { throw new Error('Notification storage write failed.'); }
    finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Notification temporary cleanup failed.'); }); }
  }
  const receiptFile = (eventId: string) => `${createHash('sha256').update(eventId).digest('hex')}.json`;
  function validReceipt(receipt: NotificationReceipt | undefined, eventId: string): receipt is NotificationReceipt {
    return !!receipt && receipt.eventId === eventId && receipt.runId === eventId.replace(/:terminal$/u, '')
      && ['pending', 'delivered', 'failed'].includes(receipt.status)
      && Number.isInteger(receipt.attempts) && receipt.attempts >= 1 && receipt.attempts <= 3
      && typeof receipt.updatedAt === 'string' && Number.isFinite(Date.parse(receipt.updatedAt));
  }
  return {
    readConfig: async () => await read<NotificationConfig>('config.json') ?? { enabled: false, webhook: '' },
    saveConfig: config => save('config.json', config),
    async readReceipt(eventId) {
      const receipt = await read<NotificationReceipt>(receiptFile(eventId));
      if (receipt === undefined) return undefined;
      if (!validReceipt(receipt, eventId)) throw new Error('Notification receipt is invalid.');
      return receipt;
    },
    async withEventLock<T>(eventId: string, action: () => Promise<T>): Promise<T> {
      await mkdir(directory, { recursive: true });
      const lockPath = path.join(directory, `${createHash('sha256').update(eventId).digest('hex')}.lock`);
      const lockToken = randomUUID();
      let handle;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { handle = await open(lockPath, 'wx', 0o600); await handle.writeFile(lockToken, 'utf8'); break; }
        catch (error) {
          if (handle) {
            await handle.close().catch(() => undefined); handle = undefined;
            // An incompletely written ownership token remains fail-closed; do not reclaim it.
            throw new Error('Notification event lock unavailable.');
          }
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Notification event lock unavailable.');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      if (!handle) throw new Error('Notification event lock unavailable.');
      try { return await action(); }
      finally {
        await handle.close();
        try { if ((await readFile(lockPath, 'utf8')) === lockToken) await unlink(lockPath); } catch { /* Preserve any lock not owned by this holder. */ }
      }
    },
    async readReceiptForRun(runId) {
      const eventId = `${runId}:terminal`;
      const receipt = await read<NotificationReceipt>(receiptFile(eventId));
      if (!receipt || receipt.eventId !== eventId || receipt.runId !== runId) return undefined;
      if (!validReceipt(receipt, eventId)) return undefined;
      return receipt;
    },
    saveReceipt: receipt => save(receiptFile(receipt.eventId), receipt),
  };
}
