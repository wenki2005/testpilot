import { createHash, randomUUID } from "node:crypto";
import type { GeneratedTestCase } from "./case-generation-agent.js";
import { validateCaseGenerationTrace } from "./case-generation-handoff.js";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Page } from "playwright";
import { disconnectPersistentTestPage, getExistingPersistentTestPage, launchPersistentTestPage, navigatePersistentPage, resetPersistentCaseBaseline } from "./browser-runtime.js";
import { unzipSync, zipSync, strToU8 } from "fflate";
import type { ImportedDocument } from "./document-importer.js";
import { runComputerUseLane, type VisualLane } from "./computer-use.js";
import { refreshDocumentPackage } from "./document-package-refresh.js";
import { assertNoHorizontalOverflow } from "./responsive-layout.js";
import { missingDirectAssertion } from "./document-case-quality.js";
import { completeChat } from "./compatible-chat.js";
import { executeApprovedApiSuite, getApiSuiteCandidate } from "./api-suite-workflow.js";
import { executeDocumentApiLane, type DocumentApiLane, type DocumentApiMapping } from "./api-document-lane.js";
import type { DocumentImpactSuggestion } from "./document-impact-analysis.js";
import { allowBrowserRequest, browserRequestPolicySource, clearLoginHandoff, getLoginHandoff, isLoginPage, waitForUserLogin } from "./login-handoff.js";
import { caseCategories, caseCategoryLabels, confidenceFromExpectation, inferCaseCategory, type CaseCategory, type CaseConfidence } from "./document-test-types.js";
import { getDocumentWorkflow } from "./document-workflow-record.js";
import { containsCredentialLikeValue, redactSensitiveExportData } from "./document-sensitive-data.js";
import { normalizeDocumentCaseEntryPath, resolveDocumentCaseEntryUrl } from "./document-case-entry.js";

export type BrowserStep =
  | { action: "fillByLabel"; label: string; value: string; rowIndex?: number }
  | { action: "fillByPlaceholder"; placeholder: string; value: string }
  | { action: "fillByRoleIndex"; role: "combobox"; index: number; value: string }
  | { action: "blurByLabel"; label: string; rowIndex?: number }
  | { action: "blurByPlaceholder"; placeholder: string }
  | { action: "selectByLabel"; label: string; value: string; rowIndex?: number }
  | { action: "selectByPlaceholder"; placeholder: string; value: string }
  | { action: "selectByRoleIndex"; role: "combobox"; index: number; value: string }
  | { action: "clickByRole"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "triggerClientValidation"; name: string }
  | { action: "clickExactText"; text: string }
  | { action: "assertText"; text: string }
  | { action: "assertVisible"; text: string }
  | { action: "assertNotVisible"; text: string }
  | { action: "assertExactVisible"; text: string }
  | { action: "assertRoleVisible"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "assertValue"; label: string; value: string; rowIndex?: number }
  | { action: "assertValueByPlaceholder"; placeholder: string; value: string }
  | { action: "assertDisabled"; label: string }
  | { action: "assertFieldInvalid"; label: string; rowIndex?: number }
  | { action: "captureCurrentUrl" }
  | { action: "assertCurrentUrlUnchanged" }
  | { action: "assertRoleDisabled"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "assertMaxLengthOrMessage"; label: string; maxLength: number; message: string }
  | { action: "startFetchOrXhrCapture" }
  | { action: "assertNoFetchOrXhr"; quietMs?: number }
  | { action: "assertNoHorizontalOverflow" }
  | { action: "setViewport"; width: number; height: number }
  | { action: "scrollToRatio"; ratio: number }
  | { action: "setReducedMotion"; value: boolean };
export type CasePriority = "P0" | "P1" | "P2" | "P3";
export type CaseLifecycleStatus = "draft" | "runnable" | "disabled";
export type SideEffectRisk = "none" | "reversible" | "irreversible" | "unknown";
export type DocumentRunMode = "regression" | "compare";
export type DocumentRunScopePlan = { mode: "single" | "feature" | "impact" | "full" | "custom"; targetCaseIds: string[]; impactCaseIds: string[]; impactReasons?: Record<string, string[]> };
export type ExecutionRoute = "browser-ui" | "api-contract" | "fixture-or-role" | "source-review" | "clarification" | "out-of-scope" | "manual-analysis";
export type CaseGenerationTrace = { sourceCaseId: string; sourceRefs: string[]; actions: string[]; scenarioType: GeneratedTestCase["scenarioType"]; clarificationNeeded: string[]; original: GeneratedTestCase };
export type BrowserCheck = { id: string; title: string; source: string; entryPath?: string; modulePath?: string[]; tags?: string[]; requirementRefs: string[]; priority: CasePriority; category: CaseCategory; confidence: CaseConfidence; coverageAreas: CaseCategory[]; lifecycleStatus?: CaseLifecycleStatus; selectedForRegression: boolean; preconditions: string[]; preconditionsConfirmed: boolean; testData: string[]; sideEffectRisk: SideEffectRisk; cleanup: string; caseOrigin?: "held-out-benchmark" | "ai-generated" | "document-derived" | "manual" | "iteration-impact-draft"; caseGenerationTrace?: CaseGenerationTrace; kind: "text" | "visible" | "field"; expected: string; steps: BrowserStep[]; baseline?: { strategy: "reload-target" | "unavailable"; reason?: string }; coverageGap?: string; executionRoute?: ExecutionRoute; executionReason?: string; nextAction?: string };
export type StepGenerationCaseResult = { caseId: string; status: "generated" | "partial" | "blocked"; stepCount: number; detail: string };
export type DocumentSiteVersion = { id: string; label: string; environment: string; targetUrl: string; changeNotes: string; createdAt: string };
export type DocumentTestDataSet = { id: string; name: string; values: Record<string, string>; createdAt: string; updatedAt: string };
export type DocumentSourceMaterial = { id: string; fileName: string; role: "requirements" | "coverage-reference" | "held-out-benchmark" | "website-content"; sha256: string; byteLength: number; createdAt: string };
export type DocumentImpactAnalysis = { id: string; siteVersionId: string; siteVersionLabel: string; changeNotesSnapshot: string; caseVersion: string; analyzedAt: string; matchingMethod: "keyword-evidence"; suggestions: DocumentImpactSuggestion[]; unmatchedTerms: string[]; status: "pending" | "accepted" | "rejected"; selectedCaseIds?: string[]; reviewNotes?: string; reviewedAt?: string };
export type DocumentProject = { id: string; name: string; fileName: string; workflowId?: string; siteVersions?: DocumentSiteVersion[]; activeSiteVersionId?: string; impactAnalyses?: DocumentImpactAnalysis[]; testDataSets?: DocumentTestDataSet[]; sourceMaterials?: DocumentSourceMaterial[]; materialTexts?: Record<string, string>; contextText?: string; sourceFiles?: string[]; sourceRoles?: Array<{ fileName: string; role: "requirements" | "coverage-reference" | "held-out-benchmark" | "website-content" }>; researchExamples?: Array<{ title: string; url: string; snippet: string }>; caseMode?: "existing" | "ai" | "both"; confirmationRequired?: boolean; generationWarning?: string; stepAuthoring?: { generatedAt: string; results: StepGenerationCaseResult[] }; workflowPlan?: string[]; caseGeneration?: { artifactId: string; version: number; generatedAt: string; digest: string; requirements: CaseGenerationRequirementSnapshot[]; qualitySummary: Record<string, unknown>; warnings: string[]; sources: Array<{ kind: string; label: string; reference?: string }>; transferredCases: Array<{ sourceCaseId: string; projectCaseId: string }> }; apiContract?: { suiteId?: string; mappings?: DocumentApiMapping[]; allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean }; sessionIdentityNote?: string; format: ImportedDocument["format"]; targetUrl: string; sourceText: string; cases: BrowserCheck[]; reviewStatus?: "draft" | "approved"; reviewNotes?: string; createdAt: string; updatedAt: string };
export type DocumentProjectRevisionKind = "case" | "steps" | "case-set" | "materials" | "test-data";
export type DocumentProjectRevisionSummary = { id: string; projectId: string; kind: DocumentProjectRevisionKind; entityId: string; version: number; digest: string; createdAt: string; source: "saved-project" | "run-snapshot"; summary: string };
export type DocumentProjectRevision = DocumentProjectRevisionSummary & { snapshot: unknown };
export type DocumentProjectSessionStatus = {
  state: "occupied" | "connected" | "unavailable" | "unknown";
  occupied: boolean;
  manualLoginRequired: boolean | null;
  identityNote?: string;
  identitySource?: "user-confirmed";
  checkedAt: string;
  message: string;
};
export type DocumentStepProbe = {
  caseId: string;
  stepIndex: number;
  action: string;
  status: "found" | "not-found" | "not-visible" | "ambiguous" | "not-required" | "blocked";
  locatorKind?: string;
  matchCount?: number;
  visibleCount?: number;
  elementTypes?: string[];
  checkedAt: string;
  detail: string;
};
type CaseGenerationRequirementSnapshot = { id: string; text: string; source: string; priority: string; confidence: string; scopeStatus: string; scopeRationale: string };
type CaseResult = { id: string; title: string; status: "passed" | "failed" | "blocked" | "not-applicable" | "cancelled" | "not-run"; detail: string; durationMs: number };
type LaneResult = { status: "passed" | "failed" | "blocked" | "not-applicable" | "cancelled"; summary: string; results: CaseResult[]; provider?: string; diagnostics?: string[] };
export type ComparisonResolution = "aligned" | "mismatch" | "unresolved" | "not-applicable";
export type DocumentCaseTriageCategory = "suspected-product-regression" | "case-or-expectation-review" | "locator-failure" | "environment-or-session" | "test-data-or-fixture" | "needs-review";
export type DocumentCaseTriage = { category: DocumentCaseTriageCategory; confidence: "evidence-based" | "tentative"; detail: string };
export type CaseComparison = { id: string; title: string; deterministic: CaseResult["status"]; computerUse: CaseResult["status"]; apiContract?: CaseResult["status"]; aligned: boolean; resolution?: ComparisonResolution; issue: string; nextAction?: string; triage?: DocumentCaseTriage };
export type BaselineDisposition = "regression" | "fixed" | "unchanged" | "case-changed" | "added" | "removed" | "not-run" | "no-baseline-result" | "unresolved";
export type DocumentBaselineComparison = { caseId: string; title: string; baselineStatus?: CaseResult["status"]; currentStatus?: CaseResult["status"]; caseChanged?: boolean; disposition: BaselineDisposition };

export function unsupportedWeChatClientGateMessage(text: string): string | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (/^请在(?:企业)?微信客户端(?:内|中)?打开(?:此|该)?链接[。！!]?$/u.test(normalized)) return normalized;
  if (/^please open (?:this )?link in (?:the )?(?:wechat|wecom)(?: work)? client[.!]?$/iu.test(normalized)) return normalized;
  return undefined;
}

async function detectUnsupportedWeChatClientGate(page: Page): Promise<string | undefined> {
  const text = await page.locator("body").innerText().catch(() => "");
  return unsupportedWeChatClientGateMessage(text);
}

export function classifyDocumentCaseTriage(input: {
  status: CaseResult["status"];
  detail: string;
  baselineDisposition?: BaselineDisposition;
  caseChanged?: boolean;
  materialChanged?: boolean;
  testDataChanged?: boolean;
  baselineEnvironmentComparison?: "same" | "different" | "unknown";
  baselineRunModeComparison?: "same" | "different" | "unknown";
  regressionMode?: boolean;
}): DocumentCaseTriage | undefined {
  if (["passed", "not-applicable", "cancelled", "not-run"].includes(input.status)) return undefined;
  const detail = input.detail.replace(/\s+/gu, " ").slice(0, 700);
  if (/(?:fixture|夹具|setup|cleanup).{0,80}(?:fail|failed|阻塞|未通过|失败)|(?:fail|failed|阻塞|未通过|失败).{0,80}(?:fixture|夹具|setup|cleanup)|缺少(?:可复用)?测试数据|前置条件尚未/u.test(detail)) {
    return { category: "test-data-or-fixture", confidence: "evidence-based", detail: "测试数据、前置条件或 fixture setup/cleanup 未就绪；先恢复数据状态，再判断产品行为。" };
  }
  if (/(?:登录|扫码|会话|浏览器未能开始|无法建立用例页面基线|net::ERR_|ECONNRESET|ECONNREFUSED|连接被拒绝|页面重载后出现登录|微信客户端|企业微信客户端|WeChat(?: Work)? client gate)/iu.test(detail)) {
    return { category: "environment-or-session", confidence: "evidence-based", detail: "运行证据指向登录会话、微信客户端访问门禁、浏览器启动或网络连接问题；先恢复目标环境，再判断产品行为。" };
  }
  if (/(?:定位|标签未匹配|字段不可见|占位符.{0,20}(?:匹配|唯一|消失)|strict mode violation|resolved to 0 elements|ambiguous|multiple elements|元素.{0,20}(?:未找到|不唯一))/iu.test(detail)) {
    return { category: "locator-failure", confidence: "evidence-based", detail: "执行证据显示元素定位失效或不唯一；先检查当前页面控件和用例定位。" };
  }
  if (input.testDataChanged) return { category: "test-data-or-fixture", confidence: "evidence-based", detail: "本轮测试数据版本与基线不同；先确认输入和数据状态等价，再判断产品回归。" };
  if (input.caseChanged || input.baselineDisposition === "case-changed" || input.materialChanged) {
    return { category: "case-or-expectation-review", confidence: "evidence-based", detail: "用例步骤、预期或需求资料相对基线已变化；先复核验收依据，再判断产品回归。" };
  }
  if ((input.baselineEnvironmentComparison && input.baselineEnvironmentComparison !== "same")
    || (input.baselineRunModeComparison && input.baselineRunModeComparison !== "same")) {
    return { category: "needs-review", confidence: "evidence-based", detail: "本轮与基线的测试环境或验证方式不同、或记录不全；状态变化可见，但目前不能可靠归因于产品回归。" };
  }
  if (input.status === "failed" && input.regressionMode === true && input.baselineDisposition === "regression") {
    return { category: "suspected-product-regression", confidence: "tentative", detail: "相同用例在基线通过、本轮失败；这是疑似产品回归证据，仍需核对环境和业务数据。" };
  }
  if (input.status === "failed" && /断言失败|期望.{0,30}(?:未出现|不符|不可见)|字段值与预期不符|不应出现的文本仍可见/iu.test(detail)) {
    return { category: "case-or-expectation-review", confidence: "tentative", detail: "断言与当前页面行为不符；可能是产品行为变化，也可能是预期或页面文本已过期，需人工复核。" };
  }
  return { category: "needs-review", confidence: "tentative", detail: "现有证据不足以可靠区分产品、用例、数据或环境问题；保留待确认。" };
}
export type CoverageSummary = { projectAreas: CaseCategory[]; selectedAreas: CaseCategory[]; notCoveredThisRun: CaseCategory[] };

const parameterToken = /\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu;
const forbiddenParameterName = /(?:pass(?:word|code)?|pwd|token|secret|cookie|auth|credential|api.?key)/iu;
const parameterizedStepFields = new Set(["value", "text", "name"]);

export function collectDocumentParameterNames(cases: Array<Pick<BrowserCheck, "steps">>): string[] {
  const names = new Set<string>();
  for (const item of cases) for (const step of item.steps ?? []) for (const [field, value] of Object.entries(step)) {
    if (!parameterizedStepFields.has(field) || typeof value !== "string") continue;
    parameterToken.lastIndex = 0;
    for (const match of value.matchAll(parameterToken)) names.add(match[1]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en"));
}

export function resolveDocumentRunParameters(project: DocumentProject, selectedCaseIds: string[], dataSetId?: string, overrides: Record<string, string> = {}): Record<string, string> {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.getPrototypeOf(overrides) !== Object.prototype) throw new Error("本轮参数必须是普通对象。");
  const knownNames = new Set(collectDocumentParameterNames(project.cases));
  const selectedCases = project.cases.filter(item => selectedCaseIds.includes(item.id));
  const requiredNames = collectDocumentParameterNames(selectedCases);
  const dataSet = dataSetId ? project.testDataSets?.find(item => item.id === dataSetId) : undefined;
  if (dataSetId && !dataSet) throw new Error("选择的测试数据组不存在或已删除；请重新选择。");
  const values: Record<string, string> = { ...(dataSet?.values ?? {}) };
  for (const [name, value] of Object.entries(overrides)) {
    if (!knownNames.has(name)) throw new Error(`未知的测试参数：${name}。请检查步骤中的 {{param:名称}} 引用。`);
    if (forbiddenParameterName.test(name)) throw new Error(`测试参数「${name}」可能是密码或凭据；认证信息请使用已登录的 Edge 会话。`);
    if (typeof value !== "string" || value.length > 500) throw new Error(`测试参数「${name}」必须是 500 字以内的字符串。`);
    values[name] = value;
  }
  for (const [name, value] of Object.entries(values)) {
    if (!knownNames.has(name)) throw new Error(`数据组中包含当前用例未定义的参数「${name}」；请整理数据组后再运行。`);
    if (forbiddenParameterName.test(name)) throw new Error(`测试参数「${name}」可能是密码或凭据；认证信息请使用已登录的 Edge 会话。`);
    if (typeof value !== "string" || value.length > 500) throw new Error(`测试数据组中的「${name}」必须是 500 字以内的字符串。`);
  }
  for (const name of requiredNames) {
    if (Object.hasOwn(values, name) && containsCredentialLikeValue(values[name]!)) {
      throw new Error("测试参数「" + name + "」疑似含有令牌、Cookie 或认证凭据；请改用合成测试数据。");
    }
  }
  const missing = requiredNames.filter(name => !Object.hasOwn(values, name));
  if (missing.length) throw new Error(`本轮缺少参数值：${missing.map(name => `{{param:${name}}}`).join("、")}。请填写参数或选择包含这些值的数据组。`);
  return Object.fromEntries(requiredNames.map(name => [name, values[name]!]));
}

function resolveBrowserStepParameters(step: BrowserStep, values: Record<string, string>): BrowserStep {
  const resolved = { ...step } as Record<string, unknown>;
  for (const [field, value] of Object.entries(resolved)) {
    if (!parameterizedStepFields.has(field) || typeof value !== "string") continue;
    parameterToken.lastIndex = 0;
    const next = value.replace(parameterToken, (_token, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`本轮没有提供参数值「${name}」。`);
      return values[name]!;
    });
    if (next.includes("{{param:")) throw new Error(`步骤中的参数引用格式无效：${value}`);
    resolved[field] = next;
  }
  return resolved as BrowserStep;
}

/** Keep true outcome disagreement separate from cases that both lanes could not verify. */
export function classifyComparison(left: CaseResult["status"], right: CaseResult["status"]): ComparisonResolution {
  if (left === "not-applicable" && right === "not-applicable") return "not-applicable";
  if ((left === "passed" || left === "failed") && left === right) return "aligned";
  if (["blocked", "cancelled", "not-run"].includes(left) || ["blocked", "cancelled", "not-run"].includes(right)) return "unresolved";
  return "mismatch";
}

function stableOutcomeForBaseline(run: DocumentRun, caseId: string): CaseResult["status"] | undefined {
  if (!run.caseScope?.selectedCaseIds.includes(caseId)) return undefined;
  const comparison = run.comparisons.find(item => item.id === caseId);
  if (!comparison) return undefined;
  if (run.runMode === "regression") {
    if (comparison.deterministic === "not-applicable" && ["passed", "failed"].includes(comparison.apiContract ?? "")) return comparison.apiContract;
    return comparison.deterministic;
  }
  if (comparison.resolution === "aligned" && comparison.deterministic === comparison.computerUse && ["passed", "failed"].includes(comparison.deterministic)) return comparison.deterministic;
  if (comparison.deterministic === "not-applicable" && comparison.computerUse === "not-applicable" && ["passed", "failed"].includes(comparison.apiContract ?? "")) return comparison.apiContract;
  if (comparison.deterministic === "not-run" || comparison.deterministic === "cancelled") return comparison.deterministic;
  return "blocked";
}

/** Compare a finished run with a user-selected immutable run by case ID. A changed
 * expectation or script is explicitly separated from a product regression. */
export function compareDocumentRunToBaseline(current: DocumentRun, baseline: DocumentRun): DocumentBaselineComparison[] {
  if (current.projectId !== baseline.projectId) throw new Error("Baseline run must belong to the same test project.");
  const currentVersions = current.caseVersions;
  const baselineVersions = baseline.caseVersions;
  if (!currentVersions || !baselineVersions) throw new Error("Both runs must record per-case revisions to compare against a baseline.");
  const currentSelected = new Set(current.caseScope.selectedCaseIds);
  const baselineSelected = new Set(baseline.caseScope.selectedCaseIds);
  const currentInventory = current.caseInventory ? new Set(Object.keys(current.caseInventory)) : undefined;
  const baselineInventory = baseline.caseInventory ? new Set(Object.keys(baseline.caseInventory)) : undefined;
  const hasCompleteInventories = Boolean(currentInventory && baselineInventory);
  const ids = [...new Set([
    ...Object.keys(currentVersions),
    ...Object.keys(baselineVersions),
    ...currentSelected,
    ...baselineSelected,
    ...(currentInventory && baselineInventory ? [...currentInventory, ...baselineInventory] : []),
  ])];
  const comparisons: DocumentBaselineComparison[] = [];
  for (const caseId of ids) {
    const currentExists = currentInventory?.has(caseId) ?? currentVersions[caseId] !== undefined;
    const baselineExists = baselineInventory?.has(caseId) ?? baselineVersions[caseId] !== undefined;
    const title = current.caseTitles?.[caseId] ?? baseline.caseTitles?.[caseId]
      ?? current.caseInventory?.[caseId] ?? baseline.caseInventory?.[caseId] ?? caseId;
    const isSelectedNow = currentSelected.has(caseId);
    const wasSelectedAtBaseline = baselineSelected.has(caseId);

    // A result-scoped case snapshot cannot tell whether an absent case was removed
    // from the project or simply omitted from this run. Only classify additions or
    // removals when both runs carry a complete project inventory.
    if (hasCompleteInventories && !currentExists && baselineExists) {
      const baselineStatus = stableOutcomeForBaseline(baseline, caseId);
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus: "not-run", disposition: "removed" });
      continue;
    }
    if (hasCompleteInventories && currentExists && !baselineExists) {
      const currentStatus = isSelectedNow ? stableOutcomeForBaseline(current, caseId) : "not-run";
      comparisons.push({ caseId, title, ...(currentStatus ? { currentStatus } : {}), disposition: "added" });
      continue;
    }
    if (!isSelectedNow && !wasSelectedAtBaseline) continue;

    const caseChanged = currentVersions[caseId] !== undefined && baselineVersions[caseId] !== undefined
      ? currentVersions[caseId] !== baselineVersions[caseId]
      : undefined;
    const currentStatus = isSelectedNow ? stableOutcomeForBaseline(current, caseId) : undefined;
    const baselineStatus = wasSelectedAtBaseline ? stableOutcomeForBaseline(baseline, caseId) : undefined;
    if (!isSelectedNow) {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus: "not-run", ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "not-run" });
      continue;
    }
    if (!wasSelectedAtBaseline) {
      comparisons.push({ caseId, title, ...(currentStatus ? { currentStatus } : {}), ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "no-baseline-result" });
      continue;
    }
    if (currentStatus === "not-run" || currentStatus === "cancelled") {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), currentStatus, ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "not-run" });
      continue;
    }
    if (caseChanged === undefined || !currentStatus || !baselineStatus || !["passed", "failed"].includes(currentStatus) || !["passed", "failed"].includes(baselineStatus)) {
      comparisons.push({ caseId, title, ...(baselineStatus ? { baselineStatus } : {}), ...(currentStatus ? { currentStatus } : {}), ...(caseChanged !== undefined ? { caseChanged } : {}), disposition: "unresolved" });
      continue;
    }
    if (caseChanged) {
      comparisons.push({ caseId, title, baselineStatus, currentStatus, caseChanged: true, disposition: "case-changed" });
      continue;
    }
    const disposition: BaselineDisposition = baselineStatus === "passed" && currentStatus === "failed" ? "regression"
      : baselineStatus === "failed" && currentStatus === "passed" ? "fixed"
        : baselineStatus === currentStatus ? "unchanged" : "unresolved";
    comparisons.push({ caseId, title, baselineStatus, currentStatus, caseChanged: false, disposition });
  }
  return comparisons;
}

export function isDocumentBaselineEligible(run: DocumentRun): boolean {
  if (!run.caseScopeKnown || !run.caseVersion || !run.caseVersions || !run.completedAt || run.overall === "cancelled") return false;
  if (run.runMode === "regression") return ["passed", "failed"].includes(run.overall)
    && run.caseScope.selectedCaseIds.every(id => ["passed", "failed"].includes(stableOutcomeForBaseline(run, id) ?? ""));
  return run.finalReady === true && ["passed", "failed"].includes(run.overall);
}

/** Keep a concrete browser-lane defect observation visible when a broader case
 * remains blocked by an API/fixture gap. This is a lead for review, not a
 * replacement for the case's unresolved overall disposition. */
export function partialUiFindingNote(results: Array<Pick<CaseResult, "status" | "detail">>): string | undefined {
  const finding = results.find(result => result.status !== "passed"
    && /(?:违反.{0,8}(?:预期|期望)|与预期.{0,24}不符|does not (?:meet|match) (?:the )?expectation|(?:the )?front[- ]?end.{0,80}(?:does not allow|rejects|clamps|truncates).{0,80}(?:1000|9999|legal values)|前端.{0,12}(?:拒绝|不允许|未允许)|(?:已复现|复现).{0,12}(?:缺陷|错误|上限)|失焦后.{0,24}(?:改为|变为|被改为|显示为).{0,8}[「“]?999|after\s+(?:clicking away|tab\s+)?(?:blur|losing focus).{0,100}(?:changed|became|displayed|reset|reverted|returned).{0,40}999|观察窗口内出现\s*\d+\s*个\s*fetch\/XHR\s*请求|(?:observed|captured)\s+\d+\s+fetch\/?XHR\s+requests?)/iu.test(result.detail));
  if (!finding) return undefined;
  const excerpt = finding.detail.replace(/\s+/gu, " ").slice(0, 360);
  return `部分 UI 检查发现疑似产品缺陷（仍待完整验证）：${excerpt}`;
}
export type DocumentRunDiagnostic = { caseId: string; classification: "mismatch" | "unverified" | "aligned" | "not-applicable"; deterministicEvidence: string; computerUseEvidence: string; apiEvidence?: string; resolution: ComparisonResolution };
export type DocumentRunBaselineSnapshot = { runId: string; startedAt: string; completedAt: string; runMode?: DocumentRunMode; siteVersionSnapshot?: DocumentSiteVersion; caseVersion?: string; materialVersion?: string; testDataVersion?: string; scopePlan?: DocumentRunScopePlan; selectedCaseCount: number; totalCases: number };
export type DocumentRun = { id: string; projectId: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; materialVersion?: string; sourceMaterialsSnapshot?: DocumentSourceMaterial[]; baselineRunId?: string; baselineRunSnapshot?: DocumentRunBaselineSnapshot; baselineEnvironmentComparison?: "same" | "different" | "unknown"; baselineRunModeComparison?: "same" | "different" | "unknown"; baselineMaterialChanged?: boolean; baselineTestDataChanged?: boolean; baselineComparison?: DocumentBaselineComparison[]; testDataSetId?: string; testDataVersion?: string; parameterValues?: Record<string, string>; caseSnapshotVersion?: 1; caseSnapshots?: BrowserCheck[]; executionCaseSnapshots?: BrowserCheck[]; caseVersions?: Record<string, string>; caseTitles?: Record<string, string>; caseInventory?: Record<string, string>; parentRunId?: string; caseVersion?: string; retestSelection?: string[]; retestNotes?: string; retestScopeNote?: string; startedAt: string; completedAt: string; caseScope: { selectedCaseIds: string[]; excludedCaseIds: string[]; totalCases: number }; caseScopeKnown?: boolean; recovery?: { resumeCount: number; replayedFromBeginning: false; skippedCompletedCaseIds: string[]; interruptedRetryCaseIds: string[] }; coverageSummary?: CoverageSummary; stepGeneration?: { generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview: boolean }; deterministic: LaneResult; ai: LaneResult & { provider?: string }; apiContract?: DocumentApiLane; comparisons: CaseComparison[]; diagnostics?: DocumentRunDiagnostic[]; analysis?: string; finalReady: boolean; reportReady?: boolean; packageReady?: boolean; overall: "passed" | "failed" | "partial" | "unresolved" | "cancelled"; report: string; packagePath: string };
export type DocumentRunProgress = {
  runId: string;
  workflowId?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: ExecutionJournal["stage"];
  workflowStatus?: "running" | "waiting" | "failed" | "completed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  resumeCount: number;
  currentCase?: ExecutionJournal["currentCase"];
  stepGeneration?: DocumentRun["stepGeneration"];
  siteVersionSnapshot?: DocumentSiteVersion;
  progress: { completed: number; total: number; counts: Record<string, number> };
  results: NonNullable<ExecutionJournal["caseResults"]>;
  run?: DocumentRun;
  lastError?: string;
};
type ExecutionJournal = { version: 1; runId: string; projectId: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; materialVersion?: string; sourceMaterialsSnapshot?: DocumentSourceMaterial[]; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; projectDigest: string; targetUrl: string; selectedCaseIds: string[]; startedAt: string; updatedAt: string; status: "running" | "completed" | "failed" | "cancelled"; stage: "starting" | "deterministic" | "computer-use" | "awaiting-login" | "analysis" | "report" | "packaging"; resumeCount: number; parentRunId?: string; retestNotes?: string; retestScopeNote?: string; caseResults?: Array<{ lane: "deterministic" | "computer-use"; id: string; title: string; status: CaseResult["status"]; detail: string; durationMs: number; updatedAt: string; actions?: number }>; currentCase?: { lane: "deterministic" | "computer-use"; id: string; title: string }; stepGeneration?: DocumentRun["stepGeneration"]; finalizationRun?: DocumentRun; lastError?: string };
export type DocumentRunRecovery = { runId: string; workflowId?: string; runMode?: DocumentRunMode; siteVersionSnapshot?: DocumentSiteVersion; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; parentRunId?: string; retestSelection?: string[]; retestNotes?: string; retestScopeNote?: string; selectedCaseIds?: string[]; startedAt: string; updatedAt: string; stage: ExecutionJournal["stage"]; resumeCount: number; canResume: boolean; canFinalizePackage?: boolean; lastError?: string; isRunning?: boolean; progress?: { completed: number; total: number; currentCase?: { lane: "deterministic" | "computer-use"; id: string; title: string }; counts: Record<string, number> }; recordedResultCount?: number; recordedResults?: Array<{ lane: "deterministic" | "computer-use"; id: string; title: string; status: CaseResult["status"]; durationMs: number; updatedAt: string; actions?: number }>; reason: string };

const baseDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"), "document-tests");
const projectsDir = path.join(baseDir, "projects");
const runsDir = path.join(baseDir, "runs");
const revisionsDir = path.join(baseDir, "revisions");
const maxCases = 200;
const activeBrowserRuns = new Set<string>();
const activeDocumentPageLeases = new Set<string>();
const activeDocumentRuns = new Map<string, { controller: AbortController; userDataDir: string; acceptingCancel: boolean }>();
const activePackageFinalizations = new Set<string>();
const projectSaveTails = new Map<string, Promise<void>>();

type DocumentProjectRevisionIndex = { version: 1; projectId: string; revisions: DocumentProjectRevisionSummary[] };

function canonicalRevisionJson(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, entry]) => [key, canonicalize(entry)]));
    return item;
  };
  return JSON.stringify(canonicalize(value));
}

function revisionDigest(kind: DocumentProjectRevisionKind, entityId: string, snapshot: unknown): string {
  return createHash("sha256").update(`testpilot-project-revision-v1\0${kind}\0${entityId}\0${canonicalRevisionJson(snapshot)}`).digest("hex");
}

function projectRevisionDirectory(projectId: string): string {
  const projectKey = createHash("sha256").update(projectId).digest("hex");
  return path.join(revisionsDir, projectKey);
}

function sourceMaterialStorageKey(projectId: string, material: DocumentSourceMaterial): string {
  const projectKey = createHash("sha256").update(projectId).digest("hex");
  const safeName = path.basename(material.fileName).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-96) || "material.bin";
  const safeId = material.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 48) || "material";
  const safeDigest = /^[0-9a-f]{64}$/iu.test(material.sha256) ? material.sha256.toLowerCase() : createHash("sha256").update(`${material.sha256}:${material.byteLength}`).digest("hex");
  return `sources/${projectKey}/${safeId}-${safeDigest}-${safeName}`;
}

