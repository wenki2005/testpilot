export interface DocumentPageExplorationSession {
    navigationSnapshot?(): Promise<import('../../domain/documents/projects/website-map.js').NavigationSnapshot>;
    activateNavigation?(evidenceId: string, index: number): Promise<import('../../domain/documents/projects/website-map.js').NavigationSnapshot>;
    resetNavigation?(): Promise<import('../../domain/documents/projects/website-map.js').NavigationSnapshot>;
    restoreNavigation?(evidenceId: string): Promise<import('../../domain/documents/projects/website-map.js').NavigationSnapshot>;
    capture(): Promise<string>;
    followLink(evidenceId: string, index: number): Promise<string>;
    /** Promote a clean, un-routed same-origin child page only after a valid model stop. */
    promoteSession(): Promise<void>;
    close(): Promise<void>;
}
export interface DocumentPageExplorationSessionPort {
    open(project: {
        id: string;
        targetUrl: string;
        activeSessionProfileId?: string;
        sessionProfiles?: DocumentSessionProfile[];
        executionConfig?: import('../../domain/documents/shared/test-model.js').DocumentProjectExecutionConfig;
    }): Promise<DocumentPageExplorationSession>;
}
import type { DocumentSessionProfile } from "../../domain/documents/projects/session-profile.js";
