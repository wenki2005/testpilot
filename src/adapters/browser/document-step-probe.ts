import { resolveDocumentSessionProfileKey } from "../../domain/document-session-profile.js";
import type { DocumentProject, DocumentStepProbe } from "../../domain/document-test-model.js";
import type { ActiveDocumentRunRegistry } from "../../application/runs/active-document-run-registry.js";
import type { Page } from "playwright";

export interface DocumentStepProbePorts {
  registry: Pick<ActiveDocumentRunRegistry, "isBrowserOccupied">;
  acquirePageLease(projectId: string): (() => void) | undefined;
  userDataDirectory(projectId: string): string;
  getExistingPage(userDataDir: string, options?: { browser?: 'chromium' | 'edge' }): Promise<{ page: Page } | undefined>;
  isLoginPage(page: Page): Promise<boolean>;
  resolveDocumentField(page: Page, label: string, rowIndex: number): Promise<import("playwright").Locator>;
  now(): string;
}

/** Safely observes a saved step's locator without performing its action or navigating the page. */
export function createDocumentStepProbeAdapter(ports: DocumentStepProbePorts) {
  return {
    async probe(project: DocumentProject, caseId: string, stepIndex: number, targetUrl = project.targetUrl): Promise<DocumentStepProbe> {
      const checkedAt = ports.now();
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
      if (ports.registry.isBrowserOccupied(project.id)) return {
        ...base, status: "blocked", detail: "项目 Edge 会话正被运行或步骤操作占用；试定位未执行。",
      };
      const release = ports.acquirePageLease(project.id);
      if (!release) return { ...base, status: "blocked", detail: "项目 Edge 会话正被占用；试定位未执行。" };
      let locatorKind = "页面元素定位";
      try {
        const session = await ports.getExistingPage(ports.userDataDirectory(resolveDocumentSessionProfileKey(project)), project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined).catch(() => undefined);
        if (!session || session.page.isClosed()) return {
          ...base, status: "blocked", detail: "未检测到可复用的项目 Edge 会话；试定位没有启动浏览器。",
        };
        const page = session.page;
        if (await ports.isLoginPage(page)) return { ...base, status: "blocked", detail: "当前页面需要人工登录；试定位未执行。" };
        let currentOrigin = "";
        try { currentOrigin = new URL(page.url()).origin; } catch { /* about:blank */ }
        if (!currentOrigin || currentOrigin !== new URL(targetUrl).origin) return {
          ...base, status: "blocked", detail: "当前 Edge 标签页不在本轮目标网站；为避免导航或丢失页面状态，试定位未执行。",
        };

        let locator: import("playwright").Locator;
        locatorKind = "可访问性定位";
        if (["fillByLabel", "blurByLabel", "selectByLabel", "assertValue", "assertDisabled", "assertFieldInvalid", "assertMaxLengthOrMessage"].includes(step.action)) {
          locator = await ports.resolveDocumentField(page, (step as { label: string }).label, (step as { rowIndex?: number }).rowIndex ?? 0);
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
    },
  };
}
