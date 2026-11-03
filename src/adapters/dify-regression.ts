import type { RegressionSourceItem, RegressionBaseline, RegressionVersion, RegressionRun } from '../domain/dify-regression-contracts.js';
export type { RegressionSourceItem, RegressionBaseline, RegressionVersion, RegressionRun } from '../domain/dify-regression-contracts.js';
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";

const text = z.string().trim().min(1).max(12000);
const itemSchema = z.object({
  case_id: text.max(160), title: text.max(500), source_path: z.array(z.string().min(1).max(12000)).min(1).max(50),
  source_expected_verbatim: z.string().min(1).max(12000), source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  preconditions_proposed: z.array(text).max(50).default([]), steps_proposed: z.array(text).max(50).default([]),
  needs_confirmation: z.array(text).max(50).default([]),
});
const baselineSchema = z.object({ name: text.max(250), baseline_sha256: z.string().regex(/^[a-f0-9]{64}$/), cases: z.array(itemSchema).min(1).max(1000) });
type Task = { id: string; baselineId: string; sourceIds: string[]; createdAt: string; status: "running" | "completed" | "error"; execution_status: "not_executed"; error?: string; versionId?: string; difyRunId?: string };
type Review = { id: string; versionId: string; decision: "approved" | "rejected"; reviewer: string; notes: string; createdAt: string };
type Result = { caseId: string; title: string; status: "not_executed" | "passed" | "failed" | "blocked"; actual: string; evidence: string };
const now = () => new Date().toISOString();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Project-owned records, separate from the target MySQL database and Dify log retention. */
export class DifyRegressionStore {
  private db: DatabaseSync;
  private active = new Set<string>();
  constructor(directory: string, private fetcher: typeof fetch = fetch) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "regression.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, task_id TEXT NOT NULL);");
    for (const task of this.list<Task>("task")) if (task.status === "running") this.put("task", { ...task, status: "error", error: "服务已重启；上次整理未完成，请重新发起。" });
  }
  close() { this.db.close(); }
  private put<T extends { id: string }>(kind: string, value: T) { this.db.prepare("INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE records.kind=excluded.kind").run(kind, value.id, JSON.stringify(value)); return value; }
  private list<T>(kind: string): T[] { return this.db.prepare("SELECT payload FROM records WHERE kind=? ORDER BY rowid DESC").all(kind).map(row => JSON.parse(String(row.payload)) as T); }
  private get<T>(kind: string, id: string): T { const row = this.db.prepare("SELECT payload FROM records WHERE kind=? AND id=?").get(kind, id); if (!row) throw new Error("记录不存在。"); return JSON.parse(String(row.payload)) as T; }
  state() { return { baselines: this.list<RegressionBaseline>("baseline"), tasks: this.list<Task>("task"), versions: this.list<RegressionVersion>("version"), reviews: this.list<Review>("review"), runs: this.list<RegressionRun>("run"), configured: Boolean(process.env.TESTPILOT_DIFY_API_KEY), workflowUrl: process.env.TESTPILOT_DIFY_WORKFLOW_URL ?? "" }; }
  importBaseline(input: unknown) {
    const data = baselineSchema.parse(input);
    if (new Set(data.cases.map(c => c.case_id)).size !== data.cases.length) throw new Error("来源编号重复。");
    if (data.cases.some(c => c.source_sha256 !== data.baseline_sha256)) throw new Error("用例与基线哈希不一致。");
    const existing = this.list<RegressionBaseline>("baseline").find(b => b.baseline_sha256 === data.baseline_sha256 && digest(b.cases) === digest(data.cases));
    if (existing) return existing;
    const value: RegressionBaseline = { ...data, id: randomUUID(), createdAt: now() }; this.put("baseline", value); return value;
  }
  importXmind(name: string, encoded: string) {
    if (!name.toLowerCase().endsWith(".xmind")) throw new Error("请选择 XMind 文件。");
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("XMind 文件须为 1 字节到 4 MB。");
    const files = unzipSync(bytes, { filter: entry => entry.name === "content.json" && entry.originalSize < 12 * 1024 * 1024 });
    if (!files["content.json"]) throw new Error("需要包含 content.json 的新版 XMind 文件；请导出为 JSON 后导入。");
    const sheets: any = JSON.parse(strFromU8(files["content.json"]));
    if (!Array.isArray(sheets)) throw new Error("XMind 内容格式无效。");
    const sha = createHash("sha256").update(bytes).digest("hex"); const cases: RegressionSourceItem[] = [];
    const visit = (topic: any, parents: string[], depth: number) => {
      if (depth > 50 || cases.length > 1000) throw new Error("XMind 超出层级或条目上限。");
      const title = typeof topic?.title === "string" && topic.title.trim() ? topic.title : "（无标题节点）";
      const source_path = [...parents, title]; const children = [...(topic.children?.attached ?? []), ...(topic.children?.detached ?? [])];
      if (children.length) children.forEach((child: any) => visit(child, source_path, depth + 1));
      else { if (typeof topic.id !== "string" || !topic.id) throw new Error("XMind 缺少节点编号。"); cases.push({ case_id: `XM-${topic.id}`, title: parents.at(-1) ?? title, source_path, source_sha256: sha, source_expected_verbatim: title, preconditions_proposed: [], steps_proposed: [], needs_confirmation: ["叶子条目不一定是可执行用例，请核对范围、前置条件与操作步骤。"] }); }
    };
    sheets.forEach(sheet => visit(sheet.rootTopic, [], 0));
    return this.importBaseline({ name, baseline_sha256: sha, cases });
  }
  start(input: unknown) {
    const data = z.object({ baselineId: text, sourceIds: z.array(text).min(1).max(12), requestId: z.string().uuid() }).parse(input);
    if (new Set(data.sourceIds).size !== data.sourceIds.length) throw new Error("不能重复选择条目。");
    const baseline = this.get<RegressionBaseline>("baseline", data.baselineId);
    const selected = data.sourceIds.map(id => { const c = baseline.cases.find(item => item.case_id === id); if (!c) throw new Error("来源编号不属于当前基线。"); return c; });
    const fingerprint = digest({ baselineId: baseline.id, sourceIds: data.sourceIds });
    if (JSON.stringify({ baseline_sha256: baseline.baseline_sha256, cases: selected }).length > 60000) throw new Error("来源内容超过 Dify 输入上限，请减少选中条目。");
    const previous = this.db.prepare("SELECT fingerprint,task_id FROM idempotency WHERE key=?").get(data.requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error("重复请求编号对应不同内容。"); return this.get<Task>("task", String(previous.task_id)); }
    if (this.active.size >= 2) throw new Error("已有两项整理任务，请稍后再试。");
    const task: Task = { id: randomUUID(), baselineId: baseline.id, sourceIds: data.sourceIds, createdAt: now(), status: "running", execution_status: "not_executed" };
    this.db.exec("BEGIN IMMEDIATE");
    try { this.put("task", task); this.db.prepare("INSERT INTO idempotency VALUES(?,?,?)").run(data.requestId, fingerprint, task.id); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.active.add(task.id);
    void this.generate(task, baseline, selected).finally(() => this.active.delete(task.id));
    return task;
  }
  private async generate(task: Task, baseline: RegressionBaseline, selected: RegressionSourceItem[]) {
    try {
      const key = process.env.TESTPILOT_DIFY_API_KEY;
      if (!key) throw new Error("未配置 Dify API Key；任务已留档，尚未整理或执行。");
      const base = new URL(process.env.TESTPILOT_DIFY_BASE_URL ?? "https://api.dify.ai/v1");
      if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Dify 地址需要不含凭据的 HTTPS 地址。");
      const response = await this.fetcher(`${base.href.replace(/\/$/, "")}/workflows/run`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(150_000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ inputs: { source_json: JSON.stringify({ baseline_sha256: baseline.baseline_sha256, cases: selected }) }, response_mode: "blocking", user: `testpilot-${task.id}` }),
      });
      if (!response.ok) throw new Error(`Dify 返回 HTTP ${response.status}；未生成可审核版本。`);
      const payload: any = await response.json();
      if (typeof payload.workflow_run_id === "string") task.difyRunId = payload.workflow_run_id;
      if (payload.data?.status !== "succeeded") throw new Error("Dify 工作流未成功完成；未生成可审核版本。");
      const output = payload.data.outputs?.result;
      const parsed = typeof output === "string" ? JSON.parse(output) : output;
      const cases = validateDifyOutput(parsed, baseline.baseline_sha256, selected);
      const version: RegressionVersion = { id: randomUUID(), taskId: task.id, baselineId: baseline.id, createdAt: now(), cases, digest: digest(cases) };
      this.db.exec("BEGIN IMMEDIATE");
      try { this.put("version", version); task.versionId = version.id; task.status = "completed"; this.put("task", task); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    } catch (error) {
      task.status = "error";
      // Never persist raw upstream errors: providers may echo credentials or user data.
      task.error = error instanceof z.ZodError ? "Dify 输出字段校验失败；未生成可审核版本。" : error instanceof Error && /^(Dify |未配置|来源|输出|基线)/.test(error.message) ? error.message.slice(0, 500) : "整理失败或超时；未生成可审核版本，请检查 Dify 日志后重试。";
      this.put("task", task);
    }
  }
  review(input: unknown) {
    const data = z.object({ versionId: text, decision: z.enum(["approved", "rejected"]), reviewer: text.max(100), notes: text.max(4000) }).parse(input);
    this.get<RegressionVersion>("version", data.versionId);
    const review: Review = { ...data, id: randomUUID(), createdAt: now() }; this.put("review", review); return review;
  }
  createRun(input: unknown) {
    const data = z.object({ versionId: text, systemVersion: text.max(250), databaseLabel: text.max(250), tester: text.max(100) }).parse(input);
    const version = this.get<RegressionVersion>("version", data.versionId);
    const review = this.list<Review>("review").find(r => r.versionId === version.id);
    const run: RegressionRun = { ...data, id: randomUUID(), versionDigest: version.digest, reviewId: review?.decision === "approved" ? review.id : null, createdAt: now(), results: version.cases.map(c => ({ caseId: c.case_id, title: c.title, status: "not_executed", actual: "", evidence: "" })) };
    this.put("run", run); return run;
  }
  recordResult(input: unknown) {
    const data = z.object({ runId: text, caseId: text, status: z.enum(["passed", "failed", "blocked", "not_executed"]), actual: z.string().max(6000), evidence: z.string().max(6000) }).parse(input);
    const run = this.get<RegressionRun>("run", data.runId); const result = run.results.find(c => c.caseId === data.caseId);
    if (!result) throw new Error("本轮没有该用例。");
    if (["passed", "failed"].includes(data.status) && !run.reviewId) throw new Error("本轮未绑定人工批准记录，请先审核版本再新建一轮。");
    if (data.status !== "not_executed" && !data.actual.trim()) throw new Error("请填写实际结果或阻塞原因。");
    if (["passed", "failed"].includes(data.status) && !data.evidence.trim()) throw new Error("通过或失败须填写证据位置或操作记录。");
    const event = { id: randomUUID(), runId: run.id, caseId: result.caseId, previous: structuredClone(result), next: data, createdAt: now() };
    this.db.exec("BEGIN IMMEDIATE");
    try { Object.assign(result, { status: data.status, actual: data.actual, evidence: data.evidence }); this.put("run", run); this.put("result-event", event); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return run;
  }
}

export function validateDifyOutput(output: any, sha: string, selected: RegressionSourceItem[]): RegressionVersion["cases"] {
  if (output?.baseline_sha256 !== sha) throw new Error("基线哈希被改动。");
  if (!Array.isArray(output.cases) || output.cases.length !== selected.length) throw new Error("输出条目数与输入不一致。");
  const seen = new Set<string>();
  return output.cases.map((value: any) => {
    const item = itemSchema.parse(value); const original = selected.find(c => c.case_id === item.case_id);
    if (!original || seen.has(item.case_id)) throw new Error("来源缺失、重复或不属于本次输入。");
    seen.add(item.case_id);
    if (item.source_sha256 !== sha || JSON.stringify(item.source_path) !== JSON.stringify(original.source_path) || item.source_expected_verbatim !== original.source_expected_verbatim || value.expected_result !== original.source_expected_verbatim) throw new Error("来源或原文预期被改动。");
    if (value.review_status !== "draft" || value.execution_status !== "not_executed" || value.actual_result !== null) throw new Error("输出试图把草稿标成已审核或已执行。");
    return { ...item, expected_result: original.source_expected_verbatim, review_status: "draft", execution_status: "not_executed", actual_result: null };
  });
}