async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readRevisionIndex(projectId: string): Promise<DocumentProjectRevisionIndex | undefined> {
  const indexPath = path.join(projectRevisionDirectory(projectId), "index.json");
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as DocumentProjectRevisionIndex;
    if (parsed.version !== 1 || parsed.projectId !== projectId || !Array.isArray(parsed.revisions)) throw new Error("项目修订索引格式无效。");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function appendProjectRevision(
  index: DocumentProjectRevisionIndex,
  kind: DocumentProjectRevisionKind,
  entityId: string,
  snapshot: unknown,
  createdAt: string,
  source: DocumentProjectRevisionSummary["source"],
  summary: string,
): Promise<void> {
  const digest = revisionDigest(kind, entityId, snapshot);
  const related = index.revisions.filter(item => item.kind === kind && item.entityId === entityId);
  if (related.at(-1)?.digest === digest) return;
  const revision: DocumentProjectRevisionSummary = {
    id: randomUUID(), projectId: index.projectId, kind, entityId,
    version: (related.at(-1)?.version ?? 0) + 1, digest, createdAt, source, summary,
  };
  const record: DocumentProjectRevision = { ...revision, snapshot: structuredClone(snapshot) };
  await atomicWriteFile(path.join(projectRevisionDirectory(index.projectId), `${revision.id}.json`), JSON.stringify(record, null, 2));
  index.revisions.push(revision);
}

async function appendProjectCasesRevisions(index: DocumentProjectRevisionIndex, cases: BrowserCheck[], createdAt: string, source: DocumentProjectRevisionSummary["source"]): Promise<void> {
  for (const item of cases) {
    await appendProjectRevision(index, "case", item.id, item, createdAt, source, item.title || item.id);
    const steps = Array.isArray(item.steps) ? item.steps : [];
    await appendProjectRevision(index, "steps", item.id, steps, createdAt, source, `${item.title || item.id} · ${steps.length} 步`);
  }
  await appendProjectRevision(index, "case-set", "cases", cases.map(item => ({ id: item.id, title: item.title, modulePath: item.modulePath ?? [], lifecycleStatus: item.lifecycleStatus ?? "runnable" })), createdAt, source, `${cases.length} 条用例`);
}

async function appendProjectStateRevisions(index: DocumentProjectRevisionIndex, project: DocumentProject, createdAt: string, source: DocumentProjectRevisionSummary["source"]): Promise<void> {
  await appendProjectCasesRevisions(index, Array.isArray(project.cases) ? project.cases : [], createdAt, source);
  for (const dataSet of project.testDataSets ?? []) await appendProjectRevision(index, "test-data", dataSet.id, dataSet, createdAt, source, dataSet.name);
  const materialsSnapshot = {
    fileName: project.fileName,
    sourceFiles: project.sourceFiles ?? [project.fileName],
    sourceRoles: project.sourceRoles ?? [],
    sourceMaterials: (project.sourceMaterials ?? []).map(item => ({ ...item, ...(item.role === "website-content" ? {} : { storageKey: sourceMaterialStorageKey(project.id, item) }) })),
    materialTexts: project.materialTexts ?? {},
    contextText: project.contextText ?? "",
    sourceText: project.sourceText ?? "",
    materialVersion: getDocumentMaterialVersion(project),
    sourceTextAvailable: true,
  };
  const materialNames = (project.sourceMaterials ?? []).map(item => item.fileName).join("、") || project.fileName;
  await appendProjectRevision(index, "materials", "materials", materialsSnapshot, createdAt, source, `${materialNames} · ${(project.sourceText ?? "").length} 字`);
}

async function bootstrapProjectRevisionHistory(projectId: string, previousProject?: DocumentProject): Promise<DocumentProjectRevisionIndex> {
  const index: DocumentProjectRevisionIndex = { version: 1, projectId, revisions: [] };
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const historicalRuns: Array<{ createdAt: string; run: Partial<DocumentRun> }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const run = JSON.parse(await readFile(path.join(runsDir, entry.name, "run.json"), "utf8")) as Partial<DocumentRun>;
      if (run.projectId !== projectId || !Array.isArray(run.caseSnapshots)) continue;
      historicalRuns.push({ createdAt: run.startedAt ?? run.completedAt ?? new Date(0).toISOString(), run });
    } catch { /* ignore legacy or partial run folders; the run store remains authoritative */ }
  }
  historicalRuns.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const { createdAt, run } of historicalRuns) {
    await appendProjectCasesRevisions(index, run.caseSnapshots!, createdAt, "run-snapshot");
    if (run.materialVersion || run.sourceMaterialsSnapshot?.length) {
      const snapshot = { fileName: previousProject?.fileName ?? "历史运行资料", sourceFiles: previousProject?.sourceFiles ?? [], sourceRoles: previousProject?.sourceRoles ?? [], sourceMaterials: run.sourceMaterialsSnapshot ?? [], sourceText: null, materialVersion: run.materialVersion ?? null, sourceTextAvailable: false };
      const materialNames = (run.sourceMaterialsSnapshot ?? []).map(item => item.fileName).join("、") || "资料内容未由该历史运行保存";
      await appendProjectRevision(index, "materials", "materials", snapshot, createdAt, "run-snapshot", `${materialNames} · 历史运行快照`);
    }
  }
  if (previousProject) await appendProjectStateRevisions(index, previousProject, previousProject.updatedAt ?? previousProject.createdAt ?? new Date().toISOString(), "saved-project");
  return index;
}

/** Ask an active run to stop. The Edge/browser connection is disconnected so
 * pending Playwright operations settle without closing the user's Edge tab. */
export async function cancelDocumentRun(runId: string): Promise<"requested" | "not-running" | "already-terminal"> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) return "not-running";
  const active = activeDocumentRuns.get(runId);
  if (!active) {
    const progress = await getDocumentRunProgress(runId);
    return progress && progress.status !== "running" ? "already-terminal" : "not-running";
  }
  if (!active.acceptingCancel) return "already-terminal";
  if (!active.controller.signal.aborted) active.controller.abort(new Error("cancelled by user"));
  await disconnectPersistentTestPage(active.userDataDir);
  return "requested";
}

function projectDigest(project: DocumentProject): string {
  const baseline = {
    id: project.id, targetUrl: project.targetUrl, reviewStatus: project.reviewStatus, caseGeneration: project.caseGeneration,
    materialVersion: getDocumentMaterialVersion(project),
    apiContract: project.apiContract,
    cases: project.cases.map(item => ({ ...item, steps: item.steps ?? [] })),
  };
  return createHash("sha256").update(JSON.stringify(baseline)).digest("hex");
}

function projectMatchesExecutionJournal(project: DocumentProject, journal: ExecutionJournal): boolean {
  if (project.reviewStatus !== "approved") return false;
  const recoveredVersion = journal.siteVersionSnapshot;
  const recoveryProject = recoveredVersion ? { ...project, targetUrl: recoveredVersion.targetUrl } : project;
  const hasRegisteredVersions = (project.siteVersions?.length ?? 0) > 0;
  const selectedVersionStillExists = recoveredVersion
    ? project.siteVersions?.some(item => item.id === recoveredVersion.id && JSON.stringify(item) === JSON.stringify(recoveredVersion)) === true
    : !hasRegisteredVersions;
  return selectedVersionStillExists
    && journal.projectDigest === projectDigest(recoveryProject)
    && journal.targetUrl === recoveryProject.targetUrl;
}

async function canSafelyFinalizeDocumentRunPackage(project: DocumentProject | undefined, journal: ExecutionJournal): Promise<boolean> {
  if (!project || journal.version !== 1 || journal.projectId !== project.id || journal.stage !== "packaging"
    || !["running", "failed"].includes(journal.status) || activeDocumentRuns.has(project.id)
    || activePackageFinalizations.has(journal.runId) || project.apiContract?.allowMutations === true
    || !projectMatchesExecutionJournal(project, journal)) return false;
  const run = journal.finalizationRun;
  return Boolean(run?.id === journal.runId && run.projectId === project.id && run.reportReady === true && run.report
    && await readFile(documentPackageInputPath(journal.runId)).then(() => true, () => false));
}

/** Stable case-asset version; deployed website versions are tracked separately. */
export function getDocumentCaseVersion(project: DocumentProject): string {
  const baseline = { id: project.id, caseGeneration: project.caseGeneration, apiContract: project.apiContract, cases: project.cases.map(item => ({ ...item, steps: item.steps ?? [] })) };
  return createHash("sha256").update(JSON.stringify(baseline)).digest("hex");
}

/** Stable source-material version; raw document bytes stay out of run records. */
export function getDocumentMaterialVersion(project: DocumentProject): string {
  const materials = (project.sourceMaterials ?? []).map(({ fileName, role, sha256, byteLength }) => ({ fileName, role, sha256, byteLength }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.role.localeCompare(b.role) || a.sha256.localeCompare(b.sha256));
  const baseline = { sourceTextSha256: createHash("sha256").update(project.sourceText ?? "").digest("hex"), materials };
  return createHash("sha256").update(JSON.stringify(baseline)).digest("hex");
}

/** Stable version of the exact data-set identity and resolved values used by a run. */
export function getDocumentTestDataVersion(testDataSetId: string | undefined, parameterValues: Record<string, string> = {}): string {
  const values = Object.fromEntries(Object.entries(parameterValues).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ testDataSetId: testDataSetId ?? null, values })).digest("hex");
}

export function validateDocumentRunScopePlan(value: unknown, selectedCaseIds: string[]): DocumentRunScopePlan | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本轮测试范围说明格式无效。");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["mode", "targetCaseIds", "impactCaseIds", "impactReasons"].includes(key))) throw new Error("本轮测试范围说明包含未知字段。");
  const modes: DocumentRunScopePlan["mode"][] = ["single", "feature", "impact", "full", "custom"];
  if (!modes.includes(input.mode as DocumentRunScopePlan["mode"])) throw new Error("本轮测试范围类型无效。");
  const readIds = (key: "targetCaseIds" | "impactCaseIds"): string[] => {
    const values = input[key];
    if (!Array.isArray(values) || values.length > 200 || values.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(id)) || new Set(values).size !== values.length) throw new Error(`本轮测试范围的 ${key} 必须是唯一、有效的用例 ID 列表。`);
    return values as string[];
  };
  const targetCaseIds = readIds("targetCaseIds");
  const impactCaseIds = readIds("impactCaseIds");
  if (!targetCaseIds.length && !(input.mode === "impact" && impactCaseIds.length > 0)) throw new Error("请至少选择一个直接测试目标；纯关联影响重测必须使用 impact 范围。");
  if (input.mode === "single" && (targetCaseIds.length !== 1 || impactCaseIds.length > 0)) throw new Error("单项测试只能包含一个目标用例，不包含关联用例。");
  if (input.mode === "impact" && impactCaseIds.length === 0) throw new Error("影响检查范围至少要包含一条关联影响用例。");
  if (input.mode === "full" && impactCaseIds.length > 0) throw new Error("完整回归范围不能把用例标为关联影响项。");
  const targetIds = new Set(targetCaseIds);
  if (impactCaseIds.some(id => targetIds.has(id))) throw new Error("直接测试目标和关联影响用例不能重复。");
  const included = new Set([...targetCaseIds, ...impactCaseIds]);
  if (included.size !== selectedCaseIds.length || selectedCaseIds.some(id => !included.has(id))) throw new Error("测试范围说明必须准确覆盖本轮实际执行的用例。");
  let impactReasons: Record<string, string[]> | undefined;
  if (input.impactReasons !== undefined) {
    if (!input.impactReasons || typeof input.impactReasons !== "object" || Array.isArray(input.impactReasons)) throw new Error("关联影响检查依据格式无效。");
    const entries = Object.entries(input.impactReasons as Record<string, unknown>);
    if (entries.length > impactCaseIds.length) throw new Error("关联影响检查依据只能对应本轮关联影响用例。");
    impactReasons = {};
    for (const [id, reasons] of entries) {
      if (!impactCaseIds.includes(id) || !Array.isArray(reasons) || reasons.length < 1 || reasons.length > 10 || reasons.some(reason => typeof reason !== "string" || !reason.trim() || reason.length > 300) || new Set(reasons).size !== reasons.length) throw new Error(`关联影响用例 ${id} 的依据必须对应本轮影响范围，并包含 1–10 条有效说明。`);
      impactReasons[id] = reasons.map(reason => (reason as string).trim());
    }
    if (Object.keys(impactReasons).length === 0) impactReasons = undefined;
  }
  return { mode: input.mode as DocumentRunScopePlan["mode"], targetCaseIds, impactCaseIds, ...(impactReasons ? { impactReasons } : {}) };
}

function journalPath(runId: string): string { return path.join(runsDir, runId, "execution.json"); }

const journalWriteQueues = new Map<string, Promise<void>>();

async function saveExecutionJournal(journal: ExecutionJournal): Promise<void> {
  const runId = journal.runId;
  const previous = journalWriteQueues.get(runId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    const dir = path.join(runsDir, runId);
    await mkdir(dir, { recursive: true });
    const temp = path.join(dir, `execution.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(journal, null, 2), "utf8");
      // Windows scanners and backup tools can briefly hold the destination
      // during replacement. Serialize writes per run and retry only these
      // transient sharing violations; never let two snapshots race to rename.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temp, journalPath(runId));
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
          await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
        }
      }
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  });
  journalWriteQueues.set(runId, write);
  try {
    await write;
  } finally {
    if (journalWriteQueues.get(runId) === write) journalWriteQueues.delete(runId);
  }
}

export async function getDocumentRunRecovery(project: DocumentProject): Promise<DocumentRunRecovery | undefined> {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const journals: ExecutionJournal[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const journal = JSON.parse(await readFile(journalPath(entry.name), "utf8")) as ExecutionJournal;
      const savedRun = await getDocumentRun(journal.runId);
      const hasFinalRun = Boolean(savedRun);
      const packageStillIncomplete = journal.stage === "packaging" && journal.finalizationRun?.id === journal.runId && savedRun?.packageReady !== true;
      if (journal.version === 1 && journal.projectId === project.id && ["running", "failed"].includes(journal.status) && (!hasFinalRun || packageStillIncomplete)) journals.push(journal);
    } catch { /* ignore incomplete or malformed journal files */ }
  }
  const journal = journals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!journal) return undefined;
  const isRunning = activeBrowserRuns.has(project.id) || activePackageFinalizations.has(journal.runId);
  const sameBaseline = !isRunning && projectMatchesExecutionJournal(project, journal);
  const mutationRecoveryBlocked = project.apiContract?.allowMutations === true;
  const canFinalizePackage = await canSafelyFinalizeDocumentRunPackage(project, journal);
  const counts: Record<string, number> = { passed: 0, failed: 0, blocked: 0 };
  for (const result of journal.caseResults ?? []) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return {
    runId: journal.runId, ...(journal.workflowId ? { workflowId: journal.workflowId } : {}), ...(journal.runMode ? { runMode: journal.runMode } : {}), ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: journal.siteVersionSnapshot } : {}), ...(journal.baselineRunId ? { baselineRunId: journal.baselineRunId } : {}), ...(journal.testDataSetId ? { testDataSetId: journal.testDataSetId } : {}), ...(journal.parameterValues ? { parameterValues: { ...journal.parameterValues } } : {}), ...(journal.parentRunId ? { parentRunId: journal.parentRunId, retestSelection: [...journal.selectedCaseIds] } : {}), ...(journal.retestNotes ? { retestNotes: journal.retestNotes } : {}), ...(journal.retestScopeNote ? { retestScopeNote: journal.retestScopeNote } : {}), selectedCaseIds: [...journal.selectedCaseIds], startedAt: journal.startedAt, updatedAt: journal.updatedAt, stage: journal.stage, resumeCount: journal.resumeCount,
    isRunning,
    progress: { completed: journal.caseResults?.length ?? 0, total: journal.selectedCaseIds.length * (journal.runMode === "regression" ? 1 : 2), ...(journal.currentCase ? { currentCase: journal.currentCase } : {}), counts },
    recordedResultCount: journal.caseResults?.length ?? 0,
    recordedResults: (journal.caseResults ?? []).slice(-100).map(({ lane, id, title, status, durationMs, updatedAt, actions }) => ({ lane, id, title, status, durationMs, updatedAt, ...(actions !== undefined ? { actions } : {}) })),
    canResume: sameBaseline && !mutationRecoveryBlocked && journal.stage !== "packaging",
    canFinalizePackage,
    ...(journal.lastError ? { lastError: journal.lastError } : {}),
    reason: isRunning ? "测试仍在执行；这里显示已完成的用例进度，不需要重新登录或重启运行。"
      : journal.stage === "packaging" ? canFinalizePackage
        ? "用例结果和报告快照已保存；重试只会完成报告/脚本包打包，不会再次访问目标网站或重跑用例。"
        : `用例已到报告/打包阶段，但缺少可安全复用的打包快照；为避免重跑旧用例，系统不会再次打开目标网站。${journal.lastError ? ` 上次错误：${journal.lastError}` : ""}`
      : mutationRecoveryBlocked ? "该项目允许 API 写请求；崩溃后无法证明外部副作用是否已提交，系统禁止自动重放。请先核对目标数据，再按新的审核运行启动重测。"
      : sameBaseline ? "原项目仍保持审核通过、网站版本和用例未变；恢复会跳过 journal 已完成的用例，仅运行未完成的只读检查；中断用例仅在副作用风险为 none 时重试。"
      : "项目网址、网站版本、审核状态或用例已变化；为避免误跑旧用例，不能恢复此运行，请重新审核并启动新运行。",
  };
}

export async function loadDocumentProjects(): Promise<DocumentProject[]> {
  await mkdir(projectsDir, { recursive: true });
  const { readdir } = await import("node:fs/promises");
  const values: DocumentProject[] = [];
  for (const name of await readdir(projectsDir).catch(() => [])) {
    try {
      const project = JSON.parse(await readFile(path.join(projectsDir, name), "utf8")) as DocumentProject;
      if (Array.isArray(project.cases)) project.cases = project.cases.map((item: BrowserCheck) => {
        const category = caseCategories.includes(item?.category) ? item.category : inferCaseCategory(`${item?.title ?? ""} ${item?.source ?? ""}`);
        const confidence = item?.confidence === "high" || item?.confidence === "low" || item?.confidence === "medium" ? item.confidence : confidenceFromExpectation(typeof item?.expected === "string" ? item.expected : "");
        const existingAreas = Array.isArray(item?.coverageAreas) ? item.coverageAreas.filter(area => caseCategories.includes(area)) : [];
        const normalized = { ...item, category, confidence, coverageAreas: [...new Set<CaseCategory>([category, ...existingAreas])] };
        const plan = planCaseExecution(normalized);
        return { ...normalized, executionRoute: plan.route, executionReason: plan.reason, nextAction: plan.nextAction };
      });
      values.push(project);
    } catch { /* ignore partial files */ }
  }
  return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function saveDocumentProjectSerial(project: DocumentProject): Promise<void> {
  await mkdir(projectsDir, { recursive: true });
  const projectPath = path.join(projectsDir, `${project.id}.json`);
  let previousProject: DocumentProject | undefined;
  try { previousProject = JSON.parse(await readFile(projectPath, "utf8")) as DocumentProject; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  await atomicWriteFile(projectPath, JSON.stringify(project, null, 2));
  let index = await readRevisionIndex(project.id);
  if (!index) index = await bootstrapProjectRevisionHistory(project.id, previousProject);
  await appendProjectStateRevisions(index, project, project.updatedAt ?? new Date().toISOString(), "saved-project");
  await atomicWriteFile(path.join(projectRevisionDirectory(project.id), "index.json"), JSON.stringify(index, null, 2));
}

export async function saveDocumentProject(project: DocumentProject): Promise<void> {
  const previous = projectSaveTails.get(project.id) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() => saveDocumentProjectSerial(project));
  projectSaveTails.set(project.id, operation);
  try { await operation; }
  finally { if (projectSaveTails.get(project.id) === operation) projectSaveTails.delete(project.id); }
}

async function ensureProjectRevisionIndex(projectId: string): Promise<DocumentProjectRevisionIndex | undefined> {
  const existing = await readRevisionIndex(projectId);
  if (existing) return existing;
  const project = await getDocumentProject(projectId);
  if (!project) return undefined;
  const index = await bootstrapProjectRevisionHistory(projectId, project);
  await appendProjectStateRevisions(index, project, project.updatedAt ?? project.createdAt ?? new Date().toISOString(), "saved-project");
  await atomicWriteFile(path.join(projectRevisionDirectory(projectId), "index.json"), JSON.stringify(index, null, 2));
  return index;
}

export async function listDocumentProjectRevisions(projectId: string, options: { kind?: DocumentProjectRevisionKind; entityId?: string; offset?: number; limit?: number } = {}): Promise<{ items: DocumentProjectRevisionSummary[]; total: number }> {
  const index = await ensureProjectRevisionIndex(projectId);
  if (!index) return { items: [], total: 0 };
  const filtered = index.revisions.filter(item => (!options.kind || item.kind === options.kind) && (!options.entityId || item.entityId === options.entityId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.version - left.version || right.id.localeCompare(left.id));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export async function getDocumentProjectRevision(projectId: string, revisionId: string): Promise<DocumentProjectRevision | undefined> {
  if (!/^[0-9a-f-]{36}$/iu.test(revisionId)) return undefined;
  const index = await ensureProjectRevisionIndex(projectId);
  const summary = index?.revisions.find(item => item.id === revisionId);
  if (!summary) return undefined;
  const record = JSON.parse(await readFile(path.join(projectRevisionDirectory(projectId), `${revisionId}.json`), "utf8")) as DocumentProjectRevision;
  if (record.projectId !== projectId || record.id !== revisionId || record.digest !== summary.digest || revisionDigest(record.kind, record.entityId, record.snapshot) !== record.digest) throw new Error("项目修订快照校验失败；为避免展示被改写的历史内容，已拒绝读取。");
  return record;
}

export function createReviewCases(text: string): BrowserCheck[] {
  // This is only a conservative fallback for documents without structured
  // cases. Do not turn YAML front matter, headings, prose, or code samples
  // into dozens of fake tests. Keep explicit list items from content sections
  // that describe behavior; the planner can refine these into measurable cases.
  const lines = text.split(/\r?\n/);
  const candidates: string[] = [];
  let inCodeFence = false;
  let inFrontMatter = false;
  let skipSection = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex]!;
    const line = raw.trim();
    if (/^---\s*$/.test(line)) {
      if (inFrontMatter) { inFrontMatter = false; continue; }
      const closing = lines.slice(lineIndex + 1).findIndex(candidate => /^\s*---\s*$/.test(candidate));
      const block = closing < 0 ? [] : lines.slice(lineIndex + 1, lineIndex + 1 + closing);
      if (block.some(candidate => /^\s*[\w-]+\s*:\s*\S/.test(candidate))) { inFrontMatter = true; continue; }
      continue;
    }
    if (inFrontMatter) continue;
    if (/^```|^~~~/.test(line)) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence || !line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const title = heading[1]!.replace(/[*_`]/g, "").trim();
      skipSection = /^(?:运行|安装|结构|目录|元信息|metadata|运行方式|文件结构|项目结构|structure|directory|source|tags?)(?:\b|\s|$)/i.test(title);
      continue;
    }
    if (skipSection) continue;
    const bullet = line.match(/^(?:[-*+]\s+|\d+[.)、]\s+)(.+)$/);
    if (!bullet) continue;
    const candidate = bullet[1]!.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/[`*_]/g, "").trim();
    if (candidate.length >= 8 && candidate.length <= 180 && !/^(?:title|category|tags?|created|updated|status|source)\s*:/i.test(candidate)) candidates.push(candidate);
  }
  const unique = [...new Set(candidates)];
  if (unique.length > maxCases) throw new Error(`资料中提取到 ${unique.length} 条候选用例，单项目上限 ${maxCases}；请拆分文档，不会静默截掉尾部项目。`);
  return unique.map((line, i) => {
    const match = line.match(/(?:应(?:该)?(?:显示|提示|出现|包含)|提示文案(?:为|是)|文案(?:为|是)|显示为)[：:「“" ]*([^，。；;」”" ]{2,40})/);
    const expected = match?.[1] ?? "[请在审核前补充页面可见预期]";
    const category = inferCaseCategory(line);
    return { id: `doc-${i + 1}`, title: line.slice(0, 90), source: line, requirementRefs: [line.slice(0, 500)], priority: "P2", category, confidence: confidenceFromExpectation(expected), coverageAreas: [category], lifecycleStatus: "draft", selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: "unknown", cleanup: "", caseOrigin: "document-derived", kind: "visible", expected, steps: [] };
  });
}

export function validateCases(value: unknown): BrowserCheck[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxCases) throw new Error(`测试用例需为 1–${maxCases} 条。`);
  const seenCaseIds = new Set<string>();
  return value.map((item: any, i) => {
    if (!item || typeof item !== "object" || !["text", "visible", "field"].includes(item.kind) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || typeof item.expected !== "string" || item.expected.length > 300 || typeof item.source !== "string" || item.source.length > 500) throw new Error(`第 ${i + 1} 条用例无效。`);
    if (!Array.isArray(item.steps) || item.steps.length > 30) throw new Error(`第 ${i + 1} 条用例 steps 必须是最多 30 步的数组。`);
    const steps: BrowserStep[] = item.steps.map((step: any, j: number) => {
      if (!step || typeof step !== "object" || typeof step.action !== "string") throw new Error(`第 ${i + 1} 条第 ${j + 1} 步无效。`);
      const text = (key: string, max = 160) => { if (typeof step[key] !== "string" || !step[key].trim() || step[key].length > max) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 ${key} 无效。`); };
      if (step.action === "fillByLabel" || step.action === "selectByLabel") { text("label"); if (typeof step.value !== "string" || step.value.length > 500 || step.action === "selectByLabel" && !step.value.trim()) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, value: step.value, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "fillByPlaceholder") { text("placeholder"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "fillByRoleIndex") { if (step.role !== "combobox" || !Number.isInteger(step.index) || step.index < 0 || step.index > 20 || typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role/index/value 无效。`); return { action: step.action, role: step.role, index: step.index, value: step.value }; }
      if (step.action === "blurByPlaceholder") { text("placeholder"); return { action: step.action, placeholder: step.placeholder }; }
      if (step.action === "selectByPlaceholder") { text("placeholder"); text("value"); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "selectByRoleIndex") { if (step.role !== "combobox" || !Number.isInteger(step.index) || step.index < 0 || step.index > 9) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role/index 无效。`); text("value"); return { action: step.action, role: step.role, index: step.index, value: step.value }; }
      if (step.action === "blurByLabel") { text("label"); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "clickByRole") {
        text("name");
        if (!["button", "radio", "checkbox", "tab", "link"].includes(step.role) || /提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.name)) throw new Error("点击步骤只能使用安全控件名称，禁止提交、保存、删除、支付、确认等动作。");
        return { action: step.action, role: step.role, name: step.name };
      }
      if (step.action === "triggerClientValidation") { text("name"); return { action: step.action, name: step.name }; }
      if (step.action === "clickExactText") {
        text("text");
        if (/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.text)) throw new Error("点击步骤只能使用安全文本，禁止提交、保存、删除、支付、确认等动作。");
        return { action: step.action, text: step.text };
      }
      if (step.action === "assertText" || step.action === "assertVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === "assertNotVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === "assertExactVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === "assertRoleVisible") { text("name"); if (!["button", "radio", "checkbox", "tab", "link"].includes(step.role)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role 无效。`); return { action: step.action, role: step.role, name: step.name }; }
      if (step.action === "assertValue") { text("label"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, value: step.value, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "assertValueByPlaceholder") { text("placeholder"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "assertDisabled") { text("label"); return { action: step.action, label: step.label }; }
      if (step.action === "assertFieldInvalid") { text("label"); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "captureCurrentUrl" || step.action === "assertCurrentUrlUnchanged") return { action: step.action };
      if (step.action === "assertRoleDisabled") { text("name"); if (!(["button", "radio", "checkbox", "tab", "link"].includes(step.role))) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role 无效。`); return { action: step.action, role: step.role, name: step.name }; }
      if (step.action === "assertMaxLengthOrMessage") { text("label"); text("message", 120); if (!Number.isInteger(step.maxLength) || step.maxLength < 1 || step.maxLength > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 maxLength 无效。`); return { action: step.action, label: step.label, maxLength: step.maxLength, message: step.message }; }
      if (step.action === "startFetchOrXhrCapture") return { action: step.action };
      if (step.action === "assertNoFetchOrXhr") { if (step.quietMs !== undefined && (!Number.isInteger(step.quietMs) || step.quietMs < 250 || step.quietMs > 5000)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 quietMs 必须在 250–5000 毫秒之间。`); return { action: step.action, ...(step.quietMs === undefined ? {} : { quietMs: step.quietMs }) }; }
      if (step.action === "assertNoHorizontalOverflow") return { action: step.action };
      if (step.action === "setViewport") { if (!Number.isInteger(step.width) || !Number.isInteger(step.height) || step.width < 320 || step.width > 1920 || step.height < 480 || step.height > 1600) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 viewport 超出允许范围。`); return { action: step.action, width: step.width, height: step.height }; }
      if (step.action === "scrollToRatio") { if (typeof step.ratio !== "number" || !Number.isFinite(step.ratio) || step.ratio < 0 || step.ratio > 1) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步滚动比例必须在 0–1 之间。`); return { action: step.action, ratio: step.ratio }; }
      if (step.action === "setReducedMotion") { if (typeof step.value !== "boolean") throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 reducedMotion 必须是布尔值。`); return { action: step.action, value: step.value }; }
      throw new Error(`不支持的浏览器动作：${step.action}`);
    });
    const networkAssertionIndex = steps.findIndex(step => step.action === "assertNoFetchOrXhr");
    if (networkAssertionIndex >= 0) {
      const captureIndex = steps.findIndex(step => step.action === "startFetchOrXhrCapture");
      const firstInteractionIndex = steps.findIndex(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "blurByPlaceholder", "selectByLabel", "selectByPlaceholder", "selectByRoleIndex", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
      const hasLaterInteraction = steps.slice(networkAssertionIndex + 1).some(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "blurByPlaceholder", "selectByLabel", "selectByPlaceholder", "selectByRoleIndex", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
      if (captureIndex < 0 || firstInteractionIndex >= 0 && captureIndex > firstInteractionIndex) throw new Error(`第 ${i + 1} 条用例必须在首个用户操作前启动 fetch/XHR 捕获。`);
      if (hasLaterInteraction) throw new Error(`第 ${i + 1} 条用例的 fetch/XHR 断言必须放在最后一个用户操作之后。`);
    }
    const stringList = (key: string, fallback: string[], maxItems = 10): string[] => {
      const raw = item[key] === undefined ? fallback : item[key];
      if (!Array.isArray(raw) || raw.length > maxItems || raw.some(value => typeof value !== "string" || value.length > 500)) throw new Error(`第 ${i + 1} 条用例 ${key} 必须是最多 ${maxItems} 条、每条不超过 500 字的字符串数组。`);
      return raw.map(value => value.trim()).filter(Boolean);
    };
    const priority = item.priority === undefined ? "P2" : item.priority;
    if (!["P0", "P1", "P2", "P3"].includes(priority)) throw new Error(`第 ${i + 1} 条用例 priority 必须是 P0–P3。`);
    const category = item.category === undefined ? inferCaseCategory(`${item.title} ${item.source}`) : item.category;
    if (!caseCategories.includes(category)) throw new Error(`第 ${i + 1} 条用例 category 无效。`);
    const confidence = item.confidence === undefined ? confidenceFromExpectation(item.expected) : item.confidence;
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") throw new Error(`第 ${i + 1} 条用例 confidence 必须是 high、medium 或 low。`);
    const suppliedCoverageAreas = stringList("coverageAreas", [category], caseCategories.length);
    if (suppliedCoverageAreas.some((area): area is string => !caseCategories.includes(area as CaseCategory))) throw new Error(`第 ${i + 1} 条用例 coverageAreas 包含未知分类。`);
    const coverageAreas = [...new Set<CaseCategory>([category, ...suppliedCoverageAreas as CaseCategory[]])];
    const rawModulePath = item.modulePath === undefined ? [] : item.modulePath;
    if (!Array.isArray(rawModulePath) || rawModulePath.length > 8 || rawModulePath.some(value => typeof value !== "string" || !value.trim() || value.trim().length > 120)) throw new Error(`第 ${i + 1} 条用例 modulePath 必须是最多 8 层、每层 1–120 字的业务模块路径。`);
    const modulePath = rawModulePath.map((value: string) => value.trim());
    const rawTags = item.tags === undefined ? [] : item.tags;
    if (!Array.isArray(rawTags) || rawTags.length > 20 || rawTags.some(value => typeof value !== "string" || value.trim().length > 40)) throw new Error(`第 ${i + 1} 条用例 tags 必须是最多 20 项、每项 1–40 字的字符串数组。`);
    const tags = [...new Set<string>(rawTags.map((value: string) => value.trim()).filter(Boolean))];
    const entryPath = normalizeDocumentCaseEntryPath(item.entryPath);
    if (item.selectedForRegression !== undefined && typeof item.selectedForRegression !== "boolean") throw new Error(`第 ${i + 1} 条用例 selectedForRegression 必须为布尔值。`);
    const lifecycleStatus = item.lifecycleStatus;
    if (lifecycleStatus !== undefined && !["draft", "runnable", "disabled"].includes(lifecycleStatus)) throw new Error(`第 ${i + 1} 条用例 lifecycleStatus 必须是 draft、runnable 或 disabled。`);
    if (lifecycleStatus !== undefined && lifecycleStatus !== "runnable" && item.selectedForRegression === true) throw new Error(`第 ${i + 1} 条用例处于草稿或停用状态，不能同时纳入本轮回归。`);
    const sideEffectRisk = item.sideEffectRisk === undefined ? "unknown" : item.sideEffectRisk;
    if (!["none", "reversible", "irreversible", "unknown"].includes(sideEffectRisk)) throw new Error(`第 ${i + 1} 条用例 sideEffectRisk 无效。`);
    if (item.preconditionsConfirmed !== undefined && typeof item.preconditionsConfirmed !== "boolean") throw new Error(`第 ${i + 1} 条用例 preconditionsConfirmed 必须为布尔值。`);
    const cleanup = item.cleanup === undefined ? "" : item.cleanup;
    if (typeof cleanup !== "string" || cleanup.length > 1000) throw new Error(`第 ${i + 1} 条用例 cleanup 必须是不超过 1000 字的字符串。`);
    const caseOrigin = item.caseOrigin;
    if (caseOrigin !== undefined && !["held-out-benchmark", "ai-generated", "document-derived", "manual", "iteration-impact-draft"].includes(caseOrigin)) throw new Error(`第 ${i + 1} 条用例 caseOrigin 无效。`);
    const caseGenerationTrace = item.caseGenerationTrace === undefined ? undefined : validateCaseGenerationTrace(item.caseGenerationTrace);
    if (item.coverageGap !== undefined && (typeof item.coverageGap !== "string" || item.coverageGap.length > 1000)) throw new Error(`第 ${i + 1} 条用例 coverageGap 必须是不超过 1000 字的字符串。`);
    const caseId = item.id === undefined ? `case-${i + 1}` : item.id;
    if (typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) throw new Error(`第 ${i + 1} 条用例 ID 无效；须为 1–80 位字母、数字、下划线、点、冒号或连字符。`);
    if (seenCaseIds.has(caseId)) throw new Error(`第 ${i + 1} 条用例 ID「${caseId}」重复；每个项目内的用例 ID 必须唯一。`);
    seenCaseIds.add(caseId);
    const validated: BrowserCheck = {
      id: caseId, title: item.title.trim(), source: item.source,
      ...(entryPath ? { entryPath } : {}),
      ...(modulePath.length ? { modulePath } : {}),
      ...(tags.length ? { tags } : {}),
      requirementRefs: stringList("requirementRefs", [item.source]), priority: priority as CasePriority, category: category as CaseCategory, confidence: confidence as CaseConfidence, coverageAreas: coverageAreas as CaseCategory[], ...(lifecycleStatus === undefined ? {} : { lifecycleStatus: lifecycleStatus as CaseLifecycleStatus }), selectedForRegression: lifecycleStatus !== undefined && lifecycleStatus !== "runnable" ? false : item.selectedForRegression !== false,
      preconditions: stringList("preconditions", []), preconditionsConfirmed: item.preconditionsConfirmed === undefined ? !(Array.isArray(item.preconditions) && item.preconditions.length > 0) : item.preconditionsConfirmed === true,
      testData: stringList("testData", []),
      sideEffectRisk: sideEffectRisk as SideEffectRisk, cleanup: cleanup.trim(),
      ...(caseOrigin === undefined ? {} : { caseOrigin: caseOrigin as NonNullable<BrowserCheck["caseOrigin"]> }),
      ...(caseGenerationTrace === undefined ? {} : { caseGenerationTrace: structuredClone(caseGenerationTrace) as CaseGenerationTrace }),
      kind: item.kind, expected: item.expected, steps, ...(typeof item.coverageGap === "string" ? { coverageGap: item.coverageGap } : {}),
    };
    const plan = planCaseExecution(validated);
    validated.executionRoute = plan.route;
    validated.executionReason = plan.reason;
    validated.nextAction = plan.nextAction;
    return validated;
  });
}

