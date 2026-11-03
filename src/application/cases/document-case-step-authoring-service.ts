import { createHash } from "node:crypto";
import {missingRequiredAssertions} from '../../domain/document-required-assertions.js';
import { resolveDocumentCaseEntryUrl } from '../../domain/document-case-entry.js';
import type { BrowserCheck, BrowserStep, DocumentProject, PageExplorationTraceEntry, StepGenerationCaseResult } from "../../domain/document-test-model.js";
import { documentProjectRevisionDigest } from "../../domain/document-project-revision-digest.js";
import type { Page } from "playwright";
import { redactSensitiveExportText } from "../../domain/document-sensitive-data.js";
import type { DocumentAuthoringContext } from '../../domain/document-authoring-context.js';
import { isSafeReadOnlyBrowserCase } from '../../domain/document-case-authoring.js';
import { missingDirectAssertion } from '../../domain/document-case-assertion-quality.js';

export type BrowserStepGenerationSummary = { generatedCaseIds: string[]; caseResults: StepGenerationCaseResult[]; attemptedCaseIds?: string[]; warning?: string };
type ExplorationDecisionInput = {
  requirements: string;
  visitedPages: Array<{ evidenceId: string; route: string; title: string; visibleText: string[]; links: Array<{ label: string; href: string }> }>;
};
type PageExplorationSession = {
  capture(): Promise<string>;
  followLink(evidenceId: string, index: number): Promise<string>;
  promoteSession(): Promise<void>;
  close(): Promise<void>;
};

export interface DocumentCaseStepAuthoringDependencies {
  deriveGroundedEmptyListNavigationSubcheck(item: BrowserCheck): boolean;
  deriveGroundedCustomerLookupSubcheck(item: BrowserCheck): boolean;
  deriveGroundedEmptyRequiredFieldSubcheck(item: BrowserCheck): boolean;
  deriveRelatedInvalidInputSubcheck(item: BrowserCheck, cases: BrowserCheck[]): boolean;
  addNoApiNetworkAssertion(item: BrowserCheck): boolean;
  hasOnlyGenericShellAssertions(item: BrowserCheck): boolean;
  browserStepDraftBlockReason(item: BrowserCheck): string | undefined;
  explainBlockedBrowserStepDraft(item: BrowserCheck): string;
  canAuthorReadOnlyBrowserSteps(item: BrowserCheck): boolean;
  draftGroundedReadOnlyBrowserSteps(item: BrowserCheck): BrowserStep[] | undefined;
  validateCases(cases: unknown[]): BrowserCheck[];
  saveProject(project: DocumentProject): Promise<unknown>;
  collectPageEvidence(project: DocumentProject, existingPage?: Page): Promise<string>;
  resolveNavigationEvidence?(project: DocumentProject, item: BrowserCheck): Promise<{ mapId: string; pageId: string; route: string } | undefined>;
  openPageExploration?(project: DocumentProject): Promise<PageExplorationSession>;
  decidePageExploration?(input: ExplorationDecisionInput, signal?: AbortSignal): Promise<{ decision: "follow-link"; index: number } | { decision: "stop"; reason: string }>;
  modelAvailable(): boolean;
  draftEvidenceBoundUiCheck(item: BrowserCheck, pageEvidence: string): BrowserStep[] | undefined;
  validateDraftLocatorsAgainstEvidence(steps: BrowserStep[], pageEvidence: string, context?: string): void;
  collectAuthoringContext?(project: DocumentProject, item: BrowserCheck): Promise<DocumentAuthoringContext>;
  bindDatabaseFixture?(project: DocumentProject, item: BrowserCheck, context?: DocumentAuthoringContext): BrowserCheck | undefined;
  databaseFixtureAssertionGap?(project: DocumentProject, item: BrowserCheck, context?: DocumentAuthoringContext): string | undefined;
  generateSteps(targetUrl: string, item: BrowserCheck & { caseGenerationActions: string[]; preconditions: string[] }, pageEvidence: string, feedback?: string, context?: DocumentAuthoringContext): Promise<BrowserStep[]>;
  generateBrowserCases(sourceText: string, researchExamples: NonNullable<DocumentProject["researchExamples"]>, pageEvidence?: string): Promise<unknown[]>;
  mergeBrowserCases(existing: BrowserCheck[], generated: BrowserCheck[]): BrowserCheck[];
  validateCasesPreservingGenerationTrace(cases: BrowserCheck[], existing: BrowserCheck[], trustedFreshExplorationEvidence?: ReadonlyMap<string, NonNullable<BrowserCheck["explorationEvidence"]>>): BrowserCheck[];
  requiresManualReview(project: DocumentProject): boolean;
  hasAutoRunnableSelectedCase(cases: BrowserCheck[]): boolean;
  now?: () => string;
}

