import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSqliteMigrationSuite, isSafeRelativeFile, type SqliteMigrationSuite } from "../storage/sqlite-migration-suite.js";
import { runSqliteMigrationSuite } from "./sqlite-migration-adapter.js";

export type SqliteMigrationCandidate = {
  id: string;
  status: "draft" | "approved" | "rejected";
  revision: number;
  revisionHistory?: Array<{ revision: number; digest: string; updatedAt: string }>;
  createdAt: string;
  updatedAt?: string;
  reviewedAt?: string;
  reviewerNotes?: string;
  digest: string;
  suite: SqliteMigrationSuite;
  files: Record<string, string>;
};

const root = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"), "sqlite-migration-suites");
const runsRoot = path.join(path.dirname(root), "sqlite-migration-runs");
const maxSourceBytes = 5_000_000;
const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const hash = (suite: SqliteMigrationSuite, files: Record<string, string>) => createHash("sha256").update(JSON.stringify({ suite, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) })).digest("hex");

async function validate(suiteValue: unknown, filesValue: unknown, dir: string): Promise<{ suite: SqliteMigrationSuite; files: Record<string, string> }> {
  if (!filesValue || typeof filesValue !== "object" || Array.isArray(filesValue)) throw new Error("files must be a path-to-SQL map.");
  const files = filesValue as Record<string, string>;
  const paths = new Set<string>();
  let bytes = 0;
  for (const [name, source] of Object.entries(files)) {
    if (!isSafeRelativeFile(name) || typeof source !== "string" || Buffer.byteLength(source) > 512_000) throw new Error(`Invalid SQL source: ${name}`);
    bytes += Buffer.byteLength(source);
    if (bytes > maxSourceBytes) throw new Error("SQL source files exceed 5 MB in total.");
    paths.add(name);
  }
  const jsonPath = path.join(dir, "suite.json");
  await mkdir(dir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(suiteValue)}\n`, "utf8");
  const suite = await loadSqliteMigrationSuite(jsonPath);
  const required = [...(suite.baseline ? [suite.baseline] : []), ...suite.fixtures, ...suite.migrations.map(item => item.file)];
  if (required.some(name => !paths.has(name))) throw new Error("Every baseline, fixture and migration path in the suite must have a corresponding SQL source.");
  if ([...paths].some(name => !required.includes(name))) throw new Error("Unused SQL source files are not allowed; remove them from the candidate.");
  for (const [name, source] of Object.entries(files)) {
    const destination = path.resolve(dir, ...name.split("/"));
    if (!destination.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new Error("SQL source path escapes candidate directory.");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }
  return { suite, files };
}

export async function createSqliteMigrationCandidate(suiteValue: unknown, filesValue: unknown): Promise<SqliteMigrationCandidate> {
  const id = randomUUID();
  const dir = path.join(root, id);
  const { suite, files } = await validate(suiteValue, filesValue, dir);
  const candidate: SqliteMigrationCandidate = { id, status: "draft", revision: 1, createdAt: new Date().toISOString(), digest: hash(suite, files), suite, files };
  await writeFile(path.join(dir, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return candidate;
}

export async function updateSqliteMigrationCandidate(id: string, suiteValue: unknown, filesValue: unknown): Promise<SqliteMigrationCandidate> {
  const candidate = await getSqliteMigrationCandidate(id);
  if (!candidate) throw new Error("SQLite migration candidate does not exist or is invalid.");
  if (candidate.status !== "draft") throw new Error("Only draft candidates may be edited; reviewed candidates are immutable.");
  if (hash(candidate.suite, candidate.files) !== candidate.digest) throw new Error("Candidate digest mismatch; refusing edit.");
  const dir = path.join(root, id);
  const { suite, files } = await validate(suiteValue, filesValue, dir);
  const updatedAt = new Date().toISOString();
  const updated: SqliteMigrationCandidate = { ...candidate, revision: candidate.revision + 1, updatedAt, revisionHistory: [...(candidate.revisionHistory ?? []), { revision: candidate.revision, digest: candidate.digest, updatedAt: candidate.updatedAt ?? candidate.createdAt }], digest: hash(suite, files), suite, files };
  await writeFile(path.join(dir, "candidate.json"), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function getSqliteMigrationCandidate(id: string): Promise<SqliteMigrationCandidate | undefined> {
  if (!isId(id)) return undefined;
  try { const value = JSON.parse(await readFile(path.join(root, id, "candidate.json"), "utf8")) as SqliteMigrationCandidate; return valid(value) ? value : undefined; }
  catch { return undefined; }
}

export async function listSqliteMigrationCandidates() {
  await mkdir(root, { recursive: true });
  const result = [];
  for (const id of await readdir(root).catch(() => [])) {
    const candidate = await getSqliteMigrationCandidate(id);
    if (candidate) result.push({ id, status: candidate.status, revision: candidate.revision, createdAt: candidate.createdAt, ...(candidate.reviewedAt ? { reviewedAt: candidate.reviewedAt } : {}), digest: candidate.digest, suiteName: candidate.suite.name, scenarioCount: candidate.suite.scenarios.length, migrationCount: candidate.suite.migrations.length });
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function reviewSqliteMigrationCandidate(id: string, decision: "approve" | "reject", notes: string) {
  const candidate = await getSqliteMigrationCandidate(id);
  if (!candidate) throw new Error("SQLite migration candidate does not exist or is invalid.");
  if (candidate.status !== "draft") throw new Error("Only draft candidates can be reviewed; reviewed versions are immutable.");
  if (hash(candidate.suite, candidate.files) !== candidate.digest) throw new Error("Candidate digest mismatch; refusing review.");
  const reviewed = { ...candidate, status: decision === "approve" ? "approved" as const : "rejected" as const, reviewedAt: new Date().toISOString(), reviewerNotes: notes.slice(0, 2000) };
  await writeFile(path.join(root, id, "candidate.json"), `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
  return reviewed;
}