/** Read-only current progress for a known run ID, including the full run once terminal. */
export async function getDocumentRunProgress(runId: string): Promise<DocumentRunProgress | undefined> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) return undefined;
  let journal: ExecutionJournal;
  try {
    journal = JSON.parse(await readFile(journalPath(runId), "utf8")) as ExecutionJournal;
    if (journal.version !== 1 || journal.runId !== runId || !Array.isArray(journal.selectedCaseIds)) return undefined;
  } catch { return undefined; }
  const results = journal.caseResults ?? [];
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const run = journal.status === "completed" || journal.status === "cancelled" ? await getDocumentRun(runId) : undefined;
  let workflowStatus: DocumentRunProgress["workflowStatus"];
  let status: DocumentRunProgress["status"] = journal.status;
  let lastError = journal.lastError;
  let exposeRun = Boolean(run);
  if ((journal.status === "completed" || journal.status === "cancelled") && !run) {
    status = "failed";
    lastError = "执行 journal 已标记终态，但最终 run 产物缺失或无效。";
  } else if (run?.workflowId) {
    const workflow = await getDocumentWorkflow(run.workflowId);
    workflowStatus = workflow?.status;
    if (!workflow) {
      status = "failed";
      lastError = `运行已生成，但关联 workflow ${run.workflowId} 不存在或无法校验。`;
      exposeRun = false;
    } else if (workflow.status === "failed") {
      status = "failed";
      lastError = workflow.stages.find(stage => stage.status === "failed")?.error?.message ?? "运行产物已生成，但 workflow 阶段失败。";
      exposeRun = false;
    } else if (workflow.status === "cancelled") {
      status = "cancelled";
      exposeRun = true;
    } else if (workflow.status !== "completed") {
      // The execution journal is written immediately before the server's
      // background finalizer completes the packaging stage and workflow. Do
      // not advertise a terminal run until both durable records agree.
      status = "running";
      exposeRun = false;
    }
  }
  return {
    runId,
    ...(journal.workflowId ? { workflowId: journal.workflowId } : {}),
    status,
    stage: status === "running" && (journal.status === "completed" || journal.status === "cancelled") ? "packaging" : journal.stage,
    ...(workflowStatus ? { workflowStatus } : {}),
    startedAt: journal.startedAt,
    updatedAt: journal.updatedAt,
    resumeCount: journal.resumeCount,
    ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: journal.siteVersionSnapshot } : {}),
    ...(journal.currentCase ? { currentCase: journal.currentCase } : {}),
    ...(journal.stepGeneration ? { stepGeneration: journal.stepGeneration } : {}),
    progress: { completed: results.length, total: journal.selectedCaseIds.length * (journal.runMode === "regression" ? 1 : 2), counts },
    results,
    ...(run && exposeRun ? { run } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

/** Route each source case to the evidence channel it actually needs. This does
 * not manufacture test data or claim undocumented backend assertions ran. */
export function planCaseExecution(item: Pick<BrowserCheck, "title" | "source" | "expected" | "steps" | "coverageGap" | "confidence">): { route: ExecutionRoute; reason: string; nextAction: string } {
  // XMind ancestors carry scope and precondition notes, but they also contain
  // parent-level implementation details (e.g. “call customer API”) that must
  // not turn a leaf assertion such as “matching customer is displayed” into
  // an API-only case. Only inherit explicit release scope from the path; route
  // the verification channel from the leaf's own title/expected result.
  const leafText = `${item.title} ${item.expected} ${item.coverageGap ?? ""}`;
  const text = leafText;
  const sourcePath = item.source ?? "";
  if (/^\[需澄清\]|待澄清|需澄清|尚未明确/u.test(text)) return { route: "clarification", reason: "验收范围或通过条件尚未定稿。", nextAction: "由产品负责人确认规则，然后拆成可判定的接受/拒绝用例。" };
  if (/(?:没有指定字段|未指定字段|未明确(?:具体)?(?:字段|格式|非法值|触发时机)|需产品确认.{0,30}(?:字段|格式|非法值))/u.test(text)) return { route: "clarification", reason: "来源缺少可复现的字段、非法值或触发条件，当前不能写出可靠输入脚本。", nextAction: "补充字段名、非法合成值、触发方式和可观察结果；若触发需要提交，则提供隔离沙箱与回滚方案。" };
  if (/(?:旧|原).{0,60}入口.{0,36}(?:下线|跳转|重定向)/u.test(text) && !/(?:https?:\/\/|(?:旧|新).{0,16}(?:URL|地址|路由)\s*[=:：]\s*\S+)/iu.test(text)) return { route: "clarification", reason: "旧入口下线/跳转缺少旧地址、新地址及可判定条件，当前页面无法证明入口迁移结果。", nextAction: "补充旧系统 URL、新系统 URL 和预期跳转/下线行为；确认后再加入 URL 断言和允许的导航范围。" };
  if (/本期不做|本期不展示\/不可选|待后续需求|明确不纳入/u.test(`${text} ${sourcePath}`)) return { route: "out-of-scope", reason: "来源将此项标记为本期范围外。", nextAction: "保留在需求追踪中；确认版本范围后标记 N/A，不计为通过。" };
  if (/(?:源代码|源码|OAuth|token.{0,12}(?:存储|明文)|localStorage|静态扫描|依赖漏洞|安全审查)/iu.test(text)) return { route: "source-review", reason: "验收需要读取源码、构建产物或安全扫描证据，页面操作无法证明。", nextAction: "关联目标仓库/构建产物和安全规则，在源码审查通道执行并附扫描结果。" };
  if (/(?:后端|服务端|数据库|事务|回调|并发|接口契约|契约|接口字段|接口返回|接口异常|落库|库存扣减|锁仓|推送至|审批流|企微审批|旺店通|易诚通|接口调用次数|请求次数|数据一致性|幂等|消息队列|企微消息)/iu.test(text)) return { route: "api-contract", reason: "验收点涉及服务端、集成或持久化结果；目前没有该目标的 API 契约/隔离环境证据。", nextAction: "提供 OpenAPI/接口契约、隔离测试环境和读回方式后，生成并运行 API/契约用例；有独立可见子断言时保留 UI 部分检查。" };
  if (/(?:账号切换|越权|串号|非本公司员工|在职员工|企微登录|当前登录人|管理员|无权限|直属上级|发起人本人|非发起人|被代申请人|审批人)/iu.test(text)) return { route: "fixture-or-role", reason: "验收依赖特定账号身份、角色或组织关系，当前登录会话不能代表所需身份。", nextAction: "准备专用测试账号/认证态与预期身份数据；保留当前 Edge 登录态，不自动切换用户。" };
  if (/(?:\b(?:test|business|product|data|state|order|account|book|customer|inventory)\s+fixtures?\b|夹具|测试数据|历史记录|订单记录|库存|状态记录|脱敏订单|申请单|客户记录|物流轨迹|PC管理后台|后台权限|迁移前基线)/iu.test(text)) return { route: "fixture-or-role", reason: "需要指定的业务记录、管理后台权限或状态夹具；当前 H5 页面没有证据证明该数据存在。", nextAction: "在隔离环境准备专用权限和可重复的合成 fixture，记录基线、创建与清理方式；后台功能需关联正确的管理端目标。" };
  if (item.steps?.length) return { route: "browser-ui", reason: "已有浏览器步骤；执行前仍会校验只读安全和预期覆盖。", nextAction: "运行脚本与 Computer Use，并核对每条验收点的证据。" };
  if (/(?:页面|文案|显示|展示|提示|按钮|字段|输入框|边框|置灰|禁用|布局|移动端|响应式|可见|隐藏|不回显|可选|空状态|列表|分页)/u.test(text)) return { route: "browser-ui", reason: "这是可观察的页面验收点，但当前没有可靠定位步骤。", nextAction: "依据当前已登录页面的 DOM/可访问性证据补控件定位与断言；定位不唯一时记录精确控件名，不猜 selector。" };
  return { route: "manual-analysis", reason: "来源没有提供足够明确的界面行为、数据或可判定预期，无法安全推导自动操作。", nextAction: "从需求原文补充前置条件、操作、预期结果和验证通道，再生成脚本。" };
}

/** Do not turn an absent record/state assertion into a product failure when
 * the case is routed to a fixture/API/role lane and its browser plan contains
 * no action that could establish the required state. */
export function nonBrowserCaseWithoutStimulus(item: Pick<BrowserCheck, "title" | "source" | "expected" | "steps" | "coverageGap" | "confidence">): { route: ExecutionRoute; reason: string; nextAction: string } | undefined {
  const plan = planCaseExecution(item);
  if (!["api-contract", "fixture-or-role", "clarification", "source-review", "manual-analysis"].includes(plan.route)) return undefined;
  const stimulus = (item.steps ?? []).some(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "selectByLabel", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
  return stimulus ? undefined : plan;
}

/** Auto-start the safe executable subset while preserving unresolved selected cases for reporting. */
export function hasAutoRunnableSelectedCase(cases: BrowserCheck[]): boolean {
  return cases.some(item => item.selectedForRegression && isSafeReadOnlyBrowserCase(item));
}

/** Ask the model only for explicitly observable, read-only UI outcomes.
 * Backend facts and fixture-dependent business state must not be guessed from
 * whatever happens to be visible on the current page. */
export function canAuthorReadOnlyBrowserSteps(item: BrowserCheck): boolean {
  const text = `${item.title} ${item.expected}`;
  const trace = `${text} ${item.source}`;
  const hasObservableUiCheck = isExplicitlyObservableUiCheck(text);
  const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
  const unresolvedFixtureGap = /依赖\/范围：(?:api_data_or_business_fixture_prerequisite|clarification-required)|(?:需要|需).{0,32}(?:fixture|测试夹具|测试账号|历史记录|隔离环境|接口契约|预期数据|角色账号)/iu.test(item.coverageGap ?? "");
  // Risk metadata often describes the surrounding business flow rather than
  // the proposed test action (e.g. checking that a delete control is present).
  // Drafting remains read-only and the canonical DSL rejects consequential
  // clicks. Do not let the generic importer precondition suppress step design.
  return item.confidence !== "low"
    && !/^\[需澄清\]|待澄清|需澄清|本期不做|本期不展示\/不可选/u.test(text)
    // An API/backend case may still contain a directly observable UI subcheck.
    // Permit authoring that bounded assertion, while coverageGap keeps the
    // full case unresolved after execution; never promote a partial check to pass.
    && (!/(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|账号切换|越权|串号|孤儿审批|幂等|非本公司员工|在职员工|企微登录|企微架构|当前登录人|身份校验|角色权限|管理员访问|无权限)/iu.test(text) || networkNoCall || hasObservableUiCheck)
    && !/(?:提交成功|提交后|成功提交|点击提交|保存成功|审批通过后|锁单成功|推送至|扣减库存|创建订单|出库单创建|发送通知|写入数据库|删除记录)/iu.test(text)
    && isExplicitlyObservableUiCheck(text)
    // Keep generating the independently verifiable UI portion even when the
    // full end-to-end expectation needs a fixture. The remaining fixture gap
    // stays attached to the case and prevents it from being reported as a
    // complete pass; it must not suppress safe browser evidence altogether.
    && (!unresolvedFixtureGap || networkNoCall || isExplicitlyObservableUiCheck(text))
    // A case may depend on a product record for its full end-to-end claim while
    // still supporting a useful, clearly scoped visible assertion. Author that
    // partial UI check and preserve the rest of the expectation as a named gap.
    && (!hasFixtureOrIntegrationDependency(trace) || networkNoCall || hasObservableUiCheck);
}

/**
 * Build a zero-action UI check when the requirement explicitly quotes static
 * page copy. This is a safe deterministic fallback for model-generated step
 * drafts: it never invents a locator, trigger, account, or business rule.
 */
export function draftGroundedReadOnlyBrowserSteps(item: Pick<BrowserCheck, "title" | "expected">): BrowserStep[] | undefined {
  const text = `${item.title} ${item.expected}`;
  if (!/(?:页面提示文案|页面文案|静态提示文案|页面固定提示)/u.test(text)) return undefined;
  const match = text.match(/(?:页面提示文案|页面文案|静态提示文案|页面固定提示)(?:为|是|[:：]?\s*)[「“"]([^「」“”"]{2,160})[」”"]/u);
  if (!match?.[1]?.trim()) return undefined;
  return [{ action: "assertExactVisible", text: match[1].trim() }];
}

/** Turn previously observed empty-list navigation into a reusable, read-only
 * partial script. These checks prove only that the relevant pages/filters and
 * empty-state copy render; they do not prove filtering, record fields or paging
 * without populated fixtures, so the case remains blocked after subchecks pass. */
export function deriveGroundedEmptyListNavigationSubcheck(item: BrowserCheck): boolean {
  if (item.steps.length || item.sideEffectRisk === "irreversible") return false;
  const text = `${item.title} ${item.expected}`;
  const historicalEmpty = /(?:无符合条件记录|暂无申请记录|申请列表.{0,12}空状态|按用途筛选.{0,20}生效)/u.test(text)
    && /(?:筛选|空状态|无符合条件记录)/u.test(text);
  if (historicalEmpty && /(?:营销用书|待审批|状态)/u.test(item.source + text)) {
    item.steps = [
      { action: "clickExactText", text: "历史申请记录" },
      { action: "clickExactText", text: "营销用书" },
      { action: "clickExactText", text: "待审批" },
      { action: "assertExactVisible", text: "暂无申请记录" },
    ];
    item.coverageGap = "部分脚本只确认历史申请页的用途/状态筛选可操作且出现空状态；默认列表也为空，没有正向记录对照，不能证明筛选正确。需预置隔离申请数据后才能完成整项。";
    item.sideEffectRisk = "none";
    item.preconditionsConfirmed = true;
    item.cleanup = "仅导航并切换只读筛选；不创建、提交或修改申请记录。";
    return true;
  }
  const pagingEmpty = /(?:支持分页|分页.{0,12}20|实时加载|平滑切换)/u.test(text)
    && /(?:超过\s*20|至少超过20|没有记录|当前没有记录|当前列表为空)/u.test(item.coverageGap ?? "");
  if (pagingEmpty) {
    item.steps = [
      { action: "clickExactText", text: "历史申请记录" },
      { action: "assertExactVisible", text: "暂无申请记录" },
      { action: "clickExactText", text: "订单物流" },
      { action: "assertExactVisible", text: "暂无订单物流记录" },
    ];
    item.coverageGap = "部分脚本只确认可导航到历史申请/订单物流页并呈现空状态；缺少超过20条历史申请记录，未验证实时加载或每页20条分页。需预置隔离数据后才能完成整项。";
    item.sideEffectRisk = "none";
    item.preconditionsConfirmed = true;
    item.cleanup = "仅在员工端导航两个只读列表页；不创建、提交或修改业务记录。";
    return true;
  }
  return false;
}

/** Author observable, read-only customer-search subchecks from the reviewed
 * case text. These scripts deliberately retain an exact fixture/freshness gap:
 * rendering an empty state or one live result cannot prove the backend's full
 * category filter or cache semantics. */
export function deriveGroundedCustomerLookupSubcheck(item: BrowserCheck): boolean {
  if (item.steps.length || item.sideEffectRisk === "irreversible") return false;
  const text = `${item.title} ${item.expected} ${item.source}`;
  if (/1004\.00/u.test(text) && /外部客户/u.test(text) && /合作客户/u.test(text)) {
    item.steps = [
      { action: "clickExactText", text: "本人申领" },
      { action: "fillByRoleIndex", role: "combobox", index: 1, value: "1004.00" },
      { action: "assertExactVisible", text: "无数据" },
    ];
    item.coverageGap = "当前员工会话查询 1004.00 后显示“无数据”；该只读子检查只记录目标环境缺少外部客户夹具，不能证明分类过滤正确或将缺记录判为产品缺陷。需提供可重复的 1004.00 合成客户及获准隔离环境后重测完整验收点。";
    item.testData = [...new Set([...(item.testData ?? []), "只读查询关键词：1004.00"])];
    item.preconditions = ["复用本项目已登录的员工 H5 会话；只执行客户检索，不提交申请。"];
    item.preconditionsConfirmed = true;
    item.sideEffectRisk = "none";
    item.cleanup = "只读搜索；不选择客户、不提交或保存。";
    return true;
  }
  if (/客户列表为最新数据/u.test(text) || /客户数据实时性/u.test(item.source)) {
    item.steps = [
      { action: "clickExactText", text: "本人申领" },
      { action: "fillByRoleIndex", role: "combobox", index: 1, value: "内部客户" },
      { action: "assertVisible", text: "内部客户部" },
    ];
    item.coverageGap = "脚本只确认当前员工会话可查询并显示客户建议项，不比对权威客户清单、更新时间或缓存旧值；需提供可控客户记录、缓存基线与 API/版本证据才能验证“最新数据”。";
    item.testData = [...new Set([...(item.testData ?? []), "只读查询关键词：内部客户"])];
    item.preconditions = ["复用本项目已登录的员工 H5 会话；只执行客户检索，不提交申请。"];
    item.preconditionsConfirmed = true;
    item.sideEffectRisk = "none";
    item.cleanup = "只读搜索；不选择客户、不提交或保存。";
    return true;
  }
  return false;
}

/** Serialize read-only authoring observations and test execution on the one project page. */
export function acquireDocumentPageLease(projectId: string): (() => void) | undefined {
  if (activeBrowserRuns.has(projectId) || activeDocumentPageLeases.has(projectId)) return undefined;
  activeDocumentPageLeases.add(projectId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDocumentPageLeases.delete(projectId);
  };
}

/** Add deterministic fetch/XHR evidence to an existing, reviewed no-API UI flow.
 * This repairs an executable gap without asking a model to invent locators. The
 * remaining coverage note keeps the broad “no API” claim from being reported as
 * fully proven by a fetch/XHR-only observation. */
export function addNoApiNetworkAssertion(item: BrowserCheck): boolean {
  const text = `${item.title} ${item.expected}`;
  const noApiExpectation = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用)/iu.test(text);
  const steps = item.steps ?? [];
  if (!noApiExpectation || !steps.length || steps.some(step => step.action === "assertNoFetchOrXhr")) return false;
  const firstInteraction = steps.findIndex(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "selectByLabel", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
  if (firstInteraction < 0 || steps.length + 2 > 30) return false;
  const repaired = [...steps];
  repaired.splice(firstInteraction, 0, { action: "startFetchOrXhrCapture" });
  repaired.push({ action: "assertNoFetchOrXhr" });
  item.steps = repaired;
  // Replace stale importer text such as “DSL cannot verify no API call”; that
  // statement becomes false once the bounded fetch/XHR observer is inserted.
  // Preserve unrelated, still-valid coverage gaps and keep the new boundary exact.
  const networkBoundary = "仅验证操作后的限定观察窗内未出现 fetch/XHR；视觉通道无法验证网络缺失，sendBeacon/WebSocket/表单导航及服务端遥测未覆盖。";
  const priorGap = (item.coverageGap ?? "").split(/[；;]+/u)
    .map(value => value.trim())
    .filter(value => value && !/(?:DSL|浏览器步骤|BrowserStep).{0,16}(?:无法|不能|未能).{0,16}(?:证明|断言|验证).{0,12}(?:接口|请求|API)|(?:接口|请求|API).{0,16}(?:需要|须).{0,16}(?:请求拦截|network interception)/iu.test(value));
  item.coverageGap = [...priorGap, networkBoundary].join("；");
  return true;
}

/** Derive one safe, concrete invalid-input subcheck from another reviewed case
 * in the same imported suite. This gives broad validation cases executable
 * evidence without pretending a single example proves every validation rule. */
export function deriveRelatedInvalidInputSubcheck(item: BrowserCheck, suite: BrowserCheck[]): boolean {
  const text = `${item.title} ${item.expected}`;
  const steps = item.steps ?? [];
  const completeEvidencePlan = steps.some(step => step.action === "captureCurrentUrl")
    && steps.some(step => step.action === "assertCurrentUrlUnchanged")
    && steps.some(step => step.action === "blurByLabel" && step.label === "手机号码")
    && steps.some(step => step.action === "assertFieldInvalid" && step.label === "手机号码");
  const legacySubmitPlan = steps.some(step => step.action === "triggerClientValidation" && /提交申请/u.test(step.name));
  const staleMessagePlan = steps.length === 4
    && steps[0]?.action === "captureCurrentUrl"
    && steps[1]?.action === "fillByLabel" && steps[1].label === "手机号码"
    && steps[2]?.action === "assertText" && /(?:手机号|手机).{0,8}(?:格式错误|错误)/u.test(steps[2].text)
    && steps[3]?.action === "assertCurrentUrlUnchanged";
  const safePartialPlan = steps.length === 3
    && steps[0]?.action === "fillByLabel" && steps[0].label === "手机号码"
    && steps[1]?.action === "blurByLabel" && steps[1].label === "手机号码"
    && steps[2]?.action === "assertFieldInvalid" && steps[2].label === "手机号码";
  // Keep the case's authored expectation (red invalid field + no navigation),
  // not a neighboring case's stale message string. The old submit-triggered
  // draft is unsafe/unrunnable with other required fields empty; an intermediate
  // draft also incorrectly asserted a message that the target does not show.
  if (!/(?:存在漏填|格式校验失败|字段.{0,8}标红).{0,24}(?:不跳转|输入框|字段)|(?:不跳转).{0,24}(?:漏填|格式校验失败)/u.test(text)
    || completeEvidencePlan || steps.length > 0 && !legacySubmitPlan && !staleMessagePlan && !safePartialPlan) return false;
  const sibling = suite.find(candidate => {
    const siblingText = `${candidate.title} ${candidate.expected}`;
    return candidate.id !== item.id && /手机号/u.test(siblingText)
      && /(?:格式错误|格式校验|非\d+位|非法)/u.test(siblingText)
      && candidate.steps.some(step => step.action === "fillByLabel" && step.label === "手机号码");
  });
  if (!sibling) return false;
  const concrete = sibling.steps.filter(step => step.action === "fillByLabel");
  if (!concrete.length || concrete.some(step => step.action === "fillByLabel" && step.label !== "手机号码")) return false;
  // Reuse only the sibling's concrete synthetic invalid value. Blur before
  // asserting red/invalid state so focus styling cannot masquerade as
  // validation. Never click submit: other required fields may keep it disabled.
  item.steps = [{ action: "captureCurrentUrl" }, ...concrete, { action: "blurByLabel", label: "手机号码" }, { action: "assertFieldInvalid", label: "手机号码" }, { action: "assertCurrentUrlUnchanged" }];
  item.sideEffectRisk = "none";
  item.preconditionsConfirmed = true;
  item.cleanup = "只输入同一套件已记录的合成非法手机号；离开输入框后检查无效样式，不点击提交、不创建数据。";
  item.coverageGap = "从同一套件的手机号非法输入用例派生子场景：离开手机号输入框后检查红框/无效状态并确认页面未跳转；不点击提交。只覆盖一种格式规则，未验证其他必填/格式规则或服务端校验，整项仍为部分覆盖。";
  item.executionRoute = "browser-ui";
  item.executionReason = "复用同一套件的合成非法手机号；离焦后断言字段无效，不点击提交。";
  item.nextAction = "完成后补充其他具体格式规则，避免把一个手机号示例扩大解释为全部表单校验。";
  return true;
}

/** Derive a required-field UI subcheck only when the source breadcrumb names
 * the exact field and the leaf explicitly requires an empty-field error state.
 * Keep the full case unresolved when it includes submit/server expectations. */
export function deriveGroundedEmptyRequiredFieldSubcheck(item: BrowserCheck): boolean {
  const text = `${item.title} ${item.expected}`;
  const groundedField = item.source.match(/(?:填写|录入)(收件人|收件地址|手机号码)(?: ›| ›|$)/u)?.[1];
  if (!groundedField || !/(?:为空|未填写).{0,12}(?:字段标红|输入框标红|标红).{0,8}(?:必填|提示)|(?:必填).{0,12}(?:为空|未填写).{0,12}(?:标红|红色)/u.test(text)) return false;
  const steps = item.steps ?? [];
  const alreadyGrounded = steps.length === 4
    && steps[0]?.action === "fillByLabel" && steps[0].label === groundedField && steps[0].value === ""
    && steps[1]?.action === "blurByLabel" && steps[1].label === groundedField
    && steps[2]?.action === "assertFieldInvalid" && steps[2].label === groundedField
    && steps[3]?.action === "assertCurrentUrlUnchanged";
  if (alreadyGrounded || steps.length > 0 && !steps.some(step => step.action === "triggerClientValidation")) return false;
  item.steps = [
    { action: "captureCurrentUrl" },
    { action: "fillByLabel", label: groundedField, value: "" },
    { action: "blurByLabel", label: groundedField },
    { action: "assertFieldInvalid", label: groundedField },
    { action: "assertCurrentUrlUnchanged" },
  ];
  item.sideEffectRisk = "none";
  item.preconditionsConfirmed = true;
  item.cleanup = `仅将「${groundedField}」置空并失焦检查字段状态；不点击提交、不创建记录。`;
  item.coverageGap = `仅检查来源明确指向的「${groundedField}」空值在失焦后的无效样式及页面未跳转；不提交、不证明其他必填项、提示文案或服务端校验，完整用例仍需保留其余覆盖。`;
  return true;
}

function isExplicitlyObservableUiCheck(text: string): boolean {
  const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
  const visibleUi = /(?:正常展示可选|页面提示文案|页面文案|静态提示文案|边框变红|输入框标红|字段.{0,12}(?:标红|红色|无效)|(?:红色|变红|无效).{0,12}(?:字段|输入框|边框)|(?:field|input).{0,16}(?:red|invalid|error)|(?:red|invalid|error).{0,16}(?:field|input)|显示.{0,18}(?:提示|文案|标题|入口|按钮)|提示.{0,12}[「“"]|每行提供.{0,12}按钮|无其他可选|不提供.{0,6}选择|保持禁用|提交按钮置灰|按钮置灰|按钮可点击|提交按钮可点击|不点亮|页面纯只读|无编辑\/提交\/删除入口|响应式布局|移动端.{0,8}适配|前端应清空|数量.{0,12}(?:上限|拦截)|录入.{0,24}(?:合法|拦截)|本期不展示\/不可选|(?:可见|显示|展示|正常展示).{0,20}(?:标题|按钮|入口|字段|申请记录|订单|客户|可选|可选择)|(?:可选|可选择).{0,16}(?:客户|分类|条目|选项)|(?:可选|可选择)(?:$|[：:，,。；;\s])|(?:不展示|不显示).{0,24}(?:选项|客户|订单|记录|结果)|(?:无符合条件记录|空状态|暂无(?:申请|订单|客户)记录)|筛选.{0,12}(?:生效|结果|切换)|(?:默认展示|支持分页|分页.{0,12}20|平滑切换|实时加载|一键复制|复制按钮|列表为最新数据)|可填入.{0,12}(?:并|后)|(?:保留|回显).{0,12}(?:该值|输入|字段)|仅提供|固定为)/iu.test(text);
  return networkNoCall || visibleUi;
}

function hasFixtureOrIntegrationDependency(text: string): boolean {
  return /(?:客户|订单|库存|仓库|锁单|缺货|审批|物流轨迹|历史记录|迁移|接口|易诚通|旺店通|易查单|回调|并发|配置|店铺ID|管理员|角色|企微|企微登录|深链|未登录|申请人|申请单|receiverPhone|bookUsage|定价|价格|小计|总价|总计|总重|重量|72小时|10分钟|筛选|搜索|图书|书目|样书|出库|赠送|费用|漏填|格式校验失败|不跳转|toast|错误原因|直连API|登录后回跳)/iu.test(text);
}

const genericEnvironmentPrecondition = /需要目标系统专用测试环境和\/或测试账号、接口 mock\/沙箱数据/u;
export function actionablePreconditions(item: BrowserCheck): string[] {
  return (item.preconditions ?? []).filter(value => !genericEnvironmentPrecondition.test(value));
}

/** Read-only browser safety is determined by the actual bounded DSL actions,
 * not by keywords/risk attached to the surrounding end-to-end business flow. */
export function isSafeReadOnlyBrowserCase(item: BrowserCheck): boolean {
  const text = `${item.title} ${item.expected}`;
  const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
  // Route by what the assertion must prove, not by every noun in a source-derived
  // title. A visible invalid-code message may be caused by an API lookup, but the
  // browser can still verify that visible behavior without claiming API correctness.
  const identityExpectation = /(?:账号切换|越权|串号|非本公司员工|在职员工|企微架构|管理员|角色=|角色为|未登录|发起人本人|非发起人|被代申请人|直属上级|申请人本人)/iu.test(text);
  const backendExpectation = /(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|幂等|物流轨迹|接口调用次数|请求次数|数据库字段|字段落库|数据一致性)/iu.test(text);
  // Confidence controls whether the agent may invent a draft from weak source
  // evidence. It does not make an already authored and reviewed read-only
  // script unsafe to execute. Keep the clarification and prerequisite gates
  // below; the project approval gate is enforced by the run entry point.
  if (!item.steps?.length || identityExpectation || backendExpectation && !item.coverageGap && !networkNoCall || /^\[需澄清\]|待澄清|需澄清/u.test(text) || (actionablePreconditions(item).length > 0 && item.preconditionsConfirmed !== true)) return false;
  return item.steps.every(step => {
    if (step.action === "clickByRole") return !/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.name);
    if (step.action === "triggerClientValidation") return true; // dedicated action blocks every request during the client validation click
    if (step.action === "clickExactText") return !/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.text);
    return true;
  });
}

/** Return a case-specific reason when a browser step cannot be safely drafted. */
export function browserStepDraftBlockReason(item: BrowserCheck): string | undefined {
  const text = `${item.title} ${item.expected}`;
  const trace = `${text} ${item.source}`;
  const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
  if (/本期不做|本期不展示\/不可选|待后续需求/u.test(text)) return "该项在原需求中标为本期不做/范围外；保留在 156 条清单中并标记 N/A，不应生成失败用例。";
  if (/^\[需澄清\]|待澄清|需澄清/u.test(text) || item.confidence === "low") return "验收预期待澄清；需要产品确认具体规则和通过条件。";
  if (!networkNoCall && /依赖\/范围：(?:api_data_or_business_fixture_prerequisite|clarification-required)/u.test(item.coverageGap ?? "")) return `项目已标记此项依赖外部夹具或范围澄清：${item.coverageGap}`;
  if (!networkNoCall && /(?:需要|需).{0,32}(?:fixture|测试夹具|测试账号|历史记录|隔离环境|接口契约|预期数据|角色账号)/iu.test(item.coverageGap ?? "")) return `缺少可重复的测试数据或环境：${item.coverageGap}`;
  if (!networkNoCall && /(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|幂等|接口调用次数|请求次数|字段落库|数据库字段)/iu.test(text)) return "验收点依赖 API/服务端/数据库证据；需要真实接口契约、隔离测试环境及对应日志或数据读回。";
  if (/(?:账号切换|越权|串号|管理员|其他角色|无权限|非本公司员工|在职员工|企微架构|角色=|角色为|发起人本人|非发起人|被代申请人|直属上级|申请人本人)/iu.test(text)) return "验收点依赖指定身份/角色；需要可复用的测试账号或认证态切换能力。";
  // Source breadcrumbs often mention an API or a business object even when the
  // expected result is a safe visible field/message assertion. Do not let that
  // metadata suppress authoring; only the expected observable decides the lane.
  const directUiExpectation = networkNoCall || /(?:显示|提示|文案|边框变红|标红|不回显|不显示|置红|禁用|不可用|置灰|可见|不可见|接受.{0,10}输入|保留该值|回显|仅提供|仅支持|字段.{0,8}为空)/u.test(item.expected);
  if (hasFixtureOrIntegrationDependency(trace) && !directUiExpectation) return "用例上下文涉及特定业务记录、角色或集成数据；需要可复用的测试夹具和明确的预期数据，不能用当前页面的外壳断言代替。";
  if (isExplicitlyObservableUiCheck(text)) return "用例属于可观察 UI 检查；生成器暂未能安全推导出控件/字段定位，需补页面入口或准确标签。";
  if (/(?:历史|订单|申请记录|详情页|物流|库存|客户|图书编码|书目|客户列表|发货)/iu.test(text)) return "验收点依赖特定历史记录或业务数据；需要提供可重复的测试夹具及其预期值。";
  if (/(?:提交成功|提交后|成功提交|点击提交|保存成功|审批通过后|锁单成功|推送至|扣减库存|创建订单|出库单创建|发送通知|写入数据库|删除记录)/iu.test(text)) return "验收点涉及业务写入或外部副作用；需要隔离沙箱、可回滚夹具和明确的操作授权。";
  return "需求没有可直接从目标页面验证的明确预期；需要补充页面入口、字段/控件和期望状态。";
}

/** Explain why a missing-step case did not produce a runnable browser plan.
 * Keep model-draft failure separate from the concrete prerequisite that makes
 * the full case unresolved. */
export function explainBlockedBrowserStepDraft(item: BrowserCheck): string {
  const blocker = browserStepDraftBlockReason(item);
  return canAuthorReadOnlyBrowserSteps(item)
    ? `未生成可执行的只读断言；${blocker ?? "需要页面证据、测试数据或明确的通过条件。"}`
    : blocker ?? "该用例需要非浏览器证据或未满足的明确前置条件。";
}

/** Detect the common bad draft where a specific business case only asserts the
 * generic page shell (for example, `样书申请` for an ERP/approval requirement). */
export function hasOnlyGenericShellAssertions(item: BrowserCheck): boolean {
  const assertions = item.steps.flatMap(step => {
    if ("text" in step) return [step.text];
    if ("name" in step) return [step.name];
    if ("label" in step) return [step.label];
    return [];
  });
  if (!assertions.length) return false;
  const genericShell = /^(?:部门样书|样书申请|样书用途|首页|我的|申请记录)$/u;
  if (!assertions.every(value => genericShell.test(value.trim()))) return false;
  const expectedSpecific = item.expected.replace(/^(?:\[需澄清\]\s*)/u, "").trim();
  return !assertions.some(value => expectedSpecific.includes(value.trim()) && expectedSpecific.length <= value.trim().length + 12);
}

function safeTarget(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("请提供有效的应用网址。");
  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("网址仅支持 HTTP/HTTPS，且不能包含用户名或密码。");
  return url.toString();
}
export const validateDocumentTarget = safeTarget;

export async function selectDocumentOption(page: Page, label: string, value: string, rowIndex = 0): Promise<void> {
  const accessible = page.getByLabel(label, { exact: false });
  const labeled = accessible.nth(rowIndex);
  if (await labeled.count()) {
    await labeled.selectOption({ label: value }).catch(async () => labeled.selectOption(value));
    return;
  }
  const candidates = await page.locator("select").evaluateAll((elements: Element[], args: { label: string; value: string }) => elements.flatMap((element, index) => {
    if (!(element instanceof HTMLSelectElement)) return [];
    const parentText = [element.closest("label")?.innerText, element.parentElement?.innerText].filter(Boolean).join(" ");
    const hasOption = [...element.options].some(option => option.textContent?.trim() === args.value || option.value === args.value);
    return parentText.includes(args.label) && hasOption ? [index] : [];
  }), { label, value });
  if (rowIndex >= candidates.length) throw new Error(`下拉字段「${label}」只有 ${candidates.length} 个匹配，无法定位第 ${rowIndex + 1} 行。`);
  const select = page.locator("select").nth(candidates[rowIndex]!);
  await select.selectOption({ label: value }).catch(async () => select.selectOption(value));
}

/** Resolve visible form captions used by apps whose markup omits label/aria associations. */
export async function resolveDocumentField(page: Page, label: string, rowIndex = 0) {
  const accessible = page.getByLabel(label, { exact: false });
  if (await accessible.count()) {
    if (rowIndex >= await accessible.count()) throw new Error(`字段「${label}」只有 ${await accessible.count()} 个可见匹配，无法定位第 ${rowIndex + 1} 行。`);
    return accessible.nth(rowIndex);
  }
  const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select';
  const matches = await page.locator(selector).evaluateAll((elements: Element[], args: { wanted: string; selector: string }) => {
    const needle = args.wanted.replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase();
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) || !element.getClientRects().length) return [];
      let parent: Element | null = element;
      for (let depth = 0; depth < 5 && parent; depth++, parent = parent.parentElement) {
        const text = (parent instanceof HTMLElement ? parent.innerText : parent.textContent ?? "").replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase();
        const controls = parent.querySelectorAll(args.selector).length + (parent.matches(args.selector) ? 1 : 0);
        if (text.includes(needle) && controls === 1) return [index];
      }
      return [];
    });
  }, { wanted: label, selector });
  if (matches.length) {
    if (rowIndex >= matches.length) throw new Error(`字段「${label}」只有 ${matches.length} 个可见匹配，无法定位第 ${rowIndex + 1} 行。`);
    return page.locator(selector).nth(matches[rowIndex]!);
  }
  if (!matches.length) {
    const byTableColumn = await page.locator("table").evaluateAll((tables: Element[], args: { wanted: string; selector: string }) => {
      return tables.flatMap(table => {
        const rows = [...table.querySelectorAll("tr")];
        for (const row of rows) {
          const headers = [...row.children];
          const column = headers.findIndex(cell => (cell.textContent ?? "").replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase() === args.wanted.replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase());
          if (column < 0) continue;
          return rows.flatMap(dataRow => {
            const cell = dataRow.children[column];
            if (!cell || row === dataRow) return [];
            const control = cell.querySelector(args.selector);
            if (!control || !control.getClientRects().length) return [];
            const index = [...document.querySelectorAll(args.selector)].indexOf(control);
            return index >= 0 ? [index] : [];
          });
        }
        return [];
      });
    }, { wanted: label, selector });
    if (byTableColumn.length) {
      if (rowIndex >= byTableColumn.length) throw new Error(`表格字段「${label}」只有 ${byTableColumn.length} 行，无法定位第 ${rowIndex + 1} 行。`);
      return page.locator(selector).nth(byTableColumn[rowIndex]!);
    }
  }
  if (!matches.length) throw new Error(`无法定位字段「${label}」；请补充可见字段标签或测试选择器。`);
  // Repeated form rows commonly reuse the same caption; in that case the first visible match is the stable default.
  return page.locator(selector).nth(matches[0]!);
}

