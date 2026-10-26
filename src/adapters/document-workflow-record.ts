import { createHash, randomUUID } from "node:crypto";
import { open, lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

/**
 * Durable state for the fixed document QA specialist pipeline.
 * This module stores orchestration records only; specialists and runners remain
 * owned by their existing adapters.
 */

export const DOCUMENT_WORKFLOW_SCHEMA_VERSION = 1 as const;
export const DOCUMENT_WORKFLOW_STORE_DIRECTORY = "document-workflows" as const;

export const DOCUMENT_WORKFLOW_STAGES = [
  "generate-cases",
  "review-cases",
  "author-steps",
  "human-approval",
  "deterministic-execution",
  "computer-use-execution",
  "analyze-results",
  "generate-report",
  "package-artifacts",
] as const;

export type DocumentWorkflowStageId = typeof DOCUMENT_WORKFLOW_STAGES[number];

export const DOCUMENT_WORKFLOW_SPECIALISTS = [
  "case-generator",
  "case-reviewer",
  "step-author",
  "human-review-gate",
  "deterministic-executor",
  "computer-use-observer",
  "result-analyst",
  "report-writer",
  "report-packager",
] as const;

export type DocumentWorkflowSpecialist = typeof DOCUMENT_WORKFLOW_SPECIALISTS[number];
export type DocumentWorkflowApprovalPolicy = "automatic" | "confirm-before-execution" | "confirm-each-stage";
export type DocumentWorkflowStatus = "running" | "waiting" | "failed" | "completed" | "cancelled";
export type DocumentWorkflowStageStatus = "running" | "waiting" | "failed" | "completed" | "cancelled";

const specialistForStage: Record<DocumentWorkflowStageId, DocumentWorkflowSpecialist> = {
  "generate-cases": "case-generator",
  "review-cases": "case-reviewer",
  "author-steps": "step-author",
  "human-approval": "human-review-gate",
  "deterministic-execution": "deterministic-executor",
  "computer-use-execution": "computer-use-observer",
  "analyze-results": "result-analyst",
  "generate-report": "report-writer",
  "package-artifacts": "report-packager",
};

const isoDate = z.string().datetime({ offset: true });
const safeIdentity = z.string().min(1).max(240).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "must not contain control characters");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 hex digest");
const stageIdSchema = z.enum(DOCUMENT_WORKFLOW_STAGES);
const specialistSchema = z.enum(DOCUMENT_WORKFLOW_SPECIALISTS);
const stageWaitSchema = z.object({ reason: z.string().min(1).max(10_000), waitingAt: isoDate, resumedAt: isoDate.optional() }).strict();
const stageErrorSchema = z.object({ message: z.string().min(1).max(20_000), code: z.string().max(200).optional(), details: z.string().max(20_000).optional() }).strict();
const approvalSchema = z.object({
  status: z.enum(["not-required", "pending", "approved", "rejected"]),
  requestedAt: isoDate.optional(),
  resolvedAt: isoDate.optional(),
  resolutionNote: z.string().max(10_000).optional(),
}).strict();

