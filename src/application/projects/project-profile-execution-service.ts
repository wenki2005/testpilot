import type { ProjectProfile, RunRecord, SuiteCase } from "../../domain/types.js";

export type ApprovedProfileScriptSnapshot = {
  id: string;
  version: number;
  digest: string;
  suite: ProjectProfile["suite"];
  files: Record<string, string>;
};

type PreparedProfile = { projectRoot: string; env: Record<string, string>; close(): Promise<void> };

/** Runs one registered profile against a disposable snapshot and retains its normalized evidence. */
export async function executeProjectProfileSnapshot(input: {
  profileId: string;
  runId: string;
  outputRoot: string;
  artifactRoot: string;
  signal: AbortSignal;
  approvedScript?: ApprovedProfileScriptSnapshot;
  loadProfile(profileId: string): Promise<ProjectProfile>;
  prepare(profile: ProjectProfile): Promise<PreparedProfile>;
  overlayApprovedFiles(projectRoot: string, files: Record<string, string>): Promise<void>;
  execute(profile: ProjectProfile, cases: SuiteCase[], prepared: PreparedProfile, outputRoot: string, signal: AbortSignal): Promise<RunRecord>;
  saveRun(record: RunRecord, outputRoot: string): Promise<void>;
  preserveArtifacts(profile: ProjectProfile, projectRoot: string, destination: string): Promise<void>;
  listArtifactFiles(runId: string): Promise<string[]>;
}): Promise<{ record: RunRecord; artifactFiles: string[]; cleanupError?: unknown }> {
  const profile = await input.loadProfile(input.profileId);
  if (input.approvedScript) profile.suite = structuredClone(input.approvedScript.suite);
  const prepared = await input.prepare(profile);
  let result: { record: RunRecord; artifactFiles: string[] } | undefined;
  let executionError: unknown;
  let cleanupError: unknown;
  try {
    if (input.approvedScript) await input.overlayApprovedFiles(prepared.projectRoot, input.approvedScript.files);
    const cases = profile.suite.cases.map(testCase => ({
      ...testCase,
      command: {
        ...testCase.command,
        cleanEnvironment: true,
        env: Object.fromEntries(Object.entries({ ...testCase.command.env, ...prepared.env }).map(([key, value]) => [key, value.replaceAll("{DEMO_URL}", prepared.env.DEMO_URL ?? "")])),
      },
    }));
    const record = await input.execute(profile, cases, prepared, input.outputRoot, input.signal);
    if (input.approvedScript) record.approvedScript = { id: input.approvedScript.id, version: input.approvedScript.version, digest: input.approvedScript.digest };
    await input.saveRun(record, input.outputRoot);
    await input.preserveArtifacts(profile, prepared.projectRoot, input.artifactRoot);
    result = { record, artifactFiles: await input.listArtifactFiles(input.runId) };
  } catch (error) {
    executionError = error;
  }
  try { await prepared.close(); }
  catch (error) { cleanupError = error; }
  if (executionError) {
    if (cleanupError && executionError && typeof executionError === "object") Object.assign(executionError, { cleanupError });
    throw executionError;
  }
  if (!result) throw new Error("Project profile execution completed without a run record.");
  return { ...result, ...(cleanupError ? { cleanupError } : {}) };
}