/** Check a saved step's current target without performing its action, navigation, or input. */
export async function probeDocumentStep(
  project: DocumentProject,
  caseId: string,
  stepIndex: number,
  targetUrl = project.targetUrl,
): Promise<DocumentStepProbe> {
  const checkedAt = new Date().toISOString();
  const item = project.cases.find(testCase => testCase.id === caseId);
  if (!item) throw new Error("指定用例不属于当前项目。");
  if (project.reviewStatus !== "approved") throw new Error("请先保存并审核当前用例，再试定位已保存步骤。");
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= item.steps.length) throw new Error("步骤序号无效或该用例没有此步骤。");
  const step = item.steps[stepIndex]!;
  const base = { caseId, stepIndex, action: step.action, checkedAt };
  const noLocatorActions = new Set([
    "captureCurrentUrl", "assertCurrentUrlUnchanged", "startFetchOrXhrCapture", "assertNoFetchOrXhr",
    "assertNoHorizontalOverflow", "setViewport", "scrollToRatio", "setReducedMotion",
  ]);
  if (noLocatorActions.has(step.action)) return {
    ...base, status: "not-required", detail: "该步骤不引用页面元素；试定位未执行任何页面操作。",
  };
  const locatorKinds = new Set([
    "fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "blurByPlaceholder",
    "selectByLabel", "selectByPlaceholder", "selectByRoleIndex", "clickByRole", "clickExactText",
    "assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible",
    "assertValue", "assertValueByPlaceholder", "assertDisabled", "assertFieldInvalid",
    "assertRoleDisabled", "assertMaxLengthOrMessage", "triggerClientValidation",
  ]);
  if (!locatorKinds.has(step.action)) return {
    ...base, status: "blocked", detail: "当前动作不支持安全试定位；步骤未执行。",
  };
  if (activeBrowserRuns.has(project.id) || activeDocumentPageLeases.has(project.id)) return {
    ...base, status: "blocked", detail: "项目 Edge 会话正被运行或步骤操作占用；试定位未执行。",
  };
  const release = acquireDocumentPageLease(project.id);
  if (!release) return { ...base, status: "blocked", detail: "项目 Edge 会话正被占用；试定位未执行。" };
  let locatorKind = "页面元素定位";
  try {
    const userDataDir = path.join(baseDir, "browser-profiles", project.id);
    const session = await getExistingPersistentTestPage(userDataDir).catch(() => undefined);
    if (!session || session.page.isClosed()) return {
      ...base, status: "blocked", detail: "未检测到可复用的项目 Edge 会话；试定位没有启动浏览器。",
    };
    const page = session.page;
    if (await isLoginPage(page)) return { ...base, status: "blocked", detail: "当前页面需要人工登录；试定位未执行。" };
    let currentOrigin = "";
    try { currentOrigin = new URL(page.url()).origin; } catch { /* about:blank */ }
    if (!currentOrigin || currentOrigin !== new URL(targetUrl).origin) return {
      ...base, status: "blocked", detail: "当前 Edge 标签页不在本轮目标网站；为避免导航或丢失页面状态，试定位未执行。",
    };

    let locator: import("playwright").Locator;
    locatorKind = "可访问性定位";
    if (["fillByLabel", "blurByLabel", "selectByLabel", "assertValue", "assertDisabled", "assertFieldInvalid", "assertMaxLengthOrMessage"].includes(step.action)) {
      locator = await resolveDocumentField(page, (step as { label: string }).label, (step as { rowIndex?: number }).rowIndex ?? 0);
      locatorKind = "字段标签";
    } else if (["fillByPlaceholder", "blurByPlaceholder", "selectByPlaceholder", "assertValueByPlaceholder"].includes(step.action)) {
      const exact = step.action !== "fillByPlaceholder";
      locator = page.getByPlaceholder((step as { placeholder: string }).placeholder, { exact });
      locatorKind = "字段占位提示";
    } else if (["fillByRoleIndex", "selectByRoleIndex"].includes(step.action)) {
      locator = page.getByRole("combobox").nth((step as { index: number }).index);
      locatorKind = "控件序号";
    } else if (["clickByRole", "assertRoleVisible", "assertRoleDisabled"].includes(step.action)) {
      const roleStep = step as { role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string };
      locator = page.getByRole(roleStep.role, { name: roleStep.name, exact: true });
      locatorKind = "控件类型和名称";
    } else if (step.action === "triggerClientValidation") {
      locator = page.getByRole("button", { name: (step as { name: string }).name, exact: true });
      locatorKind = "验证按钮名称";
    } else {
      const textStep = step as { text: string };
      const exact = ["clickExactText", "assertExactVisible"].includes(step.action);
      locator = page.getByText(textStep.text, { exact });
      locatorKind = exact ? "完全匹配文本" : "页面文本";
    }
    const matchCount = await locator.count();
    const matches = await locator.evaluateAll((elements: Element[]) => elements.slice(0, 10).map(element => ({ visible: element.getClientRects().length > 0, tag: element.tagName.toLowerCase() })));
    const visibleCount = matches.filter(match => match.visible).length;
    const status: DocumentStepProbe["status"] = matchCount === 0 ? "not-found"
      : matchCount !== 1 ? "ambiguous"
        : visibleCount === 0 ? "not-visible" : "found";
    const detail = status === "found" ? `找到唯一可见的 ${matches[0]!.tag} 控件；只检查了定位，没有执行步骤动作。`
      : status === "not-found" ? "当前页面没有匹配控件；只检查了定位，没有执行步骤动作。"
        : status === "not-visible" ? "找到一个匹配控件，但当前不可见；只检查了定位，没有执行步骤动作。"
          : `当前页面有 ${matchCount} 个匹配控件；定位不唯一，步骤未执行。`;
    return { ...base, status, locatorKind, matchCount, visibleCount, elementTypes: [...new Set(matches.map(match => match.tag))], detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const indexedMatches = message.match(/只有\s*(\d+)\s*个(?:可见)?匹配/u);
    if (/无法定位字段|表格字段|字段「.*?」只有\s*\d+\s*个(?:可见)?匹配/u.test(message)) {
      const matchCount = indexedMatches ? Number(indexedMatches[1]) : 0;
      const status = matchCount > 1 ? "ambiguous" as const : "not-found" as const;
      return {
        ...base, status, locatorKind: "字段标签",
        ...(indexedMatches ? { matchCount, visibleCount: matchCount } : { matchCount: 0, visibleCount: 0 }),
        detail: status === "ambiguous"
          ? `字段标签对应 ${matchCount} 个可见控件，但保存的行序号无法定位目标；步骤未执行。`
          : "保存步骤的字段标签在当前页面没有可见匹配控件；步骤未执行。",
      };
    }
    return { ...base, status: "blocked", detail: "读取当前页面定位状态失败；步骤未执行。请确认 Edge 会话仍可用后重试。" };
  } finally {
    release();
  }
}

export function makeDocumentProject(input: { name: unknown; fileName: unknown; document: ImportedDocument; targetUrl: unknown; sourceFiles?: string[]; researchExamples?: Array<{ title: string; url: string; snippet: string }>; caseMode?: "existing" | "ai" | "both" }): DocumentProject {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : String(input.fileName).slice(0, 120);
  const extractedCases = input.caseMode === "ai" ? [] : input.document.testCases;
  if ((extractedCases?.length ?? 0) > maxCases) throw new Error(`资料中有 ${extractedCases!.length} 条用例，单项目上限 ${maxCases}；请拆分项目，系统不会静默截断。`);
  const cases: BrowserCheck[] = extractedCases?.length
    ? extractedCases.map((item, index) => ({ id: `xmind-${index + 1}`, title: item.title, source: item.source, ...(item.modulePath?.length ? { modulePath: item.modulePath } : {}), requirementRefs: item.requirementRefs ?? [item.source], priority: item.priority ?? "P2", category: item.category ?? inferCaseCategory(`${item.title} ${item.source}`), confidence: item.confidence ?? confidenceFromExpectation(item.expected), coverageAreas: item.coverageAreas ?? [item.category ?? inferCaseCategory(`${item.title} ${item.source}`)], lifecycleStatus: "draft" as const, selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: "unknown" as const, cleanup: "", caseOrigin: "held-out-benchmark" as const, kind: "visible" as const, expected: item.expected, steps: [] }))
    : input.caseMode === "both" || input.caseMode === "ai" ? [] : createReviewCases(input.document.text);
  for (const item of cases) {
    const plan = planCaseExecution(item);
    item.executionRoute = plan.route;
    item.executionReason = plan.reason;
    item.nextAction = plan.nextAction;
  }
  return { id: randomUUID(), name, fileName: String(input.fileName).slice(0, 200), ...(input.sourceFiles?.length ? { sourceFiles: input.sourceFiles.slice(0, 8) } : {}), ...(input.researchExamples?.length ? { researchExamples: input.researchExamples.slice(0, 8) } : {}), caseMode: input.caseMode ?? "both", workflowPlan: ["规划阶段：按网址、说明和附件确定测试范围", "资料解析阶段：读取需求文件与已有测试用例", "公开资料阶段：查找测试案例并记录来源（若联网搜索可用）", "用例整理阶段：合并候选，补充边界场景和可判定预期", "双通道验证：确定性脚本与视觉 Computer Use 顺序运行并共享本轮浏览器页面"], format: input.document.format, targetUrl: safeTarget(input.targetUrl), sourceText: input.document.text, cases, reviewStatus: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

async function runLane(url: string, cases: BrowserCheck[], label: string, projectId: string, runId: string, page: Page, onLoginWait?: (waiting: boolean) => Promise<void>, onCaseResult?: (result: CaseResult) => Promise<void>, onCaseStart?: (item: BrowserCheck) => Promise<void>, signal?: AbortSignal): Promise<LaneResult> {
  const results: CaseResult[] = [];
  const record = async (result: CaseResult) => { results.push(result); await onCaseResult?.(result); };
  let activeItem: BrowserCheck | undefined;
  const stoppedDetail = (isCurrent: boolean) => isCurrent ? "运行在此用例期间被手动停止；当前结果未判定，可检查页面状态后定向重跑。" : "运行被手动停止；此用例尚未执行，可从部分结果中定向重跑。";
  const waitForVisibleText = async (expected: string, timeoutMs = 5000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("cancelled by user");
      for (const frame of page.frames()) {
        try { if ((await frame.locator("body").innerText({ timeout: 250 })).includes(expected)) return true; }
        catch { /* a detached or cross-origin frame is not evidence */ }
      }
      await page.waitForTimeout(100);
    }
    return false;
  };
  try {
    page.setDefaultTimeout(4000);
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
      const item = cases[caseIndex]!;
      if (signal?.aborted) {
        for (const pending of cases.slice(caseIndex)) await record({ id: pending.id, title: pending.title, status: "not-run", detail: stoppedDetail(false), durationMs: 0 });
        break;
      }
      await onCaseStart?.(item);
      activeItem = item;
      const start = Date.now();
      let requestObserver: ((request: any) => void) | undefined;
      let captureFetchOrXhr = false;
      let capturedUrl: string | undefined;
      const observedFetchOrXhr: string[] = [];
      try {
        const caseUrl = resolveDocumentCaseEntryUrl(url, item.entryPath);
        if (planCaseExecution(item).route === "out-of-scope") {
          await record({ id: item.id, title: item.title, status: "not-applicable", detail: `来源标明本期范围外；保留追溯，不计为通过。${planCaseExecution(item).reason}`, durationMs: Date.now() - start });
          continue;
        }
        if (planCaseExecution(item).route === "api-contract" && !item.steps?.length) {
          await record({ id: item.id, title: item.title, status: "not-applicable", detail: "该用例由关联的已审核 API contract lane 执行；浏览器脚本 lane 不重复判定。", durationMs: Date.now() - start });
          continue;
        }
        if (!item.steps?.length) {
          const plan = planCaseExecution(item);
          await record({ id: item.id, title: item.title, status: "blocked", detail: `当前网页脚本 lane 没有可执行步骤。分流：${plan.route}；原因：${plan.reason} 下一步：${plan.nextAction}${item.coverageGap ? ` 原始覆盖缺口：${item.coverageGap}` : ""}`, durationMs: Date.now() - start });
          continue;
        }
        if (!isSafeReadOnlyBrowserCase(item)) {
          const reason = browserStepDraftBlockReason(item) ?? (actionablePreconditions(item).length ? `具体前置条件未确认：${actionablePreconditions(item).join("；")}` : item.steps?.length ? "步骤尚未证明是只读操作，或步骤中包含高影响动作。" : "没有有效步骤");
          await record({ id: item.id, title: item.title, status: "blocked", detail: `当前执行计划未通过只读安全门禁：${reason}`, durationMs: Date.now() - start });
          continue;
        }
        if (actionablePreconditions(item).length > 0 && item.preconditionsConfirmed !== true) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: "用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。", durationMs: Date.now() - start });
          continue;
        }
        if (!item.expected.trim() || item.expected.startsWith("[请在") || item.expected.startsWith("[需澄清]")) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: "该用例的可判定预期尚未明确，先补充验收标准再执行。", durationMs: Date.now() - start });
          continue;
        }
        const steps = item.steps ?? [];
        if (!steps.length) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: item.coverageGap ? `该用例没有可执行的浏览器步骤；具体缺口：${item.coverageGap}` : "该用例没有可执行的浏览器步骤；请补充操作与断言后再运行。", durationMs: Date.now() - start });
          continue;
        }
        if (item.baseline?.strategy === "unavailable") {
          await record({ id: item.id, title: item.title, status: "blocked", detail: `无法为该用例建立独立页面基线：${item.baseline.reason?.trim() || "未提供安全的复位方法"}。当前实现不会沿用上一用例的页面状态执行。`, durationMs: Date.now() - start });
          continue;
        }
        const missingStimulusPlan = nonBrowserCaseWithoutStimulus(item);
        if (missingStimulusPlan) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: `当前步骤只有断言，没有建立该用例依赖的业务记录/角色/接口状态；不以空白页面上的预期内容缺失判为产品失败。执行路径：${missingStimulusPlan.route}。下一步：${missingStimulusPlan.nextAction}${item.coverageGap ? ` 原始覆盖缺口：${item.coverageGap}` : ""}`, durationMs: Date.now() - start });
          continue;
        }
        if (hasOnlyGenericShellAssertions(item) && !item.coverageGap) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: "现有步骤只检查通用页面标题/导航，没有断言该用例的具体预期；请改写为能直接验证字段、状态、提示或行为的步骤。", durationMs: Date.now() - start });
          continue;
        }
        const assertionGap = missingDirectAssertion(item);
        if (assertionGap && !item.coverageGap) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: `现有步骤不足以证明需求：${assertionGap}`, durationMs: Date.now() - start });
          continue;
        }
        if (!steps.some(step => ["assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertValueByPlaceholder", "assertDisabled", "assertFieldInvalid", "assertCurrentUrlUnchanged", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: "该用例只有操作步骤，没有结果断言；请补充断言后再运行。", durationMs: Date.now() - start });
          continue;
        }
        await page.unrouteAll().catch(() => undefined);
        await page.setViewportSize({ width: 1280, height: 720 }).catch(() => undefined);
        const allowedOrigin = new URL(caseUrl).origin;
        let blockAllRequestsForValidation = false;
        await page.route("**/*", async route => {
          const request = route.request();
          if (blockAllRequestsForValidation) { await route.abort("blockedbyclient"); return; }
          if (!allowBrowserRequest(request.method(), request.url(), projectId, { targetOrigin: allowedOrigin, resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest(), isMainFrameNavigation: request.isNavigationRequest() && request.frame().parentFrame() === null })) { await route.abort("blockedbyclient"); return; }
          if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
            try { const requested = new URL(request.url()); if (requested.origin !== allowedOrigin && !/(?:login|signin|sso|auth|accounts|passport)/i.test(`${requested.hostname}${requested.pathname}`)) { await route.abort("blockedbyclient"); return; } }
            catch { await route.abort("blockedbyclient"); return; }
          }
          await route.continue();
        });
        // Reload the same managed tab for each case. This clears SPA memory and
        // transient UI state while retaining the browser context and storage.
        // If authentication does not survive, block without asking for QR again.
        try { await resetPersistentCaseBaseline(page, caseUrl, 30000); }
        catch (error) { throw new Error(`Blocked: 无法建立用例页面基线：${error instanceof Error ? error.message : String(error)}`); }
        const clientGate = unsupportedWeChatClientGateMessage(await page.locator("body").innerText().catch(() => ""));
        if (clientGate) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: `目标页只显示“${clientGate}”；当前测试浏览器没有进入业务页面，本用例断言未执行。请在可访问的微信/企业微信测试会话中重跑。`, durationMs: Date.now() - start });
          continue;
        }
        if (await isLoginPage(page)) {
          await record({ id: item.id, title: item.title, status: "blocked", detail: "页面重载后出现登录页；为避免重复扫码，本用例已阻塞。请确认原登录会话能在同一浏览器上下文中跨页面重载保持，再重跑。", durationMs: Date.now() - start });
          continue;
        }
        requestObserver = request => {
          if (captureFetchOrXhr && (request.resourceType() === "fetch" || request.resourceType() === "xhr")) observedFetchOrXhr.push(`${request.method()} ${request.resourceType()}`);
        };
        page.on("request", requestObserver);
        let detail = `${label}：检查通过`;
        const assertionFailures: string[] = [];
        for (const step of item.steps ?? []) {
          if (signal?.aborted) throw new Error("cancelled by user");
          try {
          if (step.action === "captureCurrentUrl") { capturedUrl = page.url(); }
          else if (step.action === "assertCurrentUrlUnchanged") {
            if (!capturedUrl) throw new Error("断言失败：尚未捕获当前 URL 基线。");
            if (page.url() !== capturedUrl) throw new Error(`断言失败：预期 URL 保持不变，当前 ${page.url()}，基线 ${capturedUrl}。`);
          }
          else if (step.action === "setViewport") { await page.setViewportSize({ width: step.width, height: step.height }); }
          else if (step.action === "scrollToRatio") { await page.evaluate((ratio: number) => window.scrollTo({ top: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * ratio, behavior: "instant" }), step.ratio); await page.waitForTimeout(200); }
          else if (step.action === "setReducedMotion") { await page.emulateMedia({ reducedMotion: step.value ? "reduce" : "no-preference" }); }
          else if (step.action === "startFetchOrXhrCapture") { observedFetchOrXhr.length = 0; captureFetchOrXhr = true; }
          else if (step.action === "assertNoFetchOrXhr") {
            if (!captureFetchOrXhr) throw new Error("断言失败：尚未启动 fetch/XHR 捕获。");
            await page.waitForTimeout(step.quietMs ?? 1000);
            captureFetchOrXhr = false;
            if (observedFetchOrXhr.length) throw new Error(`断言失败：观察窗口内出现 ${observedFetchOrXhr.length} 个 fetch/XHR 请求（仅记录方法与类型，不记录 URL 或参数）。`);
          }
          if (step.action === "fillByLabel") await (await resolveDocumentField(page, step.label, step.rowIndex)).fill(step.value);
          else if (step.action === "fillByPlaceholder") {
            const field = page.getByPlaceholder(step.placeholder, { exact: false });
            if (await field.count() !== 1) throw new Error(`占位符「${step.placeholder}」匹配 ${await field.count()} 个控件；需要唯一匹配才能安全填写。`);
            await field.fill(step.value);
          }
          else if (step.action === "fillByRoleIndex") {
            const fields = page.getByRole(step.role);
            if (step.index >= await fields.count()) throw new Error(`可访问性 ${step.role} 控件数量不足，无法定位第 ${step.index + 1} 个。`);
            await fields.nth(step.index).fill(step.value);
          }
          else if (step.action === "blurByLabel") await (await resolveDocumentField(page, step.label, step.rowIndex)).blur();
          else if (step.action === "blurByPlaceholder") {
            const locator = page.getByPlaceholder(step.placeholder, { exact: true });
            if (await locator.count() !== 1) throw new Error(`占位符「${step.placeholder}」没有唯一匹配，无法安全触发失焦校验。`);
            await locator.blur();
          }
          else if (step.action === "selectByLabel") await selectDocumentOption(page, step.label, step.value, step.rowIndex);
          else if (step.action === "selectByPlaceholder") await selectDocumentOptionByPlaceholder(page, step.placeholder, step.value);
          else if (step.action === "selectByRoleIndex") await selectDocumentOptionByRoleIndex(page, step.index, step.value);
          else if (step.action === "clickByRole") {
            const locator = page.getByRole(step.role, { name: step.name, exact: true }).first();
            const unsafe = await locator.evaluate((el: Element) => (el instanceof HTMLButtonElement && el.type === "submit") || (el instanceof HTMLInputElement && ["submit", "image"].includes(el.type)) || Boolean(el.closest("form") && el instanceof HTMLButtonElement && el.type === "submit"));
            if (unsafe) throw new Error("安全策略阻止了表单提交按钮点击。");
            await locator.click();
          } else if (step.action === "triggerClientValidation") {
            const roleSubmit = page.getByRole("button", { name: step.name, exact: true });
            let submit = roleSubmit;
            if (await roleSubmit.count() !== 1) {
              const visibleText = page.getByText(step.name, { exact: true }).filter({ visible: true });
              if (await visibleText.count() !== 1) throw new Error(`安全校验点击需要唯一可见提交按钮「${step.name}」；按钮角色匹配 ${await roleSubmit.count()} 个，精确文本匹配 ${await visibleText.count()} 个。`);
              const isSubmitText = await visibleText.evaluate(element => {
                let node: Element | null = element;
                for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
                  if (node instanceof HTMLButtonElement) return node.type === "submit";
                  if (node.matches("a,[role=link]")) return false;
                  if (node.matches("[role=button],[class*=btn],[class*=button]")) return true;
                }
                return false;
              });
              if (!isSubmitText) throw new Error(`精确文本「${step.name}」没有关联到可识别的按钮控件。`);
              submit = visibleText;
            } else {
              const isSubmit = await roleSubmit.evaluate(element => element instanceof HTMLButtonElement && element.type === "submit");
              if (!isSubmit) throw new Error(`安全校验点击只允许明确标记为 type=submit 的按钮：「${step.name}」。`);
            }
            const submitState = await submit.evaluate(element => {
              let node: Element | null = element;
              for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
                if (!(node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node.matches('[role=button],[class*=btn],[class*=button]'))) continue;
                const classes = typeof node.className === "string" ? node.className : "";
                const style = getComputedStyle(node);
                return {
                  disabled: (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) && node.disabled
                    || node.getAttribute("aria-disabled") === "true"
                    || /disabled/i.test(classes)
                    || style.pointerEvents === "none",
                };
              }
              return { disabled: false };
            });
            if (submitState.disabled) throw new Error("Blocked: 提交申请按钮当前禁用；需要除目标手机号外其余必填字段的有效合成夹具，才能安全验证提交触发的客户端校验。");
            blockAllRequestsForValidation = true;
            try { await submit.click({ timeout: 5000 }); await page.waitForTimeout(800); }
            finally { blockAllRequestsForValidation = false; }
          } else if (step.action === "clickExactText") {
            const locator = page.getByText(step.text, { exact: true }).first();
            try { await locator.waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`精确文本控件不可见：${step.text}`); }
            const target = await locator.evaluate((el: Element) => {
              const node = el.closest("button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio]") ?? el;
              const label = [node.textContent, node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("name"), node.getAttribute("type")].filter(Boolean).join(" ");
              const submit = node instanceof HTMLButtonElement && node.type === "submit" || node instanceof HTMLInputElement && ["submit", "image"].includes(node.type);
              return { submit, label };
            });
            if (target.submit || /提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(target.label)) throw new Error(`安全策略阻止点击高影响文本：${step.text}`);
            await locator.click();
          } else if (step.action === "assertText" || step.action === "assertVisible") {
            // H5 summary labels and values are often sibling spans. getByText()
            // requires one DOM node to contain the entire string, so it can
            // miss copy that is visibly rendered as a composed row.
            if (!await waitForVisibleText(step.text)) {
              const current = new URL(page.url());
              const framePaths = page.frames().map(frame => { try { const frameUrl = new URL(frame.url()); return `${frameUrl.pathname}${frameUrl.hash}`; } catch { return "unavailable"; } });
              let renderSurfaceCount = 0;
              for (const frame of page.frames()) renderSurfaceCount += await frame.locator("canvas,svg").count().catch(() => 0);
              if (renderSurfaceCount > 0) throw new Error(`Blocked: 页面存在 ${renderSurfaceCount} 个 canvas/SVG 渲染面，但预期文本未暴露在 DOM/可访问文本层；请由 Computer Use 截图通道验证该视觉内容。页面=${current.pathname}${current.hash}；frames=${framePaths.join(",")}`);
              throw new Error(`断言失败：期望可见文本未出现在页面或嵌入 frame：${step.text}；页面=${current.pathname}${current.hash}；frames=${framePaths.join(",")}`);
            }
          }
          else if (step.action === "assertNotVisible") { try { await page.getByText(step.text, { exact: true }).first().waitFor({ state: "hidden", timeout: 2500 }); } catch { throw new Error(`断言失败：不应出现的文本仍可见：${step.text}`); } }
          else if (step.action === "assertExactVisible") { try { await page.getByText(step.text, { exact: true }).first().waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：没有完全匹配的可见文本：${step.text}`); } }
          else if (step.action === "assertRoleVisible") { try { await page.getByRole(step.role, { name: step.name, exact: true }).first().waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：没有完全匹配的可见 ${step.role}：${step.name}`); } }
          else if (step.action === "assertRoleDisabled") {
            const control = page.getByRole(step.role, { name: step.name, exact: true }).first();
            if (await control.count()) { await control.waitFor({ state: "visible", timeout: 5000 }); if (!(await control.isDisabled())) throw new Error(`断言失败：${step.role}「${step.name}」应为禁用状态。`); }
            else {
              const text = page.getByText(step.name, { exact: true }).first();
              const disabled = await text.evaluate((el: Element) => { let node: Element | null = el; for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) { if (!node.matches("button,[role=button],[aria-disabled=true],[class*=btn],[class*=button]")) continue; const classes = typeof node.className === "string" ? node.className : ""; return node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true" || /disabled/i.test(classes) || getComputedStyle(node).pointerEvents === "none"; } return false; });
              if (!disabled) throw new Error(`断言失败：没有找到禁用的 ${step.role}「${step.name}」。`);
            }
          }
          else if (step.action === "assertMaxLengthOrMessage") { const field = await resolveDocumentField(page, step.label); const value = await field.inputValue(); if (value.length > step.maxLength) { try { await page.getByText(step.message, { exact: false }).first().waitFor({ state: "visible", timeout: 1500 }); } catch { throw new Error(`断言失败：字段「${step.label}」长度 ${value.length} 超过 ${step.maxLength}，且没有提示「${step.message}」。`); } } }
          else if (step.action === "assertNoHorizontalOverflow") await assertNoHorizontalOverflow(page);
          else if (step.action === "assertValue") { const field = await resolveDocumentField(page, step.label, step.rowIndex); try { await field.waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`); } const value = await field.inputValue(); if (value !== step.value) throw new Error(`断言失败：字段值与预期不符：${step.label}`); }
          else if (step.action === "assertValueByPlaceholder") {
            let field = page.getByPlaceholder(step.placeholder, { exact: true });
            const placeholderCount = await field.count();
            if (placeholderCount !== 1) {
              if (placeholderCount > 1) throw new Error(`占位符「${step.placeholder}」匹配多个控件，无法安全断言字段值。`);
              const valueMatches = await page.locator("input").evaluateAll((elements: Element[], expected: string) => elements.flatMap((element, index) => element instanceof HTMLInputElement && element.getClientRects().length && element.value === expected ? [index] : []), step.value);
              if (valueMatches.length !== 1) throw new Error(`占位符「${step.placeholder}」消失后，当前值也没有唯一匹配。`);
              field = page.locator("input").nth(valueMatches[0]!);
            }
            try { await field.waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：占位符字段不可见：${step.placeholder}`); }
            const value = await field.inputValue();
            if (value !== step.value) throw new Error(`断言失败：字段值与预期不符：${step.placeholder}`);
          }
          else if (step.action === "assertDisabled") { const field = await resolveDocumentField(page, step.label); try { await field.waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`); } if (!(await field.isDisabled())) throw new Error(`断言失败：控件应为禁用：${step.label}`); }
          else if (step.action === "assertFieldInvalid") {
            const field = await resolveDocumentField(page, step.label, step.rowIndex);
            try { await field.waitFor({ state: "visible", timeout: 5000 }); } catch { throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`); }
            // Build the browser callback from a literal string. esbuild/tsx can
            // inject its Node-side __name helper into callbacks passed through
            // Playwright, and the serialized function then fails in the page.
            const invalidEvidence = await field.evaluate(new Function("element", String.raw`
              const evidence = [];
              if ("validity" in element) {
                const valid = element.validity.valid;
                evidence.push("validity=" + valid);
                if (!valid) return { invalid: true, evidence };
              }
              function isRed(color) {
                const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
                return Boolean(rgb && Number(rgb[1]) > 150 && Number(rgb[2]) < 150 && Number(rgb[3]) < 150);
              }
              const formItem = element.closest(".el-form-item,[class*=form-item]");
              if (formItem && /(?:is-error|form-item--error|invalid|error|danger)/i.test(typeof formItem.className === "string" ? formItem.className : "")) return { invalid: true, evidence: evidence.concat("invalid-form-item") };
              if (formItem) {
                const messages = formItem.querySelectorAll(".el-form-item__error,[role=alert],[aria-live=assertive]");
                for (const message of messages) if (message.getClientRects().length && /(?:invalid|error|格式错误|不能为空|必填)/iu.test(message.textContent || "")) return { invalid: true, evidence: evidence.concat("visible-field-error-message") };
              }
              const shell = element.closest(".el-input,.el-textarea")?.querySelector(".el-input__wrapper,.el-input__inner,.el-textarea__inner");
              if (shell) {
                const shellClass = typeof shell.className === "string" ? shell.className : "";
                const shellStyle = getComputedStyle(shell);
                if (/(?:invalid|error|danger)/i.test(shellClass) || [shellStyle.borderTopColor, shellStyle.borderRightColor, shellStyle.borderBottomColor, shellStyle.borderLeftColor, shellStyle.outlineColor].some(isRed)) return { invalid: true, evidence: evidence.concat("invalid-input-shell") };
              }
              let node = element;
              for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
                if (node.getAttribute("aria-invalid") === "true") return { invalid: true, evidence: evidence.concat("aria-invalid@" + depth) };
                const classes = typeof node.className === "string" ? node.className : "";
                if (/(?:invalid|error|danger)/i.test(classes)) return { invalid: true, evidence: evidence.concat("error-class@" + depth) };
                const style = getComputedStyle(node);
                const fieldCount = node.querySelectorAll("input,select,textarea").length;
                const colors = [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor, style.outlineColor];
                for (const color of colors) if (isRed(color)) return { invalid: true, evidence: evidence.concat("red-border@" + depth) };
                if (/(?:rgb\(\s*(?:1[6-9]\d|2\d\d)\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\)|#[fF][0-9a-fA-F]{2,5})/.test(style.boxShadow)) return { invalid: true, evidence: evidence.concat("red-shadow@" + depth) };
                if (depth < 3) evidence.push("node" + depth + "{tag=" + node.tagName.toLowerCase() + ",fields=" + fieldCount + ",aria=" + (node.getAttribute("aria-invalid") || "") + ",class=" + classes.slice(0, 80) + ",border=" + colors.slice(0, 4).join("|") + "}");
                if (depth > 0 && fieldCount > 1) break;
              }
              const describedBy = element.getAttribute("aria-describedby");
              for (const id of (describedBy || "").split(/\s+/u).filter(Boolean)) {
                const message = element.ownerDocument.getElementById(id);
                if (message && message.getClientRects().length && /(?:invalid|error|格式错误|不能为空|必填)/iu.test(message.textContent || "")) return { invalid: true, evidence: evidence.concat("error-description=" + id) };
              }
              return { invalid: false, evidence };
            `) as (element: Element) => { invalid: boolean; evidence: string[] });
            if (!invalidEvidence.invalid) throw new Error(`断言失败：字段「${step.label}」尚无可见无效状态。观察到：${invalidEvidence.evidence.join("; ") || "没有关联样式节点"}`);
          }
          } catch (error) {
            if (signal?.aborted) throw error;
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith("断言失败：")) { assertionFailures.push(message); continue; }
            throw error;
          }
        }
        if (signal?.aborted) throw new Error("cancelled by user");
        if (assertionFailures.length) throw new Error(assertionFailures.join("；"));
        await record({ id: item.id, title: item.title, status: item.coverageGap ? "blocked" : "passed", detail: item.coverageGap ? `可见子断言通过，但完整用例仍未验证：${item.coverageGap}` : detail, durationMs: Date.now() - start });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await record({ id: item.id, title: item.title, status: signal?.aborted ? "cancelled" : detail.startsWith("断言失败：") ? "failed" : "blocked", detail: signal?.aborted ? stoppedDetail(true) : detail, durationMs: Date.now() - start });
      }
      finally { if (requestObserver) page.off("request", requestObserver); }
      activeItem = undefined;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const hint = /executable|browser|launch/i.test(reason) ? " 请安装浏览器：npx playwright install chromium；Windows 上也会尝试使用已安装的 Edge。" : "";
    const failedToStart = cases.map(item => signal?.aborted
      ? { id: item.id, title: item.title, status: item.id === activeItem?.id ? "cancelled" as const : "not-run" as const, detail: stoppedDetail(item.id === activeItem?.id), durationMs: 0 }
      : planCaseExecution(item).route === "out-of-scope"
        ? { id: item.id, title: item.title, status: "not-applicable" as const, detail: "需求来源标记为本期范围外；保留追溯，不计为通过。", durationMs: 0 }
        : { id: item.id, title: item.title, status: "blocked" as const, detail: `浏览器未能开始执行。${hint}${reason}`, durationMs: 0 });
    return { status: signal?.aborted ? "cancelled" : "blocked", summary: signal?.aborted ? `运行被手动停止。${failedToStart.filter(item => item.status === "cancelled").length} 条正在执行的用例已标记取消，其余未执行用例已标记未运行。` : `${reason}${hint}`, results: failedToStart };
  }
  if (signal?.aborted) {
    const cancelled = results.filter(item => item.status === "cancelled").length;
    const notRun = results.filter(item => item.status === "not-run").length;
    return { status: "cancelled", summary: `运行被手动停止。已取消 ${cancelled} 条，未运行 ${notRun} 条。`, results };
  }
  const applicable = results.filter(x => x.status !== "not-applicable");
  const passed = applicable.filter(x => x.status === "passed").length;
  const notApplicable = results.length - applicable.length;
  const status = applicable.length === 0 ? "not-applicable" : passed === applicable.length ? "passed" : "failed";
  return { status, summary: `${passed}/${applicable.length} 条适用用例通过 · ${notApplicable} 条 N/A`, results };
}

