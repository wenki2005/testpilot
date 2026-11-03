import type { ExecutionJournal } from "../../domain/document-test-model.js";

/** Durable execution journal storage. Workflow policy remains in application services. */
export interface DocumentRunRepository {
  readJournal(runId: string): Promise<ExecutionJournal>;
  writeJournal(journal: ExecutionJournal): Promise<void>;
  listJournalIds(): Promise<string[]>;
}
