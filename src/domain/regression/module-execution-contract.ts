import type { RegressionDatabaseEvidence } from '../database/regression-database-contract.js';
/** Browser-safe DTO; no server, SQLite or browser-profile dependencies. */
export type ModuleCaseStatus = 'passed' | 'failed' | 'blocked' | 'error' | 'not_executed';
export type WebModuleJobView = {
    id: string;
    moduleId: string;
    moduleName: string;
    moduleDigest: string;
    createdAt: string;
    updatedAt: string;
    phase: string;
    outcome: ModuleCaseStatus;
    message: string;
    parentJobId?: string | undefined;
    documentRunId?: string;
    executionFinished?: boolean;
    runMode?: 'fixed' | 'assist';
    selectedCaseIds: string[];
    databaseEvidence?: RegressionDatabaseEvidence;
    databaseEvidenceDigest?: string;
    results: Array<{
        caseId: string;
        title: string;
        expected: string;
        priority?: 'P0' | 'P1' | 'P2' | 'P3';
        status: ModuleCaseStatus;
        detail: string;
        outOfScope?: boolean;
        evidence?: string | undefined;
        evidenceOrigin?: 'document-run' | 'preflight' | 'authorized-write';
        evidenceNote?: string | undefined;
        needsConfirmation?: boolean;
        blockerCode?: string;
        nextAction?: string;
        preparationReview?: string;
        proposal?: {
            steps: string[];
            preconditions: string[];
            questions: string[];
        };
    }>;
    difyRuns: Array<{
        phase: string;
        batch: number;
        id?: string | undefined;
        status: 'succeeded' | 'failed';
        caseIds: string[];
        inputDigest: string;
        tokens?: number;
    }>;
    events: Array<{
        at: string;
        phase: string;
        message: string;
    }>;
    progress?: {
        completed: number;
        total: number;
        currentCase?: {
            title: string;
        };
    };
};
