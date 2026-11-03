import type { BrowserCheck, DocumentProject, DocumentRun, ExecutionJournal, StepGenerationCaseResult } from '../../domain/document-test-model.js';

export type PreparedDocumentSteps = {
  generatedCaseIds: string[];
  caseResults?: StepGenerationCaseResult[];
  warning?: string;
  requiresReview?: boolean;
};

export function createDocumentRunStepGenerationService(input: {
  project: DocumentProject;
  journal: ExecutionJournal;
  selectedCaseIds: string[];
  updateRunCaseSnapshots(caseIds: string[]): void;
  saveJournal(journal: ExecutionJournal): Promise<void>;
  projectDigest(project: DocumentProject): string;
  resolveCases(cases: BrowserCheck[]): BrowserCheck[];
  now(): string;
}) {
  let stepGeneration: DocumentRun['stepGeneration'];
  return {
    async apply(prepared: PreparedDocumentSteps, previousCases: BrowserCheck[]): Promise<{
      selectedCases: BrowserCheck[];
      stepGeneration?: DocumentRun['stepGeneration'];
    }> {
      if (prepared.generatedCaseIds.length || prepared.warning) {
        stepGeneration = {
          generatedCaseIds: prepared.generatedCaseIds,
          ...(prepared.caseResults?.length ? { caseResults: prepared.caseResults } : {}),
          ...(prepared.warning ? { warning: prepared.warning } : {}),
          requiresReview: prepared.requiresReview === true,
        };
        input.journal.stepGeneration = stepGeneration;
        input.journal.updatedAt = input.now();
        await input.saveJournal(input.journal);
      }
      if (!prepared.generatedCaseIds.length) return { selectedCases: previousCases, ...(stepGeneration ? { stepGeneration } : {}) };

      input.journal.projectDigest = input.projectDigest(input.project);
      input.journal.updatedAt = input.now();
      await input.saveJournal(input.journal);
      const selectedIds = new Set(input.selectedCaseIds);
      if (prepared.requiresReview !== true) {
        input.updateRunCaseSnapshots(prepared.generatedCaseIds);
        return {
          selectedCases: input.resolveCases(input.project.cases.filter(item => selectedIds.has(item.id))),
          ...(stepGeneration ? { stepGeneration } : {}),
        };
      }

      const originalSteps = new Map(previousCases.map(item => [item.id, item.steps]));
      return {
        selectedCases: input.project.cases.filter(item => selectedIds.has(item.id)).map(item => ({
          ...item,
          steps: originalSteps.get(item.id) ?? item.steps,
        })),
        ...(stepGeneration ? { stepGeneration } : {}),
      };
    },

    async failed(prefix: string, error: unknown): Promise<DocumentRun['stepGeneration']> {
      stepGeneration = {
        generatedCaseIds: [],
        warning: `${prefix}${error instanceof Error ? error.message : String(error)}`,
        requiresReview: false,
      };
      input.journal.stepGeneration = stepGeneration;
      input.journal.updatedAt = input.now();
      await input.saveJournal(input.journal);
      return stepGeneration;
    },
  };
}