/** Detect invalid styling on either the form control or its immediate field wrapper. */
export function isDocumentFieldInvalid(element: Element): boolean {
  if ("validity" in element && !(element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).validity.valid) return true;
  const isRed = (color: string) => {
    const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return Boolean(rgb && Number(rgb[1]) > 150 && Number(rgb[2]) < 150 && Number(rgb[3]) < 150);
  };
  let node: Element | null = element;
  for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
    if (node.getAttribute("aria-invalid") === "true") return true;
    const classes = typeof node.className === "string" ? node.className : "";
    if (/(?:invalid|error|danger)/i.test(classes)) return true;
    if (node !== element && node.querySelectorAll("input,select,textarea").length > 1) break;
    const style = getComputedStyle(node);
    if (["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor"].some(key => isRed(style[key as "borderTopColor"]))) return true;
    if (/(?:rgb\(\s*(?:1[6-9]\d|2\d\d)\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\)|#[fF][0-9a-fA-F]{2,5})/.test(style.boxShadow)) return true;
  }
  const ariaDescribedBy = element.getAttribute("aria-describedby")?.split(/\s+/u).filter(Boolean) ?? [];
  return ariaDescribedBy.some(id => {
    const message = element.ownerDocument.getElementById(id);
    return Boolean(message?.getClientRects().length && /(?:invalid|error|格式错误|不能为空|必填)/iu.test(message.textContent ?? ""));
  });
}

export async function selectDocumentOptionByPlaceholder(page: Page, placeholder: string, value: string): Promise<void> {
  const locator = page.getByPlaceholder(placeholder, { exact: true });
  const count = await locator.count();
  if (count !== 1) throw new Error(`占位符「${placeholder}」匹配 ${count} 个控件；需要唯一匹配才能安全选择。`);
  if (await locator.evaluate(element => element instanceof HTMLSelectElement)) {
    await locator.selectOption({ label: value }).catch(async () => locator.selectOption(value));
    return;
  }
  // Support accessible custom comboboxes (such as Element Plus) through their
  // visible placeholder and option list. Do not use DOM internals or evaluate
  // arbitrary page code; require a unique placeholder and a unique visible option.
  await locator.click();
  const roleOption = page.getByRole("option", { name: value, exact: true });
  const optionCount = await roleOption.count();
  if (optionCount === 1) { await roleOption.click(); return; }
  const visibleText = page.getByText(value, { exact: true });
  const textCount = await visibleText.count();
  if (textCount !== 1) throw new Error(`自定义下拉框「${placeholder}」中选项「${value}」匹配 ${textCount} 项；无法安全选择。`);
  await visibleText.click();
}

export async function selectDocumentOptionByRoleIndex(page: Page, index: number, value: string): Promise<void> {
  const controls = page.getByRole("combobox");
  const count = await controls.count();
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`页面只有 ${count} 个 combobox，无法选择第 ${index + 1} 个。`);
  const control = controls.nth(index);
  if (!(await control.isVisible())) throw new Error(`第 ${index + 1} 个 combobox 当前不可见。`);
  await control.click();
  const option = page.getByRole("option", { name: value, exact: true });
  const optionCount = await option.count();
  if (optionCount === 1) { await option.click(); return; }
  const visibleText = page.getByText(value, { exact: true }).filter({ visible: true });
  const textCount = await visibleText.count();
  if (textCount !== 1) throw new Error(`选项「${value}」有 ${textCount} 个可见精确匹配；无法安全选择。`);
  await visibleText.click();
}

async function readDocumentControlValue(locator: import("playwright").Locator): Promise<string> {
  if (await locator.evaluate(element => element instanceof HTMLSelectElement)) return locator.inputValue();
  return locator.inputValue();
}

/** Open/authenticate the shared project page before attempting step generation.
 * This is needed when every selected case has empty steps: the deterministic
 * lane will otherwise mark them blocked without ever visiting the target, so
 * the post-login author cannot inspect the authenticated application. */
async function prepareSharedTargetPage(url: string, projectId: string, runId: string, page: Page, onLoginWait?: (waiting: boolean) => Promise<void>): Promise<void> {
  await page.unrouteAll().catch(() => undefined);
  const allowedOrigin = new URL(url).origin;
  await page.route("**/*", async route => {
    const request = route.request();
    if (!allowBrowserRequest(request.method(), request.url(), projectId, { targetOrigin: allowedOrigin, resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest(), isMainFrameNavigation: request.isNavigationRequest() && request.frame().parentFrame() === null })) { await route.abort("blockedbyclient"); return; }
    if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
      try {
        const requested = new URL(request.url());
        if (requested.origin !== allowedOrigin && !/(?:login|signin|sso|auth|accounts|passport)/i.test(`${requested.hostname}${requested.pathname}`)) { await route.abort("blockedbyclient"); return; }
      } catch { await route.abort("blockedbyclient"); return; }
    }
    await route.continue();
  });
  const target = new URL(url);
  let current: URL | undefined;
  try { current = new URL(page.url()); } catch { /* about:blank */ }
  if (!current || current.origin !== target.origin || current.href !== target.href) {
    await navigatePersistentPage(page, url, 30000);
  }
  if (await isLoginPage(page)) {
    const browser = page.context().browser();
    if (!browser) throw new Error("当前共享测试页没有可用浏览器上下文，无法等待同一窗口登录。");
    await waitForUserLogin(projectId, runId, url, browser, page, onLoginWait);
  }
}


function reportMarkdown(project: DocumentProject, run: DocumentRun, aiSummary: string): string {
  const scopeLabelFor = (id: string) => run.scopePlan
    ? run.scopePlan.targetCaseIds.includes(id) ? "直接目标"
      : run.scopePlan.impactCaseIds.includes(id) ? "关联影响" : "范围未分类"
    : run.caseScopeKnown === false ? "历史范围未标注" : "目标/影响未标注";
  const scopeTagFor = (id: string) => `[${scopeLabelFor(id)}] `;
  const countsFor = (results: CaseResult[]) => {
    const counts = { passed: 0, failed: 0, blocked: 0, cancelled: 0, notRun: 0, notApplicable: 0 };
    for (const item of results) {
      if (item.status === "passed") counts.passed++;
      else if (item.status === "failed") counts.failed++;
      else if (item.status === "blocked") counts.blocked++;
      else if (item.status === "cancelled") counts.cancelled++;
      else if (item.status === "not-run") counts.notRun++;
      else counts.notApplicable++;
    }
    return counts;
  };
  const lane = (name: string, value: LaneResult, selectedIds: string[]) => {
    const actual = new Map(value.results.map(item => [item.id, item]));
    const scoped = value.results.filter(item => selectedIds.includes(item.id));
    const counts = countsFor(scoped);
    const missing = selectedIds.filter(id => !actual.has(id));
    return [
      `## ${name}：${value.status}`, "", value.summary,
      `- 本轮选中用例结果数：${scoped.length}/${selectedIds.length}；通过 ${counts.passed}、失败 ${counts.failed}、阻塞 ${counts.blocked}、取消 ${counts.cancelled}、未运行 ${counts.notRun}、N/A ${counts.notApplicable}。`,
      `- 有逐用例执行明细：${scoped.length}/${selectedIds.length}；缺少结果：${missing.join(", ") || "无"}。`, "",
      ...scoped.map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.id} ${item.title} — ${item.detail}${Number.isFinite(item.durationMs) ? `（${item.durationMs} ms）` : ""}`),
      ...(missing.length ? missing.map(id => `- ${scopeTagFor(id)}[missing] ${id}：本 lane 未返回逐用例结果，不能据此记为通过。`) : []), "",
    ];
  };
  const selectedIds = run.caseScope.selectedCaseIds;
  const selectedSet = new Set(selectedIds);
  const excluded = project.cases.filter(item => !selectedSet.has(item.id));
  const selectedCases = project.cases.filter(item => selectedSet.has(item.id));
  const comparisonCounts = { aligned: 0, mismatch: 0, unresolved: 0, notApplicable: 0, missing: 0 };
  const comparisonById = new Map(run.comparisons.map(item => [item.id, item]));
  for (const id of selectedIds) {
    const resolution = comparisonById.get(id)?.resolution ?? "unresolved";
    if (resolution === "aligned") comparisonCounts.aligned++;
    else if (resolution === "mismatch") comparisonCounts.mismatch++;
    else if (resolution === "not-applicable") comparisonCounts.notApplicable++;
    else comparisonCounts.unresolved++;
    if (!comparisonById.has(id)) comparisonCounts.missing++;
  }
  const baselineDispositionLabels: Record<BaselineDisposition, string> = { regression: "疑似回归", fixed: "已修复", unchanged: "未变化", "case-changed": "用例已修改，需复核", added: "新增用例", removed: "用例已移除", "not-run": "未运行", "no-baseline-result": "基线无结果", unresolved: "无法比较" };
  const triageCategoryLabels: Record<DocumentCaseTriageCategory, string> = { "suspected-product-regression": "疑似产品回归", "case-or-expectation-review": "用例或预期需复核", "locator-failure": "元素定位失效", "environment-or-session": "环境或登录会话问题", "test-data-or-fixture": "测试数据或 fixture 问题", "needs-review": "待确认" };
  const baselineStatusLabel = (status?: CaseResult["status"]) => status ? ({ passed: "通过", failed: "失败", blocked: "阻塞", cancelled: "取消", "not-run": "未运行", "not-applicable": "不适用" }[status]) : "无结果";
  const baselineDispositionCounts = run.baselineComparison?.reduce<Record<string, number>>((counts, item) => { counts[item.disposition] = (counts[item.disposition] ?? 0) + 1; return counts; }, {}) ?? {};
  const baselineRunScopeLabel = (caseId: string) => {
    const scope = run.baselineRunSnapshot?.scopePlan;
    if (!scope) return "旧版范围未标注";
    if (scope.targetCaseIds.includes(caseId)) return "直接目标";
    if (scope.impactCaseIds.includes(caseId)) return "关联影响";
    return "基线未选";
  };
  const currentRunScopeLabel = (item: DocumentBaselineComparison) => item.disposition === "removed" ? "已从当前项目移除"
    : run.scopePlan?.targetCaseIds.includes(item.caseId) ? "直接目标"
      : run.scopePlan?.impactCaseIds.includes(item.caseId) ? "关联影响"
        : run.caseScope.selectedCaseIds.includes(item.caseId) ? "本轮执行，范围未分类" : "本轮未选";
  const pendingPrerequisites = selectedCases.filter(item => {
    const route = planCaseExecution(item).route;
    return item.preconditionsConfirmed !== true && (item.preconditions?.length ?? 0) > 0
      || Boolean(item.coverageGap)
      || ["fixture-or-role", "clarification", "source-review", "manual-analysis"].includes(route);
  });
  const evidenceCount = run.deterministic.results.filter(item => selectedSet.has(item.id)).length
    + run.ai.results.filter(item => selectedSet.has(item.id)).length
    + (run.apiContract?.results.filter(item => selectedSet.has(item.id)).length ?? 0);
  const governance = project.cases.map(item => {
    const plan = planCaseExecution(item);
    const risk = item.sideEffectRisk ?? "unknown";
    const preconditions = item.preconditions?.length ? item.preconditions.join("；") : "无";
    const data = item.testData?.length ? item.testData.join("；") : "未指定";
    const refs = item.requirementRefs?.length ? item.requirementRefs.join("；") : item.source;
    const category = caseCategoryLabels[item.category ?? "functional"];
    const areas = (item.coverageAreas ?? [item.category ?? "functional"]).map(area => caseCategoryLabels[area] ?? area).join("、");
    const lifecycle = item.lifecycleStatus === "draft" ? "草稿" : item.lifecycleStatus === "disabled" ? "停用" : item.lifecycleStatus === "runnable" ? "可运行" : "旧用例未设置";
    const runScope = selectedSet.has(item.id) ? scopeTagFor(item.id) : "[本轮未选] ";
    return `- [状态 ${lifecycle}] ${runScope}${item.id} ${item.title} [${item.priority ?? "P2"}] [${category}；置信度 ${item.confidence ?? "medium"}；覆盖 ${areas}] [执行路径 ${plan.route}] [页面入口 ${item.entryPath ?? "网站版本首页"}]：追溯 ${refs}；前置条件 ${preconditions}${item.preconditions?.length ? `（${item.preconditionsConfirmed ? "已确认" : "未确认"}）` : ""}；测试数据 ${data}；副作用风险 ${risk}；清理 ${item.cleanup || "无/未说明"}；原因 ${plan.reason}；下一步 ${plan.nextAction}`;
  });
  return [
    "# TestPilot 文档驱动测试报告", "", `- 项目：${project.name}`, `- 需求来源：${project.fileName}`, `- 应用：${project.targetUrl}`,
    ...(run.siteVersionSnapshot ? [`- 网站版本：${run.siteVersionSnapshot.label}`, `- 测试环境：${run.siteVersionSnapshot.environment}`, `- 迭代说明：${run.siteVersionSnapshot.changeNotes || "未填写"}`, `- 版本登记时间：${run.siteVersionSnapshot.createdAt}`] : ["- 网站版本：未登记（该项目尚未创建部署版本记录）"]),
    `- 执行模式：${run.runMode === "regression" ? "常规回归（确定性执行，不调用模型）" : "AI 辅助对照（确定性脚本 + Computer Use）"}`,
    `- 用例来源模式：${project.caseMode ?? "both"}`, `- 本轮范围：${run.caseScopeKnown === false ? `历史记录范围未知；记录中找到 ${run.caseScope.selectedCaseIds.length} 条结果` : `选中 ${run.caseScope.selectedCaseIds.length}/${run.caseScope.totalCases} 条用例`}`, ...(run.scopePlan ? [`- 范围类型：${run.scopePlan.mode}`, `- 直接测试目标：${run.scopePlan.targetCaseIds.join("、")}`, `- 关联影响检查：${run.scopePlan.impactCaseIds.join("、") || "无"}`] : []), `- 开始：${run.startedAt}`, `- 完成：${run.completedAt}`,
    ...(run.recovery ? [`- 中断恢复：第 ${run.recovery.resumeCount} 次恢复；已跳过已完成用例 ${run.recovery.skippedCompletedCaseIds.join(", ") || "无"}；中断用例仅在副作用风险为 none 时重试：${run.recovery.interruptedRetryCaseIds.join(", ") || "无"}。未从头无条件重放。`] : []),
    `- 结论：${run.overall}`, `- 所需执行路径已得到结论：${run.finalReady ? "是（仅指本轮适用且对齐的选中用例）" : "否"}`,
    ...(run.baselineRunId ? [
      `- 历史比较基线：${run.baselineRunId}`,
      ...(run.baselineRunSnapshot ? [
        `- 基线网站版本：${run.baselineRunSnapshot.siteVersionSnapshot ? `${run.baselineRunSnapshot.siteVersionSnapshot.environment} · ${run.baselineRunSnapshot.siteVersionSnapshot.label}` : "未登记"}`,
        `- 基线运行时间：${run.baselineRunSnapshot.startedAt} → ${run.baselineRunSnapshot.completedAt}`,
        `- 基线目标网址：${run.baselineRunSnapshot.siteVersionSnapshot?.targetUrl ?? "未登记"}`,
        `- 基线执行方式：${run.baselineRunSnapshot.runMode === "regression" ? "常规回归" : run.baselineRunSnapshot.runMode === "compare" ? "AI 辅助对照" : "历史运行未记录"}`,
        `- 基线范围：${run.baselineRunSnapshot.scopePlan ? `直接目标 ${run.baselineRunSnapshot.scopePlan.targetCaseIds.length} 条 · 关联影响 ${run.baselineRunSnapshot.scopePlan.impactCaseIds.length} 条` : `旧记录范围未分类 · 本轮 ${run.baselineRunSnapshot.selectedCaseCount}/${run.baselineRunSnapshot.totalCases} 条`}`,
        `- 基线用例/脚本版本：${run.baselineRunSnapshot.caseVersion ?? "历史运行未记录"}`,
        `- 基线需求/测试资料版本：${run.baselineRunSnapshot.materialVersion ?? "历史运行未记录"}`,
        `- 基线测试数据版本：${run.baselineRunSnapshot.testDataVersion ?? "历史运行未记录"}`,
      ] : ["- 基线详细版本快照：旧版运行未留存。"]),
      ...(run.baselineEnvironmentComparison === "different" ? [`- 注意：当前与基线的环境标识或目标站点来源不同；结果变化不能单独归因于本次迭代。`] : []),
      ...(run.baselineEnvironmentComparison === "unknown" ? ["- 注意：当前或基线运行缺少有效的环境或目标站点来源记录，无法确认两者一致。"] : []),
      ...(run.baselineRunModeComparison === "different" ? ["- 注意：当前运行方式与基线不同（常规回归与 AI 辅助对照）；通道差异可能影响结果变化判断。"] : []),
      ...(run.baselineRunModeComparison === "unknown" ? ["- 注意：当前运行方式或基线运行方式未记录，无法确认两轮使用相同的验证方法。"] : []),
      ...(run.baselineMaterialChanged ? ["- 注意：本轮需求/测试资料版本与基线不同；逐用例状态可比较，但请先复核新旧需求依据是否仍然等价。"] : []),
      ...(run.baselineRunSnapshot && (!run.materialVersion || !run.baselineRunSnapshot.materialVersion) ? ["- 注意：本轮或基线缺少需求/测试资料版本记录，无法确认资料是否一致。"] : []),
      ...(run.baselineTestDataChanged ? ["- 注意：本轮测试数据版本与基线不同；失败/通过状态变化可能同时受输入数据影响。"] : []),
      ...(run.baselineRunSnapshot && (!run.testDataVersion || !run.baselineRunSnapshot.testDataVersion) ? ["- 注意：本轮或基线缺少测试数据版本记录，无法确认测试数据是否一致。"] : []),
    ] : ["- 历史比较基线：无"]),
    ...(run.stepGeneration ? [`- 运行前补步骤：${run.stepGeneration.generatedCaseIds.length} 条（${run.stepGeneration.requiresReview ? "等待审核" : "自动模式已继续执行"}）`, ...(run.stepGeneration.caseResults?.length ? ["- 逐用例步骤生成结果：", ...run.stepGeneration.caseResults.map(item => `  - [${item.status}] ${item.caseId}（${item.stepCount} 步）：${item.detail}`)] : []), ...(run.stepGeneration.warning ? [`- 补步骤说明：${run.stepGeneration.warning}`] : [])] : []),
    "", "## 资料与调研来源", "", `- 资料版本摘要：${run.materialVersion ?? "历史运行未记录"}`,
    ...(run.sourceMaterialsSnapshot?.length ? run.sourceMaterialsSnapshot.map(item => `- 资料快照：${item.fileName}（${item.role}；${item.byteLength} bytes；SHA-256 ${item.sha256}）`) : (project.sourceFiles ?? [project.fileName]).map(item => `- 本地资料：${item}`)),
    ...(project.caseGeneration ? [`- 独立用例生成 artifact：${project.caseGeneration.artifactId} v${project.caseGeneration.version} · SHA-256 ${project.caseGeneration.digest}`, `- 生成需求基线：${project.caseGeneration.requirements.length} 条；转入项目 ${project.caseGeneration.transferredCases.length} 条 AI 用例` ] : []),
    ...(project.researchExamples ?? []).map(item => `- 公开参考（${item.title}）：${item.url}`),
    ...(project.researchExamples?.length ? [] : ["- 本次没有取得公开搜索结果；用例依据本地资料与目标页面。"]),
    "- 本轮测试数据版本：" + (run.testDataVersion ?? "历史运行未记录"),
    ...(run.parameterValues && Object.keys(run.parameterValues).length ? ["", "## 本轮参数快照", "", "- 测试数据组：" + (project.testDataSets?.find(item => item.id === run.testDataSetId)?.name ?? "本轮手动输入"), "- 参数值：" + JSON.stringify(run.parameterValues), "- 参数仅记录合成测试数据；账号认证使用 Edge 登录态。"] : []),
    "", "## 覆盖领域摘要", "",
    `- 需求/用例已识别领域：${run.coverageSummary?.projectAreas.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    `- 本轮实际选中领域：${run.coverageSummary?.selectedAreas.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    `- 已识别但本轮未覆盖领域：${run.coverageSummary?.notCoveredThisRun.map(area => caseCategoryLabels[area]).join("、") || "无"}`,
    "- 领域来自当前已整理用例的分类/覆盖标签；这不是需求完整性证明，也不会推断没有编写用例的需求领域。",
    "", "## 用例清单与本轮范围", "",
    `- 项目库存：${project.cases.length} 条；记录声明总数：${run.caseScope.totalCases} 条。`,
    `- 本轮选中：${selectedIds.length} 条；项目中可对应：${selectedCases.length} 条；记录中无对应项目用例：${selectedIds.filter(id => !project.cases.some(item => item.id === id)).join(", ") || "无"}。`,
    `- 本轮未选：${excluded.length} 条；记录声明排除：${run.caseScope.excludedCaseIds.length} 条。排除 ID：${run.caseScope.excludedCaseIds.join(", ") || "无"}。`,
    `- 选中 ID：${selectedIds.join(", ") || "无"}`,
    `- 全项目覆盖：${selectedIds.length === project.cases.length && excluded.length === 0 && run.caseScope.totalCases === project.cases.length ? "范围数量相符；执行结果仍需看逐用例状态" : "否；本报告只代表选中范围"}`,
    "", "### 未选用例及原因", "", ...(excluded.length ? excluded.map(item => {
      const plan = planCaseExecution(item);
      return `- ${item.id} ${item.title}：未纳入本轮回归（计划路径 ${plan.route}；${plan.reason}；下一步：${plan.nextAction}）。`;
    }) : ["- 无。"]),
    ...(run.scopePlan?.impactCaseIds.length ? ["", "### 关联影响检查依据", "", ...run.scopePlan.impactCaseIds.map(id => `- ${id}：${run.scopePlan?.impactReasons?.[id]?.join("；") || "本次未记录具体关系依据。"}`)] : []),
    "", "## 用例范围与治理", "", ...governance,
    "", "## 前置条件与待解决依赖", "",
    ...(pendingPrerequisites.length ? pendingPrerequisites.map(item => `- ${item.id} ${item.title}：前置条件 ${item.preconditions.join("；") || "未列明"}（${item.preconditionsConfirmed ? "已确认" : "未确认/不适用确认"}）；测试数据 ${item.testData.join("；") || "未指定"}；覆盖缺口 ${item.coverageGap || "无明示缺口"}；当前路径 ${planCaseExecution(item).route}。`) : ["- 本轮选中用例未发现明确的未确认前置条件或已记录 coverageGap；这不证明业务数据和权限已完整验证。"]),
    "", "> 浏览器 runner 只执行标记为只读且前置条件已确认的用例；清理说明不会通过浏览器自动执行。API contract lane 只会执行已审核 suite 中明确配置、获准且指向隔离环境的 fixture setup/cleanup。测试数据字段应写合成数据说明或 fixture 引用，不应存放真实凭证或个人资料。",
    "", "## 执行摘要", "", aiSummary,
    run.runMode === "regression"
      ? `- 用例结论：通过 ${run.comparisons.filter(item => item.resolution === "aligned" && item.deterministic === "passed").length}，失败 ${run.comparisons.filter(item => item.deterministic === "failed" || item.apiContract === "failed").length}，未验证/blocked ${comparisonCounts.unresolved}，N/A ${comparisonCounts.notApplicable}，缺少结果 ${comparisonCounts.missing}。`
      : `- 逐用例比较：对齐 ${comparisonCounts.aligned}，不一致 ${comparisonCounts.mismatch}，未验证/blocked ${comparisonCounts.unresolved}，N/A ${comparisonCounts.notApplicable}，缺少比较记录 ${comparisonCounts.missing}。`,
    `- 执行证据条目：确定性 ${run.deterministic.results.filter(item => selectedSet.has(item.id)).length}、视觉 ${run.runMode === "regression" ? "未运行" : run.ai.results.filter(item => selectedSet.has(item.id)).length}、API ${run.apiContract?.results.filter(item => selectedSet.has(item.id)).length ?? 0}；${run.runMode === "regression" ? "本轮不调用模型。" : `合计 ${evidenceCount}。`} 此处计数代表逐用例结果记录，不表示每条都含截图或完整 trace。`,
    "", "## 重测与恢复记录", "",
    ...(run.parentRunId ? [`- 父运行：${run.parentRunId}`] : ["- 父运行：无（首次运行或未关联重测）"]),
    `- 用例版本摘要：${run.caseVersion ?? "历史运行未记录"}`,
    ...(run.retestSelection ? [`- 本轮重测选择：${run.retestSelection.join(", ") || "无"}`] : ["- 本轮重测选择：非指定子集重测"]),
    ...(run.retestNotes ? [`- 重测说明：${run.retestNotes}`] : []), ...(run.retestScopeNote ? [`- 父运行范围说明：${run.retestScopeNote}`] : []),
    ...(run.recovery ? [`- 运行恢复：恢复 ${run.recovery.resumeCount} 次；跳过已完成用例 ${run.recovery.skippedCompletedCaseIds.length} 条；安全重试中断用例 ${run.recovery.interruptedRetryCaseIds.length} 条。`] : ["- 本运行记录没有中断恢复信息。"]),
    "- 结果对齐分类与根因初步分类分别记录；根因提示仅依据本轮留存证据，仍需人工复核。证据不足的项目会标为待确认。",
    ...(run.diagnostics?.length ? ["", "### 诊断证据", "", ...run.diagnostics.filter(item => item.classification === "mismatch" || item.classification === "unverified").map(item => `- ${item.caseId} [${item.classification}]：脚本=${item.deterministicEvidence}；Computer Use=${item.computerUseEvidence}${item.apiEvidence ? `；API=${item.apiEvidence}` : ""}`)] : []),
    "", "## 差异分析与后续建议", "", run.analysis ?? "无",
    ...(run.runMode === "compare" ? ["", "> AI 辅助对照模式使用配置的 Computer Use 能力。它与确定性脚本按顺序复用本轮浏览器页面和登录态，不是隔离会话中的独立复现；执行器会拦截已识别的提交、保存、删除、支付、确认等高风险操作。"] : []),
    "", ...lane("确定性用例", run.deterministic, selectedIds), ...(run.apiContract ? ["## API Contract 验证", "", run.apiContract.summary, ...(run.apiContract.scope?.length ? ["", "执行范围：", ...run.apiContract.scope.map(item => `- ${item}`)] : []), ...(run.apiContract.limitations?.length ? ["", "授权与限制：", ...run.apiContract.limitations.map(item => `- ${item}`)] : []), "", ...run.apiContract.results.filter(item => selectedSet.has(item.id)).map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.title} (${item.id}) — ${item.detail}`), ""] : []), ...(run.runMode === "compare" ? lane("视觉 Computer Use 验证", run.ai, selectedIds) : []),
    ...(run.runMode === "compare" && run.ai.diagnostics?.length ? ["", "### Computer Use 全局诊断", "", ...run.ai.diagnostics.map(item => `- ${item}`)] : []), "",
    ...(run.runMode === "compare" ? run.ai.results.filter(item => selectedSet.has(item.id)).map(item => `- ${scopeTagFor(item.id)}[${item.status}] ${item.title} (${item.id}) — ${item.detail}`) : []), "", run.runMode === "regression" ? "## 逐用例回归结果" : "## 逐用例对比", "",
    ...run.comparisons.map(item => `- ${scopeTagFor(item.id)}[${item.deterministic === "cancelled" || item.apiContract === "cancelled" ? "已取消" : item.deterministic === "not-run" || item.apiContract === "not-run" ? "未运行" : run.runMode === "regression" ? (item.resolution === "unresolved" ? "未验证" : item.resolution === "not-applicable" ? "N/A" : item.deterministic === "passed" && (!item.apiContract || item.apiContract === "passed") ? "通过" : "失败") : item.resolution === "mismatch" ? "结果不一致" : item.resolution === "unresolved" ? "未验证" : item.resolution === "not-applicable" ? "N/A" : item.aligned ? "结论一致" : "待处理"}] ${item.title} (${item.id}) — 脚本 ${item.deterministic}${run.runMode === "compare" ? ` / Computer Use ${item.computerUse}` : ""}${item.apiContract ? ` / API Contract ${item.apiContract}` : ""}${item.issue ? `：${item.issue}` : ""}${item.triage ? `；初步归类 ${triageCategoryLabels[item.triage.category]}（${item.triage.confidence === "evidence-based" ? "有直接证据" : "需复核"}）：${item.triage.detail}` : ""}${item.nextAction ? `；下一步：${item.nextAction}` : ""}`),
    ...(run.baselineComparison ? ["", "## 历史基线对比", "", `- 基线运行：${run.baselineRunId}`,
      ...(run.baselineEnvironmentComparison === "different" ? ["- 当前与基线的环境标识或目标站点来源不同；请先确认环境差异不会解释本轮状态变化。"] : []),
      ...(run.baselineEnvironmentComparison === "unknown" ? ["- 当前运行或基线缺少有效的环境或目标站点来源记录，无法确认环境一致。"] : []),
      ...(run.baselineRunModeComparison === "different" ? ["- 当前运行与基线使用了不同的验证方式；通道差异可能影响结果变化判断。"] : []),
      ...(run.baselineRunModeComparison === "unknown" ? ["- 当前运行或基线未记录验证方式，无法确认两轮方法一致。"] : []),
      `- 疑似回归 ${baselineDispositionCounts.regression ?? 0}；已修复 ${baselineDispositionCounts.fixed ?? 0}；未变化 ${baselineDispositionCounts.unchanged ?? 0}；用例已修改 ${baselineDispositionCounts["case-changed"] ?? 0}；新增 ${baselineDispositionCounts.added ?? 0}；移除 ${baselineDispositionCounts.removed ?? 0}；未运行 ${baselineDispositionCounts["not-run"] ?? 0}；无法比较 ${baselineDispositionCounts.unresolved ?? 0}；基线无结果 ${baselineDispositionCounts["no-baseline-result"] ?? 0}。`,
      ...run.baselineComparison.map(item => `- [基线 ${baselineRunScopeLabel(item.caseId)} → 本轮 ${currentRunScopeLabel(item)} · ${baselineDispositionLabels[item.disposition]}] ${item.caseId} ${item.title}：基线 ${baselineStatusLabel(item.baselineStatus)} → 本次 ${baselineStatusLabel(item.currentStatus)}${item.caseChanged ? "；用例或脚本内容已变化，不能直接归为产品回归" : ""}`),
    ] : []),
    ...(run.runMode === "compare" ? ["", "> 两侧结果相同是对本批用例的对齐证据，不证明应用没有其他缺陷或测试覆盖完整。"] : []),
  ].join("\n");
}

