import type { BrowserCheck } from '../documents/shared/test-model.js';
export type CaseDependency = {
    moduleId: string;
    caseId: string;
};
export type PrerequisiteReview = {
    status: 'reviewed' | 'pending';
    note: string;
};
export type CaseScript = {
    caseId: string;
    dependsOn: Array<CaseDependency & {
        requiredStatus: 'passed';
    }>;
    steps: BrowserCheck['steps'];
};
export type EditableCase = {
    sourceId?: string;
    scriptReview?: { status: 'pending' | 'reviewed'; note: string };
    changeSource?: 'manual' | 'mcp' | 'resources';
    moduleId: string;
    versionId: string;
    version: number;
    id: string;
    title: string;
    expected: string;
    manualSteps: string[];
    prerequisites: CaseDependency[];
    prerequisiteReview?: PrerequisiteReview;
    script: CaseScript;
    sourcePath: string[];
    sourceExpected: string;
    scriptPath: string;
    status: string;
    resultAt?: string;
};
export type CaseEditorCatalog = {
    systems: Array<{
        id: string;
        name: string;
    }>;
    systemId: string;
    modules: Array<{
        id: string;
        name: string;
        caseKeys: string[];
    }>;
    cases: EditableCase[];
    chains: Array<{
        id: string;
        title: string;
        caseKeys: string[];
    }>;
};
