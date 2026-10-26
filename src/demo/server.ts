import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { containsCredentialLikeValue } from "../adapters/document-sensitive-data.js";
import { mkdir, readFile, writeFile, stat, readdir, rename, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import type { DemoAssertion, DemoCheck, DemoConfig, DemoEvent, DemoRequest, DemoRun, RunContext } from "./contracts.js";
import { executeDemo, generateDocumentBrowserCases, generateDocumentCaseSteps, generateGrammarPlaywrightCandidate, modelConfiguration, validateDraftLocatorsAgainstEvidence } from "./runtime.js";
import { availableRoutes, defaultChecks, defaultRequirements, handleSample } from "./sample.js";
import type { ProjectProfile, RunRecord, TestSuite } from "../domain/types.js";
import { loadProjectProfile } from "../storage/suite-loader.js";
import { prepareProfile, preserveProfileArtifacts } from "../adapters/project-profile-adapter.js";
import { DeterministicEngine } from "../engines/deterministic-engine.js";
import { saveRun } from "../reporters/markdown-reporter.js";
import { renderGrammarRunner } from "../adapters/grammar-test-script.js";
import { extractDocument, type ImportedDocument } from "../adapters/document-importer.js";
import { generateTestCaseDrafts } from "../adapters/case-generation-agent.js";
import { createExecutionDraftFromCaseGeneration } from "../adapters/case-generation-handoff.js";
import { readPublicWebsiteText } from "../adapters/public-page-reader.js";
import { searchTestExamples } from "../adapters/test-example-search.js";
import { getLoginHandoff, isLoginPage, requestLoginContinue } from "../adapters/login-handoff.js";
import { computerUseConfiguration, testComputerUseCapability } from "../adapters/computer-use.js";
import { getBrowserRuntimeStatus, testBrowserCdpConnection } from "../adapters/browser-runtime.js";
import { readModelSettingsForUi, resolveModelSettings, saveModelSettings, testModelConnection } from "../adapters/model-settings.js";
import { acquireDocumentPageLease, addNoApiNetworkAssertion, browserStepDraftBlockReason, canAuthorReadOnlyBrowserSteps, cancelDocumentRun, collectDocumentParameterNames, createReviewCases, deriveGroundedCustomerLookupSubcheck, deriveGroundedEmptyListNavigationSubcheck, deriveGroundedEmptyRequiredFieldSubcheck, deriveRelatedInvalidInputSubcheck, draftGroundedReadOnlyBrowserSteps, executeDocumentRun, explainBlockedBrowserStepDraft, getDocumentCaseVersion, getDocumentMaterialVersion, getDocumentProject, getDocumentProjectRevision, getDocumentProjectSessionStatus, getDocumentRun, getDocumentRunProgress, getDocumentRunRecovery, hasAutoRunnableSelectedCase, hasOnlyGenericShellAssertions, isDocumentBaselineEligible, listDocumentProjectRevisions, listDocumentRuns, loadDocumentProjects, makeDocumentProject, probeDocumentStep, readDocumentPackage, readDocumentSource, resolveDocumentRunParameters, retryDocumentRunPackaging, saveDocumentProject, unsupportedWeChatClientGateMessage, validateCases, validateDocumentRunScopePlan, validateDocumentTarget, writeDocumentSource, type BrowserCheck, type DocumentProject, type DocumentProjectRevisionKind, type DocumentRunMode, type DocumentRunScopePlan, type DocumentSiteVersion, type DocumentTestDataSet, type StepGenerationCaseResult } from "../adapters/document-test-workflow.js";
import { resolveDocumentInputRoles, type DocumentInputRole } from "../adapters/document-source-roles.js";
import { analyzeDocumentCaseImpact } from "../adapters/document-impact-analysis.js";
import { closePersistentTestPages, launchPersistentTestPage, navigatePersistentPage } from "../adapters/browser-runtime.js";
import { autoRunReadOnlyApiSuite, createApiSuiteCandidate, diagnoseApiFinding, executeApprovedApiSuite, getApiFindingHistory, getApiRun, getApiSuiteCandidate, listApiSuiteCandidates, readApiRunArtifact, reviewApiSuiteCandidate, updateApiSuiteCandidate } from "../adapters/api-suite-workflow.js";
import { generateApiSuite } from "../adapters/api-suite-authoring.js";
import { approveDocumentWorkflowStage, cancelDocumentWorkflow, completeDocumentWorkflow, completeDocumentWorkflowStage, createDocumentWorkflow, failDocumentWorkflowStage, getDocumentWorkflow, linkDocumentWorkflowRun, listDocumentWorkflows, resumeDocumentWorkflowStage, startDocumentWorkflowStage, waitDocumentWorkflowStage, type DocumentWorkflowStageId, type DocumentWorkflowSpecialist, type DocumentWorkflowRecord } from "../adapters/document-workflow-record.js";
import { openApiOperationFacts, summarizeOpenApiSpecification } from "../adapters/openapi-summary.js";
import { createSqliteMigrationCandidate, executeApprovedSqliteMigrationSuite, getSqliteMigrationCandidate, getSqliteMigrationRun, listSqliteMigrationCandidates, readSqliteMigrationRunArtifact, reviewSqliteMigrationCandidate, updateSqliteMigrationCandidate } from "../adapters/sqlite-migration-workflow.js";
import { connectMysqlBrowser, disconnectMysqlBrowser, listMysqlColumns, listMysqlTables, mysqlBrowserConfig, mysqlBrowserStatus, readMysqlRows } from "../adapters/mysql-readonly-browser.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4317);
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, "../..");
const artifactsDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(projectRoot, "artifacts", "demo"));
const runsDir = path.join(artifactsDir, "runs");
const regressionsFile = path.join(artifactsDir, "regressions.json");
const distDir = path.join(projectRoot, "web", "dist");
const MAX_BODY = 64 * 1024;
const RUN_TIMEOUT_MS = 90_000;
const PROJECT_RUN_TIMEOUT_MS = 180_000;
const PROJECT_RUNS_DIR = path.join(artifactsDir, "project-runs");

/** BrowserCheck normalization intentionally selects executable fields. Keep the
 * trusted, full generation trace attached by the handoff for matching IDs, but
 * never accept a replacement trace from an update request. */
function validateCasesPreservingGenerationTrace(value: unknown, existing: BrowserCheck[]): BrowserCheck[] {
  if (!Array.isArray(value)) return validateCases(value);
  const trustedTraces = new Map(existing.flatMap(item => item.caseGenerationTrace ? [[item.id, item.caseGenerationTrace] as const] : []));
  const trustedCandidates = value.map((candidate: any) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const normalized = { ...candidate };
    delete normalized.caseGenerationTrace;
    if (typeof normalized.id === "string") {
      const trace = trustedTraces.get(normalized.id);
      if (trace) normalized.caseGenerationTrace = structuredClone(trace);
    }
    return normalized;
  });
  return validateCases(trustedCandidates);
}
const PROJECT_SCRIPTS_FILE = path.join(artifactsDir, "project-scripts.json");
const runs = new Map<string, DemoRun>();
const controllers = new Map<string, AbortController>();
function requiresManualApiContractReview(project: { apiContract?: { allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean } }): boolean {
  return project.apiContract?.allowNetwork === true || project.apiContract?.allowMutations === true || project.apiContract?.allowConcurrency === true;
}
interface ProjectProfileSummary { id: string; name: string; suiteName: string }
interface ProjectRunView {
  id: string; profileId: string; profileName: string; suiteName: string;
  scriptId?: string; scriptVersion?: number;
  status: "queued" | "running" | "passed" | "failed" | "blocked" | "cancelled" | "error";
  startedAt: string; completedAt?: string; durationMs: number; summary: string;
  recordRunId?: string;
  results: RunRecord["results"]; artifactFiles: string[];
}
interface ProjectScriptVersion {
  id: string; profileId: string; profileName: string; suiteName: string; version: number;
  status: "candidate" | "approved" | "rejected"; origin: "registered-profile-snapshot" | "ai-requirement-candidate";
  createdAt: string; reviewedAt?: string; reviewDecision?: "approve" | "reject"; reviewerNotes?: string;
  digest: string; suite: TestSuite; files: Record<string, string>; requirement?: string; generationSummary?: string;
}
interface ProjectScriptView extends Omit<ProjectScriptVersion, "suite" | "files"> {
  cases: Array<{ id: string; title: string; bin: string; args: string[]; cwd?: string; timeoutMs?: number; expectedExitCode: number }>;
  previousApprovedVersion?: number;
  diff: string[];
  files: Array<{ path: string; content: string }>;
}
const registeredProfiles: ProjectProfileSummary[] = process.env.TESTPILOT_DISTRIBUTION_DEMO === "1" ? [] : [
  { id: "grammar-lab", name: "Grammar Lab · D:/work/grammar-lab-demo", suiteName: "Grammar Lab existing tests (model + browser)" },
  { id: "plural-runner", name: "Plural Runner · D:/work/plural-runner-demo", suiteName: "Plural Runner deterministic engine tests" },
  { id: "book-companion", name: "Book Companion · D:/work/book-companion-service-demo", suiteName: "Book Companion domain + local service browser tests" },
  { id: "word-runner", name: "Word Runner · D:/work/word-runner-demo", suiteName: "Word Runner deterministic engine + canvas browser tests" },
  { id: "demo-hub", name: "Demo Hub · D:/work/demo-hub", suiteName: "Demo Hub local API, SQLite migration, and backup/restore tests" },
];
const projectRuns = new Map<string, ProjectRunView>();
const projectControllers = new Map<string, AbortController>();
const projectScripts = new Map<string, ProjectScriptVersion>();
let savedChecks: DemoCheck[] = [];
let fixedTarget = false;
let activeRunId: string | undefined;

type DocumentPreparationStage = "planning" | "reading-materials" | "web-research" | "generating-cases" | "reviewing-cases" | "generating-steps" | "ready" | "needs-review" | "failed";
type DocumentPreparationTask = { id: string; status: "running" | "completed" | "needs-review" | "failed"; stage: DocumentPreparationStage; events: Array<{ stage: DocumentPreparationStage; status: "running" | "completed" | "warning" | "failed"; message: string; at: string }>; projectId?: string; workflowId?: string; error?: string; createdAt: string; updatedAt: string };
const documentPreparationTasks = new Map<string, DocumentPreparationTask>();
const documentPreparationDir = path.join(artifactsDir, "document-preparation");
async function recordDocumentPreparation(task: DocumentPreparationTask, stage: DocumentPreparationStage, state: "running" | "completed" | "warning" | "failed", message: string): Promise<void> {
  task.stage = stage; task.updatedAt = new Date().toISOString(); task.events.push({ stage, status: state, message, at: task.updatedAt });
  await mkdir(documentPreparationDir, { recursive: true });
  await writeFile(path.join(documentPreparationDir, `${task.id}.json`), JSON.stringify(task, null, 2), "utf8");
}

async function ensureProjectWorkflow(project: DocumentProject, parentRunId?: string): Promise<DocumentWorkflowRecord> {
  let workflow: DocumentWorkflowRecord | undefined;
  if (project.workflowId) {
    const existing = await getDocumentWorkflow(project.workflowId);
    if (!existing) throw new Error(`项目关联的 workflow ${project.workflowId} 缺失或校验失败；拒绝另建一条不连贯记录。`);
    if (existing.runId && (existing.status === "running" || existing.status === "waiting")) {
      const activeRecovery = await getDocumentRunRecovery(project);
      if (activeRecovery?.isRunning) return existing;
    }
    if (!existing.runId && (existing.status === "running" || existing.status === "waiting")) workflow = existing;
  }
  if (!workflow) workflow = await createDocumentWorkflow({ projectId: project.id, ...(parentRunId ? { parentRunId } : {}), approvalPolicy: project.confirmationRequired === true ? "confirm-before-execution" : "automatic" });
  project.workflowId = workflow.workflowId;
  const snapshotDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const caseDigest = snapshotDigest(project.cases);
  const generationInput = project.caseGeneration ? {
    projectId: project.id,
    artifactId: project.caseGeneration.artifactId,
    version: project.caseGeneration.version,
    generationDigest: project.caseGeneration.digest,
    requirementsDigest: snapshotDigest(project.caseGeneration.requirements),
    sourceRoles: project.sourceRoles ?? [],
  } : { projectId: project.id, sourceText: project.sourceText, caseMode: project.caseMode };
  const generationOutput = project.caseGeneration
    ? `case-generation:${project.caseGeneration.artifactId}:v${project.caseGeneration.version}:${project.caseGeneration.digest}`
    : `project:${project.id}:case-snapshot:${caseDigest}`;
  const snapshots: Array<{ stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist; input: unknown; artifact: string }> = [
    { stageId: "generate-cases", specialist: "case-generator", input: generationInput, artifact: generationOutput },
    { stageId: "review-cases", specialist: "case-reviewer", input: { cases: project.cases, caseGenerationDigest: project.caseGeneration?.digest }, artifact: `project:${project.id}:validated-case-snapshot:${caseDigest}` },
    { stageId: "author-steps", specialist: "step-author", input: { caseIds: project.cases.map(item => item.id), steps: project.cases.map(item => ({ id: item.id, steps: item.steps })) }, artifact: `project:${project.id}:step-snapshot:${snapshotDigest(project.cases.map(item => ({ id: item.id, steps: item.steps })))}` },
  ];
  let currentWorkflow = await getDocumentWorkflow(workflow.workflowId);
  const activeStage = [...(currentWorkflow?.stages ?? [])].reverse().find(stage => stage.status === "running" || stage.status === "waiting");
  if (!activeStage) {
    for (const snapshot of snapshots) {
      const started = await startDocumentWorkflowStage(workflow.workflowId, { stageId: snapshot.stageId, specialist: snapshot.specialist, input: snapshot.input });
      if (!started.reused && started.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, snapshot.stageId, started.stage.attempt, [snapshot.artifact]);
    }
  }
  currentWorkflow = await getDocumentWorkflow(workflow.workflowId);
  let gate = [...(currentWorkflow?.stages ?? [])].reverse().find(stage => stage.stageId === "human-approval" && (stage.status === "running" || stage.status === "waiting"));
  if (!gate && !activeStage) {
    const started = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "human-approval", specialist: "human-review-gate", input: { projectId: project.id, reviewStatus: project.reviewStatus ?? "draft", caseDigest } });
    gate = started.stage;
  }
  if (gate?.status === "waiting" && gate.approval.status === "pending" && project.reviewStatus === "approved") {
    await approveDocumentWorkflowStage(workflow.workflowId, "human-approval", gate.attempt, { approved: true, note: project.reviewNotes ?? "Existing project approval." });
    gate = (await getDocumentWorkflow(workflow.workflowId))!.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
  }
  if (gate?.status === "waiting" && gate.approval.status !== "pending") {
    await resumeDocumentWorkflowStage(workflow.workflowId, "human-approval", gate.attempt);
    gate = (await getDocumentWorkflow(workflow.workflowId))!.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
  }
  if (gate?.status === "running" && project.reviewStatus === "approved") {
    await completeDocumentWorkflowStage(workflow.workflowId, "human-approval", gate.attempt, [`project:${project.id}:approval:${snapshotDigest(project.reviewNotes ?? "")}`]);
  } else if (gate?.status === "running") {
    await waitDocumentWorkflowStage(workflow.workflowId, "human-approval", gate.attempt, "项目尚未通过审核；等待用户确认或补充测试范围。");
  }
  await saveDocumentProject(project);
  return (await getDocumentWorkflow(workflow.workflowId))!;
}

async function completeProjectApprovalGate(workflowId: string, project: DocumentProject, note: string): Promise<void> {
  let workflow = await getDocumentWorkflow(workflowId);
  if (!workflow) throw new Error(`workflow ${workflowId} is unavailable.`);
  let gate = [...workflow.stages].reverse().find(stage => stage.stageId === "human-approval");
  if (!gate || gate.status === "failed") {
    const started = await startDocumentWorkflowStage(workflowId, { stageId: "human-approval", specialist: "human-review-gate", input: { projectId: project.id, decision: "approved", caseDigest: createHash("sha256").update(JSON.stringify(project.cases)).digest("hex") } });
    gate = started.stage;
    workflow = started.workflow;
  }
  if (gate.status === "waiting" && gate.approval.status === "pending") {
    workflow = await approveDocumentWorkflowStage(workflowId, "human-approval", gate.attempt, { approved: true, note });
    gate = workflow.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
  } else if (gate.status === "waiting") {
    workflow = await resumeDocumentWorkflowStage(workflowId, "human-approval", gate.attempt);
    gate = workflow.stages.find(stage => stage.stageId === "human-approval" && stage.attempt === gate!.attempt)!;
  }
  if (gate.status === "running") await completeDocumentWorkflowStage(workflowId, "human-approval", gate.attempt, [`project:${project.id}:approved:${createHash("sha256").update(project.reviewNotes ?? note).digest("hex")}`]);
}

function getModelDetails(): { available: boolean; label: string } {
  try {
    const config: any = modelConfiguration();
    return { available: Boolean(config?.modelAvailable), label: String(config?.modelLabel ?? "Pi Agent Core 1.2") };
  } catch { return { available: false, label: "Pi Agent Core 1.2" }; }
}

function config(): DemoConfig {
  const model = getModelDetails();
  const computer = computerUseConfiguration();
  return {
    framework: "Pi Agent Core 1.2",
    modelAvailable: model.available,
    modelLabel: model.label,
    computerUseAvailable: computer.available,
    computerUseReason: computer.reason,
    computerUseModel: computer.model,
    fixedTarget,
    targetLabel: fixedTarget ? "订单样例 API（预置修复）" : "订单样例 API（预置缺陷）",
    defaultRequirements,
  };
}

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store", ...headers });
  res.end(data);
}

function fail(res: ServerResponse, status: number, message: string): void { json(res, status, { error: message }); }

async function bodyJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("request body too large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("request body must be valid JSON"); }
}

async function documentBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > 64 * 1024 * 1024) throw new Error("资料请求超过 64 MB。最多附加 5 个文件，每个不超过 9 MB。"); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("request body must be valid JSON"); }
}

async function migrationBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > 7 * 1024 * 1024) throw new Error("SQLite migration suite request exceeds 7 MB."); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("request body must be valid JSON"); }
}

async function collectDocumentPageEvidence(project: NonNullable<Awaited<ReturnType<typeof getDocumentProject>>>, existingPage?: Page): Promise<string> {
  const releasePageLease = existingPage ? undefined : acquireDocumentPageLease(project.id);
  if (!existingPage && !releasePageLease) throw new Error("该项目正在运行测试或使用共享浏览器页面；步骤生成未启动，结束后再重试。");
  try {
  let page = existingPage;
  if (!page) {
    const profileDir = path.join(artifactsDir, "document-tests", "browser-profiles", project.id);
    // Use the same project-owned persistent context as execution. This first
    // reconnects to its still-running Edge window; if the service was restarted
    // and the old endpoint is stale, the runtime restores the project's profile
    // instead of silently abandoning step authoring.
    const session = await launchPersistentTestPage(profileDir);
    page = session.page;
  }
  const target = new URL(project.targetUrl);
  try {
    await navigatePersistentPage(page, project.targetUrl);
  } catch (error) {
    let currentOrigin = "未知";
    try { currentOrigin = new URL(page.url()).origin; } catch { /* blank or closed page */ }
    throw new Error(`无法在项目的同一浏览器窗口打开目标页面（当前：${currentOrigin}；目标：${target.origin}）：${error instanceof Error ? error.message : String(error)}`);
  }
  await page.waitForTimeout(300);
  const clientGate = unsupportedWeChatClientGateMessage(await page.locator("body").innerText().catch(() => ""));
  if (clientGate) throw new Error(`目标页只显示“${clientGate}”；当前测试浏览器没有进入业务页面，不能根据这张门禁页编写业务步骤。请改用可访问的微信/企业微信测试会话。`);
  if (await isLoginPage(page)) throw new Error("项目的同一测试浏览器窗口已打开目标站点，但当前仍需登录。请在这个窗口完成一次登录，然后在 TestPilot 重试生成步骤；不会为用例另开窗口或要求重复扫码。");
  const evidenceScript = String.raw`(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      return Boolean(element.getClientRects().length) && style.visibility !== "hidden" && style.display !== "none";
    };
    const clean = (value, max = 120) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const safeText = value => !/(?:\b1[3-9]\d{9}\b|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{17}[\dXx]\b)/u.test(value);
    const unique = items => [...new Set(items.filter(Boolean))].slice(0, 80);
    const headings = unique(Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(visible).map(element => clean(element.textContent, 100)).filter(safeText));
    const controls = Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select,button,[role=button],[role=tab],[role=checkbox],[role=radio]"))
      .filter(visible).slice(0, 100).map(element => {
        const html = element;
        const labels = html.labels ? Array.from(html.labels).map(label => clean(label.innerText || label.textContent, 100)) : [];
        const name = clean(element.getAttribute("aria-label")) || clean(element.getAttribute("title")) || labels.find(Boolean) || clean(element.getAttribute("placeholder"));
        const text = clean(element.textContent, 100);
        const placeholder = clean(element.getAttribute("placeholder"));
        return { tag: element.tagName.toLowerCase(), role: clean(element.getAttribute("role")), type: clean(html.type), name: safeText(name) ? name : "", placeholder: safeText(placeholder) && !/(?:password|passwd|token|secret|密钥|口令)/iu.test(placeholder) ? placeholder : "", visibleText: safeText(text) ? text : "", disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true") };
      });
    const links = unique(Array.from(document.querySelectorAll("a"))
      .filter(visible).map(element => clean(element.getAttribute("aria-label") || element.textContent, 100)).filter(safeText));
    const visibleText = unique((document.body?.innerText ?? "").split(/\n+/u)
      .map(line => clean(line, 180))
      .filter(line => line.length >= 2 && safeText(line) && !/(?:password|passwd|access.?token|secret|密钥|口令|验证码)/iu.test(line)));
    const safeHash = /^#\/[A-Za-z0-9/_-]*$/u.test(location.hash) ? location.hash : "";
    return { title: safeText(clean(document.title, 160)) ? clean(document.title, 160) : "", route: (location.pathname + safeHash).slice(0, 240), headings, controls, links, visibleText };
  })()`;
  type FrameEvidence = { title: string; route: string; headings: string[]; controls: unknown[]; links: string[]; visibleText: string[] };
  const frameEvidence: Array<FrameEvidence | undefined> = await Promise.all(page.frames().map(frame => frame.evaluate(evidenceScript).then(value => value as FrameEvidence).catch(() => undefined)));
  const unique = (items: unknown[][]) => [...new Set(items.flat().filter((item): item is string => typeof item === "string" && item.length > 0))].slice(0, 100);
  const evidence = {
    title: unique(frameEvidence.map(item => item ? [item.title] : [])).join(" | "),
    route: unique(frameEvidence.map(item => item ? [item.route] : [])).join(" | "),
    headings: unique(frameEvidence.map(item => item?.headings ?? [])),
    controls: frameEvidence.flatMap(item => item?.controls ?? []),
    links: unique(frameEvidence.map(item => item?.links ?? [])),
    visibleText: unique(frameEvidence.map(item => item?.visibleText ?? [])),
  };
  if (!evidence.controls.length && !evidence.headings.length && !evidence.links.length && !evidence.visibleText.length && !evidence.title) throw new Error("当前页面及其 frame 没有可见文字、控件、标题或链接证据，不能可靠生成定位器或断言。");
  return JSON.stringify(evidence);
  } finally { releasePageLease?.(); }
}