async function generateAlignedReport(project: DocumentProject, run: DocumentRun): Promise<string> {
  const reportData = {
    project: project.name,
    sourceFile: project.fileName,
    targetUrl: project.targetUrl,
    runMode: run.runMode,
    executionIsolation: "确定性 lane 与视觉 Computer Use lane 顺序共用同一浏览器页面及登录态，不是隔离上下文中的独立复现。",
    caseScope: run.caseScope,
    scopePlan: run.scopePlan,
    scopeClassification: run.scopePlan ? "依据 scopePlan 区分直接目标与关联影响检查" : run.caseScopeKnown === false ? "历史记录没有直接目标/关联影响范围标注" : "本轮没有直接目标/关联影响范围计划",
    excludedCaseIds: run.caseScope.excludedCaseIds,
    recovery: run.recovery,
    stepGeneration: run.stepGeneration,
    caseGeneration: project.caseGeneration ? { artifactId: project.caseGeneration.artifactId, version: project.caseGeneration.version, digest: project.caseGeneration.digest, requirements: project.caseGeneration.requirements, qualitySummary: project.caseGeneration.qualitySummary, warnings: project.caseGeneration.warnings, transferredCases: project.caseGeneration.transferredCases } : undefined,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    baselineRunSnapshot: run.baselineRunSnapshot,
    baselineEnvironmentComparison: run.baselineEnvironmentComparison,
    baselineRunModeComparison: run.baselineRunModeComparison,
    cases: project.cases.filter(check => run.caseScope.selectedCaseIds.includes(check.id)).map(check => ({
      id: check.id, title: check.title, source: check.source, requirementRefs: check.requirementRefs, priority: check.priority, category: check.category, confidence: check.confidence, coverageAreas: check.coverageAreas,
      runScope: run.scopePlan?.targetCaseIds.includes(check.id) ? "直接目标" : run.scopePlan?.impactCaseIds.includes(check.id) ? "关联影响" : run.scopePlan ? "范围未分类" : run.caseScopeKnown === false ? "历史范围未标注" : "目标/影响未标注",
      preconditions: check.preconditions, preconditionsConfirmed: check.preconditionsConfirmed, testData: check.testData,
      sideEffectRisk: check.sideEffectRisk, cleanup: check.cleanup, expected: check.expected,
      comparison: run.comparisons.find(result => result.id === check.id),
      deterministicEvidence: run.deterministic.results.find(result => result.id === check.id),
      visualEvidence: run.ai.results.find(result => result.id === check.id),
    })),
    deterministic: run.deterministic.summary,
    visual: run.ai.summary,
  };
  const message = await completeChat([
    { role: "system", content: "你是 QA 报告编辑。严格根据输入中的用例、逐通道结果、证据、时间戳和基线快照撰写中文报告摘要。不得臆造缺陷、证据或限制，不得声称数据未记录，除非输入确实缺少该数据。明确说明覆盖边界；只报告本次实际执行的用例和结果。根据每条用例的 runScope 区分直接目标与关联影响检查，不得把关联影响检查写成迭代直接目标，也不得声称未选用例已验证。基线环境不同或环境未知、两轮执行方式不同或方式未知时，明确说明状态变化不能单独归因于版本迭代。两条通道顺序复用同一浏览器页面和登录态，不得描述成隔离会话的独立复现。若证据字段没有截图，不要假称存在截图。" },
    { role: "user", content: JSON.stringify(reportData) },
  ], { maxTokens: 1200, timeoutMs: 60_000 });
  const summary = typeof message.content === "string" ? message.content.trim() : "";
  if (!summary) throw new Error("AI report generation returned no summary.");
  return summary;
}

async function analyzeDifferences(project: DocumentProject, comparisons: CaseComparison[], deterministic: LaneResult, visual: VisualLane): Promise<string> {
  const pending = comparisons.filter(item => !item.aligned);
  if (!pending.length) return "兩個通道逐用例结果一致，本轮无需重测。";
  try {
    const message = await completeChat([
      { role: "system", content: "你是 QA 差异分析助手。只根据输入的确定性脚本结果和视觉 Computer Use 结果判断差异原因；两者在本轮共享浏览器页面和登录态，不能把它们称为隔离会话中的独立复现。给出下一步：需要重测、需要修订定位/脚本、需要澄清预期、或疑似产品缺陷。不得自行修改或批准测试用例，不得声称证据未提供的事实。blocked 表示未能判定，不是产品失败。逐项引用用例 ID，优先建议最小核查动作。中文输出，最多 10 条建议。" },
      { role: "user", content: JSON.stringify({ targetUrl: project.targetUrl, cases: project.cases.filter(testCase => pending.some(item => item.id === testCase.id)).map(testCase => ({
        id: testCase.id, title: testCase.title, source: testCase.source, expected: testCase.expected,
        comparison: pending.find(item => item.id === testCase.id),
        deterministicEvidence: deterministic.results.find(result => result.id === testCase.id)?.detail.slice(0, 1800),
        computerUseEvidence: visual.results.find(result => result.id === testCase.id)?.detail.slice(0, 1800),
      })) }) },
    ], { maxTokens: 900, timeoutMs: 40_000 });
    const text = typeof message.content === "string" ? message.content.trim() : "";
    if (text) return text;
  } catch { /* static advice below remains available when model is offline */ }
  return pending.map(item => `- ${item.id} ${item.title}：脚本 ${item.deterministic} / Computer Use ${item.computerUse}。先核对页面现状与预期，再决定修订步骤或重测；不要把 blocked 当成产品失败。`).join("\n");
}

function documentPackageInputPath(runId: string): string { return path.join(runsDir, runId, "package-input.zip"); }

/** Finish the report/package stage using its saved inputs; this never opens the target site. */
async function finalizeDocumentRunPackage(project: DocumentProject, run: DocumentRun, journal: ExecutionJournal, packageInput: Uint8Array): Promise<DocumentRun> {
  const packagePath = path.join(runsDir, run.id, "testpilot-package.zip");
  const tempPackagePath = path.join(runsDir, run.id, `package.${randomUUID()}.tmp`);
  try {
    const finalizedPackage = refreshDocumentPackage(project, run, packageInput);
    await writeFile(tempPackagePath, finalizedPackage);
    await rename(tempPackagePath, packagePath);
  } finally {
    await unlink(tempPackagePath).catch(() => undefined);
  }
  run.packagePath = packagePath;
  run.packageReady = true;
  await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8");
  await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8");
  journal.finalizationRun = structuredClone(run);
  journal.status = run.overall === "cancelled" ? "cancelled" : "completed";
  journal.updatedAt = new Date().toISOString();
  delete journal.currentCase;
  delete journal.lastError;
  await saveExecutionJournal(journal);
  await unlink(documentPackageInputPath(run.id)).catch(() => undefined);
  return run;
}

/** Retry only report/package finalization from a completed execution checkpoint. */
export async function retryDocumentRunPackaging(runId: string): Promise<DocumentRun> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId)) throw new Error("运行 ID 无效。");
  if (activePackageFinalizations.has(runId)) throw new Error("该运行的报告与脚本包正在重新生成；请稍后刷新运行记录。");
  const journal = JSON.parse(await readFile(journalPath(runId), "utf8")) as ExecutionJournal;
  const run = journal.finalizationRun;
  if (journal.version !== 1 || journal.runId !== runId || journal.stage !== "packaging" || !["running", "failed"].includes(journal.status) || !run || run.id !== runId || !run.reportReady || !run.report) {
    throw new Error("没有可单独恢复的报告/打包快照；为避免再次访问目标网站，本次不会重跑用例。");
  }
  if (run.packageReady && run.packagePath && await readFile(run.packagePath).then(() => true, () => false)) return run;
  const project = await getDocumentProject(journal.projectId);
  if (!project || project.reviewStatus !== "approved" || projectDigest(project) !== journal.projectDigest || journal.targetUrl !== project.targetUrl) {
    throw new Error("项目、网址或审核版本已变化；不能用当前项目状态完成旧运行的报告/打包。");
  }
  if (journal.siteVersionSnapshot && project.targetUrl !== journal.siteVersionSnapshot.targetUrl) throw new Error("网站版本快照与项目当前网址不一致；拒绝打包。");
  if (journal.siteVersionSnapshot
    ? !project.siteVersions?.some(item => item.id === journal.siteVersionSnapshot!.id && JSON.stringify(item) === JSON.stringify(journal.siteVersionSnapshot))
    : (project.siteVersions?.length ?? 0) > 0) throw new Error("登记的网站版本与本轮快照不一致；拒绝用新版本完成旧报告。");
  const packageInput = await readFile(documentPackageInputPath(runId));
  activePackageFinalizations.add(runId);
  try {
    journal.status = "running";
    journal.updatedAt = new Date().toISOString();
    delete journal.lastError;
    await saveExecutionJournal(journal);
    return await finalizeDocumentRunPackage(project, run, journal, packageInput);
  } catch (error) {
    journal.status = "failed";
    journal.updatedAt = new Date().toISOString();
    journal.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    run.packagePath = "";
    run.packageReady = false;
    await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8").catch(() => undefined);
    await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8").catch(() => undefined);
    await saveExecutionJournal(journal).catch(() => undefined);
    throw error;
  } finally {
    activePackageFinalizations.delete(runId);
  }
}

