import type { DocumentProject, DocumentRun, ExecutionJournal } from "../../domain/documents/shared/test-model.js";
import type { DocumentRunRepository } from "../ports/document-run-repository.js";

export interface DocumentRunFinalizationDependencies {
  repository: Pick<DocumentRunRepository, "writeJournal">;
  writePackage(project: DocumentProject, run: DocumentRun, packageInput: Uint8Array): Promise<string>;
  persistRun(run: DocumentRun): Promise<void>;
  persistFailedRun(run: DocumentRun): Promise<void>;
  removePackageInput(runId: string): Promise<void>;
  notifyCompleted?(run: DocumentRun): Promise<unknown>;
  now(): string;
}

/** Commits report/package output and the journal's terminal state from saved run facts. */
export function createDocumentRunFinalizationService(deps: DocumentRunFinalizationDependencies) {
  return {
    async finalize(project: DocumentProject, run: DocumentRun, journal: ExecutionJournal, packageInput: Uint8Array): Promise<DocumentRun> {
      run.packagePath = await deps.writePackage(project, run, packageInput);
      run.packageReady = true;
      await deps.persistRun(run);
      journal.finalizationRun = structuredClone(run);
      journal.status = run.overall === "cancelled" ? "cancelled" : "completed";
      journal.updatedAt = deps.now();
      delete journal.currentCase;
      delete journal.lastError;
      await deps.repository.writeJournal(journal);
      await deps.removePackageInput(run.id);
      // Notification failure never changes the committed testing result.
      await deps.notifyCompleted?.(run).catch(() => undefined);
      return run;
    },
    async recordPackagingFailure(run: DocumentRun, journal: ExecutionJournal, error: unknown): Promise<void> {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      run.packagePath = "";
      run.packageReady = false;
      journal.status = "failed";
      journal.updatedAt = deps.now();
      journal.lastError = message;
      journal.finalizationRun = structuredClone(run);
      await deps.persistFailedRun(run).catch(() => undefined);
      await deps.repository.writeJournal(journal).catch(() => undefined);
    },
  };
}