const stageAttemptSchema = z.object({
  stageId: stageIdSchema,
  specialist: specialistSchema,
  attempt: z.number().int().positive(),
  status: z.enum(["running", "waiting", "failed", "completed", "cancelled"]),
  inputDigest: sha256,
  outputArtifactIds: z.array(safeIdentity).max(2_000),
  startedAt: isoDate,
  updatedAt: isoDate,
  completedAt: isoDate.optional(),
  failedAt: isoDate.optional(),
  cancelledAt: isoDate.optional(),
  waitingAt: isoDate.optional(),
  resumedAt: isoDate.optional(),
  waitingReason: z.string().min(1).max(10_000).optional(),
  waits: z.array(stageWaitSchema).max(200),
  error: stageErrorSchema.optional(),
  approval: approvalSchema,
}).strict().superRefine((stage, context) => {
  if (stage.specialist !== specialistForStage[stage.stageId]) {
    context.addIssue({ code: "custom", path: ["specialist"], message: `specialist must be ${specialistForStage[stage.stageId]} for ${stage.stageId}` });
  }
  if (stage.status === "waiting" && (!stage.waitingAt || !stage.waitingReason)) {
    context.addIssue({ code: "custom", path: ["waitingReason"], message: "waiting stages require waitingAt and waitingReason" });
  }
  if (stage.status !== "waiting" && (stage.waitingAt !== undefined || stage.waitingReason !== undefined)) {
    context.addIssue({ code: "custom", path: ["waitingReason"], message: "only waiting stages may have an active waiting reason" });
  }
  if (stage.status === "completed" && !stage.completedAt) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "completed stages require completedAt" });
  }
  if (stage.status === "failed" && (!stage.failedAt || !stage.error)) {
    context.addIssue({ code: "custom", path: ["error"], message: "failed stages require failedAt and an error" });
  }
  if (stage.status === "cancelled" && (!stage.cancelledAt || !stage.error)) {
    context.addIssue({ code: "custom", path: ["error"], message: "cancelled stages require cancelledAt and a reason" });
  }
  if (stage.status !== "cancelled" && stage.cancelledAt !== undefined) {
    context.addIssue({ code: "custom", path: ["cancelledAt"], message: "only cancelled stages may have cancelledAt" });
  }
  if (stage.approval.status === "pending" && stage.status !== "waiting") {
    context.addIssue({ code: "custom", path: ["approval", "status"], message: "pending approval must leave the stage waiting" });
  }
});

const workflowPayloadSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_WORKFLOW_SCHEMA_VERSION),
  workflowId: z.string().uuid(),
  projectId: safeIdentity,
  runId: safeIdentity.optional(),
  parentRunId: safeIdentity.optional(),
  status: z.enum(["running", "waiting", "failed", "completed", "cancelled"]),
  approvalPolicy: z.enum(["automatic", "confirm-before-execution", "confirm-each-stage"]),
  createdAt: isoDate,
  updatedAt: isoDate,
  completedAt: isoDate.optional(),
  cancelledAt: isoDate.optional(),
  stages: z.array(stageAttemptSchema).max(1_000),
}).strict().superRefine((workflow, context) => {
  const attempts = new Set<string>();
  for (const [index, stage] of workflow.stages.entries()) {
    const key = `${stage.stageId}:${stage.attempt}`;
    if (attempts.has(key)) context.addIssue({ code: "custom", path: ["stages", index, "attempt"], message: "stage attempts must be unique" });
    attempts.add(key);
  }
  if (workflow.status === "completed" && !workflow.completedAt) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "completed workflows require completedAt" });
  }
  if (workflow.status !== "completed" && workflow.completedAt !== undefined) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "only completed workflows may have completedAt" });
  }
  if (workflow.status === "cancelled" && !workflow.cancelledAt) {
    context.addIssue({ code: "custom", path: ["cancelledAt"], message: "cancelled workflows require cancelledAt" });
  }
  if (workflow.status !== "cancelled" && workflow.cancelledAt !== undefined) {
    context.addIssue({ code: "custom", path: ["cancelledAt"], message: "only cancelled workflows may have cancelledAt" });
  }
});

const documentWorkflowRecordSchema = workflowPayloadSchema.extend({ recordDigest: sha256 }).strict();
export type DocumentWorkflowStageAttempt = z.infer<typeof stageAttemptSchema>;
export type DocumentWorkflowRecord = z.infer<typeof documentWorkflowRecordSchema>;
export type DocumentWorkflowListFilter = { projectId?: string; status?: DocumentWorkflowStatus; limit?: number };

const maxRecordBytes = 5_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function artifactsBase(): string {
  return path.resolve(process.env.TESTPILOT_ARTIFACTS_DIR ?? process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"));
}

function storeRoot(): string {
  return path.resolve(artifactsBase(), DOCUMENT_WORKFLOW_STORE_DIRECTORY);
}

function workflowPath(workflowId: string): string {
  if (!uuidPattern.test(workflowId)) throw new Error("Invalid workflowId; expected a UUID.");
  const root = storeRoot();
  const target = path.resolve(root, `${workflowId}.json`);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Workflow record path escapes its store directory.");
  return target;
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Workflow digest input must contain only finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Workflow digest input cannot contain circular references.");
    seen.add(value);
    const result = `[${value.map(item => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) {
      throw new Error("Workflow digest input must use plain JSON objects.");
    }
    if (seen.has(object)) throw new Error("Workflow digest input cannot contain circular references.");
    seen.add(object);
    // Match JSON storage semantics: optional fields with `undefined` are omitted.
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
    const result = `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key], seen)}`).join(",")}}`;
    seen.delete(object);
    return result;
  }
  throw new Error("Workflow digest input must be JSON-compatible.");
}