export async function executeDocumentRun(project: DocumentProject, options: { runId?: string; resumeRunId?: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; parentRunId?: string; selectedCaseIds?: string[]; retestNotes?: string; retestScopeNote?: string; onStage?: (stage: ExecutionJournal["stage"]) => Promise<void>; beforeDeterministic?: (page: Page) => Promise<{ generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview?: boolean }>; afterDeterministic?: (page: Page) => Promise<{ generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview?: boolean }> } = {}): Promise<DocumentRun> {
  let startedAt = new Date().toISOString();
  const runId = options.resumeRunId ?? options.runId ?? randomUUID();
  let resumedJournal: ExecutionJournal | undefined;
  if (options.resumeRunId) {
    try { resumedJournal = JSON.parse(await readFile(journalPath(options.resumeRunId), "utf8")) as ExecutionJournal; }
    catch { throw new Error("恢复 journal 不存在或不可读；不会按当前全量选择重放用例。"); }
    if (resumedJournal.version !== 1 || resumedJournal.runId !== options.resumeRunId || resumedJournal.projectId !== project.id || !Array.isArray(resumedJournal.selectedCaseIds)) throw new Error("恢复 journal 的身份、项目或用例范围无效；不会重放执行。");
    if (options.runMode && resumedJournal.runMode && options.runMode !== resumedJournal.runMode) throw new Error("恢复请求的执行模式与原运行记录不同；拒绝改变运行模式。");
    if (options.baselineRunId && options.baselineRunId !== resumedJournal.baselineRunId) throw new Error("恢复请求的基线运行与 journal 原记录不同；拒绝改变历史比较基线。");
    if (options.testDataSetId && options.testDataSetId !== resumedJournal.testDataSetId) throw new Error("恢复请求的数据组与 journal 原记录不同；拒绝改变运行输入。");
    if (options.parameterValues && JSON.stringify(options.parameterValues) !== JSON.stringify(resumedJournal.parameterValues ?? {})) throw new Error("恢复请求的参数与 journal 原记录不同；拒绝改变运行输入。");
    if (options.selectedCaseIds && (options.selectedCaseIds.length !== resumedJournal.selectedCaseIds.length || options.selectedCaseIds.some((id, index) => id !== resumedJournal!.selectedCaseIds[index]))) throw new Error("恢复请求的用例范围与 journal 原始范围不同；拒绝扩展或缩小运行范围。");
    if (options.siteVersionSnapshot && JSON.stringify(options.siteVersionSnapshot) !== JSON.stringify(resumedJournal.siteVersionSnapshot)) throw new Error("恢复请求的网站版本与 journal 原始版本不同；拒绝在不同部署版本上续跑。");
    if (resumedJournal.siteVersionSnapshot && project.targetUrl !== resumedJournal.siteVersionSnapshot.targetUrl) throw new Error("恢复项目目标网址与 journal 的网站版本快照不一致；拒绝在其他部署版本上续跑。");
    if (resumedJournal.materialVersion && getDocumentMaterialVersion(project) !== resumedJournal.materialVersion) throw new Error("恢复时项目需求/测试资料版本与 journal 快照不一致；拒绝用新资料续跑旧运行。");
  }
  // New runs default to deterministic regression. Legacy journals have no
  // mode field and were produced by the former dual-lane runner, so resume
  // them without silently dropping their Computer Use lane.
  const runMode: DocumentRunMode = resumedJournal?.runMode ?? options.runMode ?? (resumedJournal ? "compare" : "regression");
  if (runMode !== "regression" && runMode !== "compare") throw new Error("runMode 必须是 regression 或 compare。");
  if (!options.resumeRunId && options.siteVersionSnapshot && project.targetUrl !== options.siteVersionSnapshot.targetUrl) throw new Error("运行目标网址与选择的网站版本不一致；拒绝在未固定的部署版本上启动。");
  const baselineRunId = options.baselineRunId ?? resumedJournal?.baselineRunId;
  const baselineRun = baselineRunId ? await getDocumentRun(baselineRunId) : undefined;
  if (baselineRunId && (!baselineRun || baselineRun.projectId !== project.id || !isDocumentBaselineEligible(baselineRun))) throw new Error("历史基线必须是同一项目中已完成、范围明确且所选用例均有确定结果的运行。");
  if (!options.resumeRunId && options.runId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.runId)) throw new Error("runId 只允许使用字母、数字、下划线或连字符，长度最多 128。 ");
    const existingRunDirectory = await readdir(path.join(runsDir, options.runId)).then(() => true, () => false);
    if (existingRunDirectory) throw new Error(`runId 已存在，拒绝覆盖已有执行记录：${options.runId}`);
  }
  const selectedCaseIds = options.selectedCaseIds ?? resumedJournal?.selectedCaseIds;
  if (!options.resumeRunId && !Array.isArray(options.selectedCaseIds)) throw new Error("新运行必须显式固定 selectedCaseIds；不会回退到项目全量选中用例。");
  if (!selectedCaseIds?.length) throw new Error("selectedCaseIds 不能为空；拒绝启动空范围或扩大到项目全量用例。");
  if (new Set(selectedCaseIds).size !== selectedCaseIds.length) throw new Error("selectedCaseIds 必须由唯一用例 ID 组成。");
  const projectCaseIds = new Set(project.cases.map(item => item.id));
  const unknownSelectedCases = selectedCaseIds.filter(id => !projectCaseIds.has(id));
  if (unknownSelectedCases.length) throw new Error("用例不属于当前项目：" + unknownSelectedCases.join(", "));
  const unavailableSelectedCases = selectedCaseIds.filter(id => project.cases.some(item => item.id === id && (item.lifecycleStatus === "draft" || item.lifecycleStatus === "disabled")));
  if (unavailableSelectedCases.length) throw new Error(`草稿或停用用例不能运行：${unavailableSelectedCases.join(", ")}。请将完整用例标记为可运行后，再明确选择本轮范围。`);
  const validatedScopePlan = validateDocumentRunScopePlan(options.scopePlan ?? resumedJournal?.scopePlan, selectedCaseIds);
  const runnableCaseIds = project.cases.filter(item => item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled").map(item => item.id);
  const inferredFullScope = runnableCaseIds.length === selectedCaseIds.length && runnableCaseIds.every(id => selectedCaseIds.includes(id));
  const inferredScopePlan: DocumentRunScopePlan = {
    mode: inferredFullScope ? "full" : selectedCaseIds.length === 1 ? "single" : "custom",
    targetCaseIds: [...selectedCaseIds],
    impactCaseIds: [],
  };
  // A new run without explicit classification is conservatively recorded as
  // direct targets. Legacy recovery keeps its original unclassified scope.
  const scopePlan = validatedScopePlan ?? (!options.resumeRunId ? inferredScopePlan : undefined);
  // Fresh impact selections need a traceable rationale. A child retest inherits
  // the parent's immutable classification; legacy parents may lack rationale,
  // which must be reported as missing instead of making that subset unrunnable.
  if (!options.resumeRunId && !options.parentRunId && scopePlan?.impactCaseIds.length) {
    const missingReasons = scopePlan.impactCaseIds.filter(id => !scopePlan.impactReasons?.[id]?.length);
    if (missingReasons.length) throw new Error(`每条关联影响用例都要有可追溯依据后才能启动：${missingReasons.join(", ")}。请重新分析或逐条确认关联关系。`);
  }
  if (options.resumeRunId && options.scopePlan !== undefined) {
    const originalScopePlan = validateDocumentRunScopePlan(resumedJournal?.scopePlan, selectedCaseIds);
    const canonicalizeScopePlan = (plan: DocumentRunScopePlan | undefined) => plan ? JSON.stringify({
      mode: plan.mode,
      targetCaseIds: [...plan.targetCaseIds].sort(),
      impactCaseIds: [...plan.impactCaseIds].sort(),
      impactReasons: Object.fromEntries(Object.entries(plan.impactReasons ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, reasons]) => [id, [...reasons].sort()])),
    }) : undefined;
    if (!originalScopePlan || canonicalizeScopePlan(scopePlan) !== canonicalizeScopePlan(originalScopePlan)) throw new Error("恢复请求不能改写 journal 中已固定的直接目标或关联影响范围。");
  }
  const selectedCaseIdSet = new Set(selectedCaseIds);
  let selectedCases = project.cases.filter(item => selectedCaseIdSet.has(item.id));
  if (!selectedCases.length) throw new Error("本轮没有选中任何回归用例；请至少选择一条用例后再运行。");
  if (!options.resumeRunId && scopePlan?.mode === "full") {
    const runnableIds = project.cases.filter(item => item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled").map(item => item.id);
    const selectedIds = new Set(selectedCaseIds);
    if (runnableIds.length !== selectedCaseIds.length || runnableIds.some(id => !selectedIds.has(id))) throw new Error("全量回归范围必须包含项目中的全部可运行用例。");
  }
  const testDataSetId = options.testDataSetId ?? resumedJournal?.testDataSetId;
  const parameterValues = resolveDocumentRunParameters(project, selectedCaseIds!, options.resumeRunId ? undefined : testDataSetId, options.resumeRunId ? resumedJournal?.parameterValues ?? {} : options.parameterValues ?? {});
  const resolveCasesForThisRun = (cases: BrowserCheck[]) => cases.map(item => ({ ...item, steps: item.steps.map(step => resolveBrowserStepParameters(step, parameterValues)) }));
  selectedCases = resolveCasesForThisRun(selectedCases);
  if (project.reviewStatus !== "approved") throw new Error("只有仍处于审核通过状态的项目才能运行或恢复。");
  const selectedIds = new Set(selectedCases.map(item => item.id));
  const caseScope = { selectedCaseIds: selectedCases.map(item => item.id), excludedCaseIds: project.cases.filter(item => !selectedIds.has(item.id)).map(item => item.id), totalCases: project.cases.length };
  const runCaseSnapshots = new Map(project.cases.map(item => [item.id, structuredClone(item)]));
  const updateRunCaseSnapshots = (generatedCaseIds: string[]) => {
    const selectedRunIds = new Set(caseScope.selectedCaseIds);
    for (const id of generatedCaseIds) {
      if (!selectedRunIds.has(id)) continue;
      const updated = project.cases.find(item => item.id === id);
      if (updated) runCaseSnapshots.set(id, structuredClone(updated));
    }
  };
  const areasFor = (cases: BrowserCheck[]) => [...new Set(cases.flatMap(item => [item.category, ...(item.coverageAreas ?? [])]))].sort() as CaseCategory[];
  const projectAreas = areasFor(project.cases);
  const selectedAreas = areasFor(selectedCases);
  const coverageSummary: CoverageSummary = { projectAreas, selectedAreas, notCoveredThisRun: projectAreas.filter(area => !selectedAreas.includes(area)) };
  let deterministic: LaneResult = { status: "cancelled", summary: "确定性通道尚未开始。", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行在确定性通道开始前被停止。", durationMs: 0 })) };
  let visual: VisualLane = runMode === "regression"
    ? { status: "not-applicable", summary: "常规回归模式未运行 AI 视觉通道。", provider: "not-run", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-applicable", detail: "常规回归仅使用已保存的确定性步骤；AI 视觉通道未运行。", durationMs: 0, actions: 0 })) }
    : { status: "cancelled", summary: "Computer Use 通道尚未开始。", provider: "not-run", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行在 Computer Use 通道开始前被停止。", durationMs: 0, actions: 0 })) };
  let apiContract: DocumentApiLane | undefined;
  let stepGeneration: DocumentRun["stepGeneration"];
  let session: Awaited<ReturnType<typeof launchPersistentTestPage>> | undefined;
  if (activeBrowserRuns.has(project.id)) throw new Error("该项目已有测试正在使用浏览器会话；请等待当前运行结束后再启动下一轮。");
  let journal: ExecutionJournal;
  if (options.resumeRunId) {
    const recovery = await getDocumentRunRecovery(project);
    if (!recovery || recovery.runId !== options.resumeRunId || !recovery.canResume) throw new Error(recovery?.reason ?? "找不到可恢复的中断运行；请启动一轮新测试。");
    journal = resumedJournal!;
    startedAt = journal.startedAt;
    journal.resumeCount++;
  } else {
    journal = { version: 1, runId, projectId: project.id, ...(options.workflowId ?? project.workflowId ? { workflowId: options.workflowId ?? project.workflowId } : {}), runMode, ...(scopePlan ? { scopePlan: structuredClone(scopePlan) } : {}), ...(options.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(options.siteVersionSnapshot) } : {}), materialVersion: getDocumentMaterialVersion(project), sourceMaterialsSnapshot: structuredClone(project.sourceMaterials ?? []), ...(options.baselineRunId ? { baselineRunId: options.baselineRunId } : {}), ...(testDataSetId ? { testDataSetId } : {}), parameterValues, projectDigest: projectDigest(project), targetUrl: project.targetUrl, selectedCaseIds: caseScope.selectedCaseIds, startedAt, updatedAt: startedAt, status: "running", stage: "starting", resumeCount: 0, ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}), ...(options.retestNotes ? { retestNotes: options.retestNotes } : {}), ...(options.retestScopeNote ? { retestScopeNote: options.retestScopeNote } : {}) };
  }
  const releasePageLease = acquireDocumentPageLease(project.id);
  if (!releasePageLease) throw new Error("该项目的共享浏览器页面正用于步骤生成或另一轮测试；请等待当前操作结束后重试。");
  const controller = new AbortController();
  const userDataDir = path.join(baseDir, "browser-profiles", project.id);
  activeDocumentRuns.set(runId, { controller, userDataDir, acceptingCancel: true });
  journal.status = "running"; journal.stage = "starting"; journal.updatedAt = new Date().toISOString(); delete journal.lastError;
  journal.runMode ??= runMode;
  const interruptedRetryCaseIds: string[] = [];
  const skippedCompletedCaseIds = [...new Set(selectedCases.filter(item => {
    const results = journal.caseResults ?? [];
    return results.some(result => result.id === item.id && result.lane === "deterministic")
      && (runMode === "regression" || results.some(result => result.id === item.id && result.lane === "computer-use"));
  }).map(item => item.id))];
  const updateStage = async (stage: ExecutionJournal["stage"]) => { journal.stage = stage; journal.updatedAt = new Date().toISOString(); await saveExecutionJournal(journal); await options.onStage?.(stage); };
  activeBrowserRuns.add(project.id);
  try {
    await saveExecutionJournal(journal);
    session = await launchPersistentTestPage(userDataDir);
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error("cancelled by user");
    // Establish the authenticated application page before running any cases.
    // In particular, empty-step cases must not all short-circuit as blocked
    // while the shared page is still about:blank; post-login authoring then
    // observes this same page and can continue without a second sign-in flow.
    await prepareSharedTargetPage(project.targetUrl, project.id, runId, session.page, waiting => updateStage(waiting ? "awaiting-login" : "starting"));
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error("cancelled by user");
    await updateStage("deterministic");
    const persistCaseResult = async (lane: "deterministic" | "computer-use", result: CaseResult & { actions?: number }) => {
      journal.caseResults = [...(journal.caseResults ?? []).filter(item => item.lane !== lane || item.id !== result.id), { lane, id: result.id, title: result.title, status: result.status, detail: result.detail.slice(0, 1200), durationMs: result.durationMs, updatedAt: new Date().toISOString(), ...(typeof result.actions === "number" ? { actions: result.actions } : {}) }];
      delete journal.currentCase;
      journal.updatedAt = new Date().toISOString();
      await saveExecutionJournal(journal);
    };
    const markCurrentCase = async (lane: "deterministic" | "computer-use", item: BrowserCheck) => { journal.currentCase = { lane, id: item.id, title: item.title }; journal.updatedAt = new Date().toISOString(); await saveExecutionJournal(journal); };
    const recoveredResults = journal.caseResults ?? [];
    const runRecoverableLane = async <T extends CaseResult & { actions?: number }>(lane: "deterministic" | "computer-use", cases: BrowserCheck[], runner: (pending: BrowserCheck[]) => Promise<{ status: LaneResult["status"]; summary: string; results: T[]; diagnostics?: string[]; provider?: string }>): Promise<{ status: LaneResult["status"]; summary: string; results: T[]; diagnostics?: string[]; provider?: string }> => {
      const prior = new Map(recoveredResults.filter(result => result.lane === lane && cases.some(item => item.id === result.id)).map(result => [result.id, result]));
      const active = options.resumeRunId && journal.currentCase?.lane === lane ? cases.find(item => item.id === journal.currentCase!.id) : undefined;
      const unsafeInterrupted = active && !prior.has(active.id) && active.sideEffectRisk !== "none" ? active : undefined;
      const retryableInterrupted = active && !prior.has(active.id) && active.sideEffectRisk === "none" ? active : undefined;
      if (retryableInterrupted) interruptedRetryCaseIds.push(retryableInterrupted.id);
      const blocked = unsafeInterrupted ? [{ id: unsafeInterrupted.id, title: unsafeInterrupted.title, status: "blocked" as const, detail: `进程在此用例中断，执行结果和副作用无法确认；风险标记为 ${unsafeInterrupted.sideEffectRisk}，为避免重放未自动重试。先核对目标状态并重新审核。`, durationMs: 0 }] as T[] : [];
      const pending = cases.filter(item => !prior.has(item.id) && item.id !== unsafeInterrupted?.id);
      const fresh = pending.length ? await runner(pending) : undefined;
      const byId = new Map<string, T>();
      for (const item of cases) {
        const saved = prior.get(item.id);
        if (saved) byId.set(item.id, { id: saved.id, title: saved.title, status: saved.status, detail: saved.detail, durationMs: saved.durationMs, ...(lane === "computer-use" ? { actions: saved.actions ?? 0 } : {}) } as T);
      }
      for (const item of blocked) byId.set(item.id, item);
      for (const result of fresh?.results ?? []) byId.set(result.id, result);
      if (unsafeInterrupted && journal.currentCase?.id === unsafeInterrupted.id && journal.currentCase.lane === lane) {
        delete journal.currentCase;
        journal.updatedAt = new Date().toISOString();
        await saveExecutionJournal(journal);
      }
      const results = cases.map(item => byId.get(item.id) ?? ({ id: item.id, title: item.title, status: "blocked" as const, detail: "恢复时未得到该用例结果；保留为未验证。", durationMs: 0 } as T));
      const applicable = results.filter(result => result.status !== "not-applicable");
      const passed = applicable.filter(result => result.status === "passed").length;
      const failed = applicable.filter(result => result.status === "failed").length;
      const blockedCount = applicable.filter(result => result.status === "blocked").length;
      const status = controller.signal.aborted ? "cancelled" : !applicable.length ? "not-applicable" : blockedCount ? "blocked" : failed ? "failed" : passed === applicable.length ? "passed" : "failed";
      const cancelledCount = results.filter(result => result.status === "cancelled").length;
      const notRunCount = results.filter(result => result.status === "not-run").length;
      const summary = controller.signal.aborted ? `运行被手动停止：${cancelledCount} 条取消、${notRunCount} 条未运行，${passed} 条已完成通过、${failed} 条已完成失败。` : `${passed}/${applicable.length} 条适用用例通过 · ${failed} 失败 · ${blockedCount} 阻塞 · ${results.length - applicable.length} N/A`;
      return { ...(fresh?.provider ? { provider: fresh.provider } : {}), ...(fresh?.diagnostics?.length ? { diagnostics: fresh.diagnostics } : {}), status, summary, results };
    };
    // Generate and validate missing safe steps against the already-authenticated
    // shared page before the deterministic lane starts. Previously generation
    // ran after the lane, so every empty-step case was first recorded as blocked
    // and only a subset could be replayed afterwards.
    if (runMode === "compare" && options.beforeDeterministic) {
      try {
        const originalSteps = new Map(selectedCases.map(item => [item.id, item.steps]));
        const prepared = await options.beforeDeterministic(session.page);
        if (prepared.generatedCaseIds.length || prepared.warning) {
          stepGeneration = { generatedCaseIds: prepared.generatedCaseIds, ...(prepared.caseResults?.length ? { caseResults: prepared.caseResults } : {}), ...(prepared.warning ? { warning: prepared.warning } : {}), requiresReview: prepared.requiresReview === true };
          journal.stepGeneration = stepGeneration;
          journal.updatedAt = new Date().toISOString();
          await saveExecutionJournal(journal);
        }
        if (prepared.generatedCaseIds.length) {
          journal.projectDigest = projectDigest(project);
          journal.updatedAt = new Date().toISOString();
          await saveExecutionJournal(journal);
          const runCaseIds = new Set(caseScope.selectedCaseIds);
          if (prepared.requiresReview !== true) {
            updateRunCaseSnapshots(prepared.generatedCaseIds);
            selectedCases = resolveCasesForThisRun(project.cases.filter(item => runCaseIds.has(item.id)));
          }
          else selectedCases = project.cases.filter(item => runCaseIds.has(item.id)).map(item => ({ ...item, steps: originalSteps.get(item.id) ?? item.steps }));
        }
      } catch (error) {
        stepGeneration = { generatedCaseIds: [], warning: `执行前步骤生成失败：${error instanceof Error ? error.message : String(error)}`, requiresReview: false };
        journal.stepGeneration = stepGeneration;
        journal.updatedAt = new Date().toISOString();
        await saveExecutionJournal(journal);
      }
    }
    deterministic = await runRecoverableLane<CaseResult>("deterministic", selectedCases, pending => runLane(project.targetUrl, pending, "确定性用例", project.id, runId, session!.page, waiting => updateStage(waiting ? "awaiting-login" : "deterministic"), result => persistCaseResult("deterministic", result), item => markCurrentCase("deterministic", item), controller.signal));
    if (!controller.signal.aborted && runMode === "compare" && options.afterDeterministic) {
      try {
        const originalSteps = new Map(selectedCases.map(item => [item.id, item.steps]));
        const prepared = await options.afterDeterministic(session.page);
        if (prepared.generatedCaseIds.length || prepared.warning) {
          stepGeneration = { generatedCaseIds: prepared.generatedCaseIds, ...(prepared.caseResults?.length ? { caseResults: prepared.caseResults } : {}), ...(prepared.warning ? { warning: prepared.warning } : {}), requiresReview: prepared.requiresReview === true };
          journal.stepGeneration = stepGeneration;
          journal.updatedAt = new Date().toISOString();
          await saveExecutionJournal(journal);
        }
        if (prepared.generatedCaseIds.length) {
          journal.projectDigest = projectDigest(project);
          journal.updatedAt = new Date().toISOString();
          await saveExecutionJournal(journal);
          const runCaseIds = new Set(caseScope.selectedCaseIds);
          if (prepared.requiresReview !== true) {
            updateRunCaseSnapshots(prepared.generatedCaseIds);
            selectedCases = resolveCasesForThisRun(project.cases.filter(item => runCaseIds.has(item.id)));
            const generated = selectedCases.filter(item => prepared.generatedCaseIds.includes(item.id));
            const repairedLane = await runLane(project.targetUrl, generated, "新生成脚本验证", project.id, runId, session.page, waiting => updateStage(waiting ? "awaiting-login" : "deterministic"), result => persistCaseResult("deterministic", result), item => markCurrentCase("deterministic", item), controller.signal);
            const byId = new Map(deterministic.results.map(item => [item.id, item]));
            for (const result of repairedLane.results) byId.set(result.id, result);
            const results = selectedCases.map(item => byId.get(item.id) ?? { id: item.id, title: item.title, status: "blocked" as const, detail: "本轮未得到确定性结果。", durationMs: 0 });
            const passed = results.filter(item => item.status === "passed").length;
            deterministic = { ...deterministic, status: passed === results.length ? "passed" : "failed", summary: `${passed}/${results.length} 条通过`, results };
          } else selectedCases = project.cases.filter(item => runCaseIds.has(item.id)).map(item => ({ ...item, steps: originalSteps.get(item.id) ?? item.steps }));
        }
      } catch (error) {
        stepGeneration = { generatedCaseIds: [], warning: `登录后步骤生成失败：${error instanceof Error ? error.message : String(error)}`, requiresReview: false };
        journal.stepGeneration = stepGeneration;
        journal.updatedAt = new Date().toISOString();
        await saveExecutionJournal(journal);
      }
    }
    if (runMode === "compare") {
      await updateStage("computer-use");
      visual = await runRecoverableLane<import("./computer-use.js").VisualCaseResult>("computer-use", selectedCases, pending => runComputerUseLane(project.targetUrl, pending, project.id, runId, session!.page, waiting => updateStage(waiting ? "awaiting-login" : "computer-use"), result => persistCaseResult("computer-use", result), item => markCurrentCase("computer-use", item), controller.signal)) as VisualLane;
    } else {
      visual = { status: "not-applicable", summary: "常规回归模式未运行 AI 视觉通道。", provider: "not-run", results: selectedCases.map(item => ({ id: item.id, title: item.title, status: "not-applicable", detail: "常规回归仅使用已保存的确定性步骤；AI 视觉通道未运行。", durationMs: 0, actions: 0 })) };
    }
    const apiCases = selectedCases.filter(item => planCaseExecution(item).route === "api-contract");
    if (apiCases.length && !controller.signal.aborted) {
      const candidate = project.apiContract?.suiteId ? await getApiSuiteCandidate(project.apiContract.suiteId) : undefined;
      const selectedApiCaseIds = new Set(apiCases.map(item => item.id));
      apiContract = await executeDocumentApiLane({
        candidate,
        documentCases: project.cases.filter(item => planCaseExecution(item).route === "api-contract").map(item => ({ id: item.id, title: item.title, selectedForRegression: selectedApiCaseIds.has(item.id) })),
        mapping: project.apiContract?.mappings ?? [],
        allowNetwork: project.apiContract?.allowNetwork === true,
        allowMutations: project.apiContract?.allowMutations === true,
        allowConcurrency: project.apiContract?.allowConcurrency === true,
        signal: controller.signal,
        runApproved: async (candidateId, apiOptions) => executeApprovedApiSuite(candidateId, { allowNetwork: apiOptions.allowNetwork, allowMutations: apiOptions.allowMutations, allowConcurrency: apiOptions.allowConcurrency, caseIds: apiOptions.selectedCaseIds, scopeOnly: true, ...(apiOptions.signal ? { signal: apiOptions.signal } : {}) }),
      });
    }
    if (apiCases.length && controller.signal.aborted && !apiContract) {
      apiContract = { status: "cancelled", summary: "API contract 用例尚未开始或未完成。", provider: "TestPilot approved API runner", results: apiCases.map(item => ({ id: item.id, title: item.title, status: "not-run", detail: "运行被手动停止；此 API 用例尚未执行。", apiCaseResults: [] })) };
    }
    const activeControl = activeDocumentRuns.get(runId);
    if (activeControl) activeControl.acceptingCancel = false;
  } catch (error) {
    if (!controller.signal.aborted) {
      journal.status = "failed"; journal.updatedAt = new Date().toISOString(); journal.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await saveExecutionJournal(journal).catch(() => undefined);
      throw error;
    }
    const reason = "运行在浏览器准备或用例执行过程中被手动停止。";
    const entries = journal.caseResults ?? [];
    const cancelledLane = (lane: "deterministic" | "computer-use"): LaneResult => ({
      status: "cancelled",
      summary: reason,
      results: selectedCases.map(item => {
        const saved = entries.find(result => result.lane === lane && result.id === item.id);
        if (saved) return { id: saved.id, title: saved.title, status: saved.status, detail: saved.detail, durationMs: saved.durationMs };
        const interrupted = journal.currentCase?.lane === lane && journal.currentCase.id === item.id;
        return { id: item.id, title: item.title, status: interrupted ? "cancelled" as const : "not-run" as const, detail: interrupted ? "运行在此用例期间被手动停止；当前结果未判定，可定向重跑。" : "运行被手动停止；此用例尚未执行，可定向重跑。", durationMs: 0 };
      }),
    });
    deterministic = cancelledLane("deterministic");
    if (runMode === "compare") {
      const cancelledVisual = cancelledLane("computer-use");
      visual = { ...cancelledVisual, provider: "cancelled", results: cancelledVisual.results.map(result => ({ ...result, actions: entries.find(saved => saved.lane === "computer-use" && saved.id === result.id)?.actions ?? 0 })) };
    }
    await disconnectPersistentTestPage(userDataDir);
  } finally {
    clearLoginHandoff(project.id);
    // Keep the project page and its live login state open for the next run.
    activeBrowserRuns.delete(project.id);
    activeDocumentRuns.delete(runId);
    releasePageLease();
  }
  const ai: LaneResult & { provider?: string } = visual;
  const deterministicById = new Map(deterministic.results.map(item => [item.id, item]));
  const computerById = new Map(ai.results.map(item => [item.id, item]));
  const apiById = new Map((apiContract?.results ?? []).map(item => [item.id, item]));
  const comparisons: CaseComparison[] = selectedCases.map(item => {
    const script = deterministicById.get(item.id);
    const visualCase = computerById.get(item.id);
    const left = script?.status ?? (controller.signal.aborted ? "not-run" : "blocked");
    const right = visualCase?.status ?? (controller.signal.aborted ? "not-run" : "blocked");
    const apiCase = apiById.get(item.id);
    const isApiRoute = planCaseExecution(item).route === "api-contract";
    const executionPlan = planCaseExecution(item);
    const partialFinding = partialUiFindingNote([script, visualCase].filter((result): result is CaseResult => Boolean(result)));
    const apiHasUiSubcheck = isApiRoute && item.steps.length > 0;
    const regressionTerminal = (status: CaseResult["status"]) => status === "passed" || status === "failed" || status === "not-applicable";
    const resolution = runMode === "regression"
      ? isApiRoute
        ? apiCase && regressionTerminal(apiCase.status) && (!apiHasUiSubcheck || regressionTerminal(left))
          ? "aligned"
          : "unresolved"
        : left === "not-applicable" ? "not-applicable" : regressionTerminal(left) ? "aligned" : "unresolved"
      : isApiRoute
      ? apiCase?.status === "passed" && (!apiHasUiSubcheck || (left === "passed" && right === "passed")) ? "aligned" : "unresolved"
      : classifyComparison(left, right);
    const aligned = resolution === "aligned";
    const regressionFailed = runMode === "regression" && (script?.status === "failed" || apiCase?.status === "failed");
    const issue = controller.signal.aborted && (left === "cancelled" || left === "not-run" || right === "cancelled" || right === "not-run" || apiCase?.status === "cancelled" || apiCase?.status === "not-run") ? "运行被手动停止；已完成结果保留，取消或尚未运行的用例可在本轮结果中定向重跑。"
      : resolution === "aligned" && !regressionFailed ? ""
      : runMode === "regression" && regressionFailed ? `常规回归已执行并发现失败：脚本 ${left}${apiCase ? ` / API ${apiCase.status}` : ""}。请检查逐步证据并确认是否为产品回归、测试数据或环境问题。`
      : resolution === "not-applicable" ? "需求来源标记为本期范围外；保留追溯，不计入通过。"
      : isApiRoute ? `${apiCase?.detail ?? "API contract lane 未产生结果。"}${apiHasUiSubcheck && (left !== "passed" || right !== "passed") ? `；另有浏览器子检查未双通道通过（脚本 ${left} / Computer Use ${right}）。` : ""}${partialFinding ? `；${partialFinding}` : ""} 下一步：${executionPlan.nextAction}`
      : left === "blocked" && right === "blocked" ? `两侧都未得到可判定结果；这是未验证项，不是两侧结果不一致。${executionPlan.reason}${partialFinding ? `；${partialFinding}` : ""} 下一步：${executionPlan.nextAction}`
      : left === "blocked" || right === "blocked" ? `只有一侧得到完整执行结果；当前无法进行双通道比较。${partialFinding ? `；${partialFinding}` : ""}`
          : `结果不一致：确定性脚本 ${left}，Computer Use ${right}。`;
    const nextAction = (resolution === "aligned" && !regressionFailed) || resolution === "not-applicable" ? undefined : executionPlan.nextAction;
    return { id: item.id, title: item.title, deterministic: left, computerUse: right, ...(apiCase ? { apiContract: apiCase.status } : {}), aligned, resolution, issue, ...(nextAction ? { nextAction } : {}) };
  });
  const applicableComparisons = comparisons.filter(item => item.resolution !== "not-applicable");
  const finalReady = !controller.signal.aborted && applicableComparisons.length > 0 && applicableComparisons.every(item => item.resolution === "aligned");
  const completedAt = new Date().toISOString();
  const onlyOutOfScope = comparisons.length > 0 && comparisons.every(item => item.deterministic === "not-applicable" && item.computerUse === "not-applicable" && (!item.apiContract || item.apiContract === "not-applicable"));
  const diagnostics = comparisons.map(comparison => {
    const deterministicResult = deterministic.results.find(result => result.id === comparison.id);
    const computerUseResult = ai.results.find(result => result.id === comparison.id);
    const apiResult = apiContract?.results.find(result => result.id === comparison.id);
    const resolution = comparison.resolution ?? "unresolved";
    return {
      caseId: comparison.id,
      classification: resolution === "mismatch" ? "mismatch" as const : resolution === "unresolved" ? "unverified" as const : resolution,
      resolution,
      deterministicEvidence: deterministicResult?.detail ?? "该通道没有结果。",
      computerUseEvidence: computerUseResult?.detail ?? (runMode === "regression" ? "常规回归模式未运行 Computer Use。" : "该通道没有结果。"),
      ...(apiResult ? { apiEvidence: apiResult.detail } : {}),
    };
  });
  const runParentId = options.parentRunId ?? journal.parentRunId;
  const regressionFailed = runMode === "regression" && comparisons.some(item => item.deterministic === "failed" || item.apiContract === "failed");
  const regressionBlocked = runMode === "regression" && comparisons.some(item => item.resolution === "unresolved");
  const caseSnapshots = [...runCaseSnapshots.values()];
  const executionCaseSnapshots = structuredClone(selectedCases);
  const snapshotProject = { ...project, cases: caseSnapshots };
  const caseVersions = Object.fromEntries(caseSnapshots.map(item => {
    const { selectedForRegression: _selection, ...caseRevision } = item;
    return [item.id, createHash("sha256").update(JSON.stringify({ ...caseRevision, steps: item.steps ?? [] })).digest("hex")];
  }));
  const caseTitles = Object.fromEntries(caseSnapshots.map(item => [item.id, item.title]));
  const caseInventory = Object.fromEntries(project.cases.map(item => [item.id, item.title]));
  const run: DocumentRun = { id: runId, projectId: project.id, ...(journal.workflowId ? { workflowId: journal.workflowId } : {}), runMode, ...(journal.scopePlan ? { scopePlan: structuredClone(journal.scopePlan) } : {}), ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(journal.siteVersionSnapshot) } : {}), materialVersion: journal.materialVersion ?? getDocumentMaterialVersion(project), sourceMaterialsSnapshot: structuredClone(journal.sourceMaterialsSnapshot ?? project.sourceMaterials ?? []), ...(baselineRunId ? { baselineRunId } : {}), testDataVersion: getDocumentTestDataVersion(journal.testDataSetId, journal.parameterValues ?? {}), ...(caseSnapshots.length ? { caseSnapshotVersion: 1 as const, caseSnapshots: structuredClone(caseSnapshots), executionCaseSnapshots } : {}), caseVersions, caseTitles, caseInventory, ...(runParentId ? { parentRunId: runParentId } : {}), caseVersion: getDocumentCaseVersion(snapshotProject), ...(runParentId ? { retestSelection: [...caseScope.selectedCaseIds] } : options.selectedCaseIds ? { retestSelection: [...options.selectedCaseIds] } : {}), ...(options.retestNotes ? { retestNotes: options.retestNotes } : journal.retestNotes ? { retestNotes: journal.retestNotes } : {}), ...(options.retestScopeNote ? { retestScopeNote: options.retestScopeNote } : journal.retestScopeNote ? { retestScopeNote: journal.retestScopeNote } : {}), startedAt, completedAt, caseScope, caseScopeKnown: true, ...(journal.resumeCount ? { recovery: { resumeCount: journal.resumeCount, replayedFromBeginning: false as const, skippedCompletedCaseIds, interruptedRetryCaseIds: [...new Set(interruptedRetryCaseIds)] } } : {}), coverageSummary, ...(stepGeneration ? { stepGeneration } : {}), deterministic, ai, ...(apiContract ? { apiContract } : {}), comparisons, diagnostics, finalReady, overall: controller.signal.aborted ? "cancelled" : onlyOutOfScope ? "partial" : runMode === "regression" ? regressionBlocked ? "unresolved" : regressionFailed ? "failed" : "passed" : !finalReady ? ai.status === "blocked" && deterministic.status === "passed" ? "partial" : "unresolved" : apiContract && deterministic.status === "blocked" && ai.status === "blocked" && apiContract.status === "passed" ? "passed" : deterministic.status === "passed" && ai.status === "passed" ? "passed" : "failed", report: "", packagePath: "" };
  if (baselineRun) {
    run.baselineRunSnapshot = {
      runId: baselineRun.id,
      startedAt: baselineRun.startedAt,
      completedAt: baselineRun.completedAt,
      ...(baselineRun.runMode ? { runMode: baselineRun.runMode } : {}),
      ...(baselineRun.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(baselineRun.siteVersionSnapshot) } : {}),
      ...(baselineRun.caseVersion ? { caseVersion: baselineRun.caseVersion } : {}),
      ...(baselineRun.materialVersion ? { materialVersion: baselineRun.materialVersion } : {}),
      ...(baselineRun.testDataVersion ? { testDataVersion: baselineRun.testDataVersion } : {}),
      ...(baselineRun.scopePlan ? { scopePlan: structuredClone(baselineRun.scopePlan) } : {}),
      selectedCaseCount: baselineRun.caseScope.selectedCaseIds.length,
      totalCases: baselineRun.caseScope.totalCases,
    };
    run.baselineRunModeComparison = !run.runMode || !baselineRun.runMode
      ? "unknown"
      : run.runMode === baselineRun.runMode ? "same" : "different";
    const currentEnvironment = run.siteVersionSnapshot?.environment.trim().toLocaleLowerCase() ?? "";
    const baselineEnvironment = baselineRun.siteVersionSnapshot?.environment.trim().toLocaleLowerCase() ?? "";
    const targetOrigin = (targetUrl: string | undefined) => {
      try { return targetUrl ? new URL(targetUrl).origin.toLocaleLowerCase() : ""; }
      catch { return ""; }
    };
    const currentOrigin = targetOrigin(run.siteVersionSnapshot?.targetUrl);
    const baselineOrigin = targetOrigin(baselineRun.siteVersionSnapshot?.targetUrl);
    run.baselineEnvironmentComparison = !currentEnvironment || !baselineEnvironment || !currentOrigin || !baselineOrigin
      ? "unknown"
      : currentEnvironment === baselineEnvironment && currentOrigin === baselineOrigin ? "same" : "different";
    run.baselineComparison = compareDocumentRunToBaseline(run, baselineRun);
    run.baselineMaterialChanged = Boolean(run.materialVersion && baselineRun.materialVersion && run.materialVersion !== baselineRun.materialVersion);
    run.baselineTestDataChanged = Boolean(run.testDataVersion && baselineRun.testDataVersion && run.testDataVersion !== baselineRun.testDataVersion);
  }
  run.comparisons = run.comparisons.map(comparison => {
    const evidence = [
      apiContract?.results.find(item => item.id === comparison.id),
      deterministic.results.find(item => item.id === comparison.id),
      visual.results.find(item => item.id === comparison.id),
    ].filter((item): item is CaseResult => Boolean(item));
    const relevant = evidence.find(item => item.status === "failed") ?? evidence.find(item => item.status === "blocked");
    if (!relevant) return comparison;
    const baseline = run.baselineComparison?.find(item => item.caseId === comparison.id);
    const triage = classifyDocumentCaseTriage({
      status: relevant.status,
      detail: relevant.detail,
      ...(baseline ? { baselineDisposition: baseline.disposition } : {}),
      ...(baseline?.caseChanged !== undefined ? { caseChanged: baseline.caseChanged } : {}),
      ...(run.baselineMaterialChanged !== undefined ? { materialChanged: run.baselineMaterialChanged } : {}),
      ...(run.baselineTestDataChanged !== undefined ? { testDataChanged: run.baselineTestDataChanged } : {}),
      ...(run.baselineEnvironmentComparison ? { baselineEnvironmentComparison: run.baselineEnvironmentComparison } : {}),
      ...(run.baselineRunModeComparison ? { baselineRunModeComparison: run.baselineRunModeComparison } : {}),
      regressionMode: runMode === "regression",
    });
    return triage ? { ...comparison, triage } : comparison;
  });
  if (journal.testDataSetId) run.testDataSetId = journal.testDataSetId;
  if (Object.keys(journal.parameterValues ?? {}).length) run.parameterValues = { ...journal.parameterValues };
  if (!controller.signal.aborted) await updateStage("analysis");
  run.analysis = controller.signal.aborted
    ? "本轮运行已手动取消。已保留停止前完成的逐用例结果；当前用例标记取消，未执行的用例标记未运行，可从本轮结果定向重跑。"
    : runMode === "regression"
      ? "常规回归模式不调用模型。请依据逐用例结果和保存的执行证据区分产品缺陷、测试数据问题、环境问题或过期用例。"
      : await analyzeDifferences(project, comparisons, deterministic, visual);
  let aiSummary = controller.signal.aborted
    ? `本轮运行已取消：已完成 ${comparisons.filter(item => item.deterministic === "passed" || item.deterministic === "failed").length} 条确定性结果；取消/未运行 ${comparisons.filter(item => item.deterministic === "cancelled" || item.deterministic === "not-run" || item.computerUse === "cancelled" || item.computerUse === "not-run" || item.apiContract === "cancelled" || item.apiContract === "not-run").length} 条。未运行项不会被计为通过。`
    : runMode === "regression"
    ? `常规回归完成：通过 ${comparisons.filter(item => item.resolution === "aligned" && (item.deterministic === "passed" || item.deterministic === "not-applicable" && item.apiContract === "passed") && (!item.apiContract || item.apiContract === "passed")).length} 条；失败 ${comparisons.filter(item => item.deterministic === "failed" || item.apiContract === "failed").length} 条；未验证 ${comparisons.filter(item => item.resolution === "unresolved").length} 条；N/A ${comparisons.filter(item => item.resolution === "not-applicable").length} 条。失败和阻塞均保留逐用例结果，不会被算作通过。`
    : finalReady
      ? "本轮所需执行路径均按用例 ID 得到确定结论。API contract 路由由已审核 API runner 验证；浏览器 UI 路由由对应浏览器 lane 验证。以下报告不代表已覆盖应用的所有缺陷。"
      : `本轮为${run.overall === "partial" ? "部分运行" : "未完成运行"}：已验证且结论一致 ${comparisons.filter(item => item.resolution === "aligned").length} 条；真实结果不一致 ${comparisons.filter(item => item.resolution === "mismatch").length} 条；尚未验证 ${comparisons.filter(item => item.resolution === "unresolved").length} 条；范围外 N/A ${comparisons.filter(item => item.resolution === "not-applicable").length} 条。blocked 表示未能判定，不算通过或产品失败；请根据逐用例证据复核后决定是否重测。`;
  if (!controller.signal.aborted) await updateStage("report");
  if (!controller.signal.aborted && runMode === "compare" && finalReady) {
    try { aiSummary = await generateAlignedReport(project, run); }
    catch (error) { aiSummary += `\n\nAI 摘要未能生成，以下逐用例报告由 TestPilot 根据执行记录生成。原因：${error instanceof Error ? error.message : String(error)}`; }
  }
  run.report = reportMarkdown(project, run, aiSummary);
  Object.assign(run, redactSensitiveExportData(run));
  run.reportReady = true;
  await mkdir(path.join(runsDir, run.id), { recursive: true });
  journal.finalizationRun = structuredClone(run);
  journal.updatedAt = new Date().toISOString();
  await saveExecutionJournal(journal);
  activePackageFinalizations.add(run.id);
  try {
  if (!controller.signal.aborted) await updateStage("packaging");
  const reusableRunner = `import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const suite=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url)));
const forbidden=/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\\s*order|send|reset|log\\s*out/i;
const cdp=process.env.TESTPILOT_BROWSER_CDP_ENDPOINT;let browser;if(cdp){const u=new URL(cdp);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!u.port)throw Error('CDP must be a loopback HTTP endpoint with an explicit port');browser=await chromium.connectOverCDP(cdp);}else browser=await chromium.launch({headless:true}).catch(async e=>{if(process.platform==='win32'&&/executable|browser|launch/i.test(String(e)))return chromium.launch({headless:true,channel:'msedge'});throw e;});const out=[];const sharedContext=cdp?browser.contexts()[0]:undefined;if(cdp&&!sharedContext)throw Error('No Edge browser context is available');
const waitText=async(page,text)=>{const end=Date.now()+5000;while(Date.now()<end){for(const f of page.frames()){try{if((await f.locator('body').innerText({timeout:250})).includes(text))return;}catch{}}await page.waitForTimeout(100);}throw Error('Visible text not found in page/frame: '+text)};const field=async(page,label)=>{const accessible=page.getByLabel(label,{exact:false});if(await accessible.count())return accessible.first();const selector='input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea';const clean=s=>s.replaceAll(' ','').replace(/[：:＊*]/g,'').toLowerCase();const matches=await page.locator(selector).evaluateAll((els,args)=>els.flatMap((el,i)=>{if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)||!el.getClientRects().length)return[];let p=el;for(let d=0;d<5&&p;d++,p=p.parentElement){const text=(p instanceof HTMLElement?p.innerText:p.textContent||'').replaceAll(' ','').replace(/[：:＊*]/g,'').toLowerCase();const n=p.querySelectorAll(args.selector).length+(p.matches(args.selector)?1:0);if(text.includes(args.label.replaceAll(' ','').replace(/[：:＊*]/g,'').toLowerCase())&&n===1)return[i]}return[]}),{label,selector});if(matches.length)return page.locator(selector).nth(matches[0]);const tableIndex=await page.locator('table').evaluateAll((tables,args)=>tables.flatMap(t=>{const rows=[...t.querySelectorAll('tr')];for(const row of rows){const col=[...row.children].findIndex(c=>c.textContent?.replaceAll(' ','').replace(/[：:＊*]/g,'').toLowerCase()===args.label.replaceAll(' ','').replace(/[：:＊*]/g,'').toLowerCase());if(col<0)continue;return rows.flatMap(r=>{const el=r.children[col]?.querySelector(args.selector);if(!el||!el.getClientRects().length)return[];const i=[...document.querySelectorAll(args.selector)].indexOf(el);return i>=0?[i]:[]})}return[]}),{label,selector});if(tableIndex.length)return page.locator(selector).nth(tableIndex[0]);throw Error('Unable to resolve field: '+label)};
const selectOption=async(page,label,value)=>{const labeled=page.getByLabel(label,{exact:false}).first();if(await labeled.count())return labeled.selectOption({label:value}).catch(()=>labeled.selectOption(value));const candidates=await page.locator('select').evaluateAll((els,args)=>els.flatMap((el,i)=>{const p=[el.closest('label')?.innerText,el.parentElement?.innerText].filter(Boolean).join(' ');const has=[...el.options].some(o=>o.textContent?.trim()===args.value||o.value===args.value);return p.includes(args.label)&&has?[i]:[]} ),{label,value});if(candidates.length!==1)throw Error('Ambiguous or missing select label/option: '+label+' / '+value);const el=page.locator('select').nth(candidates[0]);return el.selectOption({label:value}).catch(()=>el.selectOption(value));};
try{for(const c of suite.cases.filter(c=>!Array.isArray(suite.selectedCaseIds)||suite.selectedCaseIds.includes(c.id))){const page=cdp?await sharedContext.newPage():await browser.newPage();let status='passed',detail='';try{if(!c.steps?.length)throw Error('Blocked: no executable steps');if(!c.steps.some(s=>['assertText','assertVisible','assertExactVisible','assertRoleVisible','assertValue','assertValueByPlaceholder','assertDisabled'].includes(s.action)))throw Error('Blocked: no result assertion');const origin=new URL(suite.targetUrl).origin;const requestAllowed=__BROWSER_REQUEST_POLICY__;let blockAllValidationRequests=false;await page.route('**/*',async route=>{const req=route.request();if(blockAllValidationRequests)return route.abort('blockedbyclient');if(!requestAllowed(req.method(),req.url(),{targetOrigin:origin,resourceType:req.resourceType(),isNavigationRequest:req.isNavigationRequest(),isMainFrameNavigation:req.isNavigationRequest()&&req.frame().parentFrame()===null,loginHandoffActive:false,authOrigins:[]}))return route.abort('blockedbyclient');return route.continue();});await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});for(const s of c.steps??[]){if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);else if(s.action==='selectByLabel')await page.getByLabel(s.label,{exact:false}).first().selectOption({label:s.value}).catch(()=>page.getByLabel(s.label,{exact:false}).first().selectOption(s.value));else if(s.action==='clickByRole'){if(forbidden.test(s.name))throw Error('Unsafe click blocked');const el=page.getByRole(s.role,{name:s.name,exact:true}).first();if(await el.evaluate(e=>(e instanceof HTMLButtonElement&&e.type==='submit')||(e instanceof HTMLInputElement&&['submit','image'].includes(e.type))))throw Error('Form submit blocked');await el.click();}else if(s.action==='clickExactText'){if(forbidden.test(s.text))throw Error('Unsafe click blocked');const el=page.getByText(s.text,{exact:true}).first();const target=await el.evaluate(e=>{const n=e.closest('button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio]')||e;return {submit:n instanceof HTMLButtonElement&&n.type==='submit'||n instanceof HTMLInputElement&&['submit','image'].includes(n.type),label:[n.textContent,n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('name'),n.getAttribute('type')].filter(Boolean).join(' ')}});if(target.submit||forbidden.test(target.label))throw Error('Form submit or unsafe click blocked');await el.click();}else if(s.action==='assertText'){await waitText(page,s.text);if(!(await page.locator('body').innerText()).includes(s.text))throw Error('Text not found: '+s.text);}else if(s.action==='assertVisible')await waitText(page,s.text);else if(s.action==='assertExactVisible')await waitText(page,s.text);else if(s.action==='assertRoleVisible')await page.getByRole(s.role,{name:s.name,exact:true}).first().waitFor({state:'visible',timeout:5000});else if(s.action==='assertValue'){const el=page.getByLabel(s.label,{exact:false}).first();await el.waitFor({state:'visible',timeout:5000});if(await el.inputValue()!==s.value)throw Error('Value mismatch: '+s.label);}else if(s.action==='assertValueByPlaceholder'){const el=page.getByPlaceholder(s.placeholder,{exact:true});if(await el.count()!==1)throw Error('Placeholder is not unique: '+s.placeholder);await el.waitFor({state:'visible',timeout:5000});if(await el.inputValue()!==s.value)throw Error('Value mismatch: '+s.placeholder);}else if(s.action==='assertDisabled'){const el=page.getByLabel(s.label,{exact:false}).first();await el.waitFor({state:'visible',timeout:5000});if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.label);}}}catch(e){detail=String(e);status=detail.startsWith('Blocked:')?'blocked':'failed';}finally{out.push({id:c.id,title:c.title,status,detail});await page.close();}}}finally{await browser.close();}
writeFileSync('report.json',JSON.stringify(out,null,2));console.log(out);if(out.some(x=>x.status!=='passed'))process.exitCode=1;
`;
  const packagedRunner = reusableRunner
    .replace("__BROWSER_REQUEST_POLICY__", browserRequestPolicySource())
    .replace("await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});", "await page.goto(suite.targetUrl,{waitUntil:'domcontentloaded'});const gateText=(await page.locator('body').innerText().catch(()=>'' )).replace(/\\s+/g,' ').trim();if(/^(?:请在(?:企业)?微信客户端(?:内|中)?打开(?:此|该)?链接[。！!]?|please open (?:this )?link in (?:the )?(?:wechat|wecom)(?: work)? client[.!]?)$/iu.test(gateText))throw Error('Blocked: 当前页只显示微信客户端访问提示，业务页面未加载');")
    .replace("for(const s of c.steps??[]){if(s.action==='fillByLabel')", "let capturedUrl;for(const s of c.steps??[]){if(s.action==='captureCurrentUrl')capturedUrl=page.url();else if(s.action==='assertCurrentUrlUnchanged'){if(!capturedUrl)throw Error('Blocked: URL baseline missing');if(page.url()!==capturedUrl)throw Error('URL changed after validation')}else if(s.action==='triggerClientValidation'){const role=page.getByRole('button',{name:s.name,exact:true});let el=role;if(await role.count()!==1)el=page.getByText(s.name,{exact:true}).filter({visible:true});const ok=await el.count()===1&&await el.evaluate(n=>{let p=n;for(let d=0;d<5&&p;d++,p=p.parentElement){if(p instanceof HTMLButtonElement)return p.type==='submit';if(p.matches('a,[role=link]'))return false;if(p.matches('[role=button],[class*=btn],[class*=button]'))return true}return false});if(!ok)throw Error('Blocked: unique visible submit control required for isolated client validation');blockAllValidationRequests=true;try{await el.click({timeout:5000});await page.waitForTimeout(800)}finally{blockAllValidationRequests=false}}else if(s.action==='fillByLabel')")
    .replace("blockAllValidationRequests=true;try{await el.click", "const disabled=await el.evaluate(n=>{let p=n;for(let d=0;d<5&&p;p=p.parentElement,d++){if(!(p instanceof HTMLButtonElement||p instanceof HTMLInputElement||p.matches('[role=button],[class*=btn],[class*=button]')))continue;const c=typeof p.className==='string'?p.className:'';return ((p instanceof HTMLButtonElement||p instanceof HTMLInputElement)&&p.disabled)||p.getAttribute('aria-disabled')==='true'||/disabled/i.test(c)||getComputedStyle(p).pointerEvents==='none'}return false});if(disabled)throw Error('Blocked: submit button disabled; valid synthetic fixtures required for all other mandatory fields');blockAllValidationRequests=true;try{await el.click")
    .replace("if(!c.steps.some(s=>['assertText','assertVisible','assertExactVisible','assertRoleVisible','assertValue','assertValueByPlaceholder','assertDisabled'].includes(s.action)))", "if(!c.steps.some(s=>['assertText','assertVisible','assertNotVisible','assertExactVisible','assertRoleVisible','assertRoleDisabled','assertMaxLengthOrMessage','assertValue','assertValueByPlaceholder','assertDisabled','assertFieldInvalid','assertNoFetchOrXhr','assertNoHorizontalOverflow'].includes(s.action)))")
    .replace("let capturedUrl;for(const s of c.steps??[]){if(s.action==='captureCurrentUrl')", "let captureFetchOrXhr=false;const observedFetchOrXhr=[];page.on('request',r=>{if(captureFetchOrXhr&&['fetch','xhr'].includes(r.resourceType()))observedFetchOrXhr.push(r.method()+' '+r.resourceType())});let capturedUrl;for(const s of c.steps??[]){if(s.action==='startFetchOrXhrCapture'){observedFetchOrXhr.length=0;captureFetchOrXhr=true;}else if(s.action==='assertNoFetchOrXhr'){if(!captureFetchOrXhr)throw Error('Network capture was not started');await page.waitForTimeout(s.quietMs??1000);captureFetchOrXhr=false;if(observedFetchOrXhr.length)throw Error('Unexpected fetch/XHR count: '+observedFetchOrXhr.length+' (methods and types only)')}else if(s.action==='captureCurrentUrl')")
    .replace("if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);", "if(s.action==='fillByRoleIndex'){const fields=page.getByRole(s.role);if(s.index>=await fields.count())throw Error('Combobox index out of range: '+s.index);await fields.nth(s.index).fill(s.value);}else if(s.action==='fillByPlaceholder'){const field=page.getByPlaceholder(s.placeholder,{exact:false});if(await field.count()!==1)throw Error('Placeholder missing or ambiguous: '+s.placeholder);await field.fill(s.value);}else if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);")
    .replace("if(s.action==='fillByRoleIndex'){const fields=page.getByRole(s.role);if(s.index>=await fields.count())throw Error('Combobox index out of range: '+s.index);await fields.nth(s.index).fill(s.value);}else if(s.action==='fillByPlaceholder'){const field=page.getByPlaceholder(s.placeholder,{exact:false});if(await field.count()!==1)throw Error('Placeholder missing or ambiguous: '+s.placeholder);await field.fill(s.value);}", "if(s.action==='fillByRoleIndex'){const fields=page.getByRole(s.role);if(s.index>=await fields.count())throw Error('Combobox index out of range: '+s.index);await fields.nth(s.index).fill(s.value);}else if(s.action==='fillByPlaceholder'){const field=page.getByPlaceholder(s.placeholder,{exact:false});if(await field.count()!==1)throw Error('Placeholder missing or ambiguous: '+s.placeholder);await field.fill(s.value);}else if(s.action==='blurByLabel')await (await field(page,s.label,s.rowIndex)).blur();")
    .replace("else if(s.action==='blurByLabel')await (await field(page,s.label,s.rowIndex)).blur();", "else if(s.action==='blurByLabel')await (await field(page,s.label,s.rowIndex)).blur();else if(s.action==='blurByPlaceholder'){const el=page.getByPlaceholder(s.placeholder,{exact:true});if(await el.count()!==1)throw Error('Placeholder is ambiguous: '+s.placeholder);await el.blur();}")
    .replace("const selector='input:not([type=\"hidden\"]):not([type=\"submit\"]):not([type=\"button\"]),textarea';", "const selector='input:not([type=\"hidden\"]):not([type=\"submit\"]):not([type=\"button\"]),textarea,select';")
    .replace("el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement", "el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement")
    .replace("const field=async(page,label)=>", "const field=async(page,label,rowIndex=0)=>")
    .replace("return accessible.first();const selector=", "return accessible.nth(rowIndex);const selector=")
    .replace("return page.locator(selector).nth(matches[0]);", "return page.locator(selector).nth(matches[rowIndex]);")
    .replace("return page.locator(selector).nth(tableIndex[0]);", "return page.locator(selector).nth(tableIndex[rowIndex]);")
    .replace("else if(s.action==='selectByLabel')await page.getByLabel(s.label,{exact:false}).first().selectOption({label:s.value}).catch(()=>page.getByLabel(s.label,{exact:false}).first().selectOption(s.value));", "else if(s.action==='selectByLabel')await selectOption(page,s.label,s.value);")
    .replace("else if(s.action==='selectByLabel')await selectOption(page,s.label,s.value);", "else if(s.action==='selectByLabel')await selectOption(page,s.label,s.value);else if(s.action==='selectByPlaceholder'){const el=page.getByPlaceholder(s.placeholder,{exact:true});if(await el.count()!==1)throw Error('Placeholder must identify one unique control: '+s.placeholder);if(await el.evaluate(n=>n instanceof HTMLSelectElement))await el.selectOption({label:s.value}).catch(()=>el.selectOption(s.value));else{await el.click();const opt=page.getByRole('option',{name:s.value,exact:true});if(await opt.count()===1)await opt.click();else{const txt=page.getByText(s.value,{exact:true});if(await txt.count()!==1)throw Error('Ambiguous or missing visible option: '+s.value);await txt.click();}}}else if(s.action==='selectByRoleIndex'){const controls=page.getByRole('combobox');if(s.index<0||s.index>=await controls.count())throw Error('Combobox index is out of range: '+s.index);const control=controls.nth(s.index);await control.waitFor({state:'visible',timeout:5000});await control.click();const option=page.getByRole('option',{name:s.value,exact:true});if(await option.count()===1)await option.click();else{const txt=page.getByText(s.value,{exact:true});if(await txt.count()!==1||!(await txt.isVisible()))throw Error('Ambiguous or missing visible option: '+s.value);await txt.click();}}")
    .replace("if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);", "if(s.action==='fillByRoleIndex'){const fields=page.getByRole(s.role);if(s.index>=await fields.count())throw Error('Combobox index out of range: '+s.index);await fields.nth(s.index).fill(s.value);}else if(s.action==='fillByPlaceholder'){const field=page.getByPlaceholder(s.placeholder,{exact:false});if(await field.count()!==1)throw Error('Placeholder missing or ambiguous: '+s.placeholder);await field.fill(s.value);}else if(s.action==='blurByPlaceholder'){const el=page.getByPlaceholder(s.placeholder,{exact:true});if(await el.count()!==1)throw Error('Placeholder is ambiguous: '+s.placeholder);await el.blur();}else if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);")
    .replace("const txt=page.getByText(s.value,{exact:true});if(await txt.count()!==1||!(await txt.isVisible()))throw Error('Ambiguous or missing visible option: '+s.value);", "const txt=page.getByText(s.value,{exact:true}).filter({visible:true});if(await txt.count()!==1)throw Error('Ambiguous or missing visible option: '+s.value);")
    .replace("if(!c.steps.some(s=>['assertText','assertVisible','assertExactVisible','assertRoleVisible','assertValue','assertValueByPlaceholder','assertDisabled'].includes(s.action)))", "if(!c.steps.some(s=>['assertText','assertVisible','assertNotVisible','assertExactVisible','assertRoleVisible','assertRoleDisabled','assertMaxLengthOrMessage','assertValue','assertValueByPlaceholder','assertDisabled','assertFieldInvalid','assertNoHorizontalOverflow'].includes(s.action)))")
    .replace("else if(s.action==='assertVisible')await waitText(page,s.text);", "else if(s.action==='assertVisible')await waitText(page,s.text);else if(s.action==='assertNotVisible'){const el=page.getByText(s.text,{exact:true}).first();if(await el.count()&&await el.isVisible())throw Error('Unexpected visible text: '+s.text);}")
    .replace("else if(s.action==='assertVisible')await waitText(page,s.text);", "else if(s.action==='assertVisible')await waitText(page,s.text);else if(s.action==='assertNoHorizontalOverflow'){const m=await page.evaluate(()=>{const w=window.innerWidth;const d=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const o=[...document.querySelectorAll('input,select,textarea,button,a,[role=button],[role=link]')].flatMap(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return !n.getClientRects().length||s.visibility==='hidden'||s.display==='none'||Number(s.opacity)===0||r.width<1||r.height<1||r.right<=w+1&&r.left>=-1?[]:[{tag:n.tagName.toLowerCase(),text:(n.textContent||'').trim().slice(0,40),left:Math.round(r.left),right:Math.round(r.right)}]}).slice(0,5);return{w,d,o}});if(m.d>m.w+1||m.o.length)throw Error('Responsive overflow at '+m.w+'px: page='+m.d+'px out-of-bounds='+JSON.stringify(m.o));}")
    .replace("if(m.d>m.w+1||m.o.length)throw Error('Responsive overflow at '+m.w+'px: page='+m.d+'px out-of-bounds='+JSON.stringify(m.o));", "const t=[...document.querySelectorAll('h1,h2,h3,h4,p,li,label,button,a,[role=button],[role=link]')].flatMap(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();if(!n.getClientRects().length||s.visibility==='hidden'||s.display==='none'||Number(s.opacity)===0||r.bottom<=0||r.top>=innerHeight)return[];return(r.right>w+1||r.left< -1||(['hidden','clip'].includes(s.overflowX)&&n.scrollWidth>n.clientWidth+1))?[{tag:n.tagName.toLowerCase(),text:(n.textContent||'').trim().slice(0,60),left:Math.round(r.left),right:Math.round(r.right)}]:[]}).slice(0,5);if(m.d>m.w+1||m.o.length||t.length)throw Error('Responsive overflow at '+m.w+'px: page='+m.d+'px out-of-bounds='+JSON.stringify(m.o)+' clippedText='+JSON.stringify(t));")
    .replace("if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);", "if(s.action==='fillByLabel')await (await field(page,s.label,s.rowIndex)).fill(s.value);")
    .replace("else if(s.action==='fillByLabel')await page.getByLabel(s.label,{exact:false}).first().fill(s.value);", "else if(s.action==='fillByLabel')await (await field(page,s.label,s.rowIndex)).fill(s.value);")
    .replace("else if(s.action==='assertValue'){const el=page.getByLabel(s.label,{exact:false}).first();", "else if(s.action==='assertValueByPlaceholder'){let el=page.getByPlaceholder(s.placeholder,{exact:true});const count=await el.count();if(count!==1){if(count>1)throw Error('Placeholder is ambiguous: '+s.placeholder);const matches=await page.locator('input').evaluateAll((xs,v)=>xs.flatMap((x,i)=>x instanceof HTMLInputElement&&x.getClientRects().length&&x.value===v?[i]:[]),s.value);if(matches.length!==1)throw Error('Placeholder disappeared and value is not unique: '+s.placeholder);el=page.locator('input').nth(matches[0]);}await el.waitFor({state:'visible',timeout:5000});if(await el.inputValue()!==s.value)throw Error('Value mismatch: '+s.placeholder);}else if(s.action==='assertValue'){const el=await field(page,s.label,s.rowIndex);")
    .replace("else if(s.action==='assertDisabled'){const el=page.getByLabel(s.label,{exact:false}).first();", "else if(s.action==='assertDisabled'){const el=await field(page,s.label);")
    .replace("else if(s.action==='assertDisabled'){const el=await field(page,s.label);await el.waitFor({state:'visible',timeout:5000});if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.label);}", "else if(s.action==='assertDisabled'){const el=await field(page,s.label);await el.waitFor({state:'visible',timeout:5000});if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.label);}else if(s.action==='assertRoleDisabled'){const el=page.getByRole(s.role,{name:s.name,exact:true}).first();if(await el.count()){if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.name);}else{const text=page.getByText(s.name,{exact:true}).first();const state=await text.evaluate(n=>{for(let p=n,d=0;p&&d<5;p=p.parentElement,d++){if(p.matches('button,[role=button],[aria-disabled=true],[class*=btn],[class*=button]')){const c=typeof p.className==='string'?p.className:'';return p.hasAttribute('disabled')||p.getAttribute('aria-disabled')==='true'||/disabled/i.test(c)||getComputedStyle(p).pointerEvents==='none'}}return false});if(!state)throw Error('Expected disabled: '+s.name);}}else if(s.action==='assertMaxLengthOrMessage'){const el=await field(page,s.label);if((await el.inputValue()).length>s.maxLength)await waitText(page,s.message);}")
    .replace("else if(s.action==='assertDisabled'){const el=await field(page,s.label);await el.waitFor({state:'visible',timeout:5000});if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.label);}", "else if(s.action==='assertDisabled'){const el=await field(page,s.label);await el.waitFor({state:'visible',timeout:5000});if(!(await el.isDisabled()))throw Error('Expected disabled: '+s.label);}else if(s.action==='assertFieldInvalid'){const el=await field(page,s.label);await el.waitFor({state:'visible',timeout:5000});const invalid=await el.evaluate(n=>{const c=n;if(c.getAttribute('aria-invalid')==='true'||('validity'in c&&!c.validity.valid))return true;if(/(?:invalid|error|danger)/i.test(typeof c.className==='string'?c.className:''))return true;return ['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor'].some(k=>{const m=getComputedStyle(c)[k].match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);return !!m&&Number(m[1])>150&&Number(m[2])<130&&Number(m[3])<130})});if(!invalid)throw Error('Expected invalid field: '+s.label);}")
    .replace("else if(s.action==='assertFieldInvalid'){const el=await field(page,s.label);", "else if(s.action==='assertFieldInvalid'){const el=await field(page,s.label,s.rowIndex);")
    .replace("if(!invalid)throw Error('Expected invalid field: '+s.label);", "if(!invalid){const wrapper=await el.evaluate(n=>{let p=n.parentElement;for(let d=0;d<3&&p;d++,p=p.parentElement){if(p.querySelectorAll('input,select,textarea').length>1)break;const c=getComputedStyle(p);if(['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor'].some(k=>{const m=c[k].match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);return !!m&&Number(m[1])>150&&Number(m[2])<150&&Number(m[3])<150}))return true;}return false});if(!wrapper)throw Error('Expected invalid field: '+s.label);}")
    .replace("}}catch(e){detail=String(e);status=detail.startsWith('Blocked:')?'blocked':'failed';}", "}if(status==='passed'&&c.coverageGap){status='blocked';detail='Visible subchecks passed; remaining coverage: '+c.coverageGap;}}catch(e){detail=String(e);status=detail.startsWith('Blocked:')?'blocked':'failed';}")
    .replace("let capturedUrl;for(const s of c.steps??[]){if(s.action==='startFetchOrXhrCapture')", "let capturedUrl;for(const s of c.steps??[]){if(s.action==='setViewport')await page.setViewportSize({width:s.width,height:s.height});else if(s.action==='scrollToRatio'){await page.evaluate(r=>window.scrollTo({top:Math.max(0,document.documentElement.scrollHeight-window.innerHeight)*r,behavior:'instant'}),s.ratio);await page.waitForTimeout(200)}else if(s.action==='setReducedMotion')await page.emulateMedia({reducedMotion:s.value?'reduce':'no-preference'});else if(s.action==='startFetchOrXhrCapture')")
    .replace("if(!c.steps?.length)",
    "if((c.preconditions??[]).some(p=>!/^需要目标系统专用测试环境和\\/或测试账号、接口 mock\\/沙箱数据$/.test(p))&&c.preconditionsConfirmed!==true)throw Error('Blocked: specific preconditions are not confirmed');if(!c.steps?.length)",
  );
  const packageActions = [...new Set(selectedCases.flatMap(item => item.steps.map(step => step.action)))];
  const unsupportedPackageActions = packageActions.filter(action => !packagedRunner.includes(`s.action==='${action}'`));
  if (unsupportedPackageActions.length) throw new Error(`导出的独立 runner 缺少以下 BrowserStep 动作的执行分支：${unsupportedPackageActions.join(", ")}`);
  run.packagePath = "";
  run.packageReady = false;
const bundle = zipSync({ "README.md": strToU8(`# ${project.name}\n\n需求来源：${project.fileName}\n目标：${project.targetUrl}\n本次运行模式：${run.runMode ?? "compare"}\n本次运行结论：${run.overall}\n资料版本：${run.materialVersion ?? "历史运行未记录"}\n测试数据版本：${run.testDataVersion ?? "历史运行未记录"}\n\n使用步骤：安装 Node.js 22+ 与 Playwright Chromium，再运行 npm install && npx playwright install chromium。检查 cases.json 后运行 npm run test。允许按标签填写/选择，点击明确的安全非提交控件，并验证页面文本、可见性、字段值、无效/红框状态、禁用状态和响应式横向溢出。` + "`startFetchOrXhrCapture`/`assertNoFetchOrXhr` 只检查限定时间窗内的 fetch/XHR；不记录 URL/参数，也不代表服务端、sendBeacon、WebSocket 或其它渠道均无请求。视觉通道无法从截图证明无网络请求。" + ` 提交、保存、删除、支付、确认等动作会被 runner 拒绝。此 ZIP 提供的确定性脚本不需要模型，可独立运行；缺少步骤或断言的用例会明确记为 blocked。\n\n若目标网站需要当前 Edge 登录态，可在启动 Edge 时添加 --remote-debugging-port=9222，再设置 TESTPILOT_BROWSER_CDP_ENDPOINT=http://127.0.0.1:9222 后运行测试。Runner 会在该会话中打开新标签页，仅对测试标签页阻止非 GET/HEAD 请求，并关闭测试标签页。\n\n包中保留本轮执行记录和状态说明。结果只代表本批实际执行用例，不表示没有其他 bug。\n`), "workflow-plan.json": strToU8(JSON.stringify(project.workflowPlan ?? [], null, 2)), "research-examples.json": strToU8(JSON.stringify({ notice: project.researchExamples?.length ? "公开网页仅作未验证参考" : "无公开搜索结果", results: project.researchExamples ?? [] }, null, 2)), "source-materials.json": strToU8(JSON.stringify(run.sourceMaterialsSnapshot ?? [], null, 2)), "cases.json": strToU8(JSON.stringify({ targetUrl: project.targetUrl, materialVersion: run.materialVersion, testDataSetId: run.testDataSetId, testDataVersion: run.testDataVersion, caseMode: project.caseMode ?? "both", cases: project.cases }, null, 2)), ...(project.caseGeneration ? { "case-generation.json": strToU8(JSON.stringify(project.caseGeneration, null, 2)) } : {}), "report.md": strToU8(run.report), "run.json": strToU8(JSON.stringify({ id: run.id, runMode: run.runMode, siteVersionSnapshot: run.siteVersionSnapshot, materialVersion: run.materialVersion, sourceMaterialsSnapshot: run.sourceMaterialsSnapshot, caseVersion: run.caseVersion, testDataSetId: run.testDataSetId, testDataVersion: run.testDataVersion, parameterValues: run.parameterValues, baselineRunId: run.baselineRunId, baselineMaterialChanged: run.baselineMaterialChanged, baselineTestDataChanged: run.baselineTestDataChanged, baselineComparison: run.baselineComparison, startedAt: run.startedAt, completedAt: run.completedAt, recovery: run.recovery, retestNotes: run.retestNotes, retestScopeNote: run.retestScopeNote, stepGeneration: run.stepGeneration, overall: run.overall, finalReady: run.finalReady, deterministic: run.deterministic, ai: run.ai, apiContract: run.apiContract, comparisons: run.comparisons, analysis: run.analysis, caseGeneration: project.caseGeneration ? { artifactId: project.caseGeneration.artifactId, version: project.caseGeneration.version, digest: project.caseGeneration.digest } : undefined }, null, 2)), "package.json": strToU8(JSON.stringify({ private: true, scripts: { test: "node run.mjs" }, dependencies: { playwright: "^1.64.1" } }, null, 2)), "run.mjs": strToU8(packagedRunner) });
  const packageEntries = unzipSync(bundle);
  packageEntries["cases.json"] = strToU8(JSON.stringify({ targetUrl: project.targetUrl, siteVersionSnapshot: run.siteVersionSnapshot, materialVersion: run.materialVersion, testDataSetId: run.testDataSetId, testDataVersion: run.testDataVersion, caseMode: project.caseMode ?? "both", runMode: run.runMode, scopePlan: run.scopePlan, selectedCaseIds: caseScope.selectedCaseIds, cases: selectedCases, excludedCaseIds: caseScope.excludedCaseIds }, null, 2));
  packageEntries["run.json"] = strToU8(JSON.stringify({ id: run.id, runMode: run.runMode, scopePlan: run.scopePlan, siteVersionSnapshot: run.siteVersionSnapshot, materialVersion: run.materialVersion, sourceMaterialsSnapshot: run.sourceMaterialsSnapshot, caseVersion: run.caseVersion, testDataSetId: run.testDataSetId, testDataVersion: run.testDataVersion, parameterValues: run.parameterValues, baselineRunId: run.baselineRunId, baselineRunSnapshot: run.baselineRunSnapshot, baselineEnvironmentComparison: run.baselineEnvironmentComparison, baselineRunModeComparison: run.baselineRunModeComparison, baselineMaterialChanged: run.baselineMaterialChanged, baselineTestDataChanged: run.baselineTestDataChanged, baselineComparison: run.baselineComparison, startedAt: run.startedAt, completedAt: run.completedAt, recovery: run.recovery, retestNotes: run.retestNotes, retestScopeNote: run.retestScopeNote, stepGeneration: run.stepGeneration, overall: run.overall, finalReady: run.finalReady, caseScope, deterministic: run.deterministic, ai: run.ai, apiContract: run.apiContract, comparisons: run.comparisons, analysis: run.analysis }, null, 2));
  const packageInput = zipSync(packageEntries);
  await writeFile(documentPackageInputPath(run.id), packageInput);
  return await finalizeDocumentRunPackage(project, run, journal, packageInput);
  } catch (error) {
    journal.status = "failed";
    journal.updatedAt = new Date().toISOString();
    journal.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    run.packagePath = "";
    run.packageReady = false;
    journal.finalizationRun = structuredClone(run);
    await writeFile(path.join(runsDir, run.id, "report.md"), run.report, "utf8").catch(() => undefined);
    await writeFile(path.join(runsDir, run.id, "run.json"), JSON.stringify(run, null, 2), "utf8").catch(() => undefined);
    await saveExecutionJournal(journal).catch(() => undefined);
    throw error;
  } finally {
    activePackageFinalizations.delete(run.id);
  }
}

