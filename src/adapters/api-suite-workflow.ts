import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { calculateOpenApiCoverage, parseApiSuite, type ApiOpenApiOperationFact, type ApiTestSuite } from "../storage/api-suite-loader.js";
import { runApiSuite } from "./api-test-adapter.js";
import { listApiFindingUpdates, recordApiFindings, type ApiFinding, type ApiFindingStore } from "./api-finding-tracker.js";

export type ApiSuiteCandidate = {
  id: string;
  status: "draft" | "approved" | "rejected";
  automaticReadOnlyRun: boolean;
  revision: number;
  revisionHistory?: Array<{ revision: number; digest: string; updatedAt: string }>;
  createdAt: string;
  updatedAt?: string;
  reviewedAt?: string;
  reviewerNotes?: string;
  digest: string;
  suite: ApiTestSuite;
};

const rootDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"), "api-suites");
const runDir = path.join(path.dirname(rootDir), "api-runs");
const automaticRuns = new Map<string, ReturnType<typeof executeApprovedApiSuite>>();
const fingerprint = (suite: ApiTestSuite) => createHash("sha256").update(JSON.stringify(suite)).digest("hex");

export async function createApiSuiteCandidate(value: unknown, options: { automaticReadOnlyRun?: boolean; openApiOperations?: string[]; openApiOperationFacts?: ApiOpenApiOperationFact[] } = {}): Promise<ApiSuiteCandidate> {
  const suite = parseApiSuite(value);
  if (options.openApiOperations) suite.openApiCoverage = calculateOpenApiCoverage(suite, options.openApiOperations, options.openApiOperationFacts);
  const candidate: ApiSuiteCandidate = { id: randomUUID(), status: "draft", automaticReadOnlyRun: options.automaticReadOnlyRun === true, revision: 1, createdAt: new Date().toISOString(), digest: fingerprint(suite), suite };
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, `${candidate.id}.json`), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return candidate;
}