export function createDocumentCaseStepAuthoringService(deps: DocumentCaseStepAuthoringDependencies) {
  const now = deps.now ?? (() => new Date().toISOString());

  function safeRoute(value: unknown): string {
    if (typeof value !== "string" || value.length > 2_000) return "";
    return value.split(" | ").map(route => {
      if (!route.startsWith("/") || route.includes("?")) return "";
      return route.split("/").map(segment => {
        if (!segment) return "";
        return /[0-9@%\p{Script=Han}]/u.test(segment) || segment.length > 32 ? ":segment" : segment;
      }).join("/");
    }).filter(Boolean).join(" | ").slice(0, 240);
  }

  function recordPageEvidenceSingle(pageEvidenceByCaseId: Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>, authoredCase: BrowserCheck, pageEvidence: string): void {
    const caseId = authoredCase.id;
    const steps = authoredCase.steps;
    let snapshot: { evidenceId?: unknown; capturedAt?: unknown; route?: unknown; controls?: Array<{ tag?: string; role?: string; name?: string; placeholder?: string; visibleText?: string }>; headings?: string[]; links?: string[]; visibleText?: string[] };
    try { snapshot = JSON.parse(pageEvidence); } catch { return; }
    const controls = snapshot.controls ?? [];
    const visibleWords = [...controls.flatMap(item => [item.name, item.placeholder, item.visibleText]), ...(snapshot.headings ?? []), ...(snapshot.links ?? []), ...(snapshot.visibleText ?? [])]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map(value => value.trim().toLocaleLowerCase());
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const matchedLocators: NonNullable<StepGenerationCaseResult["pageEvidence"]>["matchedLocators"] = [];
    for (const [stepIndex, step] of steps.entries()) {
      if ("label" in step && controls.some(control => control.name?.trim().toLocaleLowerCase() === step.label.trim().toLocaleLowerCase())) {
        matchedLocators.push({ stepIndex, kind: "control-label", valueSha256: digest(step.label) });
      } else if ("placeholder" in step && controls.some(control => control.placeholder?.trim().toLocaleLowerCase() === step.placeholder.trim().toLocaleLowerCase())) {
        matchedLocators.push({ stepIndex, kind: "placeholder", valueSha256: digest(step.placeholder) });
      } else if ((step.action === "clickByRole" || step.action === "assertRoleVisible" || step.action === "assertRoleDisabled")
        && controls.some(control => {
          const role = control.role || ({ button: "button", link: "a" } as Record<string, string>)[step.role] || "";
          return role.toLocaleLowerCase() === step.role.toLocaleLowerCase() && control.name?.trim().toLocaleLowerCase() === step.name.trim().toLocaleLowerCase();
        })) {
        matchedLocators.push({ stepIndex, kind: "role-name", valueSha256: digest(`${step.role}\0${step.name}`) });
      } else if (step.action === "selectByRoleIndex" && controls.filter(control => (control.role ?? "").toLocaleLowerCase() === "combobox" || (control.tag ?? "").toLocaleLowerCase() === "select").length > step.index) {
        matchedLocators.push({ stepIndex, kind: "combobox-index", valueSha256: digest(String(step.index)) });
      } else if ((step.action === "clickExactText" || step.action === "assertText" || step.action === "assertVisible" || step.action === "assertExactVisible")
        && visibleWords.includes(step.text.trim().toLocaleLowerCase())) {
        matchedLocators.push({ stepIndex, kind: "visible-text", valueSha256: digest(step.text) });
      }
    }
    const capturedAt = typeof snapshot.capturedAt === "string" && Number.isFinite(Date.parse(snapshot.capturedAt)) ? snapshot.capturedAt : now();
    const route = safeRoute(snapshot.route);
    const evidenceId = typeof snapshot.evidenceId === "string" && /^[0-9a-f-]{36}$/iu.test(snapshot.evidenceId) ? snapshot.evidenceId : undefined;
    pageEvidenceByCaseId.set(caseId, { ...(evidenceId ? { evidenceId } : {}), sha256: digest(pageEvidence), caseRevisionDigest: documentProjectRevisionDigest("case", caseId, authoredCase), stepRevisionDigest: documentProjectRevisionDigest("steps", caseId, steps), capturedAt, route, matchedLocators });
  }

  function recordPageEvidence(pageEvidenceByCaseId: Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>, authoredCase: BrowserCheck, pageEvidence: string): void {
    let root: { pages?: unknown; explorationStatus?: unknown; decisionTrace?: unknown };
    try { root = JSON.parse(pageEvidence) as typeof root; } catch { return; }
    if (!Array.isArray(root.pages)) {
      recordPageEvidenceSingle(pageEvidenceByCaseId, authoredCase, pageEvidence);
      return;
    }
    const snapshots = parsePageEvidenceSnapshots(pageEvidence);
    if (!snapshots.length) {
      if (root.explorationStatus === "incomplete" && Array.isArray(root.decisionTrace) && root.decisionTrace.length <= 8) {
        const digest = (value: string) => createHash("sha256").update(value).digest("hex");
        pageEvidenceByCaseId.set(authoredCase.id, {
          sha256: digest(pageEvidence),
          caseRevisionDigest: documentProjectRevisionDigest("case", authoredCase.id, authoredCase),
          stepRevisionDigest: documentProjectRevisionDigest("steps", authoredCase.id, authoredCase.steps),
          capturedAt: now(), route: "", matchedLocators: [], explorationStatus: "incomplete",
          decisionTrace: structuredClone(root.decisionTrace) as PageExplorationTraceEntry[], pages: [],
        });
      }
      return;
    }
    const pageRecords = snapshots.map(page => {
      const temporary = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>();
      recordPageEvidenceSingle(temporary, authoredCase, page.serialized);
      return temporary.get(authoredCase.id);
    }).filter((record): record is NonNullable<StepGenerationCaseResult["pageEvidence"]> => Boolean(record));
    if (!pageRecords.length) return;
    const first = pageRecords[0]!;
    const locatorMap = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>["matchedLocators"][number]>();
    for (const record of pageRecords) for (const locator of record.matchedLocators) {
      const key = String(locator.stepIndex) + ":" + locator.kind;
      if (!locatorMap.has(key)) locatorMap.set(key, locator);
    }
    const { evidenceId: _singleEvidenceId, pages: _nestedPages, ...base } = first;
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    pageEvidenceByCaseId.set(authoredCase.id, {
      ...base,
      ...(pageRecords.length === 1 && first.evidenceId ? { evidenceId: first.evidenceId } : {}),
      sha256: digest(pageEvidence),
      route: pageRecords.map(record => record.route).filter(Boolean).join(" | ").slice(0, 240),
      matchedLocators: [...locatorMap.values()],
      ...(root.explorationStatus === "stopped" || root.explorationStatus === "incomplete" || root.explorationStatus === "legacy-single-page" ? { explorationStatus: root.explorationStatus } : {}),
      ...(Array.isArray(root.decisionTrace) ? { decisionTrace: structuredClone(root.decisionTrace) as PageExplorationTraceEntry[] } : {}),
      pages: pageRecords.map(({ evidenceId, sha256, capturedAt, route, matchedLocators }) => ({
        ...(evidenceId ? { evidenceId } : {}), sha256, capturedAt, route, matchedLocators,
      })),
    });
  }

  function pageObservedFactsSingle(pageEvidence: string): Array<{ value: string; role?: string; name?: string }> {
    try {
      const snapshot = JSON.parse(pageEvidence) as { evidenceId?: unknown; capturedAt?: unknown; headings?: unknown; links?: unknown; visibleText?: unknown; controls?: unknown };
      if (typeof snapshot.evidenceId !== "string" || !/^[0-9a-f-]{36}$/iu.test(snapshot.evidenceId) || typeof snapshot.capturedAt !== "string" || !Number.isFinite(Date.parse(snapshot.capturedAt))) return [];
      const values: Array<{ value: string; role?: string; name?: string }> = [];
      for (const item of [...(Array.isArray(snapshot.headings) ? snapshot.headings : []), ...(Array.isArray(snapshot.links) ? snapshot.links : []), ...(Array.isArray(snapshot.visibleText) ? snapshot.visibleText : [])]) {
        if (typeof item === "string" && item.trim()) values.push({ value: item.trim() });
      }
      for (const control of Array.isArray(snapshot.controls) ? snapshot.controls : []) {
        if (!control || typeof control !== "object") continue;
        const item = control as { role?: unknown; name?: unknown; visibleText?: unknown };
        const value = typeof item.name === "string" ? item.name.trim() : typeof item.visibleText === "string" ? item.visibleText.trim() : "";
        if (value) values.push({ value, ...(typeof item.role === "string" && item.role.trim() ? { role: item.role.trim() } : {}), ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}) });
      }
      return [...new Map(values.map(item => [`${item.role ?? ""}\0${item.value.toLocaleLowerCase()}`, item])).values()].slice(0, 200);
    } catch { return []; }
  }

  function parsePageEvidenceSnapshots(pageEvidence: string): Array<{ serialized: string; snapshot: { evidenceId?: unknown; capturedAt?: unknown; route?: unknown; title?: unknown; headings?: unknown; links?: unknown; visibleText?: unknown; controls?: unknown } }> {
    try {
      const root = JSON.parse(pageEvidence) as { pages?: unknown };
      const pages = Array.isArray(root.pages) ? root.pages : [root];
      if (!pages.length || pages.length > 4 || pages.some(value => !value || typeof value !== "object" || Array.isArray(value))) return [];
      return pages.map(value => {
        const snapshot = value as { evidenceId?: unknown; capturedAt?: unknown; route?: unknown; title?: unknown; headings?: unknown; links?: unknown; visibleText?: unknown; controls?: unknown };
        if (typeof snapshot.evidenceId !== "string" || !/^[0-9a-f-]{36}$/iu.test(snapshot.evidenceId) || typeof snapshot.capturedAt !== "string" || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error("invalid evidence");
        return { serialized: JSON.stringify(snapshot), snapshot };
      });
    } catch { return []; }
  }

  function pageObservedFacts(pageEvidence: string): Array<{ value: string; role?: string; name?: string }> {
    return parsePageEvidenceSnapshots(pageEvidence).flatMap(page => pageObservedFactsSingle(page.serialized)).slice(0, 200);
  }

  function safePageEvidenceFailure(error: unknown): string {
    const code = error instanceof Error ? error.name : "";
    const hint = error instanceof Error ? error.message : "";
    if (/(?:login|log in|sign in|auth|unauthori[sz]ed|未登录|登录|认证)/iu.test(`${code} ${hint}`)) {
      return "页面探索未完成：目标页需要人工完成登录或认证；请在受控浏览器中完成后重试。步骤生成保持阻断。";
    }
    if (/(?:timeout|timed out|超时)/iu.test(`${code} ${hint}`)) {
      return "页面探索未完成：等待目标页或采集快照超时；请确认页面已打开且可访问后重试。步骤生成保持阻断。";
    }
    if (/(?:network|connect|refused|dns|网络|连接失败)/iu.test(`${code} ${hint}`)) {
      return "页面探索未完成：无法连接目标页；请确认目标环境可访问后重试。步骤生成保持阻断。";
    }
    return "页面探索未完成：采集失败或快照缺少可校验证据；请确认目标页已打开、人工认证已完成且页面内容可见后重试。步骤生成保持阻断。";
  }

  async function explorePageEvidence(project: DocumentProject): Promise<{ evidence?: string; snapshots: string[]; warning: string }> {
    if (!deps.openPageExploration || !deps.decidePageExploration) {
      try {
        const evidence = await deps.collectPageEvidence(project);
        if (!pageObservedFacts(evidence).length) throw new Error("页面快照缺少可校验的 evidenceId、采集时间或可见事实。");
        const page = JSON.parse(evidence);
        const legacyEvidence = JSON.stringify({ ...page, version: 1, explorationStatus: "legacy-single-page", decisionTrace: [], pages: [page] });
        return { evidence: legacyEvidence, snapshots: parsePageEvidenceSnapshots(legacyEvidence).map(item => item.serialized), warning: "页面探索未完成：当前使用旧版单页采集通道，没有 AI 跨页决策记录。" };
      } catch (error) { return { snapshots: [], warning: safePageEvidenceFailure(error) }; }
    }
    let session: PageExplorationSession | undefined;
    const pages: Array<{ evidenceId?: unknown; capturedAt?: unknown; route?: unknown; title?: unknown; headings?: unknown; links?: unknown; visibleText?: unknown; controls?: unknown }> = [];
    const decisionTrace: PageExplorationTraceEntry[] = [];
    const visitedRoutes = new Set<string>();
    let warning = "";
    let explorationStatus: "stopped" | "incomplete" = "incomplete";
    const startedAt = Date.now();
    const controller = new AbortController();
    const archive = (status = explorationStatus) => JSON.stringify({ version: 1, explorationStatus: status, pages, decisionTrace });
    const addIncomplete = (reason: string, latestEvidenceId?: string) => {
      warning = reason;
      decisionTrace.push({ sequence: decisionTrace.length + 1, decision: "incomplete", inputEvidenceIds: pages.map(page => String(page.evidenceId ?? "")), ...(latestEvidenceId ? { latestEvidenceId } : {}), reason: reason.slice(0, 500), status: "incomplete" });
      explorationStatus = "incomplete";
    };
    try {
      session = await deps.openPageExploration(project);
      let currentEvidence = await session.capture();
      for (;;) {
        const current = parsePageEvidenceSnapshots(currentEvidence)[0]?.snapshot;
        if (!current || !pageObservedFacts(currentEvidence).length) throw new Error("页面快照缺少有效的 evidenceId、采集时间或可见事实。");
        const route = typeof current.route === "string" ? current.route : "";
        if (route && visitedRoutes.has(route)) {
          addIncomplete("页面探索未完成：导航回到已访问页面，为避免循环已停止。", String(current.evidenceId ?? ""));
          break;
        }
        if (route) visitedRoutes.add(route);
        pages.push(current);
        if (JSON.stringify({ version: 1, pages }).length > 24_000) {
          pages.pop();
          addIncomplete("页面探索未完成：多页证据达到本轮大小上限；超出部分未用于生成候选。", String(current.evidenceId ?? ""));
          break;
        }
        if (pages.length >= 4) {
          addIncomplete("页面探索未完成：达到本轮 4 页上限；已访问页面的证据已保留。", String(current.evidenceId ?? ""));
          break;
        }
        if (Date.now() - startedAt >= 60_000) {
          addIncomplete("页面探索未完成：达到本轮 60 秒时限；已访问页面的证据已保留。", String(current.evidenceId ?? ""));
          break;
        }
        const latest = current as { evidenceId?: unknown; route?: unknown; title?: unknown; visibleText?: unknown; links?: unknown };
        if (typeof latest.evidenceId !== "string" || typeof latest.route !== "string" || !Array.isArray(latest.links)) throw new Error("页面快照缺少安全导航所需的 evidenceId、路径或链接清单。");
        const visitedPages = pages.map(page => ({
          evidenceId: String(page.evidenceId ?? ""),
          route: String(page.route ?? "/"),
          title: String(page.title ?? ""),
          visibleText: Array.isArray(page.visibleText) ? page.visibleText.filter((item): item is string => typeof item === "string").slice(0, 80) : [],
          links: Array.isArray(page.links) ? page.links.filter((item): item is { label: string; href: string } => Boolean(item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string" && typeof (item as { href?: unknown }).href === "string")).slice(0, 80) : [],
        }));
        let decision: { decision: "stop"; reason: string } | { decision: "follow-link"; index: number };
        try {
          decision = await deps.decidePageExploration({ requirements: project.sourceText, visitedPages }, controller.signal);
        } catch (error) {
          const timedOut = error instanceof Error && /timeout|timed?\s*out|超时/iu.test(`${error.name} ${error.message}`);
          addIncomplete(timedOut ? "页面探索未完成：AI 页面决策超时；已访问页面证据已保留。" : "页面探索未完成：AI 页面决策失败；已访问页面证据已保留。", String(latest.evidenceId));
          break;
        }
        if (Date.now() - startedAt >= 60_000) {
          addIncomplete("页面探索未完成：AI 页面决策返回时已超过本轮 60 秒时限；已访问页面证据已保留。", String(latest.evidenceId));
          break;
        }
        if (decision.decision === "stop") {
          try { await session.promoteSession(); }
          catch {
            addIncomplete("页面探索未完成：无法安全保留同源人工认证会话；候选仍需人工复核。", String(latest.evidenceId));
            break;
          }
          explorationStatus = "stopped";
          warning = "页面探索已在访问 " + pages.length + " 页后由 AI 停止；这表示本轮安全链接判断结束，不代表已穷尽所有页面或测试范围。";
          decisionTrace.push({ sequence: decisionTrace.length + 1, decision: "stop", inputEvidenceIds: pages.map(page => String(page.evidenceId ?? "")), latestEvidenceId: String(latest.evidenceId), reason: redactSensitiveExportText(decision.reason).slice(0, 300), status: "stopped" });
          break;
        }
        const selected = latest.links[decision.index] as { label?: unknown; href?: unknown } | undefined;
        const trace: PageExplorationTraceEntry = {
          sequence: decisionTrace.length + 1, decision: "follow-link",
          inputEvidenceIds: pages.map(page => String(page.evidenceId ?? "")), latestEvidenceId: latest.evidenceId,
          linkIndex: decision.index,
          ...(selected && typeof selected.label === "string" ? { selectedLabel: selected.label.slice(0, 120) } : {}),
          ...(selected && typeof selected.href === "string" ? { selectedPath: selected.href.slice(0, 500) } : {}),
          status: "failed",
        };
        if (Date.now() - startedAt >= 60_000) {
          addIncomplete("页面探索未完成：模型选择了后续页面，但本轮总时限已到；已访问页面的证据已保留。", latest.evidenceId);
          break;
        }
        try {
          currentEvidence = await session.followLink(latest.evidenceId, decision.index);
          const resulting = parsePageEvidenceSnapshots(currentEvidence)[0]?.snapshot.evidenceId;
          decisionTrace.push({ ...trace, ...(typeof resulting === "string" ? { resultingEvidenceId: resulting } : {}), status: "followed" });
        } catch (error) {
          decisionTrace.push({ ...trace, reason: `链接导航失败；${redactSensitiveExportText(safePageEvidenceFailure(error)).slice(0, 260)}`, status: "failed" });
          throw error;
        }
      }
      return { evidence: archive(), snapshots: pages.map(page => JSON.stringify(page)), warning };
    } catch (error) {
      warning = pages.length
        ? "页面探索未完成：受限导航或 AI 继续决策中断；已采集页面的证据已保留，候选仍需人工复核。"
        : safePageEvidenceFailure(error);
      if (!decisionTrace.some(item => item.status === "failed" || item.status === "incomplete")) addIncomplete(warning, pages.at(-1)?.evidenceId ? String(pages.at(-1)!.evidenceId) : undefined);
      return { evidence: archive("incomplete"), snapshots: pages.map(page => JSON.stringify(page)), warning };
    } finally {
      controller.abort();
      await session?.close().catch(() => undefined);
    }
  }

  function groundExplorationCandidate(item: BrowserCheck, pageEvidence: string | undefined, facts: Array<{ value: string; role?: string; name?: string }>): { item: BrowserCheck; status: "partial" | "blocked"; detail: string } {
    const evidenceId = pageEvidence ? (() => { try { return (JSON.parse(pageEvidence) as { evidenceId?: unknown }).evidenceId; } catch { return undefined; } })() : undefined;
    const evidenceDigest = pageEvidence ? createHash("sha256").update(pageEvidence).digest("hex") : "";
    const candidateText = `${item.expected} ${item.steps.map(step => "text" in step ? step.text : "name" in step ? step.name : "").join(" ")}`;
    const match = facts.find(fact => candidateText.includes(fact.value));
    const usable = Boolean(match && pageEvidence && typeof evidenceId === "string");
    const observed = usable ? match!.value : undefined;
    let capturedAt = "";
    let route = "";
    if (pageEvidence) {
      try {
        const snapshot = JSON.parse(pageEvidence) as { capturedAt?: unknown; route?: unknown };
        if (typeof snapshot.capturedAt === "string" && Number.isFinite(Date.parse(snapshot.capturedAt))) capturedAt = snapshot.capturedAt;
        route = safeRoute(snapshot.route);
      } catch { /* Invalid snapshots remain blocked and receive no evidence reference. */ }
    }
    const role = match?.role && ["link", "button", "radio", "checkbox", "tab"].includes(match.role) ? match.role as "link" | "button" | "radio" | "checkbox" | "tab" : undefined;
    const steps: BrowserStep[] = observed ? [role && match!.name
      ? { action: "assertRoleVisible", role, name: match!.name }
      : { action: "assertExactVisible", text: observed }] : [];
    const clarification = "当前页面可见状态不等于业务长期预期；业务预期、角色、测试数据和副作用范围待确认。";
    return {
      item: {
        id: item.id,
        title: observed ? `页面当前可见：${observed.slice(0, 120)}` : "页面探索候选待确认",
        source: pageEvidence ? `页面探索（探索性检查） evidenceId=${String(evidenceId)} snapshotSha256=${evidenceDigest}` : "页面探索未完成：页面证据采集失败；候选仅供需求审核。",
        ...(observed && typeof evidenceId === "string" && capturedAt ? { explorationEvidence: {
          evidenceId, snapshotSha256: evidenceDigest, capturedAt, route,
          observedFactSha256: createHash("sha256").update(observed).digest("hex"),
        } } : {}),
        requirementRefs: [],
        ...(route && /^\/[A-Za-z/-]*$/u.test(route) ? { entryPath: route } : {}),
        priority: "P3",
        category: "visual",
        confidence: "low",
        coverageAreas: ["visual"],
        lifecycleStatus: "draft",
        selectedForRegression: false,
        preconditions: [clarification],
        preconditionsConfirmed: false,
        testData: [],
        sideEffectRisk: "unknown",
        cleanup: "",
        caseOrigin: "ai-generated",
        kind: "visible",
        expected: observed ? `当前页面观察到“${observed}”；业务预期待确认。` : "待确认：没有页面证据证明该候选的可见状态。",
        steps,
        coverageGap: observed ? clarification : "页面证据缺失或未匹配候选事实；页面探索未完成，需补充依据后再审核。",
      },
      status: observed ? "partial" : "blocked",
      detail: observed ? `只记录快照中直接可见的状态；该观察不代表业务预期。${clarification}` : `页面探索未完成；${clarification}`,
    };
  }

  function draftGroundedMissingBrowserSteps(project: DocumentProject, onlyCaseIds?: Set<string>): string[] {
    const drafted: string[] = [];
    const derive = (item: DocumentProject["cases"][number], operation: (value: typeof item) => boolean) => {
      if ((onlyCaseIds && !onlyCaseIds.has(item.id)) || item.steps.length) return;
      if (operation(item)) drafted.push(item.id);
    };
    for (const item of project.cases) derive(item, deps.deriveGroundedEmptyListNavigationSubcheck);
    for (const item of project.cases) derive(item, deps.deriveGroundedCustomerLookupSubcheck);
    for (const item of project.cases) derive(item, deps.deriveGroundedEmptyRequiredFieldSubcheck);
    for (const item of project.cases) derive(item, value => deps.deriveRelatedInvalidInputSubcheck(value, project.cases));
    for (const item of project.cases) if (!onlyCaseIds || onlyCaseIds.has(item.id)) deps.addNoApiNetworkAssertion(item);
    return drafted;
  }

  async function generateMissingBrowserSteps(project: DocumentProject | undefined, onlyCaseIds?: Set<string>, observedPageEvidence?: string, options: { repairRejectedDrafts?: boolean; feedbackByCase?: ReadonlyMap<string, string> } = {}): Promise<BrowserStepGenerationSummary> {
    if (!project) return { generatedCaseIds: [], caseResults: [], warning: "测试项目不存在。" };
    const pageEvidenceByCaseId = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>();
    const authoringContextByCaseId = new Map<string, NonNullable<StepGenerationCaseResult['authoringContext']>>();
    const contextByCaseId = new Map<string, DocumentAuthoringContext>();
    const eligibleForAttempt = (item: BrowserCheck) => (!onlyCaseIds || onlyCaseIds.has(item.id)) && (options.repairRejectedDrafts || !item.steps?.length || deps.hasOnlyGenericShellAssertions(item) || Boolean(missingDirectAssertion(item)));
    const beforeSteps = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
    const candidateIds = project.cases.filter(eligibleForAttempt).map(item => item.id);
    for (const item of project.cases.filter(eligibleForAttempt)) {
      const context = await deps.collectAuthoringContext?.(project, item);
      if (context) {
        contextByCaseId.set(item.id, context);
        authoringContextByCaseId.set(item.id, {
          sources: context.sources.map(({ excerpt: _excerpt, ...reference }) => reference),
          database: context.database, warnings: context.warnings,
        });
      }
    }
    const reasons = new Map<string, string>();
    const notices: string[] = [];
    const attemptedCaseIds = new Set<string>();
    const finish = (): BrowserStepGenerationSummary => {
      const caseResults = candidateIds.flatMap<StepGenerationCaseResult>(caseId => {
        const item = project.cases.find(candidate => candidate.id === caseId);
        if (!item) return [{ caseId, status: "blocked", stepCount: 0, detail: "生成后用例已不在项目中；请刷新项目并重试。" }];
        if (item.steps.length && !deps.hasOnlyGenericShellAssertions(item) && (!missingDirectAssertion(item) || Boolean(item.coverageGap?.trim())) && !reasons.has(caseId)) {
          const partial = Boolean(item.coverageGap?.trim());
          return [{ caseId, status: partial ? "partial" : "generated", stepCount: item.steps.length, detail: partial
            ? `已生成并通过 BrowserStep 校验的只读子检查（${item.steps.length} 步）；完整用例仍有未解决覆盖缺口：${item.coverageGap}`
            : `已生成 ${item.steps.length} 步只读 BrowserStep，并通过结构、定位器和预期断言校验；尚未执行。` }];
        }
        return [{ caseId, status: "blocked", stepCount: 0, detail: reasons.get(caseId) ?? deps.browserStepDraftBlockReason(item) ?? deps.explainBlockedBrowserStepDraft(item) }];
      });
      const tracedCaseResults = caseResults.map(rawResult => {
        const context = authoringContextByCaseId.get(rawResult.caseId);
        const result = { ...rawResult, ...(context ? { authoringContext: context } : {}) };
        const pageEvidence = pageEvidenceByCaseId.get(result.caseId);
        const database = contextByCaseId.get(result.caseId)?.databaseEvidence;
        const traced = database ? { ...result, databaseEvidence: { id: database.id, sha256: database.sha256, capturedAt: database.capturedAt, queryKeys: database.queries.map(query => query.key) } } : result;
        return pageEvidence ? { ...traced, pageEvidence } : traced;
      });
      const generatedCaseIds = tracedCaseResults.filter(result => result.status !== "blocked").map(result => result.caseId);
      const blocked = tracedCaseResults.filter(result => result.status === "blocked");
      if (blocked.length) notices.push(`${blocked.length}/${candidateIds.length} 条用例没有形成可执行步骤：${blocked.map(result => `${result.caseId}：${result.detail}`).slice(0, 12).join("；")}${blocked.length > 12 ? "；其余阻塞原因保存在逐条结果中" : ""}`);
      if (tracedCaseResults.some(result => result.status === "partial")) notices.push(`${tracedCaseResults.filter(result => result.status === "partial").length} 条只生成了可运行的 UI 子检查；完整用例仍未覆盖，不能据此判为通过。`);
      return { generatedCaseIds, caseResults: tracedCaseResults, ...(options.repairRejectedDrafts ? { attemptedCaseIds: [...attemptedCaseIds] } : {}), ...(notices.length ? { warning: notices.join(" ") } : {}) };
    };
    const groundedSubchecks = options.repairRejectedDrafts ? [] : draftGroundedMissingBrowserSteps(project, onlyCaseIds);
    for (const item of project.cases) {
      if (onlyCaseIds && !onlyCaseIds.has(item.id)) continue;
      if (JSON.stringify(item.steps ?? []) !== beforeSteps.get(item.id) && item.steps.length && !deps.hasOnlyGenericShellAssertions(item) && !candidateIds.includes(item.id)) candidateIds.push(item.id);
    }
    const requested = project.cases.map((item, index) => ({ item, index })).filter(({ item }) => eligibleForAttempt(item)).map(entry => {
      const bound = deps.bindDatabaseFixture?.(project, entry.item, contextByCaseId.get(entry.item.id));
      return { ...entry, item: bound ?? entry.item, databaseBound: Boolean(bound) };
    });
    const pending = requested.filter(({ item, databaseBound }) => databaseBound || deps.canAuthorReadOnlyBrowserSteps(item));
    const skipped = requested.filter(({ item, databaseBound }) => !databaseBound && !deps.canAuthorReadOnlyBrowserSteps(item));
    for (const { item } of skipped) reasons.set(item.id, deps.browserStepDraftBlockReason(item) ?? "需求证据不足；请补充可观察的页面预期或执行前置条件。");
    for (const { item } of pending) {
      if (!options.repairRejectedDrafts && item.steps?.length && !deps.hasOnlyGenericShellAssertions(item)) continue;
      if (options.repairRejectedDrafts) continue;
      const groundedSteps = deps.draftGroundedReadOnlyBrowserSteps(item);
      if (groundedSteps?.length) {
        const validated = deps.validateCases([{ ...item, steps: groundedSteps }])[0]!;
        project.cases[project.cases.findIndex(candidate => candidate.id === item.id)] = { ...item, steps: validated.steps };
      }
    }
    const aiPending = pending.filter(({ item }) => {
      const current = project.cases.find(candidate => candidate.id === item.id)!;
      return options.repairRejectedDrafts || !current.steps?.length || deps.hasOnlyGenericShellAssertions(current) || Boolean(missingDirectAssertion(current));
    });
    if (groundedSubchecks.length) notices.push(`已从同一套件的具体校验用例中为 ${groundedSubchecks.length} 条宽泛场景补出安全子场景：${groundedSubchecks.join(", ")}；只覆盖列明的输入示例，不冒充整项完成。`);
    if (!aiPending.length) {
      const summary = finish();
      return { ...summary, ...(notices.length ? { warning: [summary.warning, ...notices].filter(Boolean).join(" ") } : {}) };
    }

    const classifyStepGap = (item: BrowserCheck): string => {
      const concretePreconditions = (item.preconditions ?? []).filter(value => !/需要目标系统专用测试环境和\/或测试账号、接口 mock\/沙箱数据/u.test(value));
      const text = `${item.title} ${item.expected} ${item.coverageGap ?? ""} ${concretePreconditions.join(" ")}`;
      const dataPrerequisites = [item.coverageGap ?? "", ...concretePreconditions, ...(item.testData ?? [])].join(" ");
      if (/(?:\[需澄清\]|待澄清|需澄清|尚未明确|需要产品确认)/u.test(text)) return "预期结果待澄清";
      if (/(?:角色|管理员|身份|账号|权限矩阵|跨账号)/u.test(text)) return "需要核实角色或账号条件";
      if (/(?:fixture|夹具|测试数据|历史记录|订单记录|库存|状态记录|脱敏订单)/iu.test(dataPrerequisites)
        || /(?:缺少|需要|依赖|提供).{0,24}(?:测试数据|测试夹具|测试账号|历史记录|订单记录|库存记录|状态记录|fixture)/iu.test(text)) return "需要核实可复用测试数据";
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
    try { pageEvidence = observedPageEvidence ?? await deps.collectPageEvidence(project); }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      for (const { item } of aiPending) reasons.set(item.id, detail);
      notices.push(`${aiPending.length} 条 UI 用例未能取得页面证据：${detail}`);
      const summary = finish();
      return { ...summary, warning: [summary.warning, ...notices].filter(Boolean).join(" ") };
    }
    if (!deps.modelAvailable()) {
      for (const entry of aiPending) {
        const fallback = deps.draftEvidenceBoundUiCheck(entry.item, pageEvidence);
        if (!fallback?.length) { reasons.set(entry.item.id, pageEvidenceGap(entry.item, pageEvidence)); continue; }
        try {
          const validated = deps.validateCases([{ ...entry.item, steps: fallback }])[0]!;
          const gap = missingDirectAssertion(validated) ?? deps.databaseFixtureAssertionGap?.(project, validated, contextByCaseId.get(entry.item.id));
          if (gap && !validated.coverageGap) throw new Error(gap);
          deps.validateDraftLocatorsAgainstEvidence(validated.steps, pageEvidence, JSON.stringify(entry.item));
          if (deps.hasOnlyGenericShellAssertions(validated)) { reasons.set(entry.item.id, pageEvidenceGap(entry.item, pageEvidence)); continue; }
          const authoredCase = { ...entry.item, steps: validated.steps };
          project.cases[entry.index] = authoredCase;
          recordPageEvidence(pageEvidenceByCaseId, authoredCase, pageEvidence);
        } catch (error) { reasons.set(entry.item.id, `页面证据生成的只读步骤未通过验证：${error instanceof Error ? error.message : String(error)}`); }
      }
      if (aiPending.some(entry => reasons.has(entry.item.id))) notices.push("未配置模型，未能根据页面证据为所有候选生成安全步骤；逐条原因已记录。");
      const summary = finish();
      const warning = [summary.warning, ...notices].filter(Boolean).join(" ");
      return { ...summary, ...(warning ? { warning } : {}) };
    }

    const pageEvidenceSnapshot=pageEvidence;
    const entryEvidence = new Map<string,string>();
    const discoveredEntries = new Map<string,string>();
    for(const entry of aiPending) {
      try {
        const discovered = !entry.item.entryPath ? await deps.resolveNavigationEvidence?.(project, entry.item) : undefined;
        const entryPath = entry.item.entryPath ?? discovered?.route;
        if(!entryPath)continue;
        const evidence = await deps.collectPageEvidence({...project,targetUrl:resolveDocumentCaseEntryUrl(project.targetUrl,entryPath)});
        if (discovered && (JSON.parse(evidence) as { route?: string }).route !== discovered.route) throw new Error('网站地图中的入口没有到达原页面；已停止本条生成，请重新探索。');
        entryEvidence.set(entry.item.id, evidence);
        if(discovered) {
          discoveredEntries.set(entry.item.id, entryPath);
          notices.push(`${entry.item.id}：依据网站地图 ${discovered.mapId} 的页面 ${discovered.pageId} 找到入口 ${entryPath}，已重新采集当前页面证据。`);
        }
      }
      catch(error) { reasons.set(entry.item.id,error instanceof Error?error.message:'用例入口证据读取失败'); }
    }
    let cursor = 0;
    const worker = async () => {
      while (cursor < aiPending.length) {
        const entry = aiPending[cursor++];
        if (!entry) return;
        if (reasons.has(entry.item.id)) continue;
        if(entry.item.entryPath && !entryEvidence.has(entry.item.id))continue;
        const resolvedEntryPath = entry.item.entryPath ?? discoveredEntries.get(entry.item.id);
        const pageEvidence = entryEvidence.get(entry.item.id) ?? observedPageEvidence ?? pageEvidenceSnapshot;
        let detail = "";
        let repairFeedback = options.feedbackByCase?.get(entry.item.id) ?? missingDirectAssertion(entry.item) ?? "";
        let accepted = false;
        const maxDraftAttempts = 2; // One bounded correction after a concrete validation rejection.
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
          const context = contextByCaseId.get(entry.item.id);
          const steps = await deps.generateSteps(resolveDocumentCaseEntryUrl(project.targetUrl,resolvedEntryPath), authoringItem, pageEvidence, repairFeedback || undefined, context);
          if (!steps.length) throw new Error(pageEvidenceGap(entry.item, pageEvidence));
          if (!steps.some(step => ["assertControlEnabled", "assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertDisabled", "assertFieldInvalid", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) throw new Error("模型只生成了操作，没有生成结果断言；请补充具体可观察的通过条件。");
          const validated = deps.validateCases([{ ...entry.item, steps }])[0]!;
          const missingAcceptance=missingRequiredAssertions(validated);
          if(missingAcceptance)throw new Error(missingAcceptance);
          const directAssertionGap = missingDirectAssertion(validated) ?? deps.databaseFixtureAssertionGap?.(project, validated, context);
          if (directAssertionGap && !validated.coverageGap) throw new Error(directAssertionGap);
          if (deps.hasOnlyGenericShellAssertions(validated)) throw new Error("模型只检查通用标题/导航，没有验证本条业务预期；需要明确字段、文案、状态或行为。");
          const authoredCase = { ...entry.item, ...(resolvedEntryPath ? { entryPath: resolvedEntryPath } : {}), steps: validated.steps };
          project.cases[entry.index] = authoredCase;
          recordPageEvidence(pageEvidenceByCaseId, authoredCase, pageEvidence);
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
          const fallback = options.repairRejectedDrafts ? undefined : deps.draftEvidenceBoundUiCheck(entry.item, pageEvidence);
          let fallbackFailure = "";
          if (fallback?.length) {
            try {
              const validated = deps.validateCases([{ ...entry.item, steps: fallback }])[0]!;
              const gap = missingDirectAssertion(validated) ?? deps.databaseFixtureAssertionGap?.(project, validated, contextByCaseId.get(entry.item.id));
              if (gap && !validated.coverageGap) throw new Error(gap);
              deps.validateDraftLocatorsAgainstEvidence(validated.steps, pageEvidence, JSON.stringify(entry.item));
              if (!deps.hasOnlyGenericShellAssertions(validated)) {
                const authoredCase = { ...entry.item, steps: validated.steps };
                project.cases[entry.index] = authoredCase;
                recordPageEvidence(pageEvidenceByCaseId, authoredCase, pageEvidence);
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

  async function prepareCompareRun(project: DocumentProject, selectedCaseIds: string[], readCurrentPageEvidence: () => Promise<string>) {
    if (!project.cases.some(item => selectedCaseIds.includes(item.id) && (!item.steps.length || deps.hasOnlyGenericShellAssertions(item) || Boolean(missingDirectAssertion(item))))) {
      return { generatedCaseIds: [], caseResults: [], requiresReview: false };
    }
    const before = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
    const selectedIds = new Set(selectedCaseIds);
    const groundedCaseIds = draftGroundedMissingBrowserSteps(project, selectedIds);
    let warning = "";
    let caseResults: StepGenerationCaseResult[] = [];
    try {
      const pageEvidence = await readCurrentPageEvidence();
      const stepResult = await generateMissingBrowserSteps(project, selectedIds, pageEvidence);
      warning = stepResult.warning ?? "";
      caseResults = stepResult.caseResults;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warning = groundedCaseIds.length
        ? `已从原用例安全补出 ${groundedCaseIds.length} 条只读步骤；其余 AI 草稿因页面证据采集失败未生成：${detail}`
        : detail;
      caseResults = project.cases
        .filter(item => selectedCaseIds.includes(item.id) && (!item.steps.length || deps.hasOnlyGenericShellAssertions(item)))
        .map(item => ({ caseId: item.id, status: "blocked" as const, stepCount: 0, detail }));
    }

    const generatedCaseIds = project.cases
      .filter(item => selectedCaseIds.includes(item.id) && item.steps.length > 0 && JSON.stringify(item.steps) !== before.get(item.id))
      .map(item => item.id);
    const knownResultIds = new Set(caseResults.map(result => result.caseId));
    for (const caseId of groundedCaseIds) {
      if (knownResultIds.has(caseId)) continue;
      const item = project.cases.find(candidate => candidate.id === caseId);
      if (!item) continue;
      caseResults.push({
        caseId,
        status: item.coverageGap?.trim() ? "partial" : "generated",
        stepCount: item.steps.length,
        detail: item.coverageGap?.trim()
          ? `根据同一套件来源生成了只读 UI 子检查；完整用例仍有覆盖缺口：${item.coverageGap}`
          : "根据同一套件来源生成只读步骤并通过结构校验；尚未执行。",
      });
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
      await deps.saveProject(project);
    }
    return { generatedCaseIds, caseResults, ...(warning ? { warning } : {}), requiresReview: project.confirmationRequired === true };
  }

  async function ensureNoApiRunAssertions(project: DocumentProject, runMode: "compare" | "regression", selectedCaseIds: string[]) {
    const repairedCaseIds = runMode === "compare"
      ? project.cases.filter(item => selectedCaseIds.includes(item.id) && deps.addNoApiNetworkAssertion(item)).map(item => item.id)
      : [];
    if (!repairedCaseIds.length) return { requiresReview: false as const, repairedCaseIds };
    project.updatedAt = new Date().toISOString();
    if (project.confirmationRequired === true) {
      project.reviewStatus = "draft";
      project.reviewNotes = "";
      await deps.saveProject(project);
      return { requiresReview: true as const, repairedCaseIds };
    }
    if (project.reviewStatus === "approved") {
      project.reviewNotes = `${project.reviewNotes ?? "自动审核"}；已自动补上 no-API 用例的 fetch/XHR 断言，完整覆盖边界仍保留。`.slice(0, 2000);
    }
    await deps.saveProject(project);
    return { requiresReview: false as const, repairedCaseIds };
  }

  async function generateSelectedBrowserSteps(project: DocumentProject, caseIds: string[]) {
    const before = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
    const stepResult = await generateMissingBrowserSteps(project, new Set(caseIds));
    const generatedCaseIds = project.cases.filter(item => caseIds.includes(item.id) && JSON.stringify(item.steps ?? []) !== before.get(item.id) && item.steps?.length > 0 && !deps.hasOnlyGenericShellAssertions(item)).map(item => item.id);
    const refreshedIds = new Set(stepResult.caseResults.map(result => result.caseId));
    project.stepAuthoring = { generatedAt: new Date().toISOString(), results: [
      ...(project.stepAuthoring?.results ?? []).filter(result => !refreshedIds.has(result.caseId)), ...stepResult.caseResults,
    ] };
    if (project.confirmationRequired !== true && !deps.requiresManualReview(project) && deps.hasAutoRunnableSelectedCase(project.cases)) {
      project.reviewStatus = "approved";
      project.reviewNotes = "用户选择自动运行：新增只读步骤已通过服务端安全门； coverage gap 和缺少夹具的完整验收仍保留为未解决。";
    } else {
      project.reviewStatus = "draft";
      project.reviewNotes = "";
    }
    project.updatedAt = new Date().toISOString();
    const outcomes = stepResult.caseResults.map(result => ({ ...result, status: generatedCaseIds.includes(result.caseId) ? result.status : "blocked" as const }));
    const blocked = outcomes.filter(result => result.status === "blocked");
    return {
      generatedCaseIds,
      blockedCaseIds: blocked.map(result => result.caseId),
      blockedReasons: blocked.map(result => ({ caseId: result.caseId, reason: result.detail })),
      caseResults: outcomes,
      warning: stepResult.warning ?? "",
    };
  }

  /** Explicit preparation entry: missing scripts are engineering work, not a missing-fixture verdict. */
  async function prepareSelectedBrowserCases(project: DocumentProject, caseIds: string[]) {
    const enabledIds = caseIds.filter(id => project.cases.some(item => item.id === id && item.lifecycleStatus !== 'disabled'));
    const outcome = await generateSelectedBrowserSteps(project, enabledIds);
    // Freeze the exact authored draft and its evidence before lifecycle promotion changes its digest.
    await deps.saveProject(project);
    const readyCaseIds: string[] = [];
    const pending: Array<{ caseId: string; reason: string }> = [];
    for (const caseId of caseIds) {
      const item = project.cases.find(candidate => candidate.id === caseId);
      const generated = outcome.caseResults.find(result => result.caseId === caseId);
      let reason: string | undefined;
      if (!item || item.lifecycleStatus === 'disabled') reason = '用例不存在或已停用。';
      else if (project.confirmationRequired === true || deps.requiresManualReview(project)) reason = '当前项目要求人工审核；步骤已保留为草稿，没有自动发布。';
      else if (item.coverageGap?.trim()) reason = `完整预期仍有明确覆盖缺口：${item.coverageGap}`;
      else if (generated?.status === 'blocked') reason = generated.detail;
      else if (missingDirectAssertion(item)) reason = missingDirectAssertion(item);
      else if (!isSafeReadOnlyBrowserCase(item)) reason = deps.explainBlockedBrowserStepDraft(item);
      else if (item.lifecycleStatus === 'draft' && (generated?.status !== 'generated' || !generated.pageEvidence)) reason = generated?.detail ?? '本次没有生成带页面证据的完整步骤，保留草稿。';
      if (reason) {
        if (item && missingDirectAssertion(item)) { item.lifecycleStatus = 'draft'; item.selectedForRegression = false; }
        pending.push({ caseId, reason }); continue;
      }
      item!.lifecycleStatus = 'runnable';
      item!.selectedForRegression = true;
      readyCaseIds.push(caseId);
    }
    if (readyCaseIds.length && project.confirmationRequired !== true && !deps.requiresManualReview(project)) {
      project.reviewStatus = 'approved';
      project.reviewNotes = 'Agent 自动准备：仅已通过结构、页面证据、完整预期与只读检查的用例进入可执行范围；未运行用例不计通过。';
    }
    await deps.saveProject(project);
    return { ...outcome, readyCaseIds, pending, regressionStarted: false as const };
  }

  async function repairBlockedBrowserSteps(project: DocumentProject, caseIds: string[]) {
    const previousResults = project.stepAuthoring?.results ?? [];
    const blockedResults = previousResults.filter(result => caseIds.includes(result.caseId) && result.status === "blocked");
    if (!blockedResults.length || blockedResults.length !== caseIds.length) throw new Error("只能复查当前步骤记录中状态为“阻塞”的用例；请先重新生成步骤或刷新页面。");
    const before = new Map(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [])]));
    const feedbackByCase = new Map(blockedResults.map(result => [result.caseId, result.detail]));
    const stepResult = await generateMissingBrowserSteps(project, new Set(caseIds), undefined, { repairRejectedDrafts: true, feedbackByCase });
    const repairedCaseIds = project.cases.filter(item => caseIds.includes(item.id) && JSON.stringify(item.steps ?? []) !== before.get(item.id) && item.steps?.length > 0 && !deps.hasOnlyGenericShellAssertions(item)).map(item => item.id);
    const attemptedCaseIds = new Set(stepResult.attemptedCaseIds ?? []);
    const outcomes = stepResult.caseResults.map(result => repairedCaseIds.includes(result.caseId)
      ? { ...result, detail: `${result.detail} Agent 已根据阻塞反馈修订；这是未审核草稿，尚未运行。` }
      : {
        ...result,
        status: "blocked" as const,
        stepCount: project.cases.find(item => item.id === result.caseId)?.steps.length ?? 0,
        detail: attemptedCaseIds.has(result.caseId)
          ? `Agent 已收到阻塞原因并尝试修订，但没有产出通过校验的新步骤；本次原因：${result.detail}；原阻塞原因：${feedbackByCase.get(result.caseId) ?? result.detail}`
          : `该用例因验收预期或证据门禁未交给 Agent；本次原因：${result.detail}；原阻塞原因：${feedbackByCase.get(result.caseId) ?? result.detail}`,
      });
    project.cases = project.cases.map(item => repairedCaseIds.includes(item.id) ? { ...item, lifecycleStatus: "draft", selectedForRegression: false } : item);
    project.stepAuthoring = { generatedAt: new Date().toISOString(), results: [...previousResults.filter(result => !caseIds.includes(result.caseId)), ...outcomes] };
    const blocked = outcomes.filter(result => result.status === "blocked");
    project.generationWarning = blocked.length ? `${blocked.length}/${caseIds.length} 条用例仍阻塞：${blocked.map(result => `${result.caseId}：${result.detail}`).join("；")}` : "";
    project.reviewStatus = "draft";
    project.reviewNotes = "Agent 已按阻塞诊断修订步骤；修订仍是未审核草稿，需人工确认后才能运行。";
    project.updatedAt = new Date().toISOString();
    return { attemptedCaseIds: [...attemptedCaseIds], repairedCaseIds, blockedCaseIds: blocked.map(result => result.caseId), caseResults: outcomes, warning: project.generationWarning, regressionStarted: false as const };
  }

  async function generateBrowserCaseSet(project: DocumentProject): Promise<DocumentProject> {
    const existingCases = project.caseMode === "both" ? project.cases : [];
    let pageEvidence: string | undefined;
    let pageEvidenceWarning = "";
    const exploration = await explorePageEvidence(project);
    pageEvidence = exploration.evidence;
    pageEvidenceWarning = exploration.warning;
    const modelGenerated = deps.validateCases(await deps.generateBrowserCases(project.sourceText, project.researchExamples ?? [], pageEvidence)).map(item => ({ ...item, requirementRefs: (item.requirementRefs ?? []).filter(ref => ref.trim() !== "探索性检查"), caseOrigin: "ai-generated" as const, lifecycleStatus: "draft" as const, selectedForRegression: false, steps: [] }));
    const modelExplorations = modelGenerated.filter(item => !(item.requirementRefs ?? []).length);
    const modelRequirements = modelGenerated.filter(item => (item.requirementRefs ?? []).length > 0);
    const retainedExplorations = modelExplorations.slice(0, 3);
    const requirementLimit = 12 - retainedExplorations.length;
    const retainedRequirements = modelRequirements.slice(0, requirementLimit);
    const generated = [...retainedRequirements, ...retainedExplorations];
    const omittedRequirements = modelRequirements.length - retainedRequirements.length;
    const omittedExplorations = modelExplorations.length - retainedExplorations.length;
    const omittedTotal = omittedRequirements + omittedExplorations;
    const candidateCapWarning = omittedTotal
      ? `候选数量上限为12条（其中页面探索最多3条）；本批次保留${retainedRequirements.length}条需求候选和${retainedExplorations.length}条探索候选，因上限省略${omittedTotal}条模型候选（需求${omittedRequirements}条、探索${omittedExplorations}条）。`
      : "";
    const noExplorationWarning = pageEvidence && modelExplorations.length === 0
      ? "页面探索未完成：模型本批次没有返回页面探索候选；需求候选已保留，但 AI 页面缺口发现未完成。"
      : "";
    const evidencePages = pageEvidence ? parsePageEvidenceSnapshots(pageEvidence) : [];
    const explorationIds = new Set<string>();
    const explorationResults: StepGenerationCaseResult[] = [];
    const grounded = generated.map(item => {
      if ((item.requirementRefs ?? []).length) return item;
      explorationIds.add(item.id);
      const candidateText = item.expected + " " + item.steps.map(step => {
        const value = step as unknown as { text?: unknown; name?: unknown };
        return (typeof value.text === "string" ? value.text : "") + " " + (typeof value.name === "string" ? value.name : "");
      }).join(" ");
      const matchingPage = evidencePages.find(page => pageObservedFacts(page.serialized).some(fact => candidateText.includes(fact.value)));
      const evidencePage = matchingPage ?? evidencePages[0];
      const pageFacts = evidencePage ? pageObservedFacts(evidencePage.serialized).sort((left, right) => right.value.length - left.value.length) : [];
      const result = groundExplorationCandidate(item, evidencePage?.serialized, pageFacts);
      if (pageEvidenceWarning) {
        result.item.coverageGap = [result.item.coverageGap, pageEvidenceWarning].filter(Boolean).join(" ");
        result.detail += " " + pageEvidenceWarning;
      }
      const evidence = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>();
      // A candidate may be grounded on one page, but its review record must
      // retain the full exploration archive and decision trace.
      if (pageEvidence) recordPageEvidence(evidence, result.item, pageEvidence);
      const pageEvidenceRecord = evidence.get(item.id);
      explorationResults.push({ caseId: item.id, status: result.status, stepCount: result.item.steps.length, detail: result.detail, ...(pageEvidenceRecord ? { pageEvidence: pageEvidenceRecord } : {}) });
      return result.item;
    });
    const freshExplorationEvidence = new Map(grounded.flatMap(item => item.explorationEvidence ? [[item.id, item.explorationEvidence] as const] : []));
    project.cases = deps.validateCasesPreservingGenerationTrace(project.caseMode === "both" ? deps.mergeBrowserCases(existingCases, grounded) : grounded, existingCases, freshExplorationEvidence);
    const ordinaryGeneratedIds = new Set(grounded.filter(item => !explorationIds.has(item.id)).map(item => item.id));
    const blockedWithoutPage: StepGenerationCaseResult[] = !pageEvidence ? grounded.filter(item => ordinaryGeneratedIds.has(item.id)).map(item => ({ caseId: item.id, status: "blocked" as const, stepCount: 0, detail: pageEvidenceWarning })) : grounded.filter(item => ordinaryGeneratedIds.has(item.id)).map(item => {
      const evidence = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>();
      recordPageEvidence(evidence, item, pageEvidence);
      const pageEvidenceRecord = evidence.get(item.id);
      return { caseId: item.id, status: "blocked" as const, stepCount: 0, detail: pageEvidenceWarning, ...(pageEvidenceRecord ? { pageEvidence: pageEvidenceRecord } : {}) };
    });
    const stepResult = pageEvidence && evidencePages.length > 0 && ordinaryGeneratedIds.size
      ? await generateMissingBrowserSteps(project, ordinaryGeneratedIds, pageEvidence)
      : { generatedCaseIds: [], caseResults: blockedWithoutPage, ...(pageEvidenceWarning ? { warning: pageEvidenceWarning } : {}) };
    if (pageEvidence && evidencePages.length === 0) {
      stepResult.caseResults = stepResult.caseResults.map(result => {
        if (result.pageEvidence || result.status !== "blocked") return result;
        const candidate = grounded.find(item => item.id === result.caseId);
        if (!candidate) return result;
        const evidence = new Map<string, NonNullable<StepGenerationCaseResult["pageEvidence"]>>();
        recordPageEvidence(evidence, candidate, pageEvidence);
        const pageEvidenceRecord = evidence.get(result.caseId);
        return pageEvidenceRecord ? { ...result, pageEvidence: pageEvidenceRecord } : result;
      });
    }
    const generatedAt = now();
    project.stepAuthoring = { generatedAt, results: [...stepResult.caseResults, ...explorationResults] };
    const warning = [stepResult.warning, pageEvidenceWarning, candidateCapWarning, noExplorationWarning].filter(Boolean).join(" ");
    if (warning) project.generationWarning = warning;
    else delete project.generationWarning;
    project.reviewStatus = "draft";
    project.reviewNotes = "新生成候选及页面探索断言均为未选择草稿；页面现况不代表业务预期，需人工复核后才能审核或执行。";
    project.updatedAt = new Date().toISOString();
    return project;
  }

  return { draftGroundedMissingBrowserSteps, generateMissingBrowserSteps, prepareCompareRun, ensureNoApiRunAssertions, generateSelectedBrowserSteps, prepareSelectedBrowserCases, repairBlockedBrowserSteps, generateBrowserCaseSet };
}