export async function writeDocumentSource(project: DocumentProject, bytes: Uint8Array, originalName = project.fileName, index = 1): Promise<void> {
  const material = project.sourceMaterials?.[index - 1];
  if (!material || material.role === "website-content" || material.fileName !== originalName) throw new Error("保存的原始资料与项目资料清单不匹配。");
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== material.sha256 || bytes.byteLength !== material.byteLength) throw new Error(`原始资料 ${originalName} 的内容与项目记录摘要不匹配；拒绝覆盖或保存不一致的文件。`);
  const key = sourceMaterialStorageKey(project.id, material);
  const filePath = path.join(projectsDir, ...key.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  try { await writeFile(filePath, bytes, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(filePath);
    if (createHash("sha256").update(existing).digest("hex") !== material.sha256 || existing.byteLength !== material.byteLength) throw new Error(`已存在的资料文件 ${originalName} 与记录摘要不一致；拒绝覆盖。`);
  }
}

export async function readDocumentSource(project: DocumentProject, materialId: string): Promise<Buffer> {
  const index = (project.sourceMaterials ?? []).findIndex(item => item.id === materialId);
  const material = project.sourceMaterials?.[index];
  if (!material || material.role === "website-content") throw new Error("项目资料不存在或不是已上传的原始文件。");
  const key = sourceMaterialStorageKey(project.id, material);
  const currentPath = path.join(projectsDir, ...key.split("/"));
  const legacyName = `${project.id}-${index + 1}-${path.basename(material.fileName).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120)}`;
  let bytes: Buffer;
  try { bytes = await readFile(currentPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    bytes = await readFile(path.join(projectsDir, legacyName));
  }
  if (bytes.byteLength !== material.byteLength || createHash("sha256").update(bytes).digest("hex") !== material.sha256) throw new Error(`原始资料 ${material.fileName} 与项目中的 SHA-256 记录不匹配；拒绝使用损坏或已被改写的资料。`);
  return bytes;
}

export async function getDocumentProject(id: string): Promise<DocumentProject | undefined> { return (await loadDocumentProjects()).find(item => item.id === id); }

/** Inspect only an already-open project Edge page; this never launches, navigates, or replaces a browser. */
export async function getDocumentProjectSessionStatus(
  project: Pick<DocumentProject, "id" | "targetUrl" | "sessionIdentityNote">,
  targetUrl = project.targetUrl,
): Promise<DocumentProjectSessionStatus> {
  const checkedAt = new Date().toISOString();
  const identityNote = project.sessionIdentityNote?.trim();
  const identity = identityNote ? { identityNote, identitySource: "user-confirmed" as const } : {};
  const handoff = getLoginHandoff(project.id);
  const occupied = activeBrowserRuns.has(project.id) || activeDocumentPageLeases.has(project.id);
  if (occupied) return {
    state: "occupied", occupied: true,
    manualLoginRequired: handoff ? handoff.status === "waiting_for_user" : null,
    ...identity, checkedAt,
    message: handoff?.status === "waiting_for_user"
      ? "当前运行正在等待你在项目 Edge 窗口完成登录。"
      : "项目 Edge 会话正被运行或步骤操作占用；为避免干扰，暂不检查页面。",
  };

  const session = await getExistingPersistentTestPage(path.join(baseDir, "browser-profiles", project.id)).catch(() => undefined);
  if (!session || session.page.isClosed()) return {
    state: "unavailable", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
    message: "没有检测到可复用的项目 Edge 会话。运行时会连接或打开该项目的浏览器，并在需要时提示人工登录。",
  };

  try {
    if (await isLoginPage(session.page)) return {
      state: "connected", occupied: false, manualLoginRequired: true, ...identity, checkedAt,
      message: "Edge 会话已连接，当前页面显示登录界面；需要你在这个窗口完成登录。",
    };
    const actualOrigin = new URL(session.page.url()).origin;
    const expectedOrigin = new URL(targetUrl).origin;
    if (actualOrigin === expectedOrigin) return {
      state: "connected", occupied: false, manualLoginRequired: false, ...identity, checkedAt,
      message: "Edge 会话已连接到当前目标网站，未检测到登录界面；这不代表目标系统的账号权限已验证。",
    };
    return {
      state: "unknown", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
      message: "Edge 会话已连接，但当前页面不是本轮目标网站；登录状态需要在运行时确认。",
    };
  } catch {
    return {
      state: "unknown", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
      message: "Edge 会话已连接，但无法可靠判断当前页面是否需要登录。",
    };
  }
}
export async function readDocumentPackage(runId: string): Promise<Buffer> { return readFile(path.join(runsDir, runId, "testpilot-package.zip")); }
export async function getDocumentRun(runId: string): Promise<DocumentRun | undefined> {
  try {
    const stored = JSON.parse(await readFile(path.join(runsDir, runId, "run.json"), "utf8")) as Partial<DocumentRun>;
    if (!stored || typeof stored.id !== "string" || !Array.isArray(stored.comparisons)) return undefined;
    const comparisonIds = stored.comparisons.map(item => item?.id).filter((id): id is string => typeof id === "string");
    const caseScopeKnown = Boolean(stored.caseScope && Array.isArray(stored.caseScope.selectedCaseIds) && Array.isArray(stored.caseScope.excludedCaseIds) && Number.isFinite(stored.caseScope.totalCases));
    const selectedCaseIds = caseScopeKnown ? stored.caseScope!.selectedCaseIds : comparisonIds;
    const normalized: DocumentRun = {
      ...stored,
      id: stored.id,
      projectId: typeof stored.projectId === "string" ? stored.projectId : "legacy",
      startedAt: typeof stored.startedAt === "string" ? stored.startedAt : "未知",
      completedAt: typeof stored.completedAt === "string" ? stored.completedAt : "未知",
      caseScope: caseScopeKnown ? stored.caseScope! : { selectedCaseIds, excludedCaseIds: [], totalCases: selectedCaseIds.length },
      caseScopeKnown,
      deterministic: stored.deterministic ?? { status: "blocked", summary: "历史记录没有确定性通道记录。", results: [] },
      ai: stored.ai ?? { status: "blocked", summary: "历史记录没有 Computer Use 通道记录。", results: [] },
      comparisons: stored.comparisons,
      finalReady: stored.finalReady === true,
      reportReady: stored.reportReady === true || Boolean(stored.report),
      packageReady: stored.packageReady === true,
      overall: stored.overall ?? "unresolved",
      report: typeof stored.report === "string" ? stored.report : "",
      packagePath: typeof stored.packagePath === "string" ? stored.packagePath : "",
    };
    return normalized;
  } catch { return undefined; }
}

export type DocumentRunListItem = { id: string; startedAt: string; completedAt: string; overall: DocumentRun["overall"]; executionState?: "running" | "interrupted" | "failed"; stage?: ExecutionJournal["stage"]; recordedCaseCount?: number; resultCounts?: Record<string, number>; lastError?: string; canFinalizePackage?: boolean; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; parentRunId?: string; baselineRunId?: string; baselineSiteVersionSnapshot?: DocumentSiteVersion; baselineEnvironmentComparison?: DocumentRun["baselineEnvironmentComparison"]; baselineRunModeComparison?: DocumentRun["baselineRunModeComparison"]; caseTitles?: Record<string, string>; siteVersionSnapshot?: DocumentSiteVersion; caseVersion?: string; materialVersion?: string; testDataVersion?: string; selectedCaseCount: number; totalCases: number; baselineEligible: boolean };

export async function listDocumentRuns(projectId: string): Promise<DocumentRunListItem[]> {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const project = await getDocumentProject(projectId);
  const runs = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => getDocumentRun(entry.name)));
  const completed = await Promise.all(runs.filter((run): run is DocumentRun => run?.projectId === projectId).map(async run => {
    const scopedIds = run.scopePlan ? [...run.scopePlan.targetCaseIds, ...run.scopePlan.impactCaseIds] : [];
    const caseTitles = Object.fromEntries(scopedIds.map(id => [id, run.caseTitles?.[id] ?? id]));
    const item: DocumentRunListItem = {
      id: run.id, startedAt: run.startedAt, completedAt: run.completedAt, overall: run.overall,
      ...(run.runMode ? { runMode: run.runMode } : {}),
      ...(run.scopePlan ? { scopePlan: structuredClone(run.scopePlan), caseTitles } : {}),
      ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      ...(run.baselineRunId ? { baselineRunId: run.baselineRunId } : {}),
      ...(run.baselineRunSnapshot?.siteVersionSnapshot ? { baselineSiteVersionSnapshot: structuredClone(run.baselineRunSnapshot.siteVersionSnapshot) } : {}),
      ...(run.baselineEnvironmentComparison ? { baselineEnvironmentComparison: run.baselineEnvironmentComparison } : {}),
      ...(run.baselineRunModeComparison ? { baselineRunModeComparison: run.baselineRunModeComparison } : {}),
      ...(run.siteVersionSnapshot ? { siteVersionSnapshot: run.siteVersionSnapshot } : {}),
      ...(run.caseVersion ? { caseVersion: run.caseVersion } : {}),
      ...(run.materialVersion ? { materialVersion: run.materialVersion } : {}),
      ...(run.testDataVersion ? { testDataVersion: run.testDataVersion } : {}),
      selectedCaseCount: run.caseScope.selectedCaseIds.length, totalCases: run.caseScope.totalCases,
      baselineEligible: isDocumentBaselineEligible(run),
    };
    try {
      const journal = JSON.parse(await readFile(journalPath(run.id), "utf8")) as ExecutionJournal;
      if (journal.version === 1 && journal.projectId === projectId && journal.stage === "packaging" && run.packageReady !== true && ["running", "failed"].includes(journal.status)) {
        const resultCounts: Record<string, number> = {};
        for (const result of journal.caseResults ?? []) resultCounts[result.status] = (resultCounts[result.status] ?? 0) + 1;
        item.executionState = activeDocumentRuns.has(run.id) || activePackageFinalizations.has(run.id) ? "running" : journal.status === "failed" ? "failed" : "interrupted";
        item.stage = journal.stage;
        item.recordedCaseCount = journal.caseResults?.length ?? 0;
        item.resultCounts = resultCounts;
        if (journal.lastError) item.lastError = journal.lastError;
        if (await canSafelyFinalizeDocumentRunPackage(project, journal)) item.canFinalizePackage = true;
      }
    } catch { /* older completed runs may not have an execution journal */ }
    return item;
  }));
  const finalizedIds = new Set(completed.map(item => item.id));
  const incomplete: DocumentRunListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || finalizedIds.has(entry.name)) continue;
    try {
      const journal = JSON.parse(await readFile(journalPath(entry.name), "utf8")) as ExecutionJournal;
      if (journal.version !== 1 || journal.projectId !== projectId || journal.runId !== entry.name || !["running", "failed"].includes(journal.status)) continue;
      const counts: Record<string, number> = {};
      for (const result of journal.caseResults ?? []) counts[result.status] = (counts[result.status] ?? 0) + 1;
      const finalization = journal.finalizationRun;
      const scopePlan = journal.scopePlan;
      const scopedIds = scopePlan ? [...scopePlan.targetCaseIds, ...scopePlan.impactCaseIds] : journal.selectedCaseIds;
      const titlesFromResults = Object.fromEntries((journal.caseResults ?? []).map(item => [item.id, item.title]));
      const caseTitles = Object.fromEntries(scopedIds.map(id => [id, finalization?.caseTitles?.[id] ?? titlesFromResults[id] ?? id]));
      const canFinalizePackage = await canSafelyFinalizeDocumentRunPackage(project, journal);
      incomplete.push({
        id: journal.runId, startedAt: journal.startedAt, completedAt: journal.updatedAt, overall: "unresolved",
        executionState: activeDocumentRuns.has(journal.runId) || activePackageFinalizations.has(journal.runId) ? "running" : journal.status === "failed" ? "failed" : "interrupted",
        stage: journal.stage, recordedCaseCount: journal.caseResults?.length ?? 0, resultCounts: counts,
        ...(journal.lastError ? { lastError: journal.lastError } : {}), ...(canFinalizePackage ? { canFinalizePackage: true } : {}),
        ...(journal.runMode ? { runMode: journal.runMode } : {}), ...(scopePlan ? { scopePlan: structuredClone(scopePlan), caseTitles } : {}),
        ...(journal.parentRunId ? { parentRunId: journal.parentRunId } : {}), ...(journal.baselineRunId ? { baselineRunId: journal.baselineRunId } : {}),
        ...(journal.siteVersionSnapshot ? { siteVersionSnapshot: structuredClone(journal.siteVersionSnapshot) } : {}),
        ...(finalization?.caseVersion ? { caseVersion: finalization.caseVersion } : {}),
        ...(journal.materialVersion ? { materialVersion: journal.materialVersion } : {}),
        selectedCaseCount: journal.selectedCaseIds.length, totalCases: finalization?.caseScope.totalCases ?? project?.cases.length ?? journal.selectedCaseIds.length,
        baselineEligible: false,
      });
    } catch { /* malformed or unrelated folders do not hide completed history */ }
  }
  return [...completed, ...incomplete].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200);
}


