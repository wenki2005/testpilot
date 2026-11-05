import type { NavigationSnapshot } from '../../domain/documents/projects/website-map.js';
export type CaseNavigationCheck = {
    id?: string;
    title: string;
    source: string;
    expected?: string;
    entryPath?: string;
    modulePath?: string[];
    preconditions?: string[];
    testData?: string[];
};
export type CaseNavigationPage = {
    id: string;
    snapshot: NavigationSnapshot;
    pathLabels: string[];
};
export type CaseNavigationSelection = {
    pageId: string | null;
    reason: string;
    caseQuote?: string;
    pageQuote?: string;
};
export interface DocumentCaseNavigationPort {
    select(input: {
        check: CaseNavigationCheck;
        pages: CaseNavigationPage[];
    }): Promise<CaseNavigationSelection>;
}
