import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StepRevisionProposal, StepRevisionProposalRepository } from "../application/runs/document-step-revision-proposal-service.js";

type StoredProposal = { version: 1; proposal: StepRevisionProposal; digest: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const proposalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isProposal(value: unknown): value is StepRevisionProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<StepRevisionProposal>;
  return typeof item.id === "string" && proposalIdPattern.test(item.id)
    && typeof item.projectId === "string" && typeof item.runId === "string" && typeof item.investigationId === "string"
    && typeof item.runDigest === "string" && /^[0-9a-f]{64}$/iu.test(item.runDigest)
    && typeof item.caseId === "string" && typeof item.expected === "string"
    && typeof item.currentStepsDigest === "string" && /^[0-9a-f]{64}$/iu.test(item.currentStepsDigest)
    && Array.isArray(item.currentSteps) && Array.isArray(item.proposedSteps) && Array.isArray(item.evidence)
    && typeof item.changeSummary === "string" && typeof item.impactSummary === "string"
    && ["pending-review", "accepted", "rejected", "stale"].includes(String(item.status))
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
}

function encode(proposal: StepRevisionProposal): string {
  const payload = JSON.stringify(proposal);
  return JSON.stringify({ version: 1, proposal, digest: hash(`testpilot-step-revision-proposal-v1\0${payload}`) } satisfies StoredProposal, null, 2);
}

function decode(raw: string, expectedId?: string): StepRevisionProposal {
  let stored: StoredProposal;
  try { stored = JSON.parse(raw) as StoredProposal; }
  catch { throw new Error("Step revision proposal storage is corrupt."); }
  if (!stored || stored.version !== 1 || !isProposal(stored.proposal) || expectedId && stored.proposal.id !== expectedId
    || stored.digest !== hash(`testpilot-step-revision-proposal-v1\0${JSON.stringify(stored.proposal)}`)) {
    throw new Error("Step revision proposal storage is corrupt or tampered.");
  }
  return stored.proposal;
}

export function createDocumentStepRevisionProposalStore(directory: string): StepRevisionProposalRepository {
  /** Read-only lock inspection. A lock's owner cannot be proven dead portably, so this never removes it. */
  async function inspectReviewLock(projectId: string, caseId: string): Promise<{ present: boolean; path: string }> {
    const lockPath = path.join(directory, "review-locks", `${hash(JSON.stringify([projectId, caseId]))}.lock`);
    try {
      await readFile(lockPath);
      return { present: true, path: lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, path: lockPath };
      throw error;
    }
  }

  async function readById(id: string): Promise<StepRevisionProposal | undefined> {
    if (!proposalIdPattern.test(id)) return undefined;
    try { return decode(await readFile(path.join(directory, `${id}.json`), "utf8"), id); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  return {
    async withReviewLock<T>(projectId: string, caseId: string, action: () => Promise<T>): Promise<T> {
      const lockDirectory = path.join(directory, "review-locks");
      await mkdir(lockDirectory, { recursive: true });
      const lockPath = path.join(lockDirectory, `${hash(JSON.stringify([projectId, caseId]))}.lock`);
      const lockToken = randomUUID();
      let handle;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { handle = await open(lockPath, "wx", 0o600); await handle.writeFile(lockToken, "utf8"); break; }
        catch (error) {
          if (handle) {
            await handle.close().catch(() => undefined);
            throw new Error("Step revision review lock could not be initialized.");
          }
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Step revision review lock is unavailable.");
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      if (!handle) throw Object.assign(new Error("Step revision review lock is held. Automatic recovery is disabled because the lock owner cannot be proven dead safely. Inspect the lock and stop every TestPilot service using this data directory before an operator removes a confirmed abandoned lock."), { code: "ELOCKED" });
      try { return await action(); }
      finally {
        await handle.close();
        try { if ((await readFile(lockPath, "utf8")) === lockToken) await unlink(lockPath); } catch { /* Preserve a lock not owned by this holder. */ }
      }
    },
    async save(proposal) {
      if (!isProposal(proposal)) throw new Error("Step revision proposal is invalid.");
      await mkdir(directory, { recursive: true });
      const filePath = path.join(directory, `${proposal.id}.json`);
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, encode(proposal), { encoding: "utf8", mode: 0o600 });
        for (let attempt = 0; ; attempt += 1) {
          try { await rename(temporaryPath, filePath); break; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
            await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
          }
        }
      } finally { await unlink(temporaryPath).catch(() => undefined); }
    },
    get: readById,
    inspectReviewLock,
    async list(projectId) {
      const files = await readdir(directory).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      const proposals: StepRevisionProposal[] = [];
      for (const file of files.filter(name => name.endsWith(".json"))) {
        const proposal = decode(await readFile(path.join(directory, file), "utf8"));
        if (proposal.projectId === projectId) proposals.push(proposal);
      }
      return proposals.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
    },
  };
}
