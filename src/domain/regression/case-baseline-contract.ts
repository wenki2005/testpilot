/** Dify regression records shared by the UI and persistence adapter. */
export type RegressionSourceItem = {
    case_id: string;
    title: string;
    source_path: string[];
    source_expected_verbatim: string;
    source_sha256: string;
    preconditions_proposed: string[];
    steps_proposed: string[];
    needs_confirmation: string[];
};
export type RegressionBaseline = {
    name: string;
    baseline_sha256: string;
    cases: RegressionSourceItem[];
    id: string;
    createdAt: string;
};
export type RegressionVersion = {
    id: string;
    taskId: string;
    baselineId: string;
    createdAt: string;
    cases: Array<RegressionSourceItem & {
        expected_result: string;
        review_status: 'draft';
        execution_status: 'not_executed';
        actual_result: null;
    }>;
    digest: string;
};
export type RegressionRun = {
    id: string;
    versionId: string;
    versionDigest: string;
    reviewId: string | null;
    createdAt: string;
    systemVersion: string;
    databaseLabel: string;
    tester: string;
    results: Array<{
        caseId: string;
        title: string;
        status: 'not_executed' | 'passed' | 'failed' | 'blocked';
        actual: string;
        evidence: string;
    }>;
};