export function digestDocumentWorkflowContent(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function digestRecord(payload: z.infer<typeof workflowPayloadSchema>): string {
  return digestDocumentWorkflowContent(payload);
}

function withDigest(payload: z.infer<typeof workflowPayloadSchema>): DocumentWorkflowRecord {
  const parsed = workflowPayloadSchema.parse(payload);
  return documentWorkflowRecordSchema.parse({ ...parsed, recordDigest: digestRecord(parsed) });
}

function checkDigest(record: DocumentWorkflowRecord): boolean {
  const { recordDigest, ...payload } = record;
  return digestRecord(payload) === recordDigest;
}

async function ensureStore(): Promise<string> {
  const root = storeRoot();
  await mkdir(root, { recursive: true });
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Workflow store must be a real directory; symlinks are not allowed.");
  return root;
}

async function readRecord(workflowId: string): Promise<DocumentWorkflowRecord | undefined> {
  const file = workflowPath(workflowId);
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Workflow record must be a regular file; symlinks are not allowed.");
    if (info.size > maxRecordBytes) throw new Error("Workflow record exceeds the 5 MB size limit.");
    const raw = await readFile(file, "utf8");
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(`Workflow record ${workflowId} contains invalid JSON.`); }
    const parsed = documentWorkflowRecordSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Workflow record ${workflowId} failed schema/version validation: ${parsed.error.issues.map(issue => `${issue.path.join(".") || "record"}: ${issue.message}`).join("; ")}`);
    if (!checkDigest(parsed.data)) throw new Error(`Workflow record ${workflowId} has a digest mismatch; refusing to use modified data.`);
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(record: DocumentWorkflowRecord): Promise<void> {
  const root = await ensureStore();
  const file = workflowPath(record.workflowId);
  try {
    const existing = await lstat(file);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Refusing to replace a non-regular workflow record file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(root, `.${record.workflowId}.tmp-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
        await delay(30 * (attempt + 1));
      }
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function acquireLock(workflowId: string): Promise<() => Promise<void>> {
  const root = await ensureStore();
  const lockPath = path.join(root, `.${workflowId}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      await handle.close();
      return async () => {
        try {
          const state = JSON.parse(await readFile(lockPath, "utf8")) as { token?: string };
          if (state.token === token) await rm(lockPath, { force: true });
        } catch { /* A missing lock means the operation has already been released. */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const state = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number; createdAt?: string };
        const lockAge = state.createdAt ? Date.now() - Date.parse(state.createdAt) : Number.POSITIVE_INFINITY;
        let ownerAlive = false;
        if (Number.isInteger(state.pid) && Number(state.pid) > 0) {
          try { process.kill(Number(state.pid), 0); ownerAlive = true; }
          catch (probeError) { ownerAlive = (probeError as NodeJS.ErrnoException).code === "EPERM"; }
        }
        if (!ownerAlive && lockAge > 30_000) await rm(lockPath, { force: true });
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
        if (Date.now() - (await lstat(lockPath).then(info => info.mtimeMs).catch(() => Date.now())) > 30_000) await rm(lockPath, { force: true }).catch(() => undefined);
      }
      await delay(20 + Math.floor(Math.random() * 40));
    }
  }
  throw new Error("Timed out waiting for the workflow record lock; retry the operation.");
}

async function mutate(workflowId: string, update: (record: DocumentWorkflowRecord) => DocumentWorkflowRecord): Promise<DocumentWorkflowRecord> {
  const release = await acquireLock(workflowId);
  try {
    const existing = await readRecord(workflowId);
    if (!existing) throw new Error(`Workflow ${workflowId} does not exist.`);
    const next = update(existing);
    const { recordDigest: _oldDigest, ...payload } = next;
    const sealed = withDigest(payload);
    await atomicWrite(sealed);
    return sealed;
  } finally {
    await release();
  }
}

function deriveWorkflowStatus(stages: DocumentWorkflowStageAttempt[]): DocumentWorkflowStatus {
  if (stages.some(stage => stage.status === "waiting")) return "waiting";
  if (stages.some(stage => stage.status === "running")) return "running";
  const latest = new Map<DocumentWorkflowStageId, DocumentWorkflowStageAttempt>();
  for (const stage of stages) {
    if (!latest.has(stage.stageId) || latest.get(stage.stageId)!.attempt < stage.attempt) latest.set(stage.stageId, stage);
  }
  return [...latest.values()].some(stage => stage.status === "failed") ? "failed" : "running";
}

function requiresApproval(policy: DocumentWorkflowApprovalPolicy, stageId: DocumentWorkflowStageId): boolean {
  if (policy === "confirm-each-stage") return true;
  if (policy === "confirm-before-execution") return stageId === "human-approval";
  return false;
}

export async function createDocumentWorkflow(input: {
  projectId: string;
  runId?: string;
  parentRunId?: string;
  approvalPolicy?: DocumentWorkflowApprovalPolicy;
}): Promise<DocumentWorkflowRecord> {
  const createdAt = new Date().toISOString();
  const payload = workflowPayloadSchema.parse({
    schemaVersion: DOCUMENT_WORKFLOW_SCHEMA_VERSION,
    workflowId: randomUUID(),
    projectId: input.projectId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    status: "running",
    approvalPolicy: input.approvalPolicy ?? "confirm-before-execution",
    createdAt,
    updatedAt: createdAt,
    stages: [],
  });
  const record = withDigest(payload);
  await atomicWrite(record);
  return record;
}

export async function getDocumentWorkflow(workflowId: string): Promise<DocumentWorkflowRecord | undefined> {
  return readRecord(workflowId);
}

export async function listDocumentWorkflows(filter: DocumentWorkflowListFilter = {}): Promise<DocumentWorkflowRecord[]> {
  const root = await ensureStore();
  const limit = filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Workflow list limit must be an integer between 1 and 1000.");
  const records: DocumentWorkflowRecord[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue;
    const workflowId = entry.name.slice(0, -5);
    const record = await readRecord(workflowId);
    if (record && (!filter.projectId || record.projectId === filter.projectId) && (!filter.status || record.status === filter.status)) records.push(record);
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
}

/** Link an execution run after the preparation project has been created. Links are write-once. */
export async function linkDocumentWorkflowRun(workflowId: string, input: { runId: string; parentRunId?: string }): Promise<DocumentWorkflowRecord> {
  return mutate(workflowId, record => {
    if (record.status === "completed" || record.status === "cancelled") throw new Error("Completed or cancelled workflows are immutable.");
    if (record.runId && record.runId !== input.runId) throw new Error("A workflow runId is already linked and cannot be replaced.");
    if (input.parentRunId && record.parentRunId && record.parentRunId !== input.parentRunId) throw new Error("A workflow parentRunId is already linked and cannot be replaced.");
    const updatedAt = new Date().toISOString();
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, runId: input.runId, ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), updatedAt, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
}

export type StartDocumentWorkflowStageResult = { workflow: DocumentWorkflowRecord; stage: DocumentWorkflowStageAttempt; reused: boolean };

export async function startDocumentWorkflowStage(workflowId: string, input: {
  stageId: DocumentWorkflowStageId;
  specialist: DocumentWorkflowSpecialist;
  input: unknown;
}): Promise<StartDocumentWorkflowStageResult> {
  if (input.specialist !== specialistForStage[input.stageId]) throw new Error(`Stage ${input.stageId} must use specialist ${specialistForStage[input.stageId]}.`);
  const inputDigest = digestDocumentWorkflowContent(input.input);
  let resultingStage!: DocumentWorkflowStageAttempt;
  let reused = false;
  const workflow = await mutate(workflowId, record => {
    if (record.status === "completed" || record.status === "cancelled") throw new Error("Completed or cancelled workflows are immutable; create a new workflow for another run.");
    if (record.stages.some(stage => stage.status === "running" || stage.status === "waiting")) throw new Error("Another workflow stage is still active; complete, fail, or resume it before starting another stage.");
    const reusable = [...record.stages].reverse().find(stage => stage.stageId === input.stageId && stage.status === "completed" && stage.inputDigest === inputDigest);
    if (reusable) {
      resultingStage = reusable;
      reused = true;
      return record;
    }
    const attempt = Math.max(0, ...record.stages.filter(stage => stage.stageId === input.stageId).map(stage => stage.attempt)) + 1;
    const now = new Date().toISOString();
    const approvalRequired = requiresApproval(record.approvalPolicy, input.stageId);
    const stage = stageAttemptSchema.parse({
      stageId: input.stageId,
      specialist: input.specialist,
      attempt,
      status: approvalRequired ? "waiting" : "running",
      inputDigest,
      outputArtifactIds: [],
      startedAt: now,
      updatedAt: now,
      ...(approvalRequired ? { waitingAt: now, waitingReason: `Waiting for required approval before ${input.stageId}.`, approval: { status: "pending", requestedAt: now } } : { approval: { status: "not-required" } }),
      waits: [],
    });
    resultingStage = stage;
    const stages = [...record.stages, stage];
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, status: deriveWorkflowStatus(stages), updatedAt: now, stages, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
  return { workflow, stage: resultingStage, reused };
}

export async function approveDocumentWorkflowStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, input: { approved: boolean; note?: string }): Promise<DocumentWorkflowRecord> {
  return mutate(workflowId, record => {
    const index = record.stages.findIndex(stage => stage.stageId === stageId && stage.attempt === attempt);
    if (index < 0) throw new Error(`Workflow stage ${stageId} attempt ${attempt} does not exist.`);
    const stage = record.stages[index]!;
    if (stage.status !== "waiting" || stage.approval.status !== "pending") throw new Error("This workflow stage is not waiting for approval.");
    const now = new Date().toISOString();
    const note = input.note?.trim();
    const updatedStage = stageAttemptSchema.parse(input.approved ? {
      ...stage,
      status: "running",
      updatedAt: now,
      waitingAt: undefined,
      waitingReason: undefined,
      resumedAt: now,
      waits: [...stage.waits, { reason: stage.waitingReason!, waitingAt: stage.waitingAt!, resumedAt: now }],
      approval: { status: "approved", requestedAt: stage.approval.requestedAt, resolvedAt: now, ...(note ? { resolutionNote: note } : {}) },
    } : {
      ...stage,
      status: "failed",
      updatedAt: now,
      waitingAt: undefined,
      waitingReason: undefined,
      failedAt: now,
      error: { message: note || "Required approval was rejected.", code: "approval-rejected" },
      approval: { status: "rejected", requestedAt: stage.approval.requestedAt, resolvedAt: now, ...(note ? { resolutionNote: note } : {}) },
    });
    const stages = [...record.stages]; stages[index] = updatedStage;
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, status: deriveWorkflowStatus(stages), updatedAt: now, stages, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
}

export async function completeDocumentWorkflowStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, outputArtifactIds: string[]): Promise<DocumentWorkflowRecord> {
  return updateStage(workflowId, stageId, attempt, stage => {
    if (stage.status !== "running") throw new Error(`Cannot complete ${stageId} attempt ${attempt} while status is ${stage.status}.`);
    if (!Array.isArray(outputArtifactIds) || outputArtifactIds.length > 2_000) throw new Error("outputArtifactIds must be an array of at most 2000 artifact IDs.");
    if (new Set(outputArtifactIds).size !== outputArtifactIds.length) throw new Error("outputArtifactIds must be unique within a stage attempt.");
    const now = new Date().toISOString();
    return { ...stage, status: "completed", outputArtifactIds, updatedAt: now, completedAt: now };
  });
}

export async function failDocumentWorkflowStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, error: string | { message: string; code?: string; details?: string }): Promise<DocumentWorkflowRecord> {
  return updateStage(workflowId, stageId, attempt, stage => {
    if (stage.status !== "running") throw new Error(`Cannot fail ${stageId} attempt ${attempt} while status is ${stage.status}.`);
    const normalized = typeof error === "string" ? { message: error } : error;
    const now = new Date().toISOString();
    return { ...stage, status: "failed", updatedAt: now, failedAt: now, error: stageErrorSchema.parse(normalized) };
  });
}

export async function waitDocumentWorkflowStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, reason: string): Promise<DocumentWorkflowRecord> {
  return updateStage(workflowId, stageId, attempt, stage => {
    if (stage.status !== "running") throw new Error(`Cannot wait ${stageId} attempt ${attempt} while status is ${stage.status}.`);
    const now = new Date().toISOString();
    const checkedReason = z.string().trim().min(1).max(10_000).parse(reason);
    return { ...stage, status: "waiting", updatedAt: now, waitingAt: now, waitingReason: checkedReason };
  });
}

export async function resumeDocumentWorkflowStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number): Promise<DocumentWorkflowRecord> {
  return updateStage(workflowId, stageId, attempt, stage => {
    if (stage.status !== "waiting") throw new Error(`Cannot resume ${stageId} attempt ${attempt} while status is ${stage.status}.`);
    if (stage.approval.status === "pending") throw new Error("Resolve the pending approval with approveDocumentWorkflowStage before resuming this stage.");
    const now = new Date().toISOString();
    return {
      ...stage,
      status: "running",
      updatedAt: now,
      resumedAt: now,
      waits: [...stage.waits, { reason: stage.waitingReason!, waitingAt: stage.waitingAt!, resumedAt: now }],
      waitingAt: undefined,
      waitingReason: undefined,
    };
  });
}

async function updateStage(workflowId: string, stageId: DocumentWorkflowStageId, attempt: number, update: (stage: DocumentWorkflowStageAttempt) => DocumentWorkflowStageAttempt): Promise<DocumentWorkflowRecord> {
  return mutate(workflowId, record => {
    if (record.status === "completed" || record.status === "cancelled") throw new Error("Completed or cancelled workflows are immutable.");
    const index = record.stages.findIndex(stage => stage.stageId === stageId && stage.attempt === attempt);
    if (index < 0) throw new Error(`Workflow stage ${stageId} attempt ${attempt} does not exist.`);
    const stages = [...record.stages];
    stages[index] = stageAttemptSchema.parse(update(stages[index]!));
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, status: deriveWorkflowStatus(stages), updatedAt: new Date().toISOString(), stages, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
}

/** Mark the workflow done only after every fixed specialist stage has a completed latest attempt. */
export async function completeDocumentWorkflow(workflowId: string): Promise<DocumentWorkflowRecord> {
  return mutate(workflowId, record => {
    if (record.status === "completed") return record;
    if (record.status === "cancelled") throw new Error("Cancelled workflows cannot be completed.");
    if (record.stages.some(stage => stage.status === "running" || stage.status === "waiting")) throw new Error("Cannot complete a workflow while a stage is running or waiting.");
    const latest = new Map<DocumentWorkflowStageId, DocumentWorkflowStageAttempt>();
    for (const stage of record.stages) if (!latest.has(stage.stageId) || latest.get(stage.stageId)!.attempt < stage.attempt) latest.set(stage.stageId, stage);
    const incomplete = DOCUMENT_WORKFLOW_STAGES.filter(stageId => latest.get(stageId)?.status !== "completed");
    if (incomplete.length) throw new Error(`Cannot complete workflow; latest completed attempts are missing for: ${incomplete.join(", " )}.`);
    const now = new Date().toISOString();
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, status: "completed", completedAt: now, updatedAt: now, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
}

/** Finish an active workflow with an explicit cancellation state. */
export async function cancelDocumentWorkflow(workflowId: string, reason = "Run cancelled by user."): Promise<DocumentWorkflowRecord> {
  return mutate(workflowId, record => {
    if (record.status === "completed") throw new Error("Completed workflows are immutable.");
    if (record.status === "cancelled") return record;
    const now = new Date().toISOString();
    const stages = record.stages.map(stage => {
      if (stage.status !== "running" && stage.status !== "waiting") return stage;
      return stageAttemptSchema.parse({
        ...stage,
        status: "cancelled",
        updatedAt: now,
        cancelledAt: now,
        waitingAt: undefined,
        waitingReason: undefined,
        error: { message: reason.slice(0, 20_000), code: "user-cancelled" },
        approval: stage.approval.status === "pending"
          ? { status: "rejected", requestedAt: stage.approval.requestedAt, resolvedAt: now, resolutionNote: "Run cancelled before approval." }
          : stage.approval,
      });
    });
    const { recordDigest: _digest, ...payload } = record;
    return { ...payload, status: "cancelled", cancelledAt: now, updatedAt: now, stages, recordDigest: record.recordDigest } as DocumentWorkflowRecord;
  });
}
