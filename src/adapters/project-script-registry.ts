import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../domain/types.js";
import type { ProjectScriptVersion, ProjectScriptView, SourceScriptProvenance } from "../domain/project-script.js";
import { loadProjectProfile } from "../storage/suite-loader.js";
import { renderGrammarRunner, type GrammarStep } from "./grammar-test-script.js";

type RegisteredProfile = { id: string; name: string; suiteName: string };

function assertSafeProjectRelativePath(value: string): void {
  const parts = value.split("/");
  if (!value || value.includes("\\") || value.startsWith("/") || parts.some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Unsafe project-relative script path: ${value}`);
  }
}

export function createProjectScriptRegistry(input: {
  projectRoot: string;
  profilesDir: string;
  artifactDir: string;
  registryFile: string;
  profiles: RegisteredProfile[];
  distributionDemo: boolean;
}) {
  const scripts = new Map<string, ProjectScriptVersion>();

  async function loadProfile(id: string): Promise<ProjectProfile> {
    const registered = input.profiles.find(profile => profile.id === id);
    if (!registered) throw new Error("Unregistered project profile.");
    const profile = await loadProjectProfile(path.join(input.profilesDir, `${id}.json`));
    if (input.distributionDemo && id === "quantity-sample") profile.sourceRoot = path.join(input.projectRoot, "examples", "source-test-fixture");
    if (profile.name !== registered.name) throw new Error("Registered profile configuration changed unexpectedly.");
    return profile;
  }

  function view(script: ProjectScriptVersion): ProjectScriptView {
    const { suite, ...metadata } = script;
    const previous = [...scripts.values()].filter(item => item.profileId === script.profileId && item.status === "approved" && item.version < script.version).sort((a, b) => b.version - a.version)[0];
    const diff: string[] = [];
    if (!previous) diff.push("No prior approved version; this is the initial candidate.");
    else {
      const oldCases = new Map(previous.suite.cases.map(item => [item.id, item]));
      const newCases = new Map(suite.cases.map(item => [item.id, item]));
      for (const item of suite.cases) {
        const old = oldCases.get(item.id);
        if (!old) { diff.push(`Added case ${item.id}: ${item.title}`); continue; }
        const oldCommand = old.command; const newCommand = item.command;
        const commandChanged = oldCommand.bin !== newCommand.bin || JSON.stringify(oldCommand.args) !== JSON.stringify(newCommand.args)
          || oldCommand.cwd !== newCommand.cwd || oldCommand.timeoutMs !== newCommand.timeoutMs
          || (oldCommand.expectedExitCode ?? 0) !== (newCommand.expectedExitCode ?? 0);
        const titleChanged = old.title !== item.title;
        const environmentChanged = JSON.stringify(oldCommand.env ?? {}) !== JSON.stringify(newCommand.env ?? {});
        if (titleChanged || commandChanged || environmentChanged) diff.push(`Changed case ${item.id}${titleChanged ? " (title)" : ""}${commandChanged ? " (command/timeout/exit expectation)" : ""}${environmentChanged ? " (environment values withheld)" : ""}`);
      }
      for (const item of previous.suite.cases) if (!newCases.has(item.id)) diff.push(`Removed case ${item.id}: ${item.title}`);
      if (JSON.stringify(previous.suite.cases.map(item => item.id)) !== JSON.stringify(suite.cases.map(item => item.id))) diff.push("Case execution order changed");
      if (previous.suite.name !== suite.name) diff.push("Suite name changed");
    }
    if (previous) {
      const paths = new Set([...Object.keys(previous.files ?? {}), ...Object.keys(script.files ?? {})]);
      for (const filePath of [...paths].sort()) {
        const before = previous.files?.[filePath]; const after = script.files?.[filePath];
        if (before === undefined) diff.push(`Added test source ${filePath}`);
        else if (after === undefined) diff.push(`Removed test source ${filePath}`);
        else if (before !== after) diff.push(`Changed test source ${filePath}`);
      }
    } else for (const filePath of Object.keys(script.files ?? {}).sort()) diff.push(`Captured test source ${filePath}`);
    if (previous && !diff.length) diff.push("No changes from the previous approved version.");
    return {
      ...metadata, ...(previous ? { previousApprovedVersion: previous.version } : {}), diff,
      files: Object.entries(script.files ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([filePath, content]) => ({ path: filePath, content })),
      cases: suite.cases.map(item => ({ id: item.id, title: item.title, bin: item.command.bin, args: [...item.command.args], ...(item.command.cwd ? { cwd: item.command.cwd } : {}), ...(item.command.timeoutMs ? { timeoutMs: item.command.timeoutMs } : {}), expectedExitCode: item.command.expectedExitCode ?? 0 })),
    };
  }

  async function persist(): Promise<void> {
    await mkdir(input.artifactDir, { recursive: true });
    const temporary = `${input.registryFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify([...scripts.values()], null, 2)}\n`, "utf8");
    await rename(temporary, input.registryFile);
  }

  async function load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(input.registryFile, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item.id !== "string" || !input.profiles.some(profile => profile.id === item.profileId)
          || !Number.isInteger(item.version) || !["candidate", "approved", "rejected"].includes(item.status)
          || !item.suite || !Array.isArray(item.suite.cases) || typeof item.digest !== "string"
          || !item.files || typeof item.files !== "object" || Array.isArray(item.files)
          || !Object.entries(item.files).every(([filePath, content]) => typeof content === "string" && (() => { try { assertSafeProjectRelativePath(filePath); return true; } catch { return false; } })())
          || createHash("sha256").update(JSON.stringify(item.sourceProvenance ? { profileId: item.profileId, suite: item.suite, files: item.files, sourceProvenance: item.sourceProvenance } : { profileId: item.profileId, suite: item.suite, files: item.files })).digest("hex") !== item.digest) continue;
        scripts.set(item.id, item as ProjectScriptVersion);
      }
    } catch { /* first launch or no saved script registry */ }
  }

  async function overlayApprovedFiles(projectRoot: string, files: Record<string, string>): Promise<void> {
    const root = await realpath(projectRoot);
    for (const [relative, content] of Object.entries(files)) {
      assertSafeProjectRelativePath(relative);
      const parts = relative.split("/");
      let parent = root;
      for (const segment of parts.slice(0, -1)) {
        parent = path.join(parent, segment);
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Script parent must be a directory without links: ${relative}`);
        const actual = await realpath(parent);
        if (!actual.startsWith(`${root}${path.sep}`)) throw new Error(`Script parent resolves outside disposable project: ${relative}`);
      }
      const target = path.resolve(root, ...parts);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Script file escapes disposable project: ${relative}`);
      const info = await lstat(target).catch(() => undefined);
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`Script target must be a regular file without links: ${relative}`);
      await writeFile(target, content, "utf8");
    }
  }

  async function importSourceCandidate(profileId: string, source: { runId: string; candidateDigest: string; runtimeConclusion: string; suite: ProjectProfile['suite']; files: Record<string, string>; sourceProvenance: SourceScriptProvenance }): Promise<ProjectScriptView> {
    const profile = await loadProfile(profileId);
    if ([...scripts.values()].some(item => item.profileId === profileId && item.status === "candidate")) throw new Error("A candidate version is already awaiting review.");
    if (!source.runId || !source.candidateDigest || !source.suite.cases.length || !Object.keys(source.files).length) throw new Error("Source candidate is incomplete.");
    if (!source.sourceProvenance || source.sourceProvenance.runId !== source.runId || source.sourceProvenance.candidateDigest !== source.candidateDigest || source.sourceProvenance.runtimeConclusion !== source.runtimeConclusion) throw new Error("Source provenance does not match the imported candidate.");
    const latestApproved = [...scripts.values()].filter(item => item.profileId === profileId && item.status === "approved").sort((a, b) => b.version - a.version)[0];
    const baseline = structuredClone(latestApproved?.suite ?? profile.suite);
    const candidateIds = new Set<string>();
    const baselineFiles: Record<string, string> = latestApproved ? { ...latestApproved.files } : {};
    if (!latestApproved) {
      const profileRoot = await realpath(profile.sourceRoot);
      for (const relative of [...(profile.scriptFiles ?? []), ...(profile.optionalScriptFiles ?? [])]) {
        assertSafeProjectRelativePath(relative);
        const target = path.resolve(profileRoot, ...relative.split("/"));
        const info = await lstat(target).catch(error => (profile.optionalScriptFiles ?? []).includes(relative) && (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
        if (!info) continue;
        if (!info.isFile() || info.isSymbolicLink() || !(await realpath(target)).startsWith(`${profileRoot}${path.sep}`)) throw new Error("Registered profile script source is unsafe.");
        baselineFiles[relative] = await readFile(target, "utf8");
      }
    }
    const baselinePaths = new Set(Object.keys(baselineFiles));
    for (const item of source.suite.cases) {
      if (!item.id || candidateIds.has(item.id) || baseline.cases.some(existing => existing.id === item.id)) throw new Error("Candidate case ID conflicts with the registered profile.");
      candidateIds.add(item.id);
      if (item.command.bin !== "node" || item.command.args.length !== 2 || item.command.args[0] !== "--test" || typeof item.command.args[1] !== "string" || item.command.cwd !== undefined || item.command.env) throw new Error("Only plain node --test candidate commands are allowed.");
      const file = item.command.args[1]!; assertSafeProjectRelativePath(file);
      if (!/^(tests|specs|e2e)\/.*\.(?:[cm]?js)$/.test(file) || !source.files[file]) throw new Error("Candidate command must target an included Node test file.");
      if (baselinePaths.has(file)) throw new Error("Candidate file conflicts with a registered profile script.");
    }
    for (const file of Object.keys(source.files)) assertSafeProjectRelativePath(file);
    const version = Math.max(0, ...[...scripts.values()].filter(item => item.profileId === profileId).map(item => item.version)) + 1;
    const suite = { ...baseline, name: `${baseline.name} + Source Agent candidate`, cases: [...baseline.cases, ...source.suite.cases] };
    const files = { ...baselineFiles, ...source.files };
    const entry: ProjectScriptVersion = {
      id: randomUUID(), profileId, profileName: profile.name, suiteName: source.suite.name, version, status: "candidate",
      origin: "source-agent-candidate", createdAt: new Date().toISOString(), digest: createHash("sha256").update(JSON.stringify({ profileId, suite, files, sourceProvenance: source.sourceProvenance })).digest("hex"),
      suite, files, sourceRunId: source.runId, sourceCandidateDigest: source.candidateDigest, sourceRuntimeConclusion: source.runtimeConclusion, sourceProvenance: source.sourceProvenance,
    };
    scripts.set(entry.id, entry);
    try { await persist(); } catch (error) { scripts.delete(entry.id); throw error; }
    return view(entry);
  }

  async function createCandidate(profileId: string, generated?: { requirement: string; title: string; summary: string; steps: GrammarStep[] }): Promise<ProjectScriptView> {
    const profile = await loadProfile(profileId);
    if ([...scripts.values()].some(item => item.profileId === profileId && item.status === "candidate")) throw new Error("A candidate version is already awaiting review.");
    const version = Math.max(0, ...[...scripts.values()].filter(item => item.profileId === profileId).map(item => item.version)) + 1;
    const suite = structuredClone(profile.suite);
    const root = await realpath(profile.sourceRoot);
    const files: Record<string, string> = {};
    for (const relative of [...(profile.scriptFiles ?? []), ...(profile.optionalScriptFiles ?? [])]) {
      assertSafeProjectRelativePath(relative);
      const target = path.resolve(root, ...relative.split("/"));
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Script file escapes project root: ${relative}`);
      const info = await lstat(target).catch(error => (profile.optionalScriptFiles ?? []).includes(relative) && (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Script source must be a regular non-link file: ${relative}`);
      const actual = await realpath(target);
      if (!actual.startsWith(`${root}${path.sep}`)) throw new Error(`Script file resolves outside project root: ${relative}`);
      files[relative] = await readFile(actual, "utf8");
    }
    if (!Object.keys(files).length) throw new Error("Registered profile has no allowlisted scriptFiles.");
    if (generated) {
      if (profileId !== "grammar-lab") throw new Error("AI authoring is currently limited to the registered Grammar Lab browser profile.");
      const manifest = { title: generated.title, summary: generated.summary, requirement: generated.requirement, steps: generated.steps };
      const packageJson = JSON.parse(files["package.json"] ?? "{}");
      if (typeof packageJson.scripts?.test !== "string") throw new Error("Profile test manifest has no npm test script.");
      if (!packageJson.scripts.test.includes("tests/testpilot-generated.cjs")) packageJson.scripts.test += " && node tests/testpilot-generated.cjs";
      files["package.json"] = `${JSON.stringify(packageJson, null, 2)}\n`;
      files["tests/testpilot-generated.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
      files["tests/testpilot-generated.cjs"] = renderGrammarRunner();
    }
    const entry: ProjectScriptVersion = {
      id: randomUUID(), profileId, profileName: profile.name, suiteName: suite.name, version,
      status: "candidate", origin: generated ? "ai-requirement-candidate" : "registered-profile-snapshot", createdAt: new Date().toISOString(),
      digest: createHash("sha256").update(JSON.stringify({ profileId, suite, files })).digest("hex"), suite, files,
      ...(generated ? { requirement: generated.requirement, generationSummary: `${generated.title}: ${generated.summary}` } : {}),
    };
    scripts.set(entry.id, entry);
    try { await persist(); } catch (error) { scripts.delete(entry.id); throw error; }
    return view(entry);
  }

  return { scripts, loadProfile, view, persist, load, createCandidate, importSourceCandidate, overlayApprovedFiles };
}
