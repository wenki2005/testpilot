import type { DocumentProject } from '../../domain/documents/shared/test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';

export class DocumentProjectReviewError extends Error {
  constructor(readonly code: 'invalid-decision', message: string) { super(message); }
}

export function createDocumentProjectReviewService(deps: {
  projects: Pick<DocumentProjectRepository, 'saveProject'>;
  validateCases(cases: DocumentProject['cases']): DocumentProject['cases'];
  ensureWorkflow(project: DocumentProject): Promise<{ workflowId: string }>;
  completeApprovalGate(workflowId: string, project: DocumentProject, notes: string): Promise<void>;
  now(): string;
}) {
  return {
    async approve(project: DocumentProject, input: unknown): Promise<DocumentProject> {
      const data = input as { decision?: unknown; notes?: unknown } | null;
      if (!data || typeof data !== 'object' || data.decision !== 'approve' || typeof data.notes !== 'string' || data.notes.length > 2000) {
        throw new DocumentProjectReviewError('invalid-decision', '审核需确认 decision=approve，并提供不超过 2000 字的备注。');
      }
      project.cases = deps.validateCases(project.cases);
      project.reviewStatus = 'approved';
      project.reviewNotes = data.notes.trim();
      project.updatedAt = deps.now();
      await deps.projects.saveProject(project);
      const workflow = await deps.ensureWorkflow(project);
      await deps.completeApprovalGate(workflow.workflowId, project, project.reviewNotes || 'User approved the reviewed test cases.');
      return project;
    },
  };
}
