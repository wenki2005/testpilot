import type { RegressionDatabaseBinding, RegressionDatabaseEvidence } from '../database/regression-database-contract.js';
import type { WebModuleJobView } from './module-execution-contract.js';
import type { DifyNotification } from './notification-contract.js';
export type TestedSystem = {
    id: string;
    name: string;
    environment: string;
    targetUrl: string;
    profileId: string;
    notifyFailures?: boolean;
    notifyScreenshots?: boolean;
    accountProfiles?: Array<{
        id: string;
        name: string;
    }>;
    activeAccountId?: string;
    databaseBinding?: RegressionDatabaseBinding | undefined;
    selectedModuleIds: string[];
    createdAt: string;
    updatedAt: string;
};
export type ModuleVersion = {
    source?: 'manual' | 'mcp' | 'resources';
    id: string;
    version: number;
    digest: string;
    caseCount: number;
    createdAt: string;
    added: number;
    removed: number;
    changed: number;
};
export type FixedModule = {
    id: string;
    systemId: string;
    name: string;
    archived: boolean;
    coreCaseIds?: string[];
    coreVersionId?: string;
    starterCaseIds?: string[];
    starterVersionId?: string;
    versions: ModuleVersion[];
    /** Derived from the latest version; shown before a run so pending scripts are visible. */
    pendingScriptReviewCount?: number;
    /** Derived from the latest version; these cases need steps edited before they can run. */
    missingScriptCount?: number;
    createdAt: string;
    updatedAt: string;
};
export type BatchEntry = {
    moduleId: string;
    moduleName: string;
    versionId: string;
    version: number;
    digest: string;
    caseCount: number;
    jobId?: string;
    selectedCaseIds?: string[];
    confirmedCaseIds?: string[];
};
export type RegressionBatch = {
    id: string;
    requestId: string;
    systemId: string;
    systemName: string;
    environment: string;
    targetUrl: string;
    profileId: string;
    createdAt: string;
    updatedAt: string;
    phase: 'queued' | 'running' | 'completed' | 'cancelled' | 'interrupted';
    entries: BatchEntry[];
    accountName?: string;
    runMode?: 'fixed' | 'assist';
    scope?: 'core' | 'all' | 'custom' | 'starter';
    databaseBinding?: RegressionDatabaseBinding;
    parentBatchId?: string;
    message: string;
    notifyFailures?: boolean;
    notifyScreenshots?: boolean;
    notification?: DifyNotification;
};
export type BatchView = RegressionBatch & {
    jobs: WebModuleJobView[];
    counts: Record<'passed' | 'failed' | 'blocked' | 'error' | 'not_executed' | 'outside', number>;
};
export type AccountView = {
    state: 'unknown' | 'saved' | 'connecting' | 'awaiting-login' | 'connected' | 'error';
    message: string;
    profileId?: string;
    checkedAt?: string;
    databaseEvidence?: RegressionDatabaseEvidence;
};
export type SystemModuleState = {
    systems: TestedSystem[];
    modules: FixedModule[];
    batches: BatchView[];
    accounts: Record<string, AccountView>;
    legacyModules: Array<{
        id: string;
        name: string;
        targetUrl: string;
        caseCount: number;
    }>;
    configured: {
        prepare: boolean;
        execution: boolean;
    };
    database?: {
        connected: boolean;
    };
    notificationConfigured?: boolean;
};