export async function executeApprovedSqliteMigrationSuite(id: string) {
  const candidate = await getSqliteMigrationCandidate(id);
  if (!candidate) throw new Error("SQLite migration candidate does not exist or is invalid.");
  if (candidate.status !== "approved") throw new Error("Only explicitly approved SQLite migration candidates may run.");
  if (hash(candidate.suite, candidate.files) !== candidate.digest) throw new Error("Approved candidate digest mismatch; refusing execution.");
  const isolated = await mkdtemp(path.join(root, ".run-"));
  try {
    const suitePath = path.join(isolated, "suite.json");
    await writeFile(suitePath, `${JSON.stringify(candidate.suite)}\n`, "utf8");
    for (const [name, source] of Object.entries(candidate.files)) {
      const destination = path.resolve(isolated, ...name.split("/"));
      if (!destination.startsWith(`${path.resolve(isolated)}${path.sep}`)) throw new Error("SQL source path escapes candidate directory.");
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source, "utf8");
    }
    return await runSqliteMigrationSuite({ suite: candidate.suite, suitePath, projectRoot: isolated, outputRoot: runsRoot });
  } finally { await rm(isolated, { recursive: true, force: true }); }
}

export async function readSqliteMigrationRunArtifact(runId: string, artifact: "report.md" | "testpilot-sqlite-migration-suite.zip") {
  if (!isId(runId)) return undefined;
  try { return await readFile(path.join(runsRoot, runId, artifact)); } catch { return undefined; }
}
export async function getSqliteMigrationRun(runId: string) {
  if (!isId(runId)) return undefined;
  try { return JSON.parse(await readFile(path.join(runsRoot, runId, "run.json"), "utf8")) as unknown; } catch { return undefined; }
}

function valid(value: SqliteMigrationCandidate): boolean {
  return Boolean(value && isId(value.id) && ["draft", "approved", "rejected"].includes(value.status) && Number.isInteger(value.revision) && typeof value.digest === "string" && value.suite && value.files && hash(value.suite, value.files) === value.digest);
}
