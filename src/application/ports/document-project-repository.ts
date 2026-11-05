import type { DocumentProject, DocumentProjectRevision, DocumentProjectRevisionKind, DocumentProjectRevisionSummary, } from "../../domain/documents/shared/test-model.js";
/** Persistence contract used by project application services. Paths stay in adapters. */
export interface DocumentProjectRepository {
    loadProjects(): Promise<DocumentProject[]>;
    getProject(id: string): Promise<DocumentProject | undefined>;
    saveProject(project: DocumentProject): Promise<void>;
    listRevisions(projectId: string, options?: {
        kind?: DocumentProjectRevisionKind;
        entityId?: string;
        offset?: number;
        limit?: number;
    }): Promise<{
        items: DocumentProjectRevisionSummary[];
        total: number;
    }>;
    getRevision(projectId: string, revisionId: string): Promise<DocumentProjectRevision | undefined>;
    writeSource(project: DocumentProject, bytes: Uint8Array, originalName?: string, index?: number): Promise<void>;
    readSource(project: DocumentProject, materialId: string): Promise<Buffer>;
}
