import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { ApiDesignAssessmentCheck, CaseResult, RunRecord } from "../domain/types.js";

export type ApiFinding = {
  findingId: string;
  key: string;
  suiteId: string;
  suiteDigest: string;
  kind: "assertion" | "design-gap" | "manual-review";
  state: "open" | "resolved";
  category?: ApiDesignAssessmentCheck["category"];
  caseId?: string;
  operationKey?: string;
  requirementId?: string;
  title: string;
  summary: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRunId: string;
  resolvedAt?: string;
  resolvedByRunId?: string;
  history: Array<{ runId: string; at: string; state: "open" | "resolved"; summary: string }>;
};

export type ApiFindingStore = { version: 1; suiteId: string; updatedAt: string; findings: ApiFinding[] };
export type ApiFindingUpdate = Pick<ApiFinding, "findingId" | "state" | "kind" | "caseId" | "operationKey" | "requirementId" | "title" | "occurrences" | "firstSeenAt" | "lastSeenAt" | "resolvedAt" | "resolvedByRunId">;

const maxHistoryPerFinding = 50;
const locks = new Map<string, Promise<void>>();

export async function readApiFindingStore(root: string, suiteId: string): Promise<ApiFindingStore> {
  const file = storePath(root, suiteId);
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (isStore(value, suiteId)) return value;
  } catch { /* missing store starts with an empty history */ }
  return { version: 1, suiteId, updatedAt: new Date(0).toISOString(), findings: [] };
}

export async function listApiFindingUpdates(root: string, suiteId: string): Promise<ApiFindingStore> {
  return readApiFindingStore(root, suiteId);
}

export async function recordApiFindings(options: { root: string; suiteId: string; suiteDigest: string; run: RunRecord; recordPath: string; packagePath: string }): Promise<ApiFindingStore> {
  return withSuiteLock(options.suiteId, async () => {
    const store = await readApiFindingStore(options.root, options.suiteId);
    const now = options.run.completedAt;
    const updates = new Map<string, { key: string; kind: ApiFinding["kind"]; category?: ApiFinding["category"]; caseId?: string; operationKey?: string; requirementId?: string; title: string; summary: string }>();
    const clearKeys = new Set<string>();
    const coveredDesignTargets = new Set<string>();

    for (const check of options.run.apiDesignAssessment?.checks ?? []) {
      const key = findingKey(options.suiteId, check.category, check.operationKey, check.requirementId, check.caseId);
      if (check.status === "not-run") continue;
      if (check.status === "confirmed" && check.caseId) clearKeys.add(key);
      if (check.status === "confirmed" && check.caseId) coveredDesignTargets.add(designTargetKey(check.category, check.operationKey, check.requirementId));
      const kind = check.status === "not-authored" ? "design-gap" : check.status === "manual-review" ? "manual-review" : "assertion";
      const actionable = ["mismatch", "no-response", "partial-response", "not-authored", "manual-review"].includes(check.status);
      if (!actionable) continue;
      updates.set(key, {
        key, kind, category: check.category, ...(check.caseId ? { caseId: check.caseId } : {}), operationKey: check.operationKey,
        ...(check.requirementId ? { requirementId: check.requirementId } : {}),
        title: `${categoryName(check.category)} · ${check.operationKey}${check.requirementId ? ` · ${check.requirementId}` : ""}`,
        summary: assessmentSummary(check),
      });
    }

    for (const result of options.run.results) {
      if (!result.caseId || result.caseId === "__runner__") continue;
      const key = findingKey(options.suiteId, "assertion", undefined, undefined, result.caseId);
      if (result.status === "passed") clearKeys.add(key);
      if (result.status !== "failed" && result.status !== "error") continue;
      updates.set(key, {
        key, kind: "assertion", caseId: result.caseId,
        title: result.title,
        summary: safeCaseSummary(result),
      });
    }

    const changed: ApiFinding[] = [];
    for (const [key, issue] of updates) {
      const existingIndex = store.findings.findIndex(item => item.key === key);
      const existing = existingIndex >= 0 ? store.findings[existingIndex]! : undefined;
      const findingId = existing?.findingId ?? createHash("sha256").update(key).digest("hex").slice(0, 24);
      const event: ApiFinding["history"][number] = { runId: options.run.runId, at: now, state: "open", summary: issue.summary };
      const value: ApiFinding = {
        ...(existing ?? {} as ApiFinding),
        findingId, key, suiteId: options.suiteId, suiteDigest: options.suiteDigest, kind: issue.kind, state: "open",
        ...(issue.category ? { category: issue.category } : {}), ...(issue.caseId ? { caseId: issue.caseId } : {}),
        ...(issue.operationKey ? { operationKey: issue.operationKey } : {}), ...(issue.requirementId ? { requirementId: issue.requirementId } : {}),
        title: issue.title, summary: issue.summary, occurrences: (existing?.occurrences ?? 0) + 1,
        firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now, lastRunId: options.run.runId,
        history: [...(existing?.history ?? []), event].slice(-maxHistoryPerFinding),
      };
      delete value.resolvedAt;
      delete value.resolvedByRunId;
      if (existingIndex >= 0) store.findings[existingIndex] = value;
      else store.findings.push(value);
      changed.push(value);
    }

    for (const finding of store.findings) {
      if (finding.state !== "open" || updates.has(finding.key)) continue;
      const exactClear = clearKeys.has(finding.key);
      const designGapClear = finding.kind === "design-gap" && finding.category !== undefined && finding.operationKey !== undefined
        && coveredDesignTargets.has(designTargetKey(finding.category, finding.operationKey, finding.requirementId));
      if (!exactClear && !designGapClear) continue;
      finding.state = "resolved";
      finding.resolvedAt = now;
      finding.resolvedByRunId = options.run.runId;
      finding.lastSeenAt = now;
      finding.lastRunId = options.run.runId;
      finding.summary = exactClear ? "后续运行已通过对应 case。" : "后续运行已为该设计目标补齐并通过 case。";
      const event: ApiFinding["history"][number] = { runId: options.run.runId, at: now, state: "resolved", summary: finding.summary };
      finding.history = [...finding.history, event].slice(-maxHistoryPerFinding);
      changed.push(finding);
    }

    store.updatedAt = now;
    store.findings.sort((a, b) => Number(a.state === "resolved") - Number(b.state === "resolved") || b.lastSeenAt.localeCompare(a.lastSeenAt));
    await writeStore(options.root, store);
    const openCount = store.findings.filter(item => item.state === "open").length;
    options.run.apiFindingUpdates = changed.map(toUpdate);
    await writeRunArtifacts(options.run, options.recordPath, options.packagePath, store, openCount);
    return store;
  });
}