function draftEvidenceBoundUiCheck(item: NonNullable<Awaited<ReturnType<typeof getDocumentProject>>>["cases"][number], pageEvidence: string) {
  let snapshot: { controls?: Array<{ tag?: string; name?: string; placeholder?: string; visibleText?: string; disabled?: boolean }>; visibleText?: string[] };
  try { snapshot = JSON.parse(pageEvidence); } catch { return undefined; }
  // The source breadcrumb can mention neighboring XMind branches, copied
  // headings, or unrelated field names. Only the case's own title and expected
  // result may bind the visible invalid-field assertion to a specific control.
  const expected = `${item.title} ${item.expected}`;
  // This deterministic repair is intentionally limited to an explicit
  // invalid-field visual requirement and a live field whose label appears in
  // the source expectation. Repeated labels require an explicit ordinal in
  // that same expectation; otherwise the locator remains ambiguous.
  if (/(?:字段|输入框|边框|校验|验证).{0,16}(?:红|无效|错误|非法)|(?:红色|变红|无效|非法).{0,16}(?:字段|输入框|边框|校验|验证)|(?:field|input).{0,16}(?:red|invalid|error)|(?:red|invalid|error).{0,16}(?:field|input)/iu.test(expected)) {
    const controls = (snapshot.controls ?? []).filter(control => /^(?:input|textarea)$/u.test(control.tag ?? "") && control.name?.trim());
    const fields = [...new Set(controls.map(control => control.name!.trim()))];
    const expectedNames = [...fields].sort((left, right) => right.length - left.length).filter(name => expected.includes(name));
    if (expectedNames.length === 1) {
      const label = expectedNames[0]!;
      const matches = controls.filter(control => control.name?.trim() === label);
      if (matches.length === 1) return [{ action: "assertFieldInvalid" as const, label }];
      const ordinal = expected.match(/第\s*(\d+|[一二三四五六七八九十两]+)\s*(?:个|项|行)/u)?.[1];
      const ordinalMap: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      const ordinalNumber = ordinal ? Number(ordinal) || ordinalMap[ordinal] : undefined;
      if (matches.length > 1 && ordinalNumber !== undefined && ordinalNumber >= 1 && ordinalNumber <= matches.length && ordinalNumber <= 10) {
        return [{ action: "assertFieldInvalid" as const, label, rowIndex: ordinalNumber - 1 }];
      }
    }
  }
  // An exact quoted UI message in the expected result can be checked without
  // inventing a selector. Only author it when the same literal is visible in
  // the current page/frame evidence; the broader coverage gap remains intact.
  if (/(?:文案|提示|显示|可见|展示|文中|text|message|visible)/iu.test(item.expected)) {
    const literals = [...item.expected.matchAll(/[「“"]([^」”"]{2,120})[」”"]/gu)].map(match => match[1]!.trim());
    const matched = literals.filter(literal => (snapshot.visibleText ?? []).some(line => line.includes(literal)));
    if (matched.length === 1) return [{ action: "assertVisible" as const, text: matched[0]! }];
  }
  return undefined;
}

/** Apply source-grounded, assertion-only repairs before any browser evidence
 * collection. These repairs use cases already present in the same approved
 * suite and do not infer a selector, record, identity, or backend result. */
function draftGroundedMissingBrowserSteps(project: NonNullable<Awaited<ReturnType<typeof getDocumentProject>>>, onlyCaseIds?: Set<string>): string[] {
  const drafted: string[] = [];
  const derive = (item: NonNullable<Awaited<ReturnType<typeof getDocumentProject>>>["cases"][number], operation: (value: typeof item) => boolean) => {
    if ((onlyCaseIds && !onlyCaseIds.has(item.id)) || item.steps.length) return;
    if (operation(item)) drafted.push(item.id);
  };
  for (const item of project.cases) derive(item, deriveGroundedEmptyListNavigationSubcheck);
  for (const item of project.cases) derive(item, deriveGroundedCustomerLookupSubcheck);
  for (const item of project.cases) derive(item, deriveGroundedEmptyRequiredFieldSubcheck);
  for (const item of project.cases) derive(item, value => deriveRelatedInvalidInputSubcheck(value, project.cases));
  for (const item of project.cases) if (!onlyCaseIds || onlyCaseIds.has(item.id)) addNoApiNetworkAssertion(item);
  return drafted;
}

type BrowserStepGenerationSummary = { generatedCaseIds: string[]; caseResults: StepGenerationCaseResult[]; attemptedCaseIds?: string[]; warning?: string };

async function generateMissingBrowserSteps(project: Awaited<ReturnType<typeof getDocumentProject>>, onlyCaseIds?: Set<string>, observedPageEvidence?: string, options: { repairRejectedDrafts?: boolean; feedbackByCase?: ReadonlyMap<string, string> } = {}): Promise<BrowserStepGenerationSummary> {
  if (!project) return { generatedCaseIds: [], caseResults: [], warning: "测试项目不存在。" };
  const eligibleForAttempt = (item: BrowserCheck) => (!onlyCaseIds || onlyCaseIds.has(item.id)) && (options.repairRejectedDrafts || !item.steps?.length || hasOnlyGenericShellAssertions(item));
  const beforeSteps = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
  const candidateIds = project.cases.filter(eligibleForAttempt).map(item => item.id);
  const reasons = new Map<string, string>();
  const notices: string[] = [];
  const attemptedCaseIds = new Set<string>();
  const finish = (): BrowserStepGenerationSummary => {
    const caseResults = candidateIds.flatMap<StepGenerationCaseResult>(caseId => {
      const item = project.cases.find(candidate => candidate.id === caseId);
      if (!item) return [{ caseId, status: "blocked", stepCount: 0, detail: "生成后用例已不在项目中；请刷新项目并重试。" }];
      if (item.steps.length && !hasOnlyGenericShellAssertions(item)) {
        const partial = Boolean(item.coverageGap?.trim());
        return [{ caseId, status: partial ? "partial" : "generated", stepCount: item.steps.length, detail: partial
          ? `已生成并通过 BrowserStep 校验的只读子检查（${item.steps.length} 步）；完整用例仍有未解决覆盖缺口：${item.coverageGap}`
          : `已生成 ${item.steps.length} 步只读 BrowserStep，并通过结构、定位器和预期断言校验；尚未执行。` }];
      }
      return [{ caseId, status: "blocked", stepCount: 0, detail: reasons.get(caseId) ?? browserStepDraftBlockReason(item) ?? explainBlockedBrowserStepDraft(item) }];
    });
    const generatedCaseIds = caseResults.filter(result => result.status !== "blocked").map(result => result.caseId);
    const blocked = caseResults.filter(result => result.status === "blocked");
    if (blocked.length) notices.push(`${blocked.length}/${candidateIds.length} 条用例没有形成可执行步骤：${blocked.map(result => `${result.caseId}：${result.detail}`).slice(0, 12).join("；")}${blocked.length > 12 ? "；其余阻塞原因保存在逐条结果中" : ""}`);
    if (caseResults.some(result => result.status === "partial")) notices.push(`${caseResults.filter(result => result.status === "partial").length} 条只生成了可运行的 UI 子检查；完整用例仍未覆盖，不能据此判为通过。`);
    return { generatedCaseIds, caseResults, ...(options.repairRejectedDrafts ? { attemptedCaseIds: [...attemptedCaseIds] } : {}), ...(notices.length ? { warning: notices.join(" ") } : {}) };
  };
  const groundedSubchecks = options.repairRejectedDrafts ? [] : draftGroundedMissingBrowserSteps(project, onlyCaseIds);
  for (const item of project.cases) {
    if (onlyCaseIds && !onlyCaseIds.has(item.id)) continue;
    if (JSON.stringify(item.steps ?? []) !== beforeSteps.get(item.id) && item.steps.length && !hasOnlyGenericShellAssertions(item) && !candidateIds.includes(item.id)) candidateIds.push(item.id);
  }
  const requested = project.cases.map((item, index) => ({ item, index })).filter(({ item }) => eligibleForAttempt(item));
  const pending = requested.filter(({ item }) => canAuthorReadOnlyBrowserSteps(item));
  const skipped = requested.filter(({ item }) => !canAuthorReadOnlyBrowserSteps(item));
  for (const { item } of skipped) reasons.set(item.id, browserStepDraftBlockReason(item) ?? "需求证据不足；请补充可观察的页面预期或执行前置条件。");
  for (const { item } of pending) {
    if (!options.repairRejectedDrafts && item.steps?.length && !hasOnlyGenericShellAssertions(item)) continue;
    if (options.repairRejectedDrafts) continue;
    const groundedSteps = draftGroundedReadOnlyBrowserSteps(item);
    if (groundedSteps?.length) {
      const validated = validateCases([{ ...item, steps: groundedSteps }])[0]!;
      project.cases[project.cases.findIndex(candidate => candidate.id === item.id)] = { ...item, steps: validated.steps };
    }
  }
  const aiPending = pending.filter(({ item }) => {
    const current = project.cases.find(candidate => candidate.id === item.id)!;
    return options.repairRejectedDrafts || !current.steps?.length || hasOnlyGenericShellAssertions(current);
  });
  if (groundedSubchecks.length) notices.push(`已从同一套件的具体校验用例中为 ${groundedSubchecks.length} 条宽泛场景补出安全子场景：${groundedSubchecks.join(", ")}；只覆盖列明的输入示例，不冒充整项完成。`);
  if (!aiPending.length) {
    const summary = finish();
    return { ...summary, ...(notices.length ? { warning: [summary.warning, ...notices].filter(Boolean).join(" ") } : {}) };
  }

  const classifyStepGap = (item: BrowserCheck): string => {
    const text = `${item.title} ${item.expected} ${item.coverageGap ?? ""} ${(item.preconditions ?? []).join(" ")}`;
    const dataPrerequisites = [item.coverageGap ?? "", ...(item.preconditions ?? []), ...(item.testData ?? [])].join(" ");
    if (/(?:\[需澄清\]|待澄清|需澄清|尚未明确|需要产品确认)/u.test(text)) return "预期结果待澄清";
    if (/(?:角色|管理员|身份|账号|权限矩阵|跨账号)/u.test(text)) return "缺少角色或测试账号";
    if (/(?:fixture|夹具|测试数据|历史记录|订单记录|库存|状态记录|脱敏订单)/iu.test(dataPrerequisites)
      || /(?:缺少|需要|依赖|提供).{0,24}(?:测试数据|测试夹具|测试账号|历史记录|订单记录|库存记录|状态记录|fixture)/iu.test(text)) return "缺少可复用测试数据";
    if (/(?:接口契约|API|后端|服务端|数据库|读回|刷新时间)/iu.test(text)) return "需要 API/后端证据";
    if (/(?:旧入口|新地址|目标URL|目标地址|跨域|跳转判定)/iu.test(text)) return "缺少目标页面路径或 URL 预期";
    return "步骤编写或页面证据不足";
  };
  const pageEvidenceGap = (item: BrowserCheck, evidence: string): string => {
    let snapshot: { route?: string; title?: string; controls?: unknown[]; visibleText?: string[]; headings?: string[] };
    try { snapshot = JSON.parse(evidence); }
    catch { return "页面快照格式无效，无法核对控件和可见预期；请重新采集目标页证据。"; }
    const route = snapshot.route ? `当前页面路径为 ${snapshot.route}` : "当前页面路径未记录";
    const controls = snapshot.controls?.length ?? 0;
    const visible = [...(snapshot.visibleText ?? []), ...(snapshot.headings ?? [])].join("\n");
    const literals = [...item.expected.matchAll(/[「“"]([^」”"]{2,120})[」”"]/gu)].map(match => match[1]!.trim());
    const missingLiteral = literals.find(literal => !visible.includes(literal));
    if (missingLiteral) return `${route}，但页面快照中没有验收文案“${missingLiteral}”；请先在同一窗口打开对应业务页面，或补充明确页面入口。`;
    if (!controls && !visible.trim()) return `${route}，未采集到可见控件或文字；请确认目标页已加载并重新生成。`;
    return `${route}；页面当前有 ${controls} 个可见控件，但没有足够证据把本用例的预期绑定到一个安全的定位器/断言。缺口类型：${classifyStepGap(item)}。请补充准确字段标签、页面路径、测试数据或可观察预期。`;
  };

  let pageEvidence: string;
  try { pageEvidence = observedPageEvidence ?? await collectDocumentPageEvidence(project); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    for (const { item } of aiPending) reasons.set(item.id, detail);
    notices.push(`${aiPending.length} 条 UI 用例未能取得页面证据：${detail}`);
    const summary = finish();
    return { ...summary, warning: [summary.warning, ...notices].filter(Boolean).join(" ") };
  }
  if (!modelConfiguration().modelAvailable) {
    for (const entry of aiPending) {
      const fallback = draftEvidenceBoundUiCheck(entry.item, pageEvidence);
      if (!fallback?.length) { reasons.set(entry.item.id, pageEvidenceGap(entry.item, pageEvidence)); continue; }
      try {
        const validated = validateCases([{ ...entry.item, steps: fallback }])[0]!;
        validateDraftLocatorsAgainstEvidence(validated.steps, pageEvidence, JSON.stringify(entry.item));
        if (hasOnlyGenericShellAssertions(validated)) { reasons.set(entry.item.id, pageEvidenceGap(entry.item, pageEvidence)); continue; }
        project.cases[entry.index] = { ...entry.item, steps: validated.steps };
      } catch (error) { reasons.set(entry.item.id, `页面证据生成的只读步骤未通过验证：${error instanceof Error ? error.message : String(error)}`); }
    }
    if (aiPending.some(entry => reasons.has(entry.item.id))) notices.push("未配置模型，未能根据页面证据为所有候选生成安全步骤；逐条原因已记录。");
    const summary = finish();
    const warning = [summary.warning, ...notices].filter(Boolean).join(" ");
    return { ...summary, ...(warning ? { warning } : {}) };
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < aiPending.length) {
      const entry = aiPending[cursor++];
      if (!entry) return;
      let detail = "";
      let repairFeedback = options.feedbackByCase?.get(entry.item.id) ?? "";
      let accepted = false;
      const maxDraftAttempts = options.repairRejectedDrafts ? 2 : 1;
      for (let attempt = 1; attempt <= maxDraftAttempts; attempt++) try {
        // The importer used this same generic precondition for unrelated cases.
        // It is not evidence of a real fixture dependency; execution gates still
        // require the concrete preconditions to be confirmed.
        const authoringItem = {
          ...entry.item,
          caseGenerationActions: entry.item.caseGenerationTrace?.actions ?? [],
          preconditions: (entry.item.preconditions ?? []).filter(value => !/需要目标系统专用测试环境和\/或测试账号、接口 mock\/沙箱数据/u.test(value)),
        };
        attemptedCaseIds.add(entry.item.id);
        const steps = await generateDocumentCaseSteps(project.targetUrl, authoringItem, pageEvidence, options.repairRejectedDrafts ? repairFeedback : undefined);
        if (!steps.length) throw new Error(pageEvidenceGap(entry.item, pageEvidence));
        if (!steps.some(step => ["assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertDisabled", "assertFieldInvalid", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) throw new Error("模型只生成了操作，没有生成结果断言；请补充具体可观察的通过条件。");
        const validated = validateCases([{ ...entry.item, steps }])[0]!;
        if (hasOnlyGenericShellAssertions(validated)) throw new Error("模型只检查通用标题/导航，没有验证本条业务预期；需要明确字段、文案、状态或行为。");
        project.cases[entry.index] = { ...entry.item, steps: validated.steps };
        accepted = true;
        if (options.repairRejectedDrafts) notices.push(`${entry.item.id}：Agent 根据阻塞反馈重写了步骤；新草稿已通过结构和页面证据校验，仍需人工审核。`);
        break;
      } catch (error) {
        detail = error instanceof Error ? error.message : String(error);
        if (attempt < maxDraftAttempts) {
          repairFeedback = [repairFeedback, `本次步骤草稿未通过服务端校验：${detail}\n请只修正这条用例的可执行步骤，遵守原有验收预期和只读限制。若页面证据中确实没有所需控件，或验收规则仍不明确，请返回空步骤并保留阻塞，不要猜测或降低断言。`].filter(Boolean).join("\n\n");
        }
      }
      if (!accepted) {
        const fallback = options.repairRejectedDrafts ? undefined : draftEvidenceBoundUiCheck(entry.item, pageEvidence);
        let fallbackFailure = "";
        if (fallback?.length) {
          try {
            const validated = validateCases([{ ...entry.item, steps: fallback }])[0]!;
            validateDraftLocatorsAgainstEvidence(validated.steps, pageEvidence, JSON.stringify(entry.item));
            if (!hasOnlyGenericShellAssertions(validated)) {
              project.cases[entry.index] = { ...entry.item, steps: validated.steps };
              notices.push(`${entry.item.id}：模型草稿未通过校验，已改用页面证据生成只读断言；原因为 ${detail}`);
              continue;
            }
          } catch (fallbackError) {
            fallbackFailure = `页面证据回退步骤未通过定位校验：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}；`;
          }
        }
        reasons.set(entry.item.id, `${entry.item.id} [${classifyStepGap(entry.item)}]：${entry.item.coverageGap?.trim() ? `${entry.item.coverageGap}；` : ""}${fallbackFailure}${options.repairRejectedDrafts ? "Agent 已收到上轮阻塞原因并最多修订一次；" : ""}${detail}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, aiPending.length) }, worker));
  const summary = finish();
  const warning = [summary.warning, ...notices].filter(Boolean).join(" ");
  return { ...summary, ...(warning ? { warning } : {}) };
}

function validRequest(value: any): value is DemoRequest {
  return value && typeof value === "object" && !Array.isArray(value)
    && ["deterministic", "requirements", "autonomous"].includes(value.mode)
    && ["offline", "model"].includes(value.provider)
    && typeof value.requirements === "string" && value.requirements.length <= 20_000
    && Number.isInteger(value.maxActions) && value.maxActions >= 1 && value.maxActions <= 40
    && value.target === "sample";
}

function md(run: DemoRun): string {
  const lines = [
    `# TestPilot 运行报告`, "", `- 运行 ID：${run.id}`, `- 模式：${run.mode}`, `- 执行器：${run.provider}`, `- 目标：${run.fixedTarget ? "预置修复" : "预置缺陷"}`,
    `- 状态：${run.status}`, `- 开始时间：${run.startedAt}`, `- 耗时：${run.durationMs} ms`, `- 动作数：${run.actionCount}/${run.maxActions}`, `- 框架：${run.framework ?? "Pi Agent Core"}`, `- 决策来源：${run.modelLabel ?? run.provider}`, "", "## 输入需求", "", run.input?.requirements ?? "历史记录未保存输入需求。", "", `## 摘要`, "", run.summary, "", "## 测试计划", "",
    ...(run.plan.length ? run.plan.map(x => `- ${x}`) : ["- 尚无计划记录"]), "", "## 断言", "",
  ];
  if (!run.assertions.length) lines.push("没有已完成断言。", "");
  for (const a of run.assertions) {
    lines.push(`### ${a.status === "passed" ? "通过" : a.status === "failed" ? "失败" : "未定论"} · ${a.title}`, "", `- ID：${a.id}`, `- 来源：${a.source}`, `- 预期：\`${JSON.stringify(a.expected)}\``, `- 实际：\`${JSON.stringify(a.actual)}\``, `- 证据 ID：${a.evidenceId}`, `- 重现：\`${a.reproduction.method} ${a.reproduction.path}\``, `- 重现请求：\`${JSON.stringify({ body: a.reproduction.body, headers: a.reproduction.headers })}\``, "");
  }
  lines.push("## HTTP 证据", "");
  if (!run.evidence.length) lines.push("没有捕获 HTTP 证据。", "");
  for (const e of run.evidence) lines.push(`### ${e.method} ${e.path}`, "", `- 证据 ID：${e.id}`, `- 状态：${e.status}`, `- 耗时：${e.durationMs} ms`, `- 时间：${e.capturedAt}`, `- 请求体：\`${JSON.stringify(e.requestBody ?? null)}\``, `- 请求头：\`${JSON.stringify(e.requestHeaders ?? {})}\``, `- 响应体：\`${JSON.stringify(e.body)}\``, "");
  lines.push("## 事件", "");
  if (!run.events.length) lines.push("没有事件记录。", "");
  for (const e of run.events) lines.push(`- ${e.at} **${e.kind} · ${e.title}** — ${e.detail}`);
  lines.push("", "## 覆盖与未覆盖", "", `已访问：${run.coverage.visited.join(", ") || "无"}`, `可用路由：${run.coverage.available.join(", ") || "无"}`, `未覆盖：${run.coverage.untested.join(", ") || "无"}`, "", "## 限制", "", ...(run.limitations.length ? run.limitations.map(x => `- ${x}`) : ["- 无"]), "");
  if (run.error) lines.push("## 错误", "", run.error, "");
  return lines.join("\n");
}

async function persistRun(run: DemoRun): Promise<void> {
  const dir = path.join(runsDir, run.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(path.join(dir, "report.md"), md(run), "utf8");
}

async function persistRegressions(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(regressionsFile, `${JSON.stringify(savedChecks, null, 2)}\n`, "utf8");
}

async function loadSavedData(): Promise<void> {
  await mkdir(runsDir, { recursive: true });
  try {
    const raw: any = JSON.parse(await readFile(regressionsFile, "utf8"));
    if (Array.isArray(raw)) savedChecks = raw.filter(validCheck);
  } catch { /* first launch */ }
  try {
    const dirs = await (await import("node:fs/promises")).readdir(runsDir, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      try {
        const item: any = JSON.parse(await readFile(path.join(runsDir, entry.name, "run.json"), "utf8"));
        if (item && typeof item.id === "string" && item.id === entry.name) {
          if (item.status === "running" || item.status === "queued") {
            item.status = "blocked";
            item.completedAt = new Date().toISOString();
            item.summary = "服务在上次运行完成前停止；请重新运行。";
            item.limitations = [...(item.limitations ?? []), "上次运行被服务停止中断，未完成部分未判为通过。"];
            await persistRun(item as DemoRun);
          }
          runs.set(item.id, item as DemoRun);
        }
      } catch { /* skip incomplete/corrupt entries */ }
    }
  } catch { /* directory is created above */ }
  try {
    const dirs = await readdir(PROJECT_RUNS_DIR, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      try {
        const item = JSON.parse(await readFile(path.join(PROJECT_RUNS_DIR, entry.name, "profile-run.json"), "utf8")) as ProjectRunView;
        if (item.id === entry.name && registeredProfiles.some((profile) => profile.id === item.profileId)) projectRuns.set(item.id, item);
      } catch { /* skip incomplete project run */ }
    }
  } catch { /* no profile runs yet */ }
  await loadProjectScripts();
}

function validCheck(value: any): value is DemoCheck {
  return value && typeof value === "object" && typeof value.id === "string" && typeof value.title === "string"
    && typeof value.method === "string" && /^\/(sample\/)/.test(value.path) && value.expect && Number.isInteger(value.expect.status);
}

function newRun(request: DemoRequest, checks?: DemoCheck[]): DemoRun {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), mode: request.mode, provider: request.provider, status: "queued", startedAt: now, durationMs: 0,
    framework: "@earendil-works/pi-agent-core 1.2.0",
    modelLabel: request.mode === "deterministic" ? "固定断言 runner（不调用模型）" : request.provider === "offline" ? "Pi faux provider（脚本决策，无模型推理）" : modelConfiguration().modelLabel,
    input: { requirements: request.requirements, target: request.target },
    maxActions: request.maxActions, actionCount: 0, plan: [], events: [], evidence: [], assertions: [],
    coverage: { visited: [], available: [...availableRoutes], untested: [...availableRoutes] },
    limitations: ["本演示仅针对预置订单 API；不代表跨栈、浏览器或生产环境评估。", "未知新增需求没有样例服务行为支撑，不能视为已验证。"],
    summary: "运行已排队。", fixedTarget, ...(checks ? { regressionChecks: checks } as any : {}),
  };
}

function finishRun(id: string): void { if (activeRunId === id) activeRunId = undefined; controllers.delete(id); }

function persistProjectRun(run: ProjectRunView): Promise<void> {
  return mkdir(path.join(PROJECT_RUNS_DIR, run.id), { recursive: true }).then(() =>
    writeFile(path.join(PROJECT_RUNS_DIR, run.id, "profile-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8"));
}

async function readProjectRunFiles(id: string): Promise<string[]> {
  const base = path.join(PROJECT_RUNS_DIR, id, "target-artifacts");
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) found.push(path.relative(base, absolute).split(path.sep).join("/"));
    }
  }
  await walk(base);
  return found.sort();
}

function assertSafeProjectRelativePath(value: string): void {
  const parts = value.split("/");
  if (!value || value.includes("\\") || value.startsWith("/") || parts.some((part) => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Unsafe project-relative script path: ${value}`);
  }
}

async function overlayApprovedScriptFiles(projectRoot: string, files: Record<string, string>): Promise<void> {
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

async function loadRegisteredProfile(id: string): Promise<ProjectProfile> {
  if (!registeredProfiles.some((profile) => profile.id === id)) throw new Error("Unregistered project profile.");
  const profile = await loadProjectProfile(path.join(projectRoot, "examples", "profiles", `${id}.json`));
  if (profile.name !== registeredProfiles.find((item) => item.id === id)?.name) throw new Error("Registered profile configuration changed unexpectedly.");
  return profile;
}

function projectScriptView(script: ProjectScriptVersion): ProjectScriptView {
  const { suite, ...metadata } = script;
  const previous = [...projectScripts.values()]
    .filter((item) => item.profileId === script.profileId && item.status === "approved" && item.version < script.version)
    .sort((a, b) => b.version - a.version)[0];
  const diff: string[] = [];
  if (!previous) diff.push("No prior approved version; this is the initial candidate.");
  else {
    const oldCases = new Map(previous.suite.cases.map((item) => [item.id, item]));
    const newCases = new Map(suite.cases.map((item) => [item.id, item]));
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
    if (JSON.stringify(previous.suite.cases.map((item) => item.id)) !== JSON.stringify(suite.cases.map((item) => item.id))) diff.push("Case execution order changed");
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
  } else {
    for (const filePath of Object.keys(script.files ?? {}).sort()) diff.push(`Captured test source ${filePath}`);
  }
  if (previous && !diff.length) diff.push("No changes from the previous approved version.");
  return {
    ...metadata,
    ...(previous ? { previousApprovedVersion: previous.version } : {}),
    diff,
    files: Object.entries(script.files ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([filePath, content]) => ({ path: filePath, content })),
    cases: suite.cases.map((item) => ({
      id: item.id, title: item.title, bin: item.command.bin, args: [...item.command.args],
      ...(item.command.cwd ? { cwd: item.command.cwd } : {}),
      ...(item.command.timeoutMs ? { timeoutMs: item.command.timeoutMs } : {}),
      expectedExitCode: item.command.expectedExitCode ?? 0,
    })),
  };
}

async function persistProjectScripts(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
  const temporary = `${PROJECT_SCRIPTS_FILE}.tmp`;
  await writeFile(temporary, `${JSON.stringify([...projectScripts.values()], null, 2)}\n`, "utf8");
  await rename(temporary, PROJECT_SCRIPTS_FILE);
}

async function loadProjectScripts(): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(PROJECT_SCRIPTS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item.id !== "string" || !registeredProfiles.some((profile) => profile.id === item.profileId)
        || !Number.isInteger(item.version) || !["candidate", "approved", "rejected"].includes(item.status)
        || !item.suite || !Array.isArray(item.suite.cases) || typeof item.digest !== "string"
        || !item.files || typeof item.files !== "object" || Array.isArray(item.files)
        || !Object.entries(item.files).every(([filePath, content]) => typeof content === "string" && (() => { try { assertSafeProjectRelativePath(filePath); return true; } catch { return false; } })())
        || createHash("sha256").update(JSON.stringify({ profileId: item.profileId, suite: item.suite, files: item.files })).digest("hex") !== item.digest) continue;
      projectScripts.set(item.id, item as ProjectScriptVersion);
    }
  } catch { /* first launch or no saved script registry */ }
}

async function createProjectScriptCandidate(profileId: string, generated?: { requirement: string; title: string; summary: string; steps: import("../adapters/grammar-test-script.js").GrammarStep[] }): Promise<ProjectScriptView> {
  const profile = await loadRegisteredProfile(profileId);
  if ([...projectScripts.values()].some((item) => item.profileId === profileId && item.status === "candidate")) throw new Error("A candidate version is already awaiting review.");
  const version = Math.max(0, ...[...projectScripts.values()].filter((item) => item.profileId === profileId).map((item) => item.version)) + 1;
  const suite = structuredClone(profile.suite);
  const root = await realpath(profile.sourceRoot);
  const files: Record<string, string> = {};
  for (const relative of [...(profile.scriptFiles ?? []), ...(profile.optionalScriptFiles ?? [])]) {
    assertSafeProjectRelativePath(relative);
    const target = path.resolve(root, ...relative.split("/"));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Script file escapes project root: ${relative}`);
    const info = await lstat(target).catch((error) => (profile.optionalScriptFiles ?? []).includes(relative) && (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : Promise.reject(error));
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
  projectScripts.set(entry.id, entry);
  try { await persistProjectScripts(); }
  catch (error) { projectScripts.delete(entry.id); throw error; }
  return projectScriptView(entry);
}

async function launchProjectProfile(id: string, approvedScript?: ProjectScriptVersion): Promise<ProjectRunView> {
  const summary = registeredProfiles.find((profile) => profile.id === id);
  if (!summary) throw new Error("Unregistered project profile.");
  const run: ProjectRunView = {
    id: randomUUID(), profileId: id, profileName: summary.name, suiteName: approvedScript?.suite.name ?? summary.suiteName,
    ...(approvedScript ? { scriptId: approvedScript.id, scriptVersion: approvedScript.version } : {}),
    status: "queued", startedAt: new Date().toISOString(), durationMs: 0,
    summary: "已排队，等待执行。", results: [], artifactFiles: [],
  };
  projectRuns.set(run.id, run);
  activeRunId = run.id;
  const controller = new AbortController();
  projectControllers.set(run.id, controller);
  try { await persistProjectRun(run); }
  catch (error) { projectRuns.delete(run.id); finishRun(run.id); projectControllers.delete(run.id); throw error; }
  void (async () => {
    const started = Date.now();
    let prepared: Awaited<ReturnType<typeof prepareProfile>> | undefined;
    let finalStatus: ProjectRunView["status"] = "error";
    let finalSummary = "";
    let finalDuration = 0;
    const timeout = setTimeout(() => controller.abort(new Error("Project profile exceeded the 180 second deadline")), PROJECT_RUN_TIMEOUT_MS);
    run.status = "running";
    run.startedAt = new Date().toISOString();
    run.summary = "正在准备隔离副本并执行已登记测试。";
    await persistProjectRun(run).catch(() => undefined);
    try {
      const profile = await loadRegisteredProfile(id);
      if (approvedScript) profile.suite = structuredClone(approvedScript.suite);
      prepared = await prepareProfile(profile);
      if (approvedScript) await overlayApprovedScriptFiles(prepared.projectRoot, approvedScript.files);
      const cases = profile.suite.cases.map((testCase) => ({
        ...testCase,
        command: {
          ...testCase.command,
          cleanEnvironment: true,
          env: Object.fromEntries(Object.entries({ ...testCase.command.env, ...prepared!.env }).map(([key, value]) => [key, value.replaceAll("{DEMO_URL}", prepared!.env.DEMO_URL ?? "")])),
        },
      }));
      const engine = new DeterministicEngine();
      const record = await engine.run({
        mode: "deterministic", suiteName: profile.suite.name, cases,
        projectRoot: prepared.projectRoot, outputRoot: path.join(PROJECT_RUNS_DIR, run.id, "normalized"),
        scope: [`Registered profile: ${id}`, ...(approvedScript ? [`Approved script ${approvedScript.id} v${approvedScript.version}`] : []), "Disposable local snapshot; no changes to the configured source project"],
        limitations: [approvedScript ? "This run executes only the saved approved snapshot; it does not call AI or generate/heal tests during execution." : "This profile run executes the registered suite; it does not generate or heal tests.", "Browser checks use the project's existing Playwright suite in headless Edge/Chromium."],
        signal: controller.signal,
      });
      if (approvedScript) record.approvedScript = { id: approvedScript.id, version: approvedScript.version, digest: approvedScript.digest };
      await saveRun(record, path.join(PROJECT_RUNS_DIR, run.id, "normalized"));
      run.recordRunId = record.runId;
      await preserveProfileArtifacts(profile, prepared.projectRoot, path.join(PROJECT_RUNS_DIR, run.id));
      run.results = record.results;
      run.artifactFiles = await readProjectRunFiles(run.id);
      const userCancelled = controller.signal.reason?.message === "cancelled";
      finalStatus = userCancelled ? "cancelled" : controller.signal.aborted ? "blocked" : record.status;
      finalSummary = userCancelled
        ? "运行已取消；未完成的检查没有判为通过。"
        : controller.signal.aborted ? "运行达到时间上限；未完成的检查没有判为通过。"
          : `${record.results.filter((result) => result.status === "passed").length}/${record.results.length} 项通过，退出码 ${record.results.at(-1)?.actualExitCode ?? "—"}。`;
      finalDuration = record.durationMs;
    } catch (error) {
      const userCancelled = controller.signal.reason?.message === "cancelled";
      finalStatus = userCancelled ? "cancelled" : controller.signal.aborted ? "blocked" : "error";
      finalSummary = controller.signal.aborted
        ? userCancelled ? "运行已取消；未完成的检查没有判为通过。" : "运行达到时间上限；未完成的检查没有判为通过。"
        : (error instanceof Error ? error.message : String(error));
      finalDuration = Date.now() - started;
    } finally {
      clearTimeout(timeout);
      if (prepared) await prepared.close().catch((error) => { finalSummary += ` 隔离副本清理错误：${String(error)}`; finalStatus = "error"; });
      run.artifactFiles = await readProjectRunFiles(run.id).catch(() => run.artifactFiles);
      run.status = finalStatus;
      run.summary = finalSummary;
      run.completedAt = new Date().toISOString();
      run.durationMs = finalDuration || Date.now() - started;
      finishRun(run.id);
      projectControllers.delete(run.id);
      await persistProjectRun(run).catch((error) => console.error("Unable to persist project profile run", error));
    }
  })();
  return run;
}

async function launch(request: DemoRequest, checks?: DemoCheck[]): Promise<DemoRun> {
  const run = newRun(request, checks);
  runs.set(run.id, run);
  activeRunId = run.id;
  const controller = new AbortController();
  controllers.set(run.id, controller);
  try { await persistRun(run); }
  catch (error) { runs.delete(run.id); finishRun(run.id); throw error; }
  void (async () => {
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(new Error("Demo run exceeded 90 second deadline")), RUN_TIMEOUT_MS);
    run.status = "running";
    run.startedAt = new Date().toISOString();
    const emit = (kind: DemoEvent["kind"], title: string, detail: string) => {
      run.events.push({ id: randomUUID(), at: new Date().toISOString(), kind, title, detail });
    };
    const context: RunContext = { run, signal: controller.signal, baseUrl: `http://${host}:${port}`, emit };
    const isCancelled = () => run.status === "cancelled";
    try {
      await executeDemo(context, request, checks);
      if (controller.signal.aborted && controller.signal.reason?.message !== "cancelled") {
        run.status = "blocked";
        run.summary = "运行达到时间上限；已执行证据已保留，未执行部分未判为通过。";
      }
      else if (run.status === "running") run.status = run.assertions.length === 0 ? "blocked" : run.assertions.some(a => a.status === "failed") ? "failed" : run.assertions.every(a => a.status === "passed") ? "passed" : "blocked";
      run.summary ||= run.status === "passed" ? "所有断言通过。" : `运行结束：${run.status}`;
    } catch (error) {
      if (controller.signal.aborted && isCancelled()) { /* cancellation already recorded */ }
      else if (controller.signal.aborted) { run.status = "blocked"; run.error = "运行超过 90 秒期限，已停止。"; }
      else { run.status = "error"; run.error = error instanceof Error ? error.message : String(error); emit("error", "运行异常", run.error); }
      run.summary = run.error ?? "运行已取消。";
    } finally {
      clearTimeout(timeout);
      run.durationMs = Date.now() - started;
      run.completedAt = new Date().toISOString();
      finishRun(run.id);
      await persistRun(run).catch(error => console.error("Unable to persist demo run", error));
    }
  })();
  return run;
}

function isLoopbackHost(value: string): boolean { return value === "127.0.0.1" || value === "localhost" || value === "[::1]"; }

async function staticFile(pathname: string, res: ServerResponse): Promise<boolean> {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(distDir, relative);
  if (resolved !== distDir && !resolved.startsWith(`${distDir}${path.sep}`)) return false;
  let file = resolved;
  try { if (!(await stat(file)).isFile()) return false; }
  catch { if (!path.extname(relative)) file = path.join(distDir, "index.html"); else return false; }
  try {
    const content = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const type: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };
    res.writeHead(200, { "content-type": type[ext] ?? "application/octet-stream", "content-length": content.byteLength, "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(content); return true;
  } catch { return false; }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const hostHeader = req.headers.host ?? "";
  let parsedHost: string;
  try { parsedHost = new URL(`http://${hostHeader}`).hostname; } catch { fail(res, 400, "invalid host"); return; }
  if (!isLoopbackHost(parsedHost)) { fail(res, 403, "loopback requests only"); return; }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "http:" || parsedOrigin.host !== hostHeader || !isLoopbackHost(parsedOrigin.hostname)) { fail(res, 403, "same-origin requests only"); return; }
    } catch { fail(res, 403, "same-origin requests only"); return; }
  }
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const api = url.pathname.startsWith("/api/");
  if (api && req.method !== "GET" && req.method !== "POST") { fail(res, 405, "method not allowed"); return; }
  if (req.method === "GET" && url.pathname === "/api/mysql/status") { json(res, 200, mysqlBrowserStatus()); return; }
  if (req.method === "POST" && url.pathname === "/api/mysql/connect") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["user", "password"].includes(key))) { fail(res, 400, "连接请求只接受用户名和密码。"); return; }
    try { json(res, 200, await connectMysqlBrowser({ user: data.user, password: data.password })); }
    catch (error) {
      const message = error instanceof Error ? error.message : "无法连接测试库。";
      fail(res, 422, message.includes("只读") || message.includes("TLS") || message.includes("格式") || message.includes("无效") ? message : "无法连接测试库，请检查用户名、密码和网络；密码未保存。" );
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mysql/disconnect") {
    try { await disconnectMysqlBrowser(); json(res, 200, { connected: false, ...mysqlBrowserConfig() }); }
    catch { fail(res, 500, "断开 MySQL 连接失败。"); }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mysql/tables") {
    try { json(res, 200, await listMysqlTables()); }
    catch (error) { fail(res, 409, error instanceof Error && error.message.includes("尚未连接") ? error.message : "读取数据表清单失败；请确认数据库连接仍有效。"); }
    return;
  }
  const mysqlColumnsRoute = url.pathname.match(/^\/api\/mysql\/tables\/([^/]+)\/columns$/u);
  if (req.method === "GET" && mysqlColumnsRoute) {
    try { json(res, 200, await listMysqlColumns(decodeURIComponent(mysqlColumnsRoute[1]!))); }
    catch (error) { fail(res, 422, error instanceof Error && (error.message.includes("尚未连接") || error.message.includes("找不到") || error.message.includes("无效")) ? error.message : "读取数据表结构失败。"); }
    return;
  }
  const mysqlRowsRoute = url.pathname.match(/^\/api\/mysql\/tables\/([^/]+)\/rows$/u);
  if (req.method === "GET" && mysqlRowsRoute) {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "25");
    try { json(res, 200, await readMysqlRows(decodeURIComponent(mysqlRowsRoute[1]!), offset, limit)); }
    catch (error) { fail(res, 422, error instanceof Error && (error.message.includes("尚未连接") || error.message.includes("必须在") || error.message.includes("找不到") || error.message.includes("无效")) ? error.message : "读取当前数据页失败；请确认连接有效且查询可在短时间内完成。"); }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") { json(res, 200, { ok: true }); return; }
  if (req.method === "GET" && url.pathname === "/api/config") { json(res, 200, config()); return; }
  if (req.method === "GET" && url.pathname === "/api/settings") { json(res, 200, { ...readModelSettingsForUi(), computerUse: computerUseConfiguration() }); return; }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    try { await saveModelSettings(data); json(res, 200, { ...readModelSettingsForUi(), computerUse: computerUseConfiguration() }); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : "设置无效。"); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings/test") {
    try {
      const result = await testModelConnection(resolveModelSettings());
      let computerUse = computerUseConfiguration();
      if (computerUse.available) {
        try { await testComputerUseCapability(); }
        catch (error) {
          const key = resolveModelSettings().apiKey;
          computerUse = { ...computerUse, available: false, reason: (error instanceof Error ? error.message : "截图输入与工具调用预检失败。").replaceAll(key || "\u0000", "[已隐藏]") };
        }
      }
      json(res, 200, { ...result, computerUse });
    } catch (error) {
      const key = resolveModelSettings().apiKey;
      const reason = (error instanceof Error ? error.message : "连接失败。")
        .replaceAll(key || "\u0000", "[已隐藏]");
      fail(res, 502, reason);
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings/test-browser") {
    try { json(res, 200, await testBrowserCdpConnection()); }
    catch (error) { fail(res, 502, error instanceof Error ? error.message : "Edge CDP 连接失败。"); }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/browser/status") { json(res, 200, await getBrowserRuntimeStatus()); return; }
  if (req.method === "GET" && url.pathname === "/api/document-projects") { json(res, 200, await loadDocumentProjects()); return; }
  const projectRevisionDetail = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/revisions\/([^/]+)$/u);
  if (req.method === "GET" && projectRevisionDetail) {
    const projectId = decodeURIComponent(projectRevisionDetail[1]!);
    const revisionId = decodeURIComponent(projectRevisionDetail[2]!);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId) || !/^[0-9a-f-]{36}$/iu.test(revisionId)) { fail(res, 400, "项目或修订 ID 无效。"); return; }
    try {
      const revision = await getDocumentProjectRevision(projectId, revisionId);
      revision ? json(res, 200, revision) : fail(res, 404, "找不到该项目修订。修订 ID 必须属于当前项目。");
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "项目修订校验失败。"); }
    return;
  }
  const projectRevisionList = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/revisions$/u);
  if (req.method === "GET" && projectRevisionList) {
    const projectId = decodeURIComponent(projectRevisionList[1]!);
    const kind = url.searchParams.get("kind");
    const entityId = url.searchParams.get("entityId");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId) || kind !== null && !["case", "steps", "case-set", "materials", "test-data"].includes(kind) || entityId !== null && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(entityId) || !kind) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) { fail(res, 400, "修订查询条件无效；limit 为 1–500，entityId 需同时指定 kind。"); return; }
    try {
      if (!await getDocumentProject(projectId)) { fail(res, 404, "文档测试项目不存在。"); return; }
      json(res, 200, await listDocumentProjectRevisions(projectId, { ...(kind ? { kind: kind as DocumentProjectRevisionKind } : {}), ...(entityId ? { entityId } : {}), offset, limit }));
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "读取项目修订失败。"); }
    return;
  }
  const projectMaterialsRoute = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/materials$/u);
  if (req.method === "POST" && projectMaterialsRoute) {
    const projectId = decodeURIComponent(projectMaterialsRoute[1]!);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId)) { fail(res, 400, "项目 ID 无效。"); return; }
    const project = await getDocumentProject(projectId);
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["fileName", "bytesBase64", "role", "replaceMaterialId"].includes(key)) || typeof data.fileName !== "string" || !data.fileName.trim() || data.fileName.length > 200 || /[\\/]/u.test(data.fileName) || typeof data.bytesBase64 !== "string" || data.bytesBase64.length > 13_000_000 || !["requirements", "coverage-reference", "held-out-benchmark"].includes(data.role) || data.replaceMaterialId !== undefined && (typeof data.replaceMaterialId !== "string" || !/^[0-9a-f-]{36}$/iu.test(data.replaceMaterialId))) {
      fail(res, 400, "资料更新需要文件名、Base64 文件内容和明确的资料角色；文件最多 9 MB，可选择替换当前项目的一份资料。"); return;
    }
    try {
      const bytes = Buffer.from(data.bytesBase64, "base64");
      if (!bytes.length || bytes.byteLength > 9 * 1024 * 1024) throw new Error("资料不能为空且不能超过 9 MB。");
      const currentMaterials = (project.sourceMaterials ?? []).filter(item => item.role !== "website-content");
      const replaceIndex = data.replaceMaterialId === undefined ? -1 : currentMaterials.findIndex(item => item.id === data.replaceMaterialId);
      if (data.replaceMaterialId !== undefined && replaceIndex < 0) throw new Error("要替换的资料不存在或不属于当前项目。");
      if (replaceIndex < 0 && currentMaterials.length >= 5) throw new Error("单项目最多保存 5 份上传资料；请替换旧资料或拆分项目。");
      const duplicateName = currentMaterials.some((item, index) => index !== replaceIndex && item.fileName.toLocaleLowerCase() === data.fileName.trim().toLocaleLowerCase());
      if (duplicateName) throw new Error("项目内资料文件名必须唯一；请修改名称或替换同一份资料。");
      const uploadedDocument = await extractDocument(data.fileName.trim(), bytes);
      const importedSources: Array<{ fileName: string; requestedRole: DocumentInputRole; document: ImportedDocument }> = [];
      for (let index = 0; index < currentMaterials.length; index++) {
        if (index === replaceIndex) continue;
        const material = currentMaterials[index]!;
        const storedText = project.materialTexts?.[material.id];
        if (typeof storedText === "string") {
          const originalBytes = await readDocumentSource(project, material.id);
          const document = await extractDocument(material.fileName, originalBytes);
          importedSources.push({ fileName: material.fileName, requestedRole: material.role as DocumentInputRole, document: { ...document, text: storedText } });
        } else {
          const originalBytes = await readDocumentSource(project, material.id);
          importedSources.push({ fileName: material.fileName, requestedRole: material.role as DocumentInputRole, document: await extractDocument(material.fileName, originalBytes) });
        }
      }
      const newMaterial = { id: randomUUID(), fileName: data.fileName.trim(), role: data.role as "requirements" | "coverage-reference" | "held-out-benchmark", sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength, createdAt: new Date().toISOString() };
      importedSources.splice(replaceIndex < 0 ? importedSources.length : Math.min(replaceIndex, importedSources.length), 0, { fileName: newMaterial.fileName, requestedRole: newMaterial.role, document: uploadedDocument });
      const resolvedSources = resolveDocumentInputRoles(importedSources);
      const websiteMaterial = (project.sourceMaterials ?? []).find(item => item.role === "website-content");
      let websiteText = websiteMaterial ? project.materialTexts?.[websiteMaterial.id] : undefined;
      if (websiteMaterial && typeof websiteText !== "string") {
        const marker = `# 网站可公开读取的页面文字\n\n`;
        const start = project.sourceText.indexOf(marker);
        if (start >= 0) websiteText = project.sourceText.slice(start + marker.length).split(/\n\n## 用户补充的测试重点/u, 1)[0]!.trim();
      }
      const contextText = project.contextText ?? project.sourceText.match(/## 用户补充的测试重点\s*\n([\s\S]*)$/u)?.[1]?.trim() ?? "";
      const websiteBlock = websiteText ? `# 网站可公开读取的页面文字\n\n${websiteText}` : "";
      let sourceText = [resolvedSources.requirementsText, websiteBlock, contextText ? `## 用户补充的测试重点\n${contextText}` : ""].filter(Boolean).join("\n\n---\n\n");
      if (!sourceText.trim() && project.caseMode !== "existing") sourceText = `# 网站探索目标\n\n目标网址：${project.targetUrl}\n\n请根据目标页面中实际可观察到的内容设计测试用例；业务规则或登录后状态无法确认时，明确标注待澄清，不得猜测预期。`;
      if (sourceText.length > 100_000) throw new Error(`更新后的需求资料共 ${sourceText.length} 字符，项目上限为 100000；不会静默截断。`);
      const materialCreatedAt = new Date().toISOString();
      const files = importedSources.map((item, index) => {
        if (item.fileName === newMaterial.fileName) return newMaterial;
        const existing = currentMaterials.find(material => material.fileName === item.fileName);
        if (!existing) throw new Error(`资料 ${item.fileName} 的项目关联丢失。`);
        return existing;
      });
      project.sourceMaterials = [...files, ...(websiteMaterial ? [websiteMaterial] : [])];
      project.materialTexts = Object.fromEntries([
        ...importedSources.map((item, index) => [files[index]!.id, item.document.text] as const),
        ...(websiteMaterial && websiteText ? [[websiteMaterial.id, websiteText] as const] : []),
      ]);
      project.sourceFiles = files.map(item => item.fileName);
      project.sourceRoles = [...resolvedSources.sourceRoles, ...(websiteMaterial ? [{ fileName: websiteMaterial.fileName, role: "website-content" as const }] : [])];
      project.sourceText = sourceText;
      project.contextText = contextText;
      project.fileName = files[0]?.fileName ?? project.fileName;
      project.researchExamples = [...(project.researchExamples ?? []).filter(item => !item.url.startsWith("uploaded-coverage-reference:")), ...resolvedSources.coverageReferences];
      project.reviewStatus = "draft";
      project.reviewNotes = "";
      project.updatedAt = materialCreatedAt;
      project.workflowPlan = [...(project.workflowPlan ?? []), `${data.replaceMaterialId ? "替换" : "新增"}资料版本：${newMaterial.fileName}（${newMaterial.role}）；正式用例未自动改写，需重新复核测试依据。`];
      const newMaterialIndex = project.sourceMaterials.findIndex(item => item.id === newMaterial.id);
      await writeDocumentSource(project, bytes, newMaterial.fileName, newMaterialIndex + 1);
      await saveDocumentProject(project);
      json(res, 200, { project, updatedMaterialId: newMaterial.id, materialVersion: getDocumentMaterialVersion(project) });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "资料版本更新失败。"); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/case-generator/generate") {
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    const allowed = new Set(["requirementsText", "websiteUrl", "websiteText", "files", "maxCases", "searchExamples"]);
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key))) { fail(res, 400, "用例生成请求字段无效。"); return; }
    if (typeof data.requirementsText === "string" && data.requirementsText.length > 60_000 || typeof data.websiteText === "string" && data.websiteText.length > 30_000 || typeof data.websiteUrl === "string" && data.websiteUrl.length > 2_000) { fail(res, 400, "说明文字或网址超过长度限制。"); return; }
    if (data.maxCases !== undefined && (!Number.isInteger(data.maxCases) || data.maxCases < 1 || data.maxCases > 80)) { fail(res, 400, "新增候选用例数量需为 1–80 的整数。"); return; }
    if (data.websiteUrl) { try { const parsed = new URL(data.websiteUrl); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); } catch { fail(res, 400, "网站地址必须是有效的 HTTP 或 HTTPS 网址。"); return; } }
    const files: Array<{ fileName: string; bytesBase64: string; role?: string }> = data.files ?? [];
    if (!Array.isArray(files) || files.length > 5 || files.some(file => !file || typeof file.fileName !== "string" || typeof file.bytesBase64 !== "string" || file.bytesBase64.length > 13_000_000 || (file.role !== undefined && !["auto", "requirements", "coverage-reference", "held-out-benchmark"].includes(file.role)))) { fail(res, 400, "资料需为最多 5 个 PDF、XMind、Markdown 或 TXT 文件，每个不超过 9 MB；用途必须是 auto/requirements/coverage-reference/held-out-benchmark。"); return; }
    try {
      const imported = await Promise.all(files.map(async file => {
        const bytes = Buffer.from(file.bytesBase64, "base64");
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
        return { fileName: file.fileName, requestedRole: file.role ?? "auto", document: await extractDocument(file.fileName, bytes) };
      }));
      const classified = imported.map(file => ({ ...file, role: file.requestedRole === "auto" ? (file.document.testCases?.length ? "held-out-benchmark" : "requirements") : file.requestedRole }));
      for (const file of classified) {
        if (file.role === "requirements" && file.document.testCases?.length) throw new Error(`文件「${file.fileName}」同时包含可识别用例和需求用途。为防止留出用例泄漏进生成提示，请拆分需求文本与基准，或将此文件标记为留出基准。`);
        if (file.role === "held-out-benchmark" && !file.document.testCases?.length) throw new Error(`文件「${file.fileName}」标记为留出基准，但没有识别到可比较的用例；请检查格式或改选覆盖参考。`);
      }
      const requirementParts = [typeof data.requirementsText === "string" ? data.requirementsText.trim() : "", ...classified.filter(file => file.role === "requirements").map(file => `资料：${file.fileName}\n${file.document.text}`)].filter(Boolean);
      const requirementsText = requirementParts.join("\n\n---\n\n");
      if (requirementsText.length > 40_000) throw new Error(`需求资料合计 ${requirementsText.length} 字符，单轮上限 40000；请按功能章节分批提交。未截断或静默漏测。`);
      const websiteUrl = typeof data.websiteUrl === "string" ? data.websiteUrl.trim() : "";
      const hostname = websiteUrl ? new URL(websiteUrl).hostname : "";
      let websiteText = typeof data.websiteText === "string" ? data.websiteText : "";
      if (websiteText.length > 12_000) throw new Error(`页面文字有 ${websiteText.length} 字符，单轮上限 12000；请分页面提交。`);
      let websiteReadWarning = "";
      if (websiteUrl && !websiteText.trim()) {
        try { websiteText = await readPublicWebsiteText(websiteUrl); }
        catch (error) { websiteReadWarning = error instanceof Error ? error.message : String(error); }
      }
      const research = data.searchExamples === false || process.env.TESTPILOT_DISABLE_PUBLIC_SEARCH === "1"
        ? { results: [], notice: "公开案例搜索未启用。" }
        : await searchTestExamples(`${hostname ? `${hostname} web application` : "software requirements"} functional test case examples boundary validation state transition QA`, { limit: 5, timeoutMs: 15_000 }).catch(() => ({ results: [], notice: "公开案例搜索暂时不可用。" }));
      const existingCases = classified.filter(file => file.role === "held-out-benchmark").flatMap(file => (file.document.testCases ?? []).map(item => ({ title: item.title, source: `[${file.fileName}] ${item.source}`, expected: item.expected })));
      const referenceFiles = classified.filter(file => file.role === "coverage-reference");
      const uploadedExamples = referenceFiles.flatMap(file => file.document.testCases?.length
        ? file.document.testCases.map(item => ({ title: item.title, url: `uploaded-reference:${file.fileName}`, snippet: `${item.source}\n预期：${item.expected}` }))
        : [{ title: file.fileName, url: `uploaded-reference:${file.fileName}`, snippet: file.document.text.slice(0, 2_500) }]);
      const result = await generateTestCaseDrafts({ requirementsText, websiteUrl, websiteText, existingCases, examples: [...research.results, ...uploadedExamples], maxCases: data.maxCases });
      if (websiteReadWarning) result.warnings.push(`网页内容未能自动读取：${websiteReadWarning} 可粘贴页面文字后重新生成。`);
      const benchmarkFiles = classified.filter(file => file.role === "held-out-benchmark");
      if (benchmarkFiles.length) {
        const baselineSource = result.sources.find(source => source.kind === "existing-cases");
        if (baselineSource) {
          baselineSource.label = `${baselineSource.label}；资料：${benchmarkFiles.map(file => file.fileName).join("、")}`;
          baselineSource.reference = "generated-after-comparison-only";
        }
      }
      result.sources.push(...classified.filter(file => file.role !== "held-out-benchmark").map(file => ({ kind: file.role === "requirements" ? "requirements" : "public-examples", label: file.fileName, reference: file.role } as const)));
      // Keep the exact, handoff-valid generation artifact separate from UI
      // decorations such as research counts. The handoff validator is strict
      // by design and must never be fed a mutated response envelope.
      json(res, 201, { ...result, generationArtifact: structuredClone(result), research: { count: research.results.length, uploadedReferenceCount: uploadedExamples.length, notice: research.notice }, generationOnly: true });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "测试用例生成失败。"); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/case-generator/execute-draft") {
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["generation", "targetUrl", "name"].includes(key)) || !Object.hasOwn(data, "generation") || typeof data.targetUrl !== "string") {
      fail(res, 400, "移交测试执行需要生成结果和目标网址。"); return;
    }
    try {
      const project = createExecutionDraftFromCaseGeneration({ targetUrl: data.targetUrl, name: data.name, generation: data.generation });
      const workflow = await createDocumentWorkflow({ projectId: project.id, approvalPolicy: "confirm-before-execution" });
      project.workflowId = workflow.workflowId;
      const generation = project.caseGeneration;
      const generationInput = {
        projectId: project.id,
        artifactId: generation.artifactId,
        version: generation.version,
        generationDigest: generation.digest,
        requirementsDigest: createHash("sha256").update(JSON.stringify(generation.requirements)).digest("hex"),
        sourceRoles: project.sourceRoles ?? [],
      };
      const generationStage = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "generate-cases", specialist: "case-generator", input: generationInput });
      if (generationStage.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, "generate-cases", generationStage.stage.attempt, [`case-generation:${generation.artifactId}:v${generation.version}:${generation.digest}`, `project:${project.id}:case-snapshot:${createHash("sha256").update(JSON.stringify(project.cases)).digest("hex")}`]);
      await saveDocumentProject(project);
      json(res, 201, { projectId: project.id, workflowId: workflow.workflowId, projectName: project.name, caseCount: project.cases.length, selectedForReview: project.cases.filter(item => item.selectedForRegression).length, reviewStatus: project.reviewStatus });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "无法创建用例执行草稿。"); }
    return;
  }
  const documentPreparation = url.pathname.match(/^\/api\/document-preparation\/([^/]+)$/);
  if (req.method === "GET" && documentPreparation) {
    const id = decodeURIComponent(documentPreparation[1]!);
    if (!/^[0-9a-f-]{36}$/i.test(id)) { fail(res, 400, "资料准备任务 ID 格式无效。"); return; }
    const task = documentPreparationTasks.get(id) ?? await readFile(path.join(documentPreparationDir, `${id}.json`), "utf8").then(text => JSON.parse(text) as DocumentPreparationTask, () => undefined);
    if (!task) { fail(res, 404, "资料准备任务不存在。"); return; }
    json(res, 200, task); return;
  }
  if (req.method === "GET" && url.pathname === "/api/sqlite-migration-suites") { json(res, 200, await listSqliteMigrationCandidates()); return; }
  if (req.method === "POST" && url.pathname === "/api/sqlite-migration-suites") {
    let data: any; try { data = await migrationBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["suite", "files"].includes(key)) || !Object.hasOwn(data, "suite") || !Object.hasOwn(data, "files")) { fail(res, 400, "A migration candidate requires exactly suite and files fields."); return; }
    try { json(res, 201, await createSqliteMigrationCandidate(data.suite, data.files)); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : "SQLite migration suite is invalid."); }
    return;
  }
  const migrationUpdate = url.pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/update$/);
  if (req.method === "POST" && migrationUpdate) {
    let data: any; try { data = await migrationBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["suite", "files"].includes(key)) || !Object.hasOwn(data, "suite") || !Object.hasOwn(data, "files")) { fail(res, 400, "An update requires exactly suite and files fields."); return; }
    try { json(res, 200, await updateSqliteMigrationCandidate(decodeURIComponent(migrationUpdate[1]!), data.suite, data.files)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "SQLite migration suite revision failed."); }
    return;
  }
  const migrationReview = url.pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/review$/);
  if (req.method === "POST" && migrationReview) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["decision", "notes"].includes(key)) || !["approve", "reject"].includes(data.decision) || typeof data.notes !== "string" || data.notes.length > 2000) { fail(res, 400, "Review requires decision=approve/reject and notes up to 2000 characters."); return; }
    try { json(res, 200, await reviewSqliteMigrationCandidate(decodeURIComponent(migrationReview[1]!), data.decision, data.notes)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "SQLite migration review failed."); }
    return;
  }
  const migrationRunAction = url.pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)\/run$/);
  if (req.method === "POST" && migrationRunAction) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length) { fail(res, 400, "SQLite migration runs do not accept execution options."); return; }
    try { const run = await executeApprovedSqliteMigrationSuite(decodeURIComponent(migrationRunAction[1]!)); json(res, 201, run.record); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "SQLite migration suite execution failed."); }
    return;
  }
  const migrationArtifact = url.pathname.match(/^\/api\/sqlite-migration-runs\/([^/]+)\/(report|package)$/);
  if (req.method === "GET" && migrationArtifact) {
    const id = decodeURIComponent(migrationArtifact[1]!);
    const name = migrationArtifact[2] === "report" ? "report.md" : "testpilot-sqlite-migration-suite.zip";
    const artifact = await readSqliteMigrationRunArtifact(id, name);
    if (!artifact) { fail(res, 404, "SQLite migration run artifact does not exist."); return; }
    const type = name.endsWith(".zip") ? "application/zip" : "text/markdown; charset=utf-8";
    res.writeHead(200, { "content-type": type, "content-length": artifact.length, "content-disposition": `attachment; filename="testpilot-${id}.${name.endsWith(".zip") ? "zip" : "md"}"`, "cache-control": "no-store" }); res.end(artifact); return;
  }
  const migrationRun = url.pathname.match(/^\/api\/sqlite-migration-runs\/([^/]+)$/);
  if (req.method === "GET" && migrationRun) {
    const run = await getSqliteMigrationRun(decodeURIComponent(migrationRun[1]!));
    run ? json(res, 200, run) : fail(res, 404, "SQLite migration run does not exist.");
    return;
  }
  const migrationSuite = url.pathname.match(/^\/api\/sqlite-migration-suites\/([^/]+)$/);
  if (req.method === "GET" && migrationSuite) {
    const candidate = await getSqliteMigrationCandidate(decodeURIComponent(migrationSuite[1]!));
    candidate ? json(res, 200, candidate) : fail(res, 404, "SQLite migration suite candidate does not exist or failed validation.");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/api-suites") { json(res, 200, await listApiSuiteCandidates()); return; }
  if (req.method === "POST" && url.pathname === "/api/api-suites") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    try { json(res, 201, await createApiSuiteCandidate(data)); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : "API suite 无效。"); }
    return;
  }
  const apiSuiteUpdate = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/update$/);
  if (req.method === "POST" && apiSuiteUpdate) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || !Object.hasOwn(data, "suite")) { fail(res, 400, "update requires exactly one suite field."); return; }
    try { json(res, 200, await updateApiSuiteCandidate(decodeURIComponent(apiSuiteUpdate[1]!), data.suite)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "API suite 修订失败。"); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/api-suites/generate") {
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    const allowed = new Set(["baseUrl", "contextText", "apiSpecification", "files"]);
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key)) || typeof data.baseUrl !== "string" || data.baseUrl.length > 2000 || (data.contextText !== undefined && (typeof data.contextText !== "string" || data.contextText.length > 20_000)) || (data.apiSpecification !== undefined && (typeof data.apiSpecification !== "string" || data.apiSpecification.length > 40_000))) { fail(res, 400, "API 用例生成请求字段无效或超过长度限制。"); return; }
    const files: Array<{ fileName: string; bytesBase64: string }> = data.files ?? [];
    if (!Array.isArray(files) || files.length > 5 || files.some(file => !file || typeof file.fileName !== "string" || typeof file.bytesBase64 !== "string" || file.bytesBase64.length > 13_000_000)) { fail(res, 400, "资料需为 1–5 个 PDF、XMind、Markdown 或 TXT 文件，每个不超过 9 MB。"); return; }
    try {
      const documents = await Promise.all(files.map(async file => {
        const bytes = Buffer.from(file.bytesBase64, "base64");
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
        return { fileName: file.fileName, document: await extractDocument(file.fileName, bytes) };
      }));
      const sourceRequirements = [typeof data.contextText === "string" ? data.contextText.trim() : "", ...documents.map(item => `资料：${item.fileName}\n${item.document.text}`)].filter(Boolean).join("\n\n").slice(0, 20_000);
      const apiSpecification = typeof data.apiSpecification === "string" ? data.apiSpecification.trim().slice(0, 40_000) : "";
      if (!sourceRequirements && !apiSpecification) { fail(res, 400, "请提供 API 需求资料、补充说明或 OpenAPI 契约。"); return; }
      const hostname = new URL(data.baseUrl).hostname;
      const researchPromise = process.env.TESTPILOT_DISABLE_PUBLIC_SEARCH === "1"
        ? Promise.resolve({ provider: "none" as const, notice: "公开案例搜索已关闭。", results: [] })
        : searchTestExamples(`${hostname} API endpoint testing authentication validation test cases`, { limit: 5, timeoutMs: 15_000 }).catch(() => ({ provider: "none" as const, notice: "公开案例搜索不可用。", results: [] }));
      const [research] = await Promise.all([researchPromise]);
      const suite = await generateApiSuite(data.baseUrl, sourceRequirements, apiSpecification, research.results);
      suite.description = [suite.description, `来源资料文件：${documents.map(item => item.fileName).join("、") || "无"}`, `公开案例检索：${research.results.length} 条（仅参考测试覆盖，不作为目标 API 行为依据）`].filter(Boolean).join("\n").slice(0, 2000);
      const openApiSummary = await summarizeOpenApiSpecification(apiSpecification);
      const openApiOperations = openApiSummary?.operations.map(operation => `${String(operation.method)} ${String(operation.path)}`);
      const candidate = await createApiSuiteCandidate(suite, { automaticReadOnlyRun: true, ...(openApiOperations ? { openApiOperations, openApiOperationFacts: openApiOperationFacts(openApiSummary!) } : {}) });
      json(res, 201, { ...candidate, research: { count: research.results.length, provider: research.provider, notice: research.notice } });
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "API 测试套件生成失败。"); }
    return;
  }
  const apiSuiteReview = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/review$/);
  if (req.method === "POST" && apiSuiteReview) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || !["approve", "reject"].includes(data.decision) || typeof data.notes !== "string" || data.notes.length > 2000) { fail(res, 400, "审核需要 decision=approve/reject 和不超过 2000 字的 notes。"); return; }
    try { json(res, 200, await reviewApiSuiteCandidate(decodeURIComponent(apiSuiteReview[1]!), data.decision, data.notes)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "API suite 审核失败。"); }
    return;
  }
  const apiSuite = url.pathname.match(/^\/api\/api-suites\/([^/]+)$/);
  if (req.method === "GET" && apiSuite) {
    const candidate = await getApiSuiteCandidate(decodeURIComponent(apiSuite[1]!));
    candidate ? json(res, 200, candidate) : fail(res, 404, "API suite 候选不存在或校验失败。");
    return;
  }
  const apiSuiteFindings = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/findings$/);
  if (req.method === "GET" && apiSuiteFindings) {
    const history = await getApiFindingHistory(decodeURIComponent(apiSuiteFindings[1]!));
    history ? json(res, 200, history) : fail(res, 404, "API suite 候选不存在或校验失败。");
    return;
  }
  const apiFindingDiagnosis = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/findings\/([^/]+)\/diagnosis$/);
  if (req.method === "GET" && apiFindingDiagnosis) {
    const diagnosis = await diagnoseApiFinding(decodeURIComponent(apiFindingDiagnosis[1]!), decodeURIComponent(apiFindingDiagnosis[2]!));
    diagnosis ? json(res, 200, diagnosis) : fail(res, 404, "API finding 或套件不存在。");
    return;
  }
  const apiSuiteRun = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/run$/);
  if (req.method === "POST" && apiSuiteRun) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    const allowed = new Set(["baseUrl", "allowNetwork", "allowMutations", "allowConcurrency", "caseIds", "rerunOf"]);
    const validIds = data?.caseIds === undefined || (Array.isArray(data.caseIds) && data.caseIds.length > 0 && data.caseIds.length <= 500 && data.caseIds.every((id: unknown) => typeof id === "string" && id.length <= 120 && id.trim()) && new Set(data.caseIds).size === data.caseIds.length);
    const validParent = data?.rerunOf === undefined || (typeof data.rerunOf === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.rerunOf));
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key)) || (data.baseUrl !== undefined && typeof data.baseUrl !== "string") || ["allowNetwork", "allowMutations", "allowConcurrency"].some(key => data[key] !== undefined && typeof data[key] !== "boolean") || !validIds || !validParent || (data.rerunOf !== undefined && data.caseIds === undefined)) { fail(res, 400, "API run options are invalid."); return; }
    try { const run = await executeApprovedApiSuite(decodeURIComponent(apiSuiteRun[1]!), data); json(res, 201, run.record); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "API suite 执行失败。"); }
    return;
  }
  const apiSuiteAutoRun = url.pathname.match(/^\/api\/api-suites\/([^/]+)\/auto-run$/);
  if (req.method === "POST" && apiSuiteAutoRun) {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => key !== "allowNetwork") || (data.allowNetwork !== undefined && typeof data.allowNetwork !== "boolean")) { fail(res, 400, "API auto-run options are invalid."); return; }
    try { const run = await autoRunReadOnlyApiSuite(decodeURIComponent(apiSuiteAutoRun[1]!), data); json(res, 201, { candidate: await getApiSuiteCandidate(decodeURIComponent(apiSuiteAutoRun[1]!)), run: run.record }); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "API suite 自动运行失败。"); }
    return;
  }
  const apiRunArtifact = url.pathname.match(/^\/api\/api-runs\/([^/]+)\/(report|package)$/);
  if (req.method === "GET" && apiRunArtifact) {
    const id = decodeURIComponent(apiRunArtifact[1]!);
    const name = apiRunArtifact[2] === "report" ? "report.md" : "testpilot-api-suite.zip";
    const artifact = await readApiRunArtifact(id, name);
    if (!artifact) { fail(res, 404, "API run artifact 不存在。"); return; }
    const type = name.endsWith(".zip") ? "application/zip" : "text/markdown; charset=utf-8";
    res.writeHead(200, { "content-type": type, "content-length": artifact.length, "content-disposition": `attachment; filename="testpilot-${id}.${name.endsWith(".zip") ? "zip" : "md"}"`, "cache-control": "no-store" }); res.end(artifact); return;
  }
  const apiRun = url.pathname.match(/^\/api\/api-runs\/([^/]+)$/);
  if (req.method === "GET" && apiRun) {
    const run = await getApiRun(decodeURIComponent(apiRun[1]!));
    run ? json(res, 200, run) : fail(res, 404, "API run 不存在。");
    return;
  }
  const loginHandoff = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/login(?:\/(continue))?$/);
  const recoveryProject = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/recovery$/);
  if (req.method === "GET" && recoveryProject) {
    const project = await getDocumentProject(decodeURIComponent(recoveryProject[1]!));
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    json(res, 200, await getDocumentRunRecovery(project) ?? null); return;
  }
  if (loginHandoff && req.method === "GET" && !loginHandoff[2]) { json(res, 200, getLoginHandoff(decodeURIComponent(loginHandoff[1]!)) ?? null); return; }
  if (loginHandoff && req.method === "POST" && loginHandoff[2] === "continue") {
    try { json(res, 200, await requestLoginContinue(decodeURIComponent(loginHandoff[1]!))); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "登录状态尚未就绪。"); }
    return;
  }
  const documentRunFinalizePackage = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/finalize-package$/);
  if (req.method === "POST" && documentRunFinalizePackage) {
    try { json(res, 200, await retryDocumentRunPackaging(decodeURIComponent(documentRunFinalizePackage[1]!))); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : "无法完成本轮报告和脚本包。"); }
    return;
  }
  const docRunArtifact = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/(report|package)$/);
  if (req.method === "GET" && docRunArtifact) {
    const id = decodeURIComponent(docRunArtifact[1]!); const run = await getDocumentRun(id);
    if (!run) { fail(res, 404, "文档测试运行不存在。"); return; }
    if (docRunArtifact[2] === "package") {
      if (!run.packageReady && !run.packagePath) { fail(res, 409, "本轮尚无可复用脚本包。"); return; }
      let bytes: Buffer;
      try { bytes = await readDocumentPackage(id); }
      catch { fail(res, 404, "本轮记录了脚本包，但 ZIP 文件缺失或不可读取；请重新运行以重新生成脚本包。"); return; }
      res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="testpilot-${id}.zip"`, "content-length": bytes.length }); res.end(bytes); return;
    }
    if (!run.reportReady && !run.report) { fail(res, 409, "本轮报告尚未生成。"); return; }
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="testpilot-${id}.md"` }); res.end(run.report); return;
  }
  const documentRun = url.pathname.match(/^\/api\/document-runs\/([^/]+)$/);
  if (req.method === "GET" && documentRun) {
    const run = await getDocumentRun(decodeURIComponent(documentRun[1]!));
    if (!run) { fail(res, 404, "文档测试运行不存在。"); return; }
    json(res, 200, run); return;
  }
  const documentRunProgress = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/progress$/);
  if (req.method === "GET" && documentRunProgress) {
    const progress = await getDocumentRunProgress(decodeURIComponent(documentRunProgress[1]!));
    if (!progress) { fail(res, 404, "文档测试运行不存在。可能尚未启动，或记录已清理。"); return; }
    json(res, 200, progress); return;
  }
  const documentRunCancel = url.pathname.match(/^\/api\/document-runs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && documentRunCancel) {
    const runId = decodeURIComponent(documentRunCancel[1]!);
    const progress = await getDocumentRunProgress(runId);
    if (!progress) { fail(res, 404, "文档测试运行不存在或尚未启动。"); return; }
    try {
      const status = await cancelDocumentRun(runId);
      if (status === "requested" && progress.workflowId) await cancelDocumentWorkflow(progress.workflowId, "文档测试运行由用户手动停止。");
      json(res, status === "requested" ? 202 : 200, { runId, status });
    } catch (error) { fail(res, 409, error instanceof Error ? error.message : "无法停止当前运行。"); }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/document-workflows") {
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    if (status && !["running", "waiting", "failed", "completed", "cancelled"].includes(status)) { fail(res, 400, "workflow status filter is invalid."); return; }
    try { json(res, 200, await listDocumentWorkflows({ ...(projectId ? { projectId } : {}), ...(status ? { status: status as "running" | "waiting" | "failed" | "completed" | "cancelled" } : {}) })); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : "Could not read workflows."); }
    return;
  }
  const documentWorkflow = url.pathname.match(/^\/api\/document-workflows\/([^/]+)$/);
  if (req.method === "GET" && documentWorkflow) {
    const id = decodeURIComponent(documentWorkflow[1]!);
    if (!/^[0-9a-f-]{36}$/i.test(id)) { fail(res, 400, "workflow ID must be a UUID."); return; }
    try {
      const workflow = await getDocumentWorkflow(id);
      workflow ? json(res, 200, workflow) : fail(res, 404, "document workflow not found.");
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : "workflow validation failed."); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/document-projects/import") {
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    const files: Array<{ fileName: string; bytesBase64: string; role?: DocumentInputRole }> = Array.isArray(data?.files) ? data.files : [{ fileName: data?.fileName, bytesBase64: data?.bytesBase64, role: data?.role }];
    if (!data || typeof data.targetUrl !== "string" || !files.length || files.length > 5 || files.some(file => !file || typeof file.fileName !== "string" || typeof file.bytesBase64 !== "string" || file.bytesBase64.length > 13_000_000 || file.role !== undefined && !["auto", "requirements", "coverage-reference", "held-out-benchmark"].includes(file.role)) || data.contextText !== undefined && (typeof data.contextText !== "string" || data.contextText.length > 8_000)) { fail(res, 400, "需要目标网址和 1–5 个有效资料文件；每个文件不能超过 9 MB，role 仅支持 auto、requirements、coverage-reference 或 held-out-benchmark，补充说明最多 8000 字。"); return; }
    const task: DocumentPreparationTask = { id: randomUUID(), status: "running", stage: "planning", events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    documentPreparationTasks.set(task.id, task);
    await recordDocumentPreparation(task, "planning", "completed", `目标已锁定：${data.targetUrl}；输入 ${files.length} 份资料；将解析资料、查询公开参考、准备可执行用例，并遵守${data.requireConfirmation === true ? "需要用户审核" : "自动安全审核"}策略。`);
    json(res, 202, { preparationId: task.id, status: task.status });
    void (async () => {
      try {
        await recordDocumentPreparation(task, "reading-materials", "running", "正在解析需求资料与已有测试用例。");
        const imported = await Promise.all(files.map(async file => {
          const bytes = Buffer.from(file.bytesBase64, "base64");
          if (!bytes.length || bytes.length > 9 * 1024 * 1024) throw new Error(`${file.fileName} 不能为空且不能超过 9 MB。`);
          let document = await extractDocument(file.fileName, bytes);
          if (file.role === "held-out-benchmark" && !(document.testCases?.length)) {
            const extracted = createReviewCases(document.text);
            document = { ...document, testCases: extracted.map(item => ({ title: item.title, source: item.source, expected: item.expected, priority: item.priority, category: item.category, confidence: item.confidence, coverageAreas: item.coverageAreas, requirementRefs: item.requirementRefs })) };
          }
          return { file, bytes, document };
        }));
        await recordDocumentPreparation(task, "reading-materials", "completed", `已解析 ${imported.length} 份资料，共提取 ${imported.reduce((sum, item) => sum + (item.document.testCases?.length ?? 0), 0)} 条已有测试用例。`);
        await recordDocumentPreparation(task, "web-research", "running", "正在查找公开测试案例参考；参考内容只用于覆盖启发，不视为目标应用事实。");
        const research = await searchTestExamples(`${new URL(data.targetUrl).hostname} web application QA test case examples`, { limit: 5, timeoutMs: 15_000 });
        await recordDocumentPreparation(task, "web-research", research.results.length ? "completed" : "warning", research.results.length ? `找到 ${research.results.length} 条公开参考。` : `没有可用公开参考：${research.notice}`);
        const fileName = imported.map(({ file }) => file.fileName).join("、").slice(0, 200);
        const resolvedSources = resolveDocumentInputRoles(imported.map(({ file, document }) => ({ fileName: file.fileName, requestedRole: file.role ?? "auto", document })));
        let sourceText = resolvedSources.requirementsText;
        const caseMode = data.caseMode === "existing" || data.caseMode === "ai" || data.caseMode === "both" ? data.caseMode : "both";
        let websiteReadWarning = "";
        let websiteContent = "";
        try { websiteContent = await readPublicWebsiteText(data.targetUrl); }
        catch (error) { websiteReadWarning = error instanceof Error ? error.message : String(error); }
        if (websiteContent) sourceText = [sourceText, `# 网站可公开读取的页面文字\n\n${websiteContent}`].filter(Boolean).join("\n\n---\n\n");
        if (!sourceText.trim() && caseMode !== "existing") sourceText = `# 网站探索目标\n\n目标网址：${data.targetUrl}\n\n请根据目标页面中实际可观察到的内容设计测试用例；业务规则或登录后状态无法确认时，明确标注待澄清，不得猜测预期。`;
        if (sourceText.length > 100_000) throw new Error(`需求与网站资料合计 ${sourceText.length} 字符，项目上限 100000；请拆分文档，不会静默截断。`);
        const testCases = resolvedSources.benchmarkCases;
        if (testCases.length > 200) throw new Error(`资料中提取到 ${testCases.length} 条用例，单项目上限 200；请拆分为多个项目，未静默漏掉尾部用例。`);
        if (research.results.length + resolvedSources.coverageReferences.length > 8) throw new Error(`公开搜索参考 ${research.results.length} 条，加上上传覆盖参考 ${resolvedSources.coverageReferences.length} 条后超过模型输入上限 8；请将部分资料标为留出基准，或减少覆盖参考文件。`);
        const primary = imported[0]!.document;
        const document: ImportedDocument = { format: primary.format, text: sourceText, ...(testCases.length ? { testCases } : {}) };
        const project = makeDocumentProject({ name: data.name, fileName, sourceFiles: imported.map(({ file }) => file.fileName), researchExamples: [...research.results, ...resolvedSources.coverageReferences], caseMode, document, targetUrl: data.targetUrl });
        project.sourceRoles = [...resolvedSources.sourceRoles, ...(websiteContent ? [{ fileName: new URL(data.targetUrl).hostname, role: "website-content" as const }] : [])];
        const materialCreatedAt = new Date().toISOString();
        const importedMaterials = imported.map(({ file, bytes }, index) => ({
            id: randomUUID(), fileName: file.fileName, role: resolvedSources.sourceRoles[index]?.role ?? ("requirements" as const),
            sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength, createdAt: materialCreatedAt,
          }));
        const websiteMaterial = websiteContent ? { id: randomUUID(), fileName: new URL(data.targetUrl).hostname, role: "website-content" as const, sha256: createHash("sha256").update(websiteContent, "utf8").digest("hex"), byteLength: Buffer.byteLength(websiteContent, "utf8"), createdAt: materialCreatedAt } : undefined;
        project.sourceMaterials = [...importedMaterials, ...(websiteMaterial ? [websiteMaterial] : [])];
        project.materialTexts = Object.fromEntries([
          ...imported.map(({ document }, index) => [importedMaterials[index]!.id, document.text] as const),
          ...(websiteMaterial ? [[websiteMaterial.id, websiteContent] as const] : []),
        ]);
        project.contextText = typeof data.contextText === "string" ? data.contextText.trim() : "";
        task.projectId = project.id;
        const workflow = await createDocumentWorkflow({ projectId: project.id, approvalPolicy: data.requireConfirmation === true ? "confirm-before-execution" : "automatic" });
        project.workflowId = workflow.workflowId;
        task.workflowId = workflow.workflowId;
        project.confirmationRequired = data.requireConfirmation === true;
        project.workflowPlan = [...(project.workflowPlan ?? []), `联网调研结果：${research.results.length} 条参考${research.provider === "none" ? `（${research.notice}）` : `（${research.provider}）`}`];
        if (project.contextText) project.sourceText += `\n\n## 用户补充的测试重点\n${project.contextText}`;
        if (websiteReadWarning) project.workflowPlan.push(`网站正文未能读取：${websiteReadWarning}；模型只使用明确的需求资料、用户说明和公开参考。`);
        await saveDocumentProject(project);
        await recordDocumentPreparation(task, "planning", "completed", `已创建可追踪 workflow ${workflow.workflowId}，生成模型只接收需求资料与公开参考；留出基准在生成后比较。`);
        let generationWarning = "";
        await recordDocumentPreparation(task, "generating-cases", "running", "正在根据资料、已有用例和公开参考生成或整理测试用例。");
        const generationStage = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "generate-cases", specialist: "case-generator", input: { caseMode, requirementsDigest: createHash("sha256").update(project.sourceText).digest("hex"), publicReferenceIds: research.results.map(item => item.url), heldOutBenchmarkCount: testCases.length, heldOutBenchmarkDigest: createHash("sha256").update(JSON.stringify(testCases)).digest("hex") } });
        if (caseMode !== "existing" && modelConfiguration().modelAvailable) {
          try {
            const existing = [...project.cases];
            const generated = validateCases(await generateDocumentBrowserCases(project.sourceText, [...research.results, ...resolvedSources.coverageReferences])).map(item => ({ ...item, caseOrigin: "ai-generated" as const, lifecycleStatus: "draft" as const, selectedForRegression: false }));
            project.cases = validateCasesPreservingGenerationTrace(caseMode === "both" ? mergeBrowserCases(existing, generated) : generated, existing);
          } catch (error) { generationWarning = error instanceof Error ? error.message : String(error); }
        } else if (caseMode !== "existing" && !modelConfiguration().modelAvailable) generationWarning = "未配置兼容模型 API：已保留资料中现有用例；AI 补充和 Computer Use 暂不可用。可在设置中配置模型后重新生成。";
        if (generationWarning) project.generationWarning = generationWarning; else delete project.generationWarning;
        await saveDocumentProject(project);
        if (generationStage.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, "generate-cases", generationStage.stage.attempt, [`project:${project.id}:cases:${createHash("sha256").update(JSON.stringify(project.cases)).digest("hex")}`]);
        await recordDocumentPreparation(task, "generating-cases", generationWarning ? "warning" : "completed", generationWarning ? `用例生成遇到限制：${generationWarning}` : `已整理 ${project.cases.length} 条测试用例。`);
        await recordDocumentPreparation(task, "reviewing-cases", "running", "正在校验用例结构、唯一 ID、预期结果、需求引用及执行范围。");
        const reviewStage = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "review-cases", specialist: "case-reviewer", input: { casesDigest: createHash("sha256").update(JSON.stringify(project.cases)).digest("hex"), requirementsDigest: createHash("sha256").update(project.sourceText).digest("hex") } });
        project.cases = validateCasesPreservingGenerationTrace(project.cases, project.cases);
        if (reviewStage.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, "review-cases", reviewStage.stage.attempt, [`project:${project.id}:validated-cases:${createHash("sha256").update(JSON.stringify(project.cases)).digest("hex")}`]);
        await saveDocumentProject(project);
        await recordDocumentPreparation(task, "reviewing-cases", "completed", `结构与引用校验通过；用例总数 ${project.cases.length}，AI 生成与基准来源分别保留。`);
        await recordDocumentPreparation(task, "generating-steps", "running", "正在为用例生成受限浏览器步骤并检查是否可自动执行。");
        const stepStage = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "author-steps", specialist: "step-author", input: { caseIds: project.cases.map(item => item.id), casesDigest: createHash("sha256").update(JSON.stringify(project.cases)).digest("hex"), targetUrl: project.targetUrl } });
        if (project.cases.length) {
          const stepResult = await generateMissingBrowserSteps(project);
          project.stepAuthoring = { generatedAt: new Date().toISOString(), results: stepResult.caseResults };
          if (stepResult.warning) generationWarning = [generationWarning, stepResult.warning].filter(Boolean).join(" ");
        } else generationWarning = [generationWarning, "没有提取到可执行测试用例。"].filter(Boolean).join(" ");
        if (stepStage.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, "author-steps", stepStage.stage.attempt, [`project:${project.id}:steps:${createHash("sha256").update(JSON.stringify(project.cases.map(item => ({ id: item.id, steps: item.steps })))).digest("hex")}`]);
        if (generationWarning) project.generationWarning = generationWarning; else delete project.generationWarning;
        if (!project.confirmationRequired && !requiresManualApiContractReview(project) && hasAutoRunnableSelectedCase(project.cases)) {
          project.cases = validateCases(project.cases); project.reviewStatus = "approved";
          project.reviewNotes = "用户选择自动运行：已就绪的只读用例通过服务端安全 DSL 校验后自动执行；缺步骤、风险未定或依赖缺失的用例会逐条标为阻塞并说明补齐项。";
        }
        await Promise.all(imported.map(({ file, bytes }, index) => writeDocumentSource(project, bytes, file.fileName, index + 1)));
        await saveDocumentProject(project);
        const approvalInput = { projectId: project.id, reviewedCaseDigest: createHash("sha256").update(JSON.stringify(project.cases)).digest("hex"), confirmationRequired: project.confirmationRequired === true, securityGatePassed: project.reviewStatus === "approved" };
        const approvalGate = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "human-approval", specialist: "human-review-gate", input: approvalInput });
        if (project.reviewStatus === "approved" && approvalGate.stage.status === "running") {
          await completeDocumentWorkflowStage(workflow.workflowId, "human-approval", approvalGate.stage.attempt, [`project:${project.id}:approved:${createHash("sha256").update(project.reviewNotes ?? "").digest("hex")}`]);
        } else if (approvalGate.stage.status === "running") {
          await waitDocumentWorkflowStage(workflow.workflowId, "human-approval", approvalGate.stage.attempt, "自动模式安全门未通过或用例仍有待澄清项；等待用户在同一项目对话中复核范围、风险或补充条件。");
        }
        task.status = project.reviewStatus === "approved" ? "completed" : "needs-review";
        await recordDocumentPreparation(task, task.status === "completed" ? "ready" : "needs-review", task.status === "completed" ? "completed" : "warning", task.status === "completed" ? "准备完成；用例通过安全门禁，按设置自动继续测试。" : generationWarning || "用例已准备完成，等待审核或补充可执行信息后继续。");
      } catch (error) {
        task.status = "failed"; task.error = error instanceof Error ? error.message : String(error);
        if (task.workflowId) {
          const workflowState = await getDocumentWorkflow(task.workflowId).catch(() => undefined);
          const activeStage = [...(workflowState?.stages ?? [])].reverse().find(stage => stage.status === "running");
          if (activeStage) await failDocumentWorkflowStage(task.workflowId, activeStage.stageId, activeStage.attempt, { message: task.error, code: "preparation-stage-failed" }).catch(() => undefined);
        }
        await recordDocumentPreparation(task, "failed", "failed", task.error).catch(() => undefined);
      }
    })();
    return;
  }
  const documentImpactReviews = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/impact-reviews$/);
  if (req.method === "POST" && documentImpactReviews) {
    const projectId = decodeURIComponent(documentImpactReviews[1]!);
    const project = await getDocumentProject(projectId);
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || !["analyze", "review"].includes(data.action)) { fail(res, 400, "变更影响操作必须是 analyze 或 review。"); return; }
    if (data.action === "analyze") {
      if (Object.keys(data).some(key => !["action", "siteVersionId"].includes(key)) || typeof data.siteVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.siteVersionId)) { fail(res, 400, "影响分析需要有效的网站版本 ID。"); return; }
      const siteVersion = project.siteVersions?.find(item => item.id === data.siteVersionId);
      if (!siteVersion) { fail(res, 404, "网站版本不存在或不属于当前项目。"); return; }
      if (!siteVersion.changeNotes.trim()) { fail(res, 422, "该网站版本没有迭代说明；请先登记可审核的变更说明。"); return; }
      const analyses = project.impactAnalyses ?? [];
      if (analyses.length >= 100) { fail(res, 422, "单个项目最多保留 100 次变更影响审核记录。"); return; }
      const scan = analyzeDocumentCaseImpact(project.cases, siteVersion.changeNotes);
      const analysis = { id: randomUUID(), siteVersionId: siteVersion.id, siteVersionLabel: siteVersion.label, changeNotesSnapshot: siteVersion.changeNotes, caseVersion: getDocumentCaseVersion(project), analyzedAt: new Date().toISOString(), ...scan, status: "pending" as const };
      project.impactAnalyses = [...analyses, analysis];
      project.updatedAt = new Date().toISOString();
      await saveDocumentProject(project);
      json(res, 201, { project, analysis }); return;
    }
    if (Object.keys(data).some(key => !["action", "analysisId", "decision", "selectedCaseIds", "notes"].includes(key)) || typeof data.analysisId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.analysisId) || !["accept", "reject"].includes(data.decision) || data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 1000) || data.decision === "accept" && (!Array.isArray(data.selectedCaseIds) || !data.selectedCaseIds.length || data.selectedCaseIds.length > 200 || data.selectedCaseIds.some((id: unknown) => typeof id !== "string") || new Set(data.selectedCaseIds).size !== data.selectedCaseIds.length) || data.decision === "reject" && data.selectedCaseIds !== undefined && (!Array.isArray(data.selectedCaseIds) || data.selectedCaseIds.length > 0)) {
      fail(res, 400, "审核需要 analysisId、accept/reject、审核说明，以及 accept 时明确选择的用例 ID。"); return;
    }
    const reviews = project.impactAnalyses ?? [];
    const index = reviews.findIndex(item => item.id === data.analysisId);
    if (index < 0) { fail(res, 404, "变更影响分析记录不存在。"); return; }
    const review = reviews[index]!;
    if (review.status !== "pending") { fail(res, 409, "该影响建议已审核；如需修改选择，请重新分析后创建一条新记录。"); return; }
    if (review.caseVersion !== getDocumentCaseVersion(project)) { fail(res, 409, "分析后测试用例已发生变化；请重新分析，避免审核过期的影响建议。"); return; }
    const selectedCaseIds: string[] = data.decision === "accept" ? data.selectedCaseIds : [];
    const known = new Set(project.cases.map(item => item.id));
    const unknown = selectedCaseIds.filter(id => !known.has(id));
    if (unknown.length) { fail(res, 422, `审核范围包含不存在的用例：${unknown.join(", ")}`); return; }
    const updatedReview = { ...review, status: data.decision === "accept" ? "accepted" as const : "rejected" as const, selectedCaseIds, ...(typeof data.notes === "string" && data.notes.trim() ? { reviewNotes: data.notes.trim() } : {}), reviewedAt: new Date().toISOString() };
    project.impactAnalyses = reviews.map((item, itemIndex) => itemIndex === index ? updatedReview : item);
    project.updatedAt = new Date().toISOString();
    await saveDocumentProject(project);
    json(res, 200, { project, analysis: updatedReview }); return;
  }
  const documentSiteVersions = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/site-versions$/);
  if (req.method === "POST" && documentSiteVersions) {
    const projectId = decodeURIComponent(documentSiteVersions[1]!);
    const project = await getDocumentProject(projectId);
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["label", "environment", "targetUrl", "changeNotes"].includes(key)) || typeof data.label !== "string" || !data.label.trim() || data.label.length > 80 || typeof data.environment !== "string" || !data.environment.trim() || data.environment.length > 80 || typeof data.targetUrl !== "string" || typeof data.changeNotes !== "string" || data.changeNotes.length > 2000) {
      fail(res, 400, "网站版本需要不超过 80 字的版本标识和环境名、有效网址，以及不超过 2000 字的迭代说明。"); return;
    }
    const targetUrl = validateDocumentTarget(data.targetUrl);
    const versions = project.siteVersions ?? [];
    if (versions.length >= 200) { fail(res, 422, "单个测试项目最多保留 200 个网站版本记录。"); return; }
    if (versions.some(item => item.label.trim() === data.label.trim() && item.environment.trim() === data.environment.trim())) { fail(res, 409, "该环境已登记相同版本标识；版本记录不可覆盖，请使用新的版本标识。"); return; }
    const version: DocumentSiteVersion = { id: randomUUID(), label: data.label.trim(), environment: data.environment.trim(), targetUrl, changeNotes: data.changeNotes.trim(), createdAt: new Date().toISOString() };
    project.siteVersions = [...versions, version];
    project.activeSiteVersionId = version.id;
    project.targetUrl = version.targetUrl;
    project.updatedAt = new Date().toISOString();
    await saveDocumentProject(project);
    json(res, 201, project); return;
  }
  const documentProjectSessionStatus = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-status$/);
  if (req.method === "GET" && documentProjectSessionStatus) {
    const project = await getDocumentProject(decodeURIComponent(documentProjectSessionStatus[1]!));
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    const requestedVersionId = url.searchParams.get("siteVersionId");
    const selectedVersion = requestedVersionId
      ? project.siteVersions?.find(item => item.id === requestedVersionId)
      : project.siteVersions?.find(item => item.id === project.activeSiteVersionId);
    if (requestedVersionId && !selectedVersion) { fail(res, 422, "会话状态检查的网站版本不属于当前项目。"); return; }
    json(res, 200, await getDocumentProjectSessionStatus(project, selectedVersion?.targetUrl ?? project.targetUrl)); return;
  }
  const documentProjectSessionIdentity = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/session-identity$/);
  if (req.method === "POST" && documentProjectSessionIdentity) {
    const project = await getDocumentProject(decodeURIComponent(documentProjectSessionIdentity[1]!));
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => key !== "identityNote") || typeof data.identityNote !== "string" || data.identityNote.length > 160) {
      fail(res, 400, "身份或角色备注只能是 160 字以内的文字；清空内容即可删除备注。"); return;
    }
    const identityNote = data.identityNote.trim();
    if (containsCredentialLikeValue(identityNote)) { fail(res, 422, "身份备注疑似含有密码、令牌或 Cookie；请只填写非敏感的账号角色描述。"); return; }
    project.sessionIdentityNote = identityNote || undefined;
    project.updatedAt = new Date().toISOString();
    await saveDocumentProject(project);
    json(res, 200, project); return;
  }
  const documentProjectRuns = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/runs$/);
  if (req.method === "GET" && documentProjectRuns) {
    const projectId = decodeURIComponent(documentProjectRuns[1]!);
    if (!await getDocumentProject(projectId)) { fail(res, 404, "文档测试项目不存在。"); return; }
    json(res, 200, await listDocumentRuns(projectId)); return;
  }
  const documentStepProbe = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/probe-step$/);
  if (req.method === "POST" && documentStepProbe) {
    const project = await getDocumentProject(decodeURIComponent(documentStepProbe[1]!));
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["caseId", "stepIndex", "siteVersionId"].includes(key)) || typeof data.caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(data.caseId) || !Number.isInteger(data.stepIndex) || data.stepIndex < 0 || data.stepIndex > 99 || data.siteVersionId !== undefined && (typeof data.siteVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.siteVersionId))) {
      fail(res, 400, "试定位需要有效的用例 ID、0–99 的步骤序号和可选网站版本 ID。"); return;
    }
    const selectedVersion = data.siteVersionId ? project.siteVersions?.find(item => item.id === data.siteVersionId) : project.siteVersions?.find(item => item.id === project.activeSiteVersionId);
    if (data.siteVersionId && !selectedVersion) { fail(res, 422, "试定位的网站版本不属于当前项目。"); return; }
    try { json(res, 200, await probeDocumentStep(project, data.caseId, data.stepIndex, selectedVersion?.targetUrl ?? project.targetUrl)); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : "试定位请求无效。"); }
    return;
  }
  const docProject = url.pathname.match(/^\/api\/document-projects\/([^/]+)\/(update|review|run|start|resume|retest|generate-cases|generate-steps|repair-steps|selection|cases\/([^/]+)\/generate-steps)$/);
  if (req.method === "POST" && docProject) {
    const id = decodeURIComponent(docProject[1]!); let action = docProject[2]!; const project = await getDocumentProject(id);
    if (!project) { fail(res, 404, "文档测试项目不存在。"); return; }
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    let parentRunId: string | undefined;
    let retestSelectedCaseIds: string[] | undefined;
    let retestNotes: string | undefined;
    let retestScopeNote: string | undefined;
    let requestedRunMode: DocumentRunMode = "regression";
    let runScopePlan: DocumentRunScopePlan | undefined;
    let requestedCaseIds: string[] | undefined;
    let runSiteVersion: DocumentSiteVersion | undefined;
    let baselineRunId: string | undefined;
    let testDataSetId: string | undefined;
    let parameterValues: Record<string, string> = {};
    let runProject = project;
    if (action === "retest") {
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["parentRunId", "caseIds", "notes", "runMode"].includes(key)) || typeof data.parentRunId !== "string" || !Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) || new Set(data.caseIds).size !== data.caseIds.length || data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 2000) || data.runMode !== undefined && data.runMode !== "regression" && data.runMode !== "compare") {
        fail(res, 400, "重测需要 parentRunId、1–200 个唯一 caseIds、可选 runMode 和不超过 2000 字的说明。"); return;
      }
      const parent = await getDocumentRun(data.parentRunId);
      if (!parent || parent.projectId !== project.id) { fail(res, 404, "父运行不存在或不属于当前项目。"); return; }
      runSiteVersion = parent.siteVersionSnapshot;
      baselineRunId = parent.baselineRunId;
      testDataSetId = parent.testDataSetId;
      parameterValues = parent.parameterValues ?? {};
      if ((project.siteVersions?.length ?? 0) > 0 && !runSiteVersion) { fail(res, 409, "父运行没有网站版本快照；为避免把新版本误当作原基线，不能从该历史运行自动重测。请手动运行并明确选择版本。"); return; }
      requestedRunMode = parent.runMode ?? "compare";
      if (data.runMode !== undefined && data.runMode !== requestedRunMode) { fail(res, 409, "定向重测必须沿用父运行的执行模式；如需切换模式，请启动一轮新运行。"); return; }
      if (parent.materialVersion && parent.materialVersion !== getDocumentMaterialVersion(project)) { fail(res, 409, "项目需求/测试资料版本已变化；为避免在不同测试依据上改写旧结果，不能从该运行创建定向重测。请启动一轮新运行并选择历史基线。"); return; }
      if (!parent.caseVersion || parent.caseVersion !== getDocumentCaseVersion(project)) { fail(res, 409, "项目用例、预期、步骤或执行配置已变化；为避免改写旧基线，不允许从该运行创建定向重测。请重新审核并启动新运行。"); return; }
      if (project.apiContract?.allowMutations === true) { fail(res, 409, "当前项目允许 API 写请求；无法确认重测副作用是否幂等，禁止自动重放。请撤销写授权并重新审核后再选安全用例重测。"); return; }
      const parentScope = new Set(parent.caseScope.selectedCaseIds);
      const currentCaseIds = new Set(project.cases.map(item => item.id));
      const invalid = data.caseIds.filter((caseId: string) => !parentScope.has(caseId) || !currentCaseIds.has(caseId));
      if (invalid.length) { fail(res, 422, `重测用例必须属于父运行的原始选中范围且仍存在：${invalid.join(", ")}`); return; }
      const unsafe = project.cases.filter(item => data.caseIds.includes(item.id) && (item.sideEffectRisk !== "none" || (item.preconditions?.length ?? 0) > 0 && item.preconditionsConfirmed !== true));
      if (unsafe.length) { fail(res, 409, `定向自动重测仅接受已确认前置条件且标记为无副作用的用例；请先核对并审核：${unsafe.map(item => item.id).join(", ")}`); return; }
      const retestIds = [...data.caseIds] as string[];
      const retestTargetIds = parent.scopePlan?.targetCaseIds.filter(caseId => retestIds.includes(caseId)) ?? [];
      const retestImpactIds = parent.scopePlan?.impactCaseIds.filter(caseId => retestIds.includes(caseId)) ?? [];
      const parentScopeKnown = Boolean(parent.scopePlan
        && retestIds.every(caseId => parent.scopePlan!.targetCaseIds.includes(caseId) || parent.scopePlan!.impactCaseIds.includes(caseId)));
      // Keep the exact parent classification for this subset. An impact-only
      // retest is valid: its original direct targets were already run earlier.
      const currentTargetIds = parentScopeKnown ? retestTargetIds : retestIds;
      const currentImpactIds = parentScopeKnown ? retestImpactIds : [];
      const impactReasons = Object.fromEntries(currentImpactIds.flatMap(caseId => {
        const reasons = parent.scopePlan?.impactReasons?.[caseId];
        return reasons?.length ? [[caseId, reasons]] : [];
      }));
      runScopePlan = {
        mode: currentImpactIds.length ? "impact" : currentTargetIds.length === 1 ? "single" : "custom",
        targetCaseIds: currentTargetIds,
        impactCaseIds: currentImpactIds,
        ...(Object.keys(impactReasons).length ? { impactReasons } : {}),
      };
      const parentImpactSummary = retestImpactIds.slice(0, 5).map(caseId => {
        const title = parent.caseTitles?.[caseId] ?? caseId;
        const reasons = parent.scopePlan?.impactReasons?.[caseId];
        return `${title}（${caseId}）${reasons?.length ? `：${reasons.slice(0, 3).join("；")}` : ""}`;
      }).join("；");
      const parentImpactMissingReasonCount = retestImpactIds.filter(caseId => !parent.scopePlan?.impactReasons?.[caseId]?.length).length;
      const parentScopeNote = parentScopeKnown
        ? `父运行 ${parent.id} 的本次重测来源：原直接目标 ${retestTargetIds.length} 条，原关联影响 ${retestImpactIds.length} 条${parentImpactSummary ? `；原关联影响依据：${parentImpactSummary}` : ""}${retestImpactIds.length > 5 ? `；另有 ${retestImpactIds.length - 5} 条关联影响用例` : ""}${parentImpactMissingReasonCount ? `；${parentImpactMissingReasonCount} 条关联影响用例的历史依据未留存，本次保留原分类并标明依据缺失` : ""}。`
        : `父运行 ${parent.id} 未记录可核对的直接目标/关联影响分类；本次按定向重测目标留档。`;
      parentRunId = data.parentRunId;
      retestSelectedCaseIds = [...data.caseIds];
      requestedCaseIds = [...data.caseIds];
      retestNotes = (typeof data.notes === "string" ? data.notes.trim() : "定向重测父运行失败或未验证用例。").slice(0, 2000);
      retestScopeNote = parentScopeNote.slice(0, 1000);
      action = "start";
    }
    if ((action === "start" || action === "run") && !requestedCaseIds) {
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["runMode", "selectedCaseIds", "siteVersionId", "baselineRunId", "testDataSetId", "parameterValues", "scopePlan"].includes(key)) || data.runMode !== undefined && data.runMode !== "regression" && data.runMode !== "compare" || data.siteVersionId !== undefined && (typeof data.siteVersionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.siteVersionId)) || data.baselineRunId !== undefined && (typeof data.baselineRunId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(data.baselineRunId)) || data.testDataSetId !== undefined && (typeof data.testDataSetId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.testDataSetId)) || data.parameterValues !== undefined && (!data.parameterValues || typeof data.parameterValues !== "object" || Array.isArray(data.parameterValues) || Object.keys(data.parameterValues).length > 100 || Object.entries(data.parameterValues).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u.test(key) || typeof value !== "string" || value.length > 500)) || !Array.isArray(data.selectedCaseIds) || data.selectedCaseIds.length < 1 || data.selectedCaseIds.length > 200 || data.selectedCaseIds.some((caseId: unknown) => typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) || new Set(data.selectedCaseIds).size !== data.selectedCaseIds.length) {
        fail(res, 400, "运行需要显式提供 runMode、1–200 个唯一 selectedCaseIds，以及可选网站版本、历史基线、测试数据组和参数值；不会退回项目全量用例。"); return;
      }
      requestedRunMode = data.runMode ?? "regression";
      requestedCaseIds = [...data.selectedCaseIds];
      try { runScopePlan = validateDocumentRunScopePlan(data.scopePlan, requestedCaseIds); }
      catch (error) { fail(res, 400, error instanceof Error ? error.message : "本轮测试范围说明无效。"); return; }
      if (runScopePlan?.impactCaseIds.length) {
        const missingReasons = runScopePlan.impactCaseIds.filter(caseId => !runScopePlan!.impactReasons?.[caseId]?.length);
        if (missingReasons.length) {
          fail(res, 400, `每条关联影响用例都要有可追溯依据后才能启动：${missingReasons.join(", ")}。请重新分析或逐条确认关联关系。`);
          return;
        }
      }
      baselineRunId = data.baselineRunId;
      testDataSetId = data.testDataSetId;
      parameterValues = data.parameterValues ?? {};
    }
    if (action === "start" || action === "run") {
      if (baselineRunId) {
        const baseline = await getDocumentRun(baselineRunId);
        if (!baseline || baseline.projectId !== project.id || !isDocumentBaselineEligible(baseline)) { fail(res, 422, "历史基线必须属于当前项目，并且是已完成、范围明确且所选用例均有确定结果的运行。"); return; }
      }
      const allowedIds = new Set(project.cases.filter(item => item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled" && item.selectedForRegression !== false).map(item => item.id));
      const invalidIds = requestedCaseIds!.filter(caseId => !allowedIds.has(caseId));
      testDataSetId = data.testDataSetId ?? testDataSetId;
      try { parameterValues = resolveDocumentRunParameters(project, requestedCaseIds!, testDataSetId, retestSelectedCaseIds ? parameterValues : data.parameterValues ?? {}); }
      catch (error) { fail(res, 422, error instanceof Error ? error.message : "本轮测试参数无效。"); return; }
      if (invalidIds.length) { fail(res, 422, `本轮用例必须属于当前项目、处于可运行状态且已纳入回归选择；请先启用被取消选择的用例：${invalidIds.join(", ")}`); return; }
      if (project.siteVersions?.length) {
        const versionId = runSiteVersion?.id ?? data.siteVersionId ?? project.activeSiteVersionId;
        runSiteVersion ??= project.siteVersions.find(item => item.id === versionId);
        if (!runSiteVersion || !project.siteVersions.some(item => item.id === runSiteVersion!.id)) { fail(res, 422, "本轮必须选择一个属于当前项目的网站版本。"); return; }
      } else if (data.siteVersionId !== undefined) { fail(res, 422, "该项目尚未登记网站版本；先登记版本后再用版本 ID 运行。"); return; }
      runProject = runSiteVersion ? { ...project, targetUrl: runSiteVersion.targetUrl } : project;
    }
    if (action.startsWith("cases/")) {
      if (!modelConfiguration().modelAvailable) { fail(res, 409, "AI 步骤草稿需要先配置 TESTPILOT_API_KEY 或 OPENAI_API_KEY。现有手动编辑和审核流程仍可使用。"); return; }
      const caseId = decodeURIComponent(docProject[3]!);
      const caseIndex = project.cases.findIndex(item => item.id === caseId);
      if (caseIndex < 0) { fail(res, 404, "目标文档用例不存在。"); return; }
      const item = project.cases[caseIndex]!;
      try {
        const pageEvidence = await collectDocumentPageEvidence(project);
        let steps: Awaited<ReturnType<typeof generateDocumentCaseSteps>>;
        const authoringItem = { ...item, caseGenerationActions: item.caseGenerationTrace?.actions ?? [] };
        try { steps = await generateDocumentCaseSteps(project.targetUrl, authoringItem, pageEvidence); }
        catch (error) {
          steps = draftEvidenceBoundUiCheck(item, pageEvidence) ?? [];
          if (!steps.length) throw new Error(`AI 没有生成可执行步骤；${error instanceof Error ? error.message : String(error)}`);
        }
        if (!steps.length || !steps.some(step => ["assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertDisabled", "assertFieldInvalid", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) {
          throw new Error("没有生成可执行的验收断言；保留原用例并补充页面证据、具体测试数据或可观察的通过条件后重试。空草稿不会保存为已生成步骤。");
        }
        // Validate once more at the API boundary, then update only steps so document provenance and IDs stay intact.
        const validated = validateCases([{ ...item, steps }])[0]!;
        project.cases[caseIndex] = { ...item, steps: validated.steps };
        project.reviewStatus = "draft"; project.reviewNotes = ""; project.updatedAt = new Date().toISOString();
        await saveDocumentProject(project); json(res, 200, { project, steps: validated.steps });
      } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (action === "generate-steps") {
      if (!modelConfiguration().modelAvailable) { fail(res, 409, "AI 步骤草稿需要先配置兼容模型 API。现有手动编辑流程仍可使用。"); return; }
      if (!Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || caseId.length > 80)) { fail(res, 400, "批量生成需要提供 1–200 个 caseIds。"); return; }
      const caseIds = [...new Set<string>(data.caseIds)];
      if (caseIds.some(caseId => !project.cases.some(item => item.id === caseId))) { fail(res, 404, "待生成列表中存在不属于该项目的用例 ID。"); return; }
      const before = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
      const stepResult = await generateMissingBrowserSteps(project, new Set(caseIds));
      const generated = project.cases.filter(item => caseIds.includes(item.id) && JSON.stringify(item.steps ?? []) !== before.get(item.id) && item.steps?.length > 0 && !hasOnlyGenericShellAssertions(item)).map(item => item.id);
      project.stepAuthoring = { generatedAt: new Date().toISOString(), results: stepResult.caseResults };
      if (project.confirmationRequired !== true && !requiresManualApiContractReview(project) && hasAutoRunnableSelectedCase(project.cases)) {
        project.reviewStatus = "approved";
        project.reviewNotes = "用户选择自动运行：新增只读步骤已通过服务端安全门； coverage gap 和缺少夹具的完整验收仍保留为未解决。";
      } else {
        project.reviewStatus = "draft";
        project.reviewNotes = "";
      }
      project.updatedAt = new Date().toISOString();
      await saveDocumentProject(project);
      const outcomes = stepResult.caseResults.map(result => ({ ...result, status: generated.includes(result.caseId) ? result.status : "blocked" as const }));
      const blockedCaseIds = outcomes.filter(result => result.status === "blocked").map(result => result.caseId);
      const blockedReasons = outcomes.filter(result => result.status === "blocked").map(result => ({ caseId: result.caseId, reason: result.detail }));
      json(res, 200, { projectId: project.id, requested: caseIds.length, generatedCaseIds: generated, blockedCaseIds, blockedReasons, caseResults: outcomes, warning: stepResult.warning ?? "" });
      return;
    }
    if (action === "repair-steps") {
      if (!modelConfiguration().modelAvailable) { fail(res, 409, "Agent 修订需要先配置兼容模型 API。现有手动编辑流程仍可使用。"); return; }
      if (!Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 50 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || caseId.length > 80)) { fail(res, 400, "复查需要提供 1–50 个阻塞用例 ID。"); return; }
      const caseIds = [...new Set<string>(data.caseIds)];
      if (caseIds.some(caseId => !project.cases.some(item => item.id === caseId))) { fail(res, 404, "复查列表中存在不属于该项目的用例 ID。"); return; }
      const previousResults = project.stepAuthoring?.results ?? [];
      const blockedResults = previousResults.filter(result => caseIds.includes(result.caseId) && result.status === "blocked");
      if (!blockedResults.length || blockedResults.length !== caseIds.length) { fail(res, 422, "只能复查当前步骤记录中状态为“阻塞”的用例；请先重新生成步骤或刷新页面。"); return; }
      const before = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
      const feedbackByCase = new Map(blockedResults.map(result => [result.caseId, result.detail]));
      const stepResult = await generateMissingBrowserSteps(project, new Set(caseIds), undefined, { repairRejectedDrafts: true, feedbackByCase });
      const repairedCaseIds = project.cases.filter(item => caseIds.includes(item.id) && JSON.stringify(item.steps ?? []) !== before.get(item.id) && item.steps?.length > 0 && !hasOnlyGenericShellAssertions(item)).map(item => item.id);
      const attemptedCaseIds = new Set(stepResult.attemptedCaseIds ?? []);
      const outcomes = stepResult.caseResults.map(result => repairedCaseIds.includes(result.caseId)
        ? { ...result, detail: `${result.detail} Agent 已根据阻塞反馈修订；这是未审核草稿，尚未运行。` }
        : {
          ...result,
          status: "blocked" as const,
          stepCount: project.cases.find(item => item.id === result.caseId)?.steps.length ?? 0,
          detail: attemptedCaseIds.has(result.caseId)
            ? `Agent 已收到阻塞原因并尝试修订，但没有产出通过校验的新步骤；保留原阻塞原因：${feedbackByCase.get(result.caseId) ?? result.detail}`
            : `该用例因验收预期或证据门禁未交给 Agent；保留原阻塞原因：${feedbackByCase.get(result.caseId) ?? result.detail}`,
        });
      project.cases = project.cases.map(item => repairedCaseIds.includes(item.id) ? { ...item, lifecycleStatus: "draft", selectedForRegression: false } : item);
      project.stepAuthoring = {
        generatedAt: new Date().toISOString(),
        results: [...previousResults.filter(result => !caseIds.includes(result.caseId)), ...outcomes],
      };
      const blocked = outcomes.filter(result => result.status === "blocked");
      project.generationWarning = blocked.length ? `${blocked.length}/${caseIds.length} 条用例仍阻塞：${blocked.map(result => `${result.caseId}：${result.detail}`).join("；")}` : "";
      project.reviewStatus = "draft";
      project.reviewNotes = "Agent 已按阻塞诊断修订步骤；修订仍是未审核草稿，需人工确认后才能运行。";
      project.updatedAt = new Date().toISOString();
      await saveDocumentProject(project);
      json(res, 200, {
        project,
        requested: caseIds.length,
        attemptedCaseIds: [...attemptedCaseIds],
        repairedCaseIds,
        blockedCaseIds: blocked.map(result => result.caseId),
        caseResults: outcomes,
        warning: project.generationWarning,
        regressionStarted: false,
      });
      return;
    }
    if (action === "selection") {
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["caseIds", "selected"].includes(key)) || !Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some((caseId: unknown) => typeof caseId !== "string" || !caseId.length || caseId.length > 80) || typeof data.selected !== "boolean") { fail(res, 400, "case selection requires 1–200 caseIds and a boolean selected value"); return; }
      const caseIds = [...new Set<string>(data.caseIds)];
      const knownIds = new Set(project.cases.map(item => item.id));
      const unknownIds = caseIds.filter(caseId => !knownIds.has(caseId));
      if (unknownIds.length) { fail(res, 404, `以下用例不属于该项目：${unknownIds.join(", ")}`); return; }
      const unavailableIds = data.selected ? caseIds.filter(caseId => project.cases.some(item => item.id === caseId && (item.lifecycleStatus === "draft" || item.lifecycleStatus === "disabled"))) : [];
      if (unavailableIds.length) { fail(res, 422, `草稿或停用用例不能加入回归范围：${unavailableIds.join(", ")}。请先将完整用例标记为可运行。`); return; }
      const requestedIds = new Set(caseIds);
      const changed = project.cases.some(item => requestedIds.has(item.id) && (item.selectedForRegression !== false) !== data.selected);
      if (!changed) { json(res, 200, { project, selectedCaseIds: project.cases.filter(item => item.selectedForRegression !== false).map(item => item.id), excludedCaseIds: project.cases.filter(item => item.selectedForRegression === false).map(item => item.id), changed: false }); return; }
      project.cases = project.cases.map(item => caseIds.includes(item.id) ? { ...item, selectedForRegression: data.selected } : item);
      const selectedCaseIds = project.cases.filter(item => item.selectedForRegression !== false).map(item => item.id);
      if (!selectedCaseIds.length) { fail(res, 422, "至少保留一条选中用例。"); return; }
      if (project.confirmationRequired !== true && !requiresManualApiContractReview(project) && hasAutoRunnableSelectedCase(project.cases)) {
        project.reviewStatus = "approved";
        project.reviewNotes = "用户选择自动运行：仅已就绪的只读用例通过服务端安全门后自动执行；缺步骤、预期不足、风险未定或依赖缺失的用例保留为阻塞。";
      } else {
        project.reviewStatus = "draft";
        project.reviewNotes = "";
      }
      project.updatedAt = new Date().toISOString();
      await saveDocumentProject(project);
      json(res, 200, { project, selectedCaseIds, excludedCaseIds: project.cases.filter(item => item.selectedForRegression === false).map(item => item.id), changed: true });
      return;
    }
    if (action === "generate-cases") {
      if (!modelConfiguration().modelAvailable) { fail(res, 409, "AI 候选用例生成需要先配置模型 API Key。现有手工维护流程仍可使用。"); return; }
      try {
        const existingCases = project.caseMode === "both" ? project.cases : [];
        const generated = validateCases(await generateDocumentBrowserCases(project.sourceText, project.researchExamples ?? [])).map(item => ({ ...item, caseOrigin: "ai-generated" as const, lifecycleStatus: "draft" as const, selectedForRegression: false }));
        project.cases = validateCasesPreservingGenerationTrace(project.caseMode === "both" ? mergeBrowserCases(existingCases, generated) : generated, existingCases);
        const stepResult = await generateMissingBrowserSteps(project);
        project.stepAuthoring = { generatedAt: new Date().toISOString(), results: stepResult.caseResults };
        if (stepResult.warning) project.generationWarning = stepResult.warning;
        else delete project.generationWarning;
        if (project.confirmationRequired !== true && !requiresManualApiContractReview(project) && hasAutoRunnableSelectedCase(project.cases)) {
          project.reviewStatus = "approved";
          project.reviewNotes = "用户选择自动运行：已就绪的只读用例通过服务端安全 DSL 校验后自动执行；缺步骤、风险未定或依赖缺失的用例会逐条标为阻塞并说明补齐项。";
        } else {
          project.reviewStatus = "draft";
        }
        if (project.reviewStatus !== "approved") project.reviewNotes = ""; project.updatedAt = new Date().toISOString();
        await saveDocumentProject(project); json(res, 200, project);
      } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (action === "update") {
      try {
        if (data.targetUrl !== undefined) {
          const updatedTargetUrl = validateDocumentTarget(data.targetUrl);
          if ((project.siteVersions?.length ?? 0) > 0 && updatedTargetUrl !== project.targetUrl) throw new Error("该项目已启用网站版本记录；请登记一个新版本来变更网址，不能直接改写项目目标网址。");
          project.targetUrl = updatedTargetUrl;
          delete project.stepAuthoring;
        }
        if (data.cases !== undefined) { project.cases = validateCasesPreservingGenerationTrace(data.cases, project.cases); delete project.stepAuthoring; }
        if (data.testDataSets !== undefined) {
          if (!Array.isArray(data.testDataSets) || data.testDataSets.length > 50) throw new Error("测试数据组必须是最多 50 组的数组。");
          const previous = new Map((project.testDataSets ?? []).map(item => [item.id, item]));
          const ids = new Set<string>();
          const names = new Set<string>();
          const now = new Date().toISOString();
          project.testDataSets = data.testDataSets.map((item: any, index: number): DocumentTestDataSet => {
            if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["id", "name", "values", "createdAt", "updatedAt"].includes(key)) || typeof item.id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 80 || !item.values || typeof item.values !== "object" || Array.isArray(item.values) || Object.keys(item.values).length > 100) throw new Error("第 " + (index + 1) + " 组测试数据无效。");
            if (ids.has(item.id) || names.has(item.name.trim().toLocaleLowerCase())) throw new Error("测试数据组 ID 和名称必须唯一。");
            ids.add(item.id); names.add(item.name.trim().toLocaleLowerCase());
            const values: Record<string, string> = {};
            for (const [key, value] of Object.entries(item.values)) {
              if (!/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u.test(key) || /(?:pass(?:word|code)?|pwd|token|secret|cookie|auth|credential|api.?key)/iu.test(key) || typeof value !== "string" || value.length > 500) throw new Error("第 " + (index + 1) + " 组测试数据包含无效或敏感参数「" + key + "」；不要保存密码、令牌或认证信息。");
              if (containsCredentialLikeValue(value)) throw new Error("第 " + (index + 1) + " 组测试数据中的「" + key + "」疑似含有令牌、Cookie 或认证凭据；请改用合成测试数据。");
              values[key] = value;
            }
            const saved = previous.get(item.id);
            return { id: item.id, name: item.name.trim(), values, createdAt: saved?.createdAt ?? now, updatedAt: now };
          });
        }
        if (data.apiContract !== undefined) {
          const config = data.apiContract;
          if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("apiContract 必须是对象。");
          if (config.suiteId !== undefined && (typeof config.suiteId !== "string" || !/^[0-9a-f-]{36}$/i.test(config.suiteId))) throw new Error("apiContract.suiteId 必须是有效的候选 UUID。");
          if (["allowNetwork", "allowMutations", "allowConcurrency"].some(key => config[key] !== undefined && typeof config[key] !== "boolean")) throw new Error("API 网络、写请求和并发授权必须分别使用布尔值。");
          if (config.mappings !== undefined && (!Array.isArray(config.mappings) || config.mappings.some((entry: any) => !entry || typeof entry.documentCaseId !== "string" || !Array.isArray(entry.apiCaseIds) || entry.apiCaseIds.some((id: unknown) => typeof id !== "string")))) throw new Error("apiContract.mappings 必须包含 documentCaseId 和 apiCaseIds 字符串数组。");
          project.apiContract = { ...(config.suiteId ? { suiteId: config.suiteId } : {}), allowNetwork: config.allowNetwork === true, allowMutations: config.allowMutations === true, allowConcurrency: config.allowConcurrency === true, mappings: config.mappings ?? [] };
        }
        if (project.confirmationRequired !== true && !requiresManualApiContractReview(project) && hasAutoRunnableSelectedCase(project.cases)) {
          project.reviewStatus = "approved";
          project.reviewNotes = "用户选择自动运行：仅已就绪的只读用例通过服务端安全门后自动执行；缺步骤、预期不足、风险未定或依赖缺失的用例保留为阻塞。";
        } else {
          project.reviewStatus = "draft";
          project.reviewNotes = "";
        }
        project.updatedAt = new Date().toISOString();
        await saveDocumentProject(project); json(res, 200, project);
      } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (action === "review") {
      if (data?.decision !== "approve" || typeof data.notes !== "string" || data.notes.length > 2000) { fail(res, 400, "审核需确认 decision=approve，并提供不超过 2000 字的备注。"); return; }
      try { project.cases = validateCasesPreservingGenerationTrace(project.cases, project.cases); project.reviewStatus = "approved"; project.reviewNotes = data.notes.trim(); project.updatedAt = new Date().toISOString(); await saveDocumentProject(project); const workflow = await ensureProjectWorkflow(project); await completeProjectApprovalGate(workflow.workflowId, project, project.reviewNotes || "User approved the reviewed test cases."); json(res, 200, project); }
      catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (action === "run" || action === "start") {
      const repairedCaseIds = requestedRunMode === "compare" ? project.cases.filter(item => requestedCaseIds!.includes(item.id) && addNoApiNetworkAssertion(item)).map(item => item.id) : [];
      if (repairedCaseIds.length) {
        project.updatedAt = new Date().toISOString();
        if (project.confirmationRequired === true) {
          project.reviewStatus = "draft"; project.reviewNotes = "";
          await saveDocumentProject(project);
          json(res, 409, { error: "已为选中用例自动补上 fetch/XHR 断言。请复核新增步骤和 coverage gap 后再运行。", repairedCaseIds, project });
          return;
        }
        // In reduced-confirmation mode this is a deterministic assertion-only
        // repair: it adds no user action and retains the reviewed read-only plan.
        if (project.reviewStatus === "approved") project.reviewNotes = `${project.reviewNotes ?? "自动审核"}；已自动补上 no-API 用例的 fetch/XHR 断言，完整覆盖边界仍保留。`.slice(0, 2000);
        await saveDocumentProject(project);
      }
    }
    if (project.reviewStatus !== "approved") { fail(res, 409, "请先编辑并人工审核通过用例，再启动执行。"); return; }
    const resumeRunId = action === "resume" ? data?.runId : undefined;
    let recoveryWorkflowId: string | undefined;
    let resumeSelectedCaseIds: string[] | undefined;
    if (action === "resume") {
      if (typeof resumeRunId !== "string" || !resumeRunId || resumeRunId.length > 80) { fail(res, 400, "恢复运行需要提供有效的 runId。"); return; }
      const recovery = await getDocumentRunRecovery(project);
      if (!recovery || recovery.runId !== resumeRunId || !recovery.canResume) { fail(res, 409, recovery?.reason ?? "找不到可恢复的中断运行；请启动一轮新测试。"); return; }
      runSiteVersion = recovery.siteVersionSnapshot;
      runProject = runSiteVersion ? { ...project, targetUrl: runSiteVersion.targetUrl } : project;
      recoveryWorkflowId = recovery.workflowId;
      requestedRunMode = recovery.runMode ?? "compare";
      resumeSelectedCaseIds = recovery.selectedCaseIds;
      baselineRunId = recovery.baselineRunId;
      testDataSetId = recovery.testDataSetId;
      parameterValues = recovery.parameterValues ?? {};
      parentRunId = recovery.parentRunId ?? parentRunId;
      retestNotes = recovery.retestNotes ?? retestNotes;
      retestScopeNote = recovery.retestScopeNote ?? retestScopeNote;
    }
    try {
      const workflow = recoveryWorkflowId ? await getDocumentWorkflow(recoveryWorkflowId) : await ensureProjectWorkflow(project, parentRunId);
      if (!workflow) throw new Error(`当前运行关联的 workflow ${recoveryWorkflowId ?? "unknown"} 无法读取。`);
      if (resumeRunId) await linkDocumentWorkflowRun(workflow.workflowId, { runId: resumeRunId, ...(parentRunId ? { parentRunId } : {}) });
      let activeWorkflowStage: { stageId: DocumentWorkflowStageId; attempt: number } | undefined;
      const executionRunId = resumeRunId ?? randomUUID();
      const executionCaseIds = resumeSelectedCaseIds ?? requestedCaseIds;
      if (!executionCaseIds?.length) throw new Error("运行范围缺少已固定的用例 ID；拒绝回退到项目全量选择。");
      const nonRunnableExecutionIds = executionCaseIds.filter(caseId => !project.cases.some(item => item.id === caseId && item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled"));
      if (nonRunnableExecutionIds.length) throw new Error(`本轮范围包含不存在、草稿或已停用用例：${nonRunnableExecutionIds.join(", ")}`);
      // The API validates this fixed scope against persisted selection before
      // reaching the runner; resumes keep the original journaled scope.
      const executionOptions: NonNullable<Parameters<typeof executeDocumentRun>[1]> = {
        ...(resumeRunId ? { resumeRunId } : {}),
        workflowId: workflow.workflowId,
        ...(resumeRunId ? {} : { runMode: requestedRunMode }),
        ...(!resumeRunId && runScopePlan ? { scopePlan: runScopePlan } : {}),
        ...(runSiteVersion ? { siteVersionSnapshot: runSiteVersion } : {}),
        ...(baselineRunId ? { baselineRunId } : {}),
        ...(testDataSetId ? { testDataSetId } : {}),
        parameterValues,
        selectedCaseIds: executionCaseIds,
        ...(parentRunId && (retestSelectedCaseIds || resumeSelectedCaseIds) ? { parentRunId, ...(retestNotes ? { retestNotes } : {}), ...(retestScopeNote ? { retestScopeNote } : {}) } : {}),
        onStage: async stage => {
          const nextStage: Partial<Record<typeof stage, { stageId: DocumentWorkflowStageId; specialist: DocumentWorkflowSpecialist }>> = {
            deterministic: { stageId: "deterministic-execution", specialist: "deterministic-executor" },
            "computer-use": { stageId: "computer-use-execution", specialist: "computer-use-observer" },
            analysis: { stageId: "analyze-results", specialist: "result-analyst" },
            report: { stageId: "generate-report", specialist: "report-writer" },
            packaging: { stageId: "package-artifacts", specialist: "report-packager" },
          };
          if (stage === "awaiting-login") {
            if (!activeWorkflowStage) {
              const started = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "deterministic-execution", specialist: "deterministic-executor", input: { runId: executionRunId, projectId: project.id, projectDigest: createHash("sha256").update(JSON.stringify({ project: runProject, siteVersionSnapshot: runSiteVersion })).digest("hex"), selectedCaseIds: executionCaseIds, ...(runSiteVersion ? { siteVersionSnapshot: runSiteVersion } : {}), ...(parentRunId ? { parentRunId } : {}), ...(retestNotes ? { retestNotes } : {}), ...(retestScopeNote ? { retestScopeNote } : {}) } });
              activeWorkflowStage = { stageId: started.stage.stageId, attempt: started.stage.attempt };
            }
            if (activeWorkflowStage) {
              const current = await getDocumentWorkflow(workflow.workflowId);
              const persisted = current?.stages.find(item => item.stageId === activeWorkflowStage!.stageId && item.attempt === activeWorkflowStage!.attempt);
              if (persisted?.status === "running") await waitDocumentWorkflowStage(workflow.workflowId, persisted.stageId, persisted.attempt, "浏览器已复用当前登录窗口，等待用户完成登录；登录成功后会从当前用例继续。");
            }
            return;
          }
          if (stage === "starting") {
            if (activeWorkflowStage) {
              const current = await getDocumentWorkflow(workflow.workflowId);
              const persisted = current?.stages.find(item => item.stageId === activeWorkflowStage!.stageId && item.attempt === activeWorkflowStage!.attempt);
              if (persisted?.status === "waiting" && persisted.approval.status !== "pending") await resumeDocumentWorkflowStage(workflow.workflowId, persisted.stageId, persisted.attempt);
            }
            return;
          }
          const targetStage = nextStage[stage];
          if (!targetStage) return;
          if (activeWorkflowStage?.stageId === targetStage.stageId) {
            const current = await getDocumentWorkflow(workflow.workflowId);
            const persisted = current?.stages.find(item => item.stageId === activeWorkflowStage!.stageId && item.attempt === activeWorkflowStage!.attempt);
            if (persisted?.status === "waiting" && persisted.approval.status !== "pending") await resumeDocumentWorkflowStage(workflow.workflowId, persisted.stageId, persisted.attempt);
            return;
          }
          if (activeWorkflowStage) {
            let current = await getDocumentWorkflow(workflow.workflowId);
            let persisted = current?.stages.find(item => item.stageId === activeWorkflowStage!.stageId && item.attempt === activeWorkflowStage!.attempt);
            if (persisted?.status === "waiting" && persisted.approval.status !== "pending") {
              current = await resumeDocumentWorkflowStage(workflow.workflowId, persisted.stageId, persisted.attempt);
              persisted = current.stages.find(item => item.stageId === activeWorkflowStage!.stageId && item.attempt === activeWorkflowStage!.attempt);
            }
            if (persisted?.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, persisted.stageId, persisted.attempt, [`run:${resumeRunId ?? "pending"}:${persisted.stageId}`]);
          }
          if (stage === "analysis" && requestedRunMode === "regression") {
            const workflowState = await getDocumentWorkflow(workflow.workflowId);
            const visualStage = [...(workflowState?.stages ?? [])].reverse().find(item => item.stageId === "computer-use-execution");
            if (!visualStage) {
              const skipped = await startDocumentWorkflowStage(workflow.workflowId, { stageId: "computer-use-execution", specialist: "computer-use-observer", input: { runId: executionRunId, projectId: project.id, runMode: "regression", disposition: "not-applicable", reason: "常规回归模式不运行视觉 Computer Use。" } });
              if (skipped.stage.status === "waiting" && skipped.stage.approval.status === "pending") throw new Error("Workflow computer-use-execution is waiting for approval; approve the human gate before finalizing the regression run.");
              if (skipped.stage.status === "running") await completeDocumentWorkflowStage(workflow.workflowId, skipped.stage.stageId, skipped.stage.attempt, [`run:${executionRunId}:computer-use:not-applicable:regression`]);
            }
          }
          const currentWorkflow = await getDocumentWorkflow(workflow.workflowId);
          const active = [...(currentWorkflow?.stages ?? [])].reverse().find(item => item.stageId === targetStage.stageId && (item.status === "running" || item.status === "waiting"));
          if (active) {
            if (active.status === "waiting" && active.approval.status !== "pending") await resumeDocumentWorkflowStage(workflow.workflowId, active.stageId, active.attempt);
            activeWorkflowStage = { stageId: active.stageId, attempt: active.attempt };
          } else {
            const started = await startDocumentWorkflowStage(workflow.workflowId, { stageId: targetStage.stageId, specialist: targetStage.specialist, input: { runId: executionRunId, projectId: project.id, projectDigest: createHash("sha256").update(JSON.stringify({ project: runProject, siteVersionSnapshot: runSiteVersion })).digest("hex"), selectedCaseIds: executionCaseIds, ...(runSiteVersion ? { siteVersionSnapshot: runSiteVersion } : {}), ...(parentRunId ? { parentRunId } : {}), ...(retestNotes ? { retestNotes } : {}), ...(retestScopeNote ? { retestScopeNote } : {}) } });
            if (started.stage.status === "waiting" && started.stage.approval.status === "pending") throw new Error(`Workflow ${targetStage.stageId} is waiting for approval; approve the human gate before execution.`);
            activeWorkflowStage = { stageId: started.stage.stageId, attempt: started.stage.attempt };
          }
        },
        ...(requestedRunMode === "compare" ? { beforeDeterministic: async page => {
          const before = new Map(runProject.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
          const selectedCaseIds = new Set(executionCaseIds);
          // Run source-grounded repairs first. A failed browser/page evidence
          // read must not suppress safe deterministic drafts already derivable
          // from this case suite.
          const groundedCaseIds = draftGroundedMissingBrowserSteps(runProject, selectedCaseIds);
          let warning = "";
          let caseResults: StepGenerationCaseResult[] = [];
          try {
            const pageEvidence = await collectDocumentPageEvidence(runProject, page);
            const stepResult = await generateMissingBrowserSteps(runProject, selectedCaseIds, pageEvidence);
            warning = stepResult.warning ?? "";
            caseResults = stepResult.caseResults;
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            warning = groundedCaseIds.length
              ? `已从原用例安全补出 ${groundedCaseIds.length} 条只读步骤；其余 AI 草稿因页面证据采集失败未生成：${detail}`
              : detail;
            caseResults = runProject.cases.filter(item => executionCaseIds.includes(item.id) && (!item.steps.length || hasOnlyGenericShellAssertions(item))).map(item => ({ caseId: item.id, status: "blocked" as const, stepCount: 0, detail }));
          }
          const generatedCaseIds = runProject.cases.filter(item => executionCaseIds.includes(item.id) && item.steps.length > 0 && JSON.stringify(item.steps) !== before.get(item.id)).map(item => item.id);
          const knownResultIds = new Set(caseResults.map(result => result.caseId));
          for (const caseId of groundedCaseIds) if (!knownResultIds.has(caseId)) {
            const item = runProject.cases.find(candidate => candidate.id === caseId);
            if (item) caseResults.push({ caseId, status: item.coverageGap?.trim() ? "partial" : "generated", stepCount: item.steps.length, detail: item.coverageGap?.trim() ? `根据同一套件来源生成了只读 UI 子检查；完整用例仍有覆盖缺口：${item.coverageGap}` : "根据同一套件来源生成只读步骤并通过结构校验；尚未执行。" });
          }
          project.stepAuthoring = { generatedAt: new Date().toISOString(), results: caseResults };
          if (warning) project.generationWarning = warning;
          else delete project.generationWarning;
          if (generatedCaseIds.length || warning) {
            if (generatedCaseIds.length) {
            if (project.confirmationRequired === true) {
              project.reviewStatus = "draft";
              project.reviewNotes = "根据当前已认证页面生成了只读步骤草稿；请在对话中审核后再运行这些新步骤。";
            } else {
              project.reviewStatus = "approved";
              project.reviewNotes = "自动模式：新增的只读步骤已通过 DSL 与页面证据校验，随本轮继续执行。";
            }
            }
            project.updatedAt = new Date().toISOString();
            await saveDocumentProject(project);
          }
          return { generatedCaseIds, caseResults, ...(warning ? { warning } : {}), requiresReview: project.confirmationRequired === true };
        } } : {}),
      };
      if (action === "start") {
        const existingRecovery = await getDocumentRunRecovery(project);
        if (existingRecovery?.isRunning) {
          const existingProgress = await getDocumentRunProgress(existingRecovery.runId);
          if (existingProgress) {
            json(res, 202, { runId: existingRecovery.runId, projectId: project.id, status: existingProgress.status, stage: existingProgress.stage, progress: existingProgress.progress, reusedExistingRun: true });
            return;
          }
          fail(res, 409, "该项目已有运行占用浏览器会话；请稍候再检查恢复进度，不要启动重复运行。");
          return;
        }
        const runId = executionRunId;
        await linkDocumentWorkflowRun(workflow.workflowId, { runId, ...(parentRunId ? { parentRunId } : {}) });
        let settled = false;
        let startupError: unknown;
        const execution = executeDocumentRun(runProject, { ...executionOptions, runId });
        void execution.then(async run => {
          if (run.overall === "cancelled") {
            await cancelDocumentWorkflow(workflow.workflowId, "文档测试运行由用户手动停止。");
            return;
          }
          if (activeWorkflowStage) await completeDocumentWorkflowStage(workflow.workflowId, activeWorkflowStage.stageId, activeWorkflowStage.attempt, [`run:${runId}:${activeWorkflowStage.stageId}`]);
          await completeDocumentWorkflow(workflow.workflowId);
        }).catch(async error => {
          if (activeWorkflowStage) await failDocumentWorkflowStage(workflow.workflowId, activeWorkflowStage.stageId, activeWorkflowStage.attempt, { message: error instanceof Error ? error.message : String(error), code: "execution-failed" }).catch(() => undefined);
        });
        void execution.then(() => { settled = true; }, error => { startupError = error; settled = true; });
        // Wait only for the execution journal to exist. Long browser/model runs remain
        // in the background and are observed through GET /api/document-runs/:id/progress.
        for (let attempt = 0; attempt < 150; attempt++) {
          const progress = await getDocumentRunProgress(runId);
          if (progress) { json(res, 202, { runId, projectId: project.id, status: progress.status, stage: progress.stage, progress: progress.progress }); return; }
          if (settled) { fail(res, 409, startupError instanceof Error ? startupError.message : "测试运行未能初始化。"); return; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        fail(res, 503, `测试运行已提交，但启动状态日志暂不可读（runId=${runId}）；请使用项目恢复状态检查，勿重复提交。`);
        return;
      }
      await linkDocumentWorkflowRun(workflow.workflowId, { runId: executionRunId, ...(parentRunId ? { parentRunId } : {}) });
      const run = await executeDocumentRun(runProject, { ...executionOptions, runId: executionRunId });
      if (run.overall === "cancelled") {
        await cancelDocumentWorkflow(workflow.workflowId, "文档测试运行由用户手动停止。");
        json(res, 200, run); return;
      }
      if (activeWorkflowStage) await completeDocumentWorkflowStage(workflow.workflowId, activeWorkflowStage.stageId, activeWorkflowStage.attempt, [`run:${run.id}:${activeWorkflowStage.stageId}`]);
      await completeDocumentWorkflow(workflow.workflowId);
      json(res, 201, run);
    }
    catch (error) { fail(res, 500, error instanceof Error ? error.message : String(error)); }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/runs") { json(res, 200, [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))); return; }
  if (req.method === "GET" && url.pathname === "/api/project-profiles") { json(res, 200, registeredProfiles); return; }
  if (req.method === "GET" && url.pathname === "/api/project-runs") { json(res, 200, [...projectRuns.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))); return; }
  if (req.method === "GET" && url.pathname === "/api/project-scripts") { json(res, 200, [...projectScripts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(projectScriptView)); return; }
  if (req.method === "POST" && url.pathname === "/api/project-scripts/ai-candidates") {
    let data: any; try { data = await documentBody(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !["profileId", "requirement", "fileName", "bytesBase64"].includes(key)) || typeof data.profileId !== "string" || typeof data.requirement !== "string" || (data.requirement.trim().length < 8 && typeof data.bytesBase64 !== "string") || data.requirement.length > 2000 || (data.fileName !== undefined && typeof data.fileName !== "string") || (data.bytesBase64 !== undefined && (typeof data.bytesBase64 !== "string" || data.bytesBase64.length > 13_000_000))) { fail(res, 400, "need a registered profile, a requirement (up to 2000 characters), and an optional supported document up to 9 MB"); return; }
    if (!registeredProfiles.some((profile) => profile.id === data.profileId)) { fail(res, 404, "project profile is not registered"); return; }
    if (!modelConfiguration().modelAvailable) { fail(res, 409, "AI authoring requires a configured model provider"); return; }
    if ([...projectScripts.values()].some((item) => item.profileId === data.profileId && item.status === "candidate")) { fail(res, 409, "review the existing candidate before authoring another"); return; }
    try {
      let requirement = data.requirement.trim();
      if (typeof data.bytesBase64 === "string") {
        if (typeof data.fileName !== "string") { fail(res, 400, "fileName is required with document bytes"); return; }
        const bytes = Buffer.from(data.bytesBase64, "base64");
        if (!bytes.length || bytes.length > 9 * 1024 * 1024) { fail(res, 400, "document must be non-empty and no larger than 9 MB"); return; }
        const document = await extractDocument(data.fileName, bytes);
        requirement = `${requirement}\n\n需求资料摘录：\n${document.text.slice(0, Math.max(0, 12_000 - requirement.length))}`;
        if (requirement.length < 8) requirement = `请根据以下需求资料为项目整理关键测试场景：\n${document.text.slice(0, 12_000)}`;
      }
      const generated = await generateGrammarPlaywrightCandidate(requirement);
      json(res, 201, await createProjectScriptCandidate(data.profileId, { requirement, ...generated }));
    } catch (error) { fail(res, 422, error instanceof Error ? error.message : String(error)); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/project-scripts/candidates") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || typeof data.profileId !== "string") { fail(res, 400, "body must contain only a registered profileId"); return; }
    if (!registeredProfiles.some((profile) => profile.id === data.profileId)) { fail(res, 404, "project profile is not registered"); return; }
    try { json(res, 201, await createProjectScriptCandidate(data.profileId)); }
    catch (error) { fail(res, 409, error instanceof Error ? error.message : String(error)); }
    return;
  }
  const scriptReview = url.pathname.match(/^\/api\/project-scripts\/([^/]+)\/review$/);
  if (req.method === "POST" && scriptReview) {
    const id = decodeURIComponent(scriptReview[1]!); const script = projectScripts.get(id);
    if (!script) { fail(res, 404, "script candidate not found"); return; }
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !["decision", "notes"].includes(key)) || !["approve", "reject"].includes(data.decision) || (data.notes !== undefined && typeof data.notes !== "string") || (data.notes?.length ?? 0) > 2000) { fail(res, 400, "review requires decision approve/reject and optional notes (up to 2000 characters)"); return; }
    if (script.status !== "candidate") { fail(res, 409, "only a candidate version can be reviewed"); return; }
    script.status = data.decision === "approve" ? "approved" : "rejected";
    script.reviewDecision = data.decision;
    script.reviewedAt = new Date().toISOString();
    script.reviewerNotes = (data.notes ?? "").trim();
    await persistProjectScripts(); json(res, 200, projectScriptView(script)); return;
  }
  const scriptRun = url.pathname.match(/^\/api\/project-scripts\/([^/]+)\/run$/);
  if (req.method === "POST" && scriptRun) {
    const script = projectScripts.get(decodeURIComponent(scriptRun[1]!));
    if (!script) { fail(res, 404, "approved script not found"); return; }
    if (script.status !== "approved") { fail(res, 409, "only an approved script version can run"); return; }
    if (activeRunId) { fail(res, 409, "another test run is already active"); return; }
    try { json(res, 202, await launchProjectProfile(script.profileId, script)); }
    catch (error) { fail(res, 500, error instanceof Error ? error.message : String(error)); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/project-runs") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 1 || typeof data.profileId !== "string") { fail(res, 400, "body must contain only a registered profileId"); return; }
    if (!registeredProfiles.some((profile) => profile.id === data.profileId)) { fail(res, 404, "project profile is not registered"); return; }
    if (activeRunId) { fail(res, 409, "another test run is already active"); return; }
    try { json(res, 202, await launchProjectProfile(data.profileId)); }
    catch (error) { fail(res, 500, error instanceof Error ? error.message : String(error)); }
    return;
  }
  const projectCancel = url.pathname.match(/^\/api\/project-runs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && projectCancel) {
    const run = projectRuns.get(decodeURIComponent(projectCancel[1]!)); if (!run) { fail(res, 404, "project run not found"); return; }
    if (["queued", "running"].includes(run.status)) {
      run.summary = "已请求取消运行，正在清理临时副本。";
      projectControllers.get(run.id)?.abort(new Error("cancelled")); await persistProjectRun(run);
    }
    json(res, 200, run); return;
  }
  const projectArtifact = url.pathname.match(/^\/api\/project-runs\/([^/]+)\/artifacts\/(.+)$/);
  if (req.method === "GET" && projectArtifact) {
    const id = decodeURIComponent(projectArtifact[1]!); const run = projectRuns.get(id);
    if (!run) { fail(res, 404, "project run not found"); return; }
    let artifactPath: string; try { artifactPath = decodeURIComponent(projectArtifact[2]!); } catch { fail(res, 400, "invalid artifact path"); return; }
    const normalized = artifactPath.split("\\").join("/");
    if (!run.artifactFiles.includes(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) { fail(res, 404, "artifact not found"); return; }
    const base = path.resolve(PROJECT_RUNS_DIR, id, "target-artifacts"); const file = path.resolve(base, ...normalized.split("/"));
    if (!file.startsWith(`${base}${path.sep}`)) { fail(res, 400, "invalid artifact path"); return; }
    try {
      const info = await stat(file); if (!info.isFile()) { fail(res, 404, "artifact not found"); return; }
      const content = await readFile(file); const ext = path.extname(file).toLowerCase();
      const contentType: Record<string, string> = { ".png": "image/png", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
      res.writeHead(200, { "content-type": contentType[ext] ?? "application/octet-stream", "content-length": content.byteLength, "content-disposition": `inline; filename="${path.basename(file).replace(/[\"\r\n]/g, "_")}"`, "cache-control": "no-store" }); res.end(content);
    } catch { fail(res, 404, "artifact not found"); }
    return;
  }
  const projectReport = url.pathname.match(/^\/api\/project-runs\/([^/]+)\/report$/);
  if (req.method === "GET" && projectReport) {
    const id = decodeURIComponent(projectReport[1]!); if (!projectRuns.has(id)) { fail(res, 404, "project run not found"); return; }
    const format = url.searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "json") { fail(res, 400, "format must be md or json"); return; }
    const recordRunId = projectRuns.get(id)?.recordRunId;
    if (!recordRunId) { fail(res, 409, "normalized report is not ready yet"); return; }
    const file = path.join(PROJECT_RUNS_DIR, id, "normalized", recordRunId, format === "md" ? "report.md" : "run.json");
    try { const data = await readFile(file); res.writeHead(200, { "content-type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8", "content-disposition": `attachment; filename="project-${id}.${format}"` }); res.end(data); }
    catch { fail(res, 409, "normalized report is not ready yet"); }
    return;
  }
  const projectRunMatch = url.pathname.match(/^\/api\/project-runs\/([^/]+)$/);
  if (req.method === "GET" && projectRunMatch) { const run = projectRuns.get(decodeURIComponent(projectRunMatch[1]!)); run ? json(res, 200, run) : fail(res, 404, "project run not found"); return; }
  if (req.method === "GET" && url.pathname === "/api/regressions") { json(res, 200, savedChecks); return; }
  if (req.method === "POST" && url.pathname === "/api/target") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data.fixed !== "boolean") { fail(res, 400, "fixed must be a boolean"); return; }
    if (activeRunId) { fail(res, 409, "target cannot change while a run is active"); return; }
    fixedTarget = data.fixed; json(res, 200, config()); return;
  }
  if (req.method === "POST" && url.pathname === "/api/runs") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!validRequest(data)) { fail(res, 400, "invalid demo request"); return; }
    if (data.mode === "deterministic") data.provider = "offline";
    if (data.provider === "model" && !getModelDetails().available) { fail(res, 409, "model provider is not configured"); return; }
    if (activeRunId) { fail(res, 409, "a demo run is already active"); return; }
    const run = await launch(data);
    json(res, 202, run); return;
  }
  if (req.method === "POST" && url.pathname === "/api/regressions/run") {
    if (!savedChecks.length) { fail(res, 409, "no saved regressions"); return; }
    if (activeRunId) { fail(res, 409, "a demo run is already active"); return; }
    const request: DemoRequest = { mode: "deterministic", provider: "offline", requirements: defaultRequirements, maxActions: Math.min(100, Math.max(savedChecks.length, 10)), target: "sample" };
    const run = await launch(request, savedChecks.map(c => structuredClone(c)));
    json(res, 202, run); return;
  }
  const cancel = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel) {
    const run = runs.get(decodeURIComponent(cancel[1]!)); if (!run) { fail(res, 404, "run not found"); return; }
    if (!["queued", "running"].includes(run.status)) { json(res, 200, run); return; }
    run.status = "cancelled"; run.summary = "运行已取消。"; run.completedAt = new Date().toISOString();
    controllers.get(run.id)?.abort(new Error("cancelled")); await persistRun(run);
    json(res, 200, run); return;
  }
  const report = url.pathname.match(/^\/api\/runs\/([^/]+)\/report$/);
  if (req.method === "GET" && report) {
    const run = runs.get(decodeURIComponent(report[1]!)); if (!run) { fail(res, 404, "run not found"); return; }
    const format = url.searchParams.get("format") ?? "md";
    if (format === "json") { const data = JSON.stringify(run, null, 2); res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${run.id}.json"` }); res.end(data); return; }
    if (format === "md") { const data = md(run); res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${run.id}.md"` }); res.end(data); return; }
    fail(res, 400, "format must be json or md"); return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === "GET" && runMatch) { const run = runs.get(decodeURIComponent(runMatch[1]!)); run ? json(res, 200, run) : fail(res, 404, "run not found"); return; }
  if (req.method === "POST" && url.pathname === "/api/regressions") {
    let data: any; try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return; }
    if (!data || typeof data.runId !== "string" || typeof data.assertionId !== "string") { fail(res, 400, "runId and assertionId are required"); return; }
    const run = runs.get(data.runId); if (!run) { fail(res, 404, "run not found"); return; }
    const assertion: DemoAssertion | undefined = run.assertions.find(a => a.id === data.assertionId);
    if (!assertion) { fail(res, 404, "assertion not found"); return; }
    if (assertion.status !== "failed") { fail(res, 409, "only failed assertions can be saved as regressions"); return; }
    const expected: any = assertion.expected;
    if (!expected || typeof expected !== "object" || !Number.isInteger(expected.status)) { fail(res, 400, "failed assertion has no reusable HTTP expectation"); return; }
    const check: DemoCheck = { id: `reg-${randomUUID()}`, title: `回归：${assertion.title}`, source: "regression", method: assertion.reproduction.method, path: assertion.reproduction.path, expect: structuredClone(expected), ...(assertion.reproduction.body === undefined ? {} : { body: structuredClone(assertion.reproduction.body) }), ...(assertion.reproduction.headers === undefined ? {} : { headers: structuredClone(assertion.reproduction.headers) }) };
    savedChecks.push(check); await persistRegressions(); json(res, 201, check); return;
  }
  if (url.pathname.startsWith("/api/")) { fail(res, 404, "not found"); return; }
  if (await handleSample(req, res, fixedTarget)) return;
  if (req.method === "GET" && await staticFile(url.pathname, res)) return;
  fail(res, 404, "not found");
}

function mergeBrowserCases(existing: ReturnType<typeof validateCases>, generated: ReturnType<typeof validateCases>) {
  const seen = new Set<string>();
  const merged = [...existing, ...generated].filter(item => {
    const key = `${item.title.trim().toLocaleLowerCase()}\n${item.expected.trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (merged.length > 200) throw new Error(`合并后有 ${merged.length} 条用例，项目上限 200；请分批建项目，未静默截断。`);
  return merged.map((item, index) => ({ ...item, caseOrigin: item.caseOrigin ?? "manual", id: `case-${index + 1}` }));
}

await loadSavedData();
const server = createServer((req, res) => {
  void handle(req, res).catch(error => {
    console.error("Demo server request failed", error);
    if (!res.headersSent) fail(res, 500, "internal server error"); else res.destroy();
  });
});
server.listen(port, host, () => console.log(`TestPilot Demo: http://${host}:${port}`));

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => { void Promise.all([closePersistentTestPages(), disconnectMysqlBrowser()]).finally(() => process.exit(0)); });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
