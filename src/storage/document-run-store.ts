import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecutionJournal } from "../domain/document-test-model.js";
import type { DocumentRunRepository } from "../application/ports/document-run-repository.js";

/** File-backed journal adapter. A caller supplies its data root explicitly. */
export function createDocumentRunStore(runsDirectory: string): DocumentRunRepository {
  const writeQueues = new Map<string, Promise<void>>();
  const journalPath = (runId: string) => path.join(runsDirectory, runId, "execution.json");
  return {
    async readJournal(runId) {
      return JSON.parse(await readFile(journalPath(runId), "utf8")) as ExecutionJournal;
    },
    async writeJournal(journal) {
      const runId = journal.runId;
      const previous = writeQueues.get(runId) ?? Promise.resolve();
      const write = previous.catch(() => undefined).then(async () => {
        const dir = path.join(runsDirectory, runId);
        await mkdir(dir, { recursive: true });
        const temp = path.join(dir, `execution.${randomUUID()}.tmp`);
        try {
          await writeFile(temp, JSON.stringify(journal, null, 2), "utf8");
          for (let attempt = 0; ; attempt += 1) {
            try { await rename(temp, journalPath(runId)); break; }
            catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
              await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
            }
          }
        } finally { await unlink(temp).catch(() => undefined); }
      });
      writeQueues.set(runId, write);
      try { await write; }
      finally { if (writeQueues.get(runId) === write) writeQueues.delete(runId); }
    },
    async listJournalIds() {
      const entries = await readdir(runsDirectory, { withFileTypes: true }).catch(() => []);
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    },
  };
}