function assessmentSummary(check: ApiDesignAssessmentCheck): string {
  const actual = check.observedStatuses.length ? [...new Set(check.observedStatuses)].map(status => `HTTP ${status}`).join(", ") : "no HTTP response";
  if (check.status === "mismatch") return `Expected response class ${check.expectedResponse}; observed ${actual}.`;
  if (check.status === "no-response") return `Expected response class ${check.expectedResponse}; no HTTP response was observed.`;
  if (check.status === "partial-response") return `Expected response class ${check.expectedResponse}; only some requests responded (${actual}).`;
  if (check.status === "not-authored") return "This eligible contract target has no matching test case.";
  return "The contract constraint is unsupported by automatic boundary analysis and needs human review.";
}

function safeCaseSummary(result: CaseResult): string {
  if (result.error) return result.evidence.some(item => item.kind === "timeout") ? "The request timed out; inspect the linked run evidence." : "The case returned a runner or assertion error; inspect the linked run evidence.";
  return "The case's declared assertion failed; inspect the linked, redacted run evidence.";
}

function categoryName(category: ApiDesignAssessmentCheck["category"]): string {
  return ({ success: "Success response", error: "Error response", authorization: "Authorization", boundary: "Boundary", "manual-review": "Manual review" })[category];
}

function findingKey(suiteId: string, category: string, operationKey?: string, requirementId?: string, caseId?: string): string {
  return [suiteId, category, operationKey ?? "", requirementId ?? "", caseId ?? ""].join("|");
}

function designTargetKey(category: string, operationKey: string, requirementId?: string): string {
  return [category, operationKey, requirementId ?? ""].join("|");
}

function toUpdate(item: ApiFinding): ApiFindingUpdate {
  return { findingId: item.findingId, state: item.state, kind: item.kind, ...(item.caseId ? { caseId: item.caseId } : {}), ...(item.operationKey ? { operationKey: item.operationKey } : {}), ...(item.requirementId ? { requirementId: item.requirementId } : {}), title: item.title, occurrences: item.occurrences, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt, ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}), ...(item.resolvedByRunId ? { resolvedByRunId: item.resolvedByRunId } : {}) };
}

async function writeRunArtifacts(run: RunRecord, recordPath: string, packagePath: string, store: ApiFindingStore, openCount: number): Promise<void> {
  await writeFile(recordPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  const reportPath = path.join(path.dirname(recordPath), "report.md");
  const originalReport = await readFile(reportPath, "utf8");
  const updates = run.apiFindingUpdates ?? [];
  const section = ["", "## Persistent finding history", "", `Open review items across runs: ${openCount}.`, "", ...(updates.length ? updates.map(item => `- ${item.state.toUpperCase()} · ${item.findingId} · ${item.title} · ${item.state === "open" ? `occurrences ${item.occurrences}` : `resolved ${item.resolvedAt ?? ""}`}`) : ["- No finding state changed in this run."]), ""].join("\n");
  await writeFile(reportPath, `${originalReport.replace(/\n## Persistent finding history[\s\S]*$/u, "").trimEnd()}\n${section}`, "utf8");
  const archive = unzipSync(await readFile(packagePath));
  archive["run.json"] = strToU8(`${JSON.stringify(run, null, 2)}\n`);
  archive["report.md"] = strToU8(await readFile(reportPath, "utf8"));
  archive["findings.json"] = strToU8(`${JSON.stringify(store, null, 2)}\n`);
  await writeFile(packagePath, zipSync(archive));
}

async function writeStore(root: string, store: ApiFindingStore): Promise<void> {
  const file = storePath(root, store.suiteId);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function storePath(root: string, suiteId: string): string { return path.join(root, "findings", `${suiteId}.json`); }

function isStore(value: unknown, suiteId: string): value is ApiFindingStore {
  return Boolean(value && typeof value === "object" && (value as ApiFindingStore).version === 1 && (value as ApiFindingStore).suiteId === suiteId && Array.isArray((value as ApiFindingStore).findings));
}

async function withSuiteLock<T>(suiteId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(suiteId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(suiteId, current);
  await previous.catch(() => undefined);
  try { return await action(); }
  finally { release(); if (locks.get(suiteId) === current) locks.delete(suiteId); }
}
