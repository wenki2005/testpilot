import path from "node:path";
import { DeterministicEngine } from "../engines/deterministic-engine.js";
import { executeProjectProfileSnapshot } from "../application/projects/project-profile-execution-service.js";
import { createProjectProfileRunService } from "../application/projects/project-profile-run-service.js";
import { prepareProfile, preserveProfileArtifacts } from "../adapters/projects/project-profile-adapter.js";
import { saveRun } from "../reporters/markdown-reporter.js";
import type { ProjectProfileSummary, ProjectRunView } from "../domain/projects/profile-contract.js";
import type { createProjectScriptRegistry } from "../adapters/projects/project-script-registry.js";
type ScriptRegistry = ReturnType<typeof createProjectScriptRegistry>;
/** Compose disposable profile runs around the shared demo run activity slot. */
export function createProjectProfileRunRuntime(input: {
    profiles: ProjectProfileSummary[];
    runsDirectory: string;
    timeoutMs: number;
    createRunId: () => string;
    now: () => string;
    scripts: ScriptRegistry;
    readArtifactFiles: (id: string) => Promise<string[]>;
    persist: (run: ProjectRunView) => Promise<void>;
    isAnyRunActive: () => boolean;
    activateRun: (id: string) => void;
    finishRun: (id: string) => void;
}) {
    return createProjectProfileRunService({
        profiles: input.profiles,
        timeoutMs: input.timeoutMs,
        createRunId: input.createRunId,
        now: input.now,
        runDirectory: id => ({ normalized: path.join(input.runsDirectory, id, "normalized"), artifacts: path.join(input.runsDirectory, id) }),
        readArtifactFiles: input.readArtifactFiles,
        persist: input.persist,
        isAnyRunActive: input.isAnyRunActive,
        activateRun: input.activateRun,
        finishRun: input.finishRun,
        execute: async (id, runId, directory, approvedScript, signal) => executeProjectProfileSnapshot({
            profileId: id,
            runId,
            outputRoot: directory.normalized,
            artifactRoot: directory.artifacts,
            signal,
            ...(approvedScript ? { approvedScript } : {}),
            loadProfile: input.scripts.loadProfile,
            prepare: prepareProfile,
            overlayApprovedFiles: input.scripts.overlayApprovedFiles,
            execute: async (profile, cases, prepared, outputRoot, runSignal) => new DeterministicEngine().run({
                mode: "deterministic",
                suiteName: profile.suite.name,
                cases,
                projectRoot: prepared.projectRoot,
                outputRoot,
                scope: [`Registered profile: ${id}`, ...(approvedScript ? [`Approved script ${approvedScript.id} v${approvedScript.version}`] : []), "Disposable local snapshot; no changes to the configured source project"],
                limitations: [approvedScript ? "This run executes only the saved approved snapshot; it does not call AI or generate/heal tests during execution." : "This profile run executes the registered suite; it does not generate or heal tests.", "Browser checks use the project's existing Playwright suite in headless Edge/Chromium."],
                signal: runSignal,
            }),
            saveRun: async (record, outputRoot) => { await saveRun(record, outputRoot); },
            preserveArtifacts: preserveProfileArtifacts,
            listArtifactFiles: input.readArtifactFiles,
        }),
    });
}
