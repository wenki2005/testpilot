import { mkdir } from "node:fs/promises";
import type { DemoCheck, DemoRun } from "../demo/contracts.js";
import type { ProjectProfileSummary, ProjectRunView } from "../domain/project-profile.js";
import type { createDemoArtifactStore } from "../storage/demo-artifact-store.js";

type ArtifactStore = ReturnType<typeof createDemoArtifactStore>;

function isDemoCheck(value: unknown): value is DemoCheck {
  if (!value || typeof value !== "object") return false;
  const check = value as Partial<DemoCheck>;
  return typeof check.id === "string" && typeof check.title === "string"
    && typeof check.method === "string" && typeof check.path === "string" && /^\/(sample\/)/u.test(check.path)
    && Boolean(check.expect) && Number.isInteger(check.expect?.status);
}

/** Restore persisted demo/profile state before serving requests. */
export async function restoreDemoServerState(input: {
  runsDirectory: string;
  artifactStore: ArtifactStore;
  demoRunService: { restore(run: DemoRun): void };
  projectRuns: Map<string, ProjectRunView>;
  profiles: ProjectProfileSummary[];
  loadProjectScripts(): Promise<unknown>;
  now(): string;
}): Promise<DemoCheck[]> {
  await mkdir(input.runsDirectory, { recursive: true });
  const regressions = await input.artifactStore.readRegressionChecks();
  const savedChecks = Array.isArray(regressions) ? regressions.filter(isDemoCheck) : [];
  for (const candidate of await input.artifactStore.listDemoRunSnapshots()) {
    if (!candidate || typeof candidate !== "object" || !("id" in candidate) || typeof candidate.id !== "string") continue;
    const run = candidate as DemoRun;
    if (run.status === "running" || run.status === "queued") {
      run.status = "blocked";
      run.completedAt = input.now();
      run.summary = "服务在上次运行完成前停止；请重新运行。";
      run.limitations = [...(run.limitations ?? []), "上次运行被服务停止中断，未完成部分未判为通过。"];
      await input.artifactStore.saveDemoRun(run);
    }
    input.demoRunService.restore(run);
  }
  for (const candidate of await input.artifactStore.listProfileRunSnapshots()) {
    if (!candidate || typeof candidate !== "object" || !("id" in candidate) || typeof candidate.id !== "string" || !("profileId" in candidate)) continue;
    const run = candidate as ProjectRunView;
    if (input.profiles.some(profile => profile.id === run.profileId)) input.projectRuns.set(run.id, run);
  }
  await input.loadProjectScripts();
  return savedChecks;
}