export async function updateApiSuiteCandidate(id: string, value: unknown): Promise<ApiSuiteCandidate> {
  const candidate = await getApiSuiteCandidate(id);
  if (!candidate) throw new Error("API suite 候选不存在或无法读取。");
  if (candidate.status !== "draft") throw new Error("只有 draft 候选可编辑；审核结论不能被修改。请重新生成候选。");
  if (fingerprint(candidate.suite) !== candidate.digest) throw new Error("API suite digest 不匹配；候选内容已变化，拒绝编辑。");
  const suite = parseApiSuite(value);
  if (candidate.suite.openApiCoverage) suite.openApiCoverage = calculateOpenApiCoverage(suite, candidate.suite.openApiCoverage.operationKeys, candidate.suite.openApiCoverage.operationFacts);
  const updatedAt = new Date().toISOString();
  const revision = candidate.revision + 1;
  const updated: ApiSuiteCandidate = {
    ...candidate,
    revision,
    updatedAt,
    revisionHistory: [...(candidate.revisionHistory ?? []), { revision: candidate.revision, digest: candidate.digest, updatedAt: candidate.updatedAt ?? candidate.createdAt }],
    digest: fingerprint(suite),
    suite,
  };
  await writeFile(path.join(rootDir, `${id}.json`), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function listApiSuiteCandidates(): Promise<Array<Omit<ApiSuiteCandidate, "suite"> & { suiteName: string; caseCount: number }>> {
  await mkdir(rootDir, { recursive: true });
  const { readdir } = await import("node:fs/promises");
  const values = [];
  for (const file of await readdir(rootDir).catch(() => [])) {
    try {
      const candidate = JSON.parse(await readFile(path.join(rootDir, file), "utf8")) as ApiSuiteCandidate;
      if (validCandidate(candidate)) values.push({ id: candidate.id, status: candidate.status, automaticReadOnlyRun: candidate.automaticReadOnlyRun === true, revision: candidate.revision ?? 1, createdAt: candidate.createdAt, ...(candidate.reviewedAt ? { reviewedAt: candidate.reviewedAt } : {}), ...(candidate.reviewerNotes ? { reviewerNotes: candidate.reviewerNotes } : {}), digest: candidate.digest, suiteName: candidate.suite.name, caseCount: candidate.suite.cases.length });
    } catch { /* ignore corrupt candidate files */ }
  }
  return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getApiSuiteCandidate(id: string): Promise<ApiSuiteCandidate | undefined> {
  if (!isUuid(id)) return undefined;
  try {
    const candidate = JSON.parse(await readFile(path.join(rootDir, `${id}.json`), "utf8")) as ApiSuiteCandidate;
    candidate.revision ??= 1;
    candidate.automaticReadOnlyRun ??= false;
    return validCandidate(candidate) ? candidate : undefined;
  } catch { return undefined; }
}

export async function reviewApiSuiteCandidate(id: string, decision: "approve" | "reject", notes: string): Promise<ApiSuiteCandidate> {
  const candidate = await getApiSuiteCandidate(id);
  if (!candidate) throw new Error("API suite 候选不存在或无法读取。");
  if (candidate.status !== "draft") throw new Error("API suite 已审核；需要修订时请创建新候选，已批准版本保持不可变。");
  if (fingerprint(candidate.suite) !== candidate.digest) throw new Error("API suite digest 不匹配；候选内容已变化，拒绝审核。");
  const reviewed: ApiSuiteCandidate = { ...candidate, status: decision === "approve" ? "approved" : "rejected", reviewedAt: new Date().toISOString(), reviewerNotes: notes.slice(0, 2000) };
  await writeFile(path.join(rootDir, `${id}.json`), `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
  return reviewed;
}

export async function executeApprovedApiSuite(id: string, options: { baseUrl?: string; allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean; caseIds?: string[]; rerunOf?: string; scopeOnly?: boolean; signal?: AbortSignal }) {
  const candidate = await getApiSuiteCandidate(id);
  if (!candidate) throw new Error("API suite 候选不存在或无法读取。");
  if (candidate.status !== "approved") throw new Error("只有明确审核通过的 API suite 才能执行。");
  if (fingerprint(candidate.suite) !== candidate.digest) throw new Error("已批准 API suite 的 digest 校验失败；已停止执行。");
  if (options.baseUrl !== undefined && options.baseUrl !== candidate.suite.baseUrl) throw new Error("已批准 API suite 的目标 URL 已锁定；请创建并审核一个指向新目标的候选。");
  if (options.scopeOnly === true && (!options.caseIds?.length || options.rerunOf)) throw new Error("Document-scoped API execution requires a non-empty selected case scope and cannot be used as a targeted rerun.");
  if (options.scopeOnly !== true && (options.caseIds || options.rerunOf)) {
    if (!options.caseIds?.length || !options.rerunOf) throw new Error("定向重测必须同时提供父运行记录和 case ID。");
    const parent = await getApiRun(options.rerunOf) as { scope?: unknown; results?: unknown } | undefined;
    const approvedVersion = `Approved API suite: ${candidate.id} (SHA-256 ${candidate.digest})`;
    if (!parent || !Array.isArray(parent.scope) || !parent.scope.includes(approvedVersion) || !Array.isArray(parent.results)) throw new Error("父运行记录与此已批准套件版本不匹配，拒绝定向重测。");
    const rerunnable = new Set<string>(parent.results
      .filter((result: any) => Boolean(result && typeof result.caseId === "string" && ["failed", "error"].includes(result.status)))
      .map((result: any) => result.caseId));
    if (options.caseIds.some(caseId => !rerunnable.has(caseId))) throw new Error("定向重测只能选择父运行中失败或运行错误的 approved case。");
  }
  const run = await runApiSuite({ suite: candidate.suite, ...options, outputRoot: runDir, approvedSuite: { id: candidate.id, digest: candidate.digest } });
  await recordApiFindings({ root: path.dirname(rootDir), suiteId: candidate.id, suiteDigest: candidate.digest, run: run.record, recordPath: run.recordPath, packagePath: run.packagePath });
  return run;
}

export async function getApiFindingHistory(id: string): Promise<ApiFindingStore | undefined> {
  if (!await getApiSuiteCandidate(id)) return undefined;
  return listApiFindingUpdates(path.dirname(rootDir), id);
}

export type ApiFindingDiagnosis = {
  findingId: string;
  state: ApiFinding["state"];
  source: "deterministic-evidence";
  classification: "resolved" | "assertion-failure" | "suite-design-gap" | "manual-review" | "blocked-or-stale";
  summary: string;
  evidence: { runId: string; runStatus?: string; caseId?: string; caseStatus?: string; observedStatuses: number[]; suiteDigest: string };
  recommendation: { action: "none" | "rerun-case" | "author-or-review-case" | "human-review"; summary: string; canRun: boolean; caseId?: string; parentRunId?: string };
};

export async function diagnoseApiFinding(suiteId: string, findingId: string): Promise<ApiFindingDiagnosis | undefined> {
  const candidate = await getApiSuiteCandidate(suiteId);
  if (!candidate) return undefined;
  const store = await listApiFindingUpdates(path.dirname(rootDir), suiteId);
  const finding = store.findings.find(item => item.findingId === findingId);
  if (!finding) return undefined;
  const rawRun = await getApiRun(finding.lastRunId) as any;
  const result = finding.caseId && Array.isArray(rawRun?.results) ? rawRun.results.find((item: any) => item.caseId === finding.caseId) : undefined;
  const observedStatuses = finding.caseId && Array.isArray(rawRun?.apiDesignAssessment?.checks)
    ? [...new Set<number>(rawRun.apiDesignAssessment.checks.filter((check: any) => check.caseId === finding.caseId).flatMap((check: any) => Array.isArray(check.observedStatuses) ? check.observedStatuses.filter((status: unknown) => Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599) : []))]
    : [];
  const evidence = { runId: finding.lastRunId, ...(typeof rawRun?.status === "string" ? { runStatus: rawRun.status } : {}), ...(finding.caseId ? { caseId: finding.caseId } : {}), ...(typeof result?.status === "string" ? { caseStatus: result.status } : {}), observedStatuses, suiteDigest: finding.suiteDigest };
  if (finding.state === "resolved") return { findingId, state: finding.state, source: "deterministic-evidence", classification: "resolved", summary: "此问题已由后续运行证据标记为解决。", evidence, recommendation: { action: "none", summary: "无需重测；如问题再次出现，新运行会重新打开该问题。", canRun: false } };
  if (finding.kind === "design-gap") return { findingId, state: finding.state, source: "deterministic-evidence", classification: "suite-design-gap", summary: "契约中存在适用的设计目标，但当前没有关联的测试用例，因此没有执行结果可供判断。", evidence, recommendation: { action: "author-or-review-case", summary: "补充或修订该目标的测试用例并重新审核套件；此问题没有可直接重测的 case。", canRun: false } };
  if (finding.kind === "manual-review") return { findingId, state: finding.state, source: "deterministic-evidence", classification: "manual-review", summary: "当前自动边界分析无法验证此约束，现有证据不足以判定为产品缺陷。", evidence, recommendation: { action: "human-review", summary: "由测试人员检查契约约束与样例数据；确认如何测试后再修订套件。", canRun: false } };
  const approvedVersion = `Approved API suite: ${candidate.id} (SHA-256 ${candidate.digest})`;
  const sameApprovedVersion = candidate.status === "approved" && finding.suiteDigest === candidate.digest && Array.isArray(rawRun?.scope) && rawRun.scope.includes(approvedVersion);
  const failedCase = result && ["failed", "error"].includes(result.status);
  if (sameApprovedVersion && failedCase && finding.caseId) {
    return { findingId, state: finding.state, source: "deterministic-evidence", classification: "assertion-failure", summary: observedStatuses.length ? `关联用例最近一次执行未通过；观测到 HTTP ${observedStatuses.join(", ")}。` : "关联用例最近一次执行失败或发生运行错误。", evidence, recommendation: { action: "rerun-case", summary: "可仅重测此失败用例。重测仍使用同一审核版本、目标和现有安全门禁；点击按钮即表示你批准本次重测。", canRun: true, caseId: finding.caseId, parentRunId: finding.lastRunId } };
  }
  return { findingId, state: finding.state, source: "deterministic-evidence", classification: "blocked-or-stale", summary: "没有找到同一已审核版本下可复核的失败用例证据，不能据此推荐自动重测。", evidence, recommendation: { action: "human-review", summary: "请先查看关联运行记录与套件版本；如果用例或目标已变化，修订并重新审核后再运行。", canRun: false } };
}

export async function autoRunReadOnlyApiSuite(id: string, options: { allowNetwork?: boolean }) {
  const existing = automaticRuns.get(id);
  if (existing) return existing;
  const promise = autoRunReadOnlyApiSuiteOnce(id, options);
  automaticRuns.set(id, promise);
  return promise;
}

async function autoRunReadOnlyApiSuiteOnce(id: string, options: { allowNetwork?: boolean }) {
  const candidate = await getApiSuiteCandidate(id);
  if (!candidate) throw new Error("API suite 候选不存在或无法读取。");
  if (candidate.status !== "draft") throw new Error("自动运行只接受尚未审核的新草稿。");
  if (candidate.automaticReadOnlyRun !== true) throw new Error("此套件不是由工作台自动运行策略创建的候选；请显式审核后运行。");
  const suite = candidate.suite;
  if (!suite.baseUrl) throw new Error("自动运行草稿必须保存用户指定的 Base URL。");
  const readOnly = suite.cases.every(item => ["GET", "HEAD", "OPTIONS"].includes(item.request.method) && (item.concurrency ?? 1) === 1 && !item.accessControl)
    && !suite.fixtures;
  if (!readOnly) throw new Error("自动运行仅适用于不含写请求、角色矩阵、并发和 fixture 的只读草稿；请先检查并人工审核。");
  const base = new URL(suite.baseUrl!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) && options.allowNetwork !== true) throw new Error("此 API 目标不是本机地址；请明确勾选允许外网目标后再运行。");
  await reviewApiSuiteCandidate(candidate.id, "approve", "用户关闭了运行前确认；TestPilot 仅自动批准无写请求、无角色矩阵、无并发和无 fixture 的只读草稿。");
  return executeApprovedApiSuite(candidate.id, options);
}

export async function getApiRun(id: string): Promise<unknown | undefined> {
  if (!isUuid(id)) return undefined;
  try { return JSON.parse(await readFile(path.join(runDir, id, "run.json"), "utf8")) as unknown; }
  catch { return undefined; }
}

export async function readApiRunArtifact(id: string, artifact: "report.md" | "testpilot-api-suite.zip"): Promise<Buffer | undefined> {
  if (!isUuid(id)) return undefined;
  try { return await readFile(path.join(runDir, id, artifact)); }
  catch { return undefined; }
}

function validCandidate(value: ApiSuiteCandidate): boolean {
  return Boolean(value && isUuid(value.id) && ["draft", "approved", "rejected"].includes(value.status) && (value.revision === undefined || (Number.isInteger(value.revision) && value.revision >= 1)) && (value.automaticReadOnlyRun === undefined || typeof value.automaticReadOnlyRun === "boolean") && typeof value.createdAt === "string" && typeof value.digest === "string" && value.suite && typeof value.suite.name === "string" && Array.isArray(value.suite.cases));
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
