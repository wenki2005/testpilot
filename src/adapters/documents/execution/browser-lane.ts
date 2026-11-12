import type { Locator, Page } from 'playwright';
import { actionablePreconditions, browserStepDraftBlockReason, hasOnlyGenericShellAssertions, isSafeReadOnlyBrowserCase } from '../../../domain/documents/cases/case-authoring.js';
import { nonBrowserCaseWithoutStimulus, planCaseExecution } from '../../../domain/documents/cases/case-routing.js';
import type { BrowserCheck, CaseResult, LaneResult } from '../../../domain/documents/shared/test-model.js';
import { resetPersistentCaseBaseline } from '../../browser/browser-runtime.js';
import { inspectTextRenderSupport } from '../../browser/text-evidence.js';
import { executeReadonlyNavigationCheck } from '../../browser/document-readonly-actions.js';
import { resolveDocumentCaseEntryUrl } from '../cases/case-entry.js';
import { missingDirectAssertion } from '../cases/case-quality.js';
import { allowBrowserRequest, isLoginPage, isAuthenticationRoute } from '../../browser/login-handoff.js';
import { assertNoHorizontalOverflow } from '../../browser/responsive-layout.js';
interface DocumentBrowserLaneHelpers {
    authorizedBinding?: {
        resolveCase(item: BrowserCheck, projectId: string, runId: string): Promise<BrowserCheck>;
        completeCase(item: BrowserCheck, projectId: string, runId: string, targetUrl: string, page: Page): Promise<string | undefined>;
    };
    resolveDocumentField(page: Page, label: string, rowIndex?: number): Promise<Locator>;
    selectDocumentOption(page: Page, label: string, value: string, rowIndex?: number): Promise<void>;
    selectDocumentOptionByPlaceholder(page: Page, placeholder: string, value: string): Promise<void>;
    selectDocumentOptionByRoleIndex(page: Page, index: number, value: string): Promise<void>;
    unsupportedWeChatClientGateMessage(text: string): string | undefined;
}
/** Create the browser lane executor with its concrete UI controls injected. */
const failureShots = new Map<string, Buffer>();
export function takeFailureScreenshot(runId: string, caseId: string): Buffer | undefined {
    const key = runId + ":" + caseId;
    const value = failureShots.get(key);
    failureShots.delete(key);
    return value;
}
export function createDocumentBrowserLaneAdapter(helpers: DocumentBrowserLaneHelpers) {
    const { resolveDocumentField, selectDocumentOption, selectDocumentOptionByPlaceholder, selectDocumentOptionByRoleIndex, unsupportedWeChatClientGateMessage } = helpers;
    return async function runLane(url: string, cases: BrowserCheck[], label: string, projectId: string, runId: string, page: Page, _onLoginWait?: (waiting: boolean) => Promise<void>, onCaseResult?: (result: CaseResult) => Promise<void>, onCaseStart?: (item: BrowserCheck) => Promise<void>, signal?: AbortSignal, onStep?: (item: BrowserCheck, stepIndex: number, phase: "before" | "passed" | "failed", detail?: string) => Promise<void>, onEvidence?: (item: BrowserCheck, stepIndex: number | undefined, reason: string) => Promise<void>, viewport?: {
        width: number;
        height: number;
    }, handoff?: {
        prerequisiteCaseIds: string[];
        onPrerequisitesComplete(): Promise<string | undefined>;
    }, onCasePrepared?: (item: BrowserCheck, page: Page) => Promise<void>): Promise<LaneResult> {
        const results: CaseResult[] = [];
        const capturedCases = new Set<string>();
        const evidenceSink = onEvidence;
        onEvidence = evidenceSink ? async (item, index, reason) => {
            await evidenceSink(item, index, reason);
            capturedCases.add(item.id);
        } : undefined;
        const record = async (result: CaseResult) => {
            if (result.status === 'blocked' && !capturedCases.has(result.id)) {
                const item = cases.find(candidate => candidate.id === result.id);
                if (item)
                    await onEvidence?.(item, undefined, '用例阻塞：' + result.detail).catch(() => undefined);
            }
            results.push(result);
            await onCaseResult?.(result);
            if (handoff && handoff.prerequisiteCaseIds.includes(result.id)) {
                recordedPrerequisites.add(result.id);
                if (!handoffAttempted && handoff.prerequisiteCaseIds.every(id => recordedPrerequisites.has(id))) {
                    handoffAttempted = true;
                    handoffBlockedReason = await handoff.onPrerequisitesComplete();
                }
            }
        };
        const establishedCases = new Set<string>();
        const recordedPrerequisites = new Set<string>();
        let handoffAttempted = false;
        let handoffBlockedReason: string | undefined;
        let activeItem: BrowserCheck | undefined;
        const stoppedDetail = (isCurrent: boolean) => signal?.reason instanceof Error && /page context lost/.test(signal.reason.message) ? "暂停页面已关闭或发生导航，已阻断继续；请核验后从用例起点重建，不能跳过前置步骤。" : isCurrent ? "运行在此用例期间被手动停止；当前结果未判定，可检查页面状态后定向重跑。" : "运行被手动停止；此用例尚未执行，可从部分结果中定向重跑。";
        const waitForVisibleText = async (expected: string, timeoutMs = 5000): Promise<boolean> => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (signal?.aborted)
                    throw new Error("cancelled by user");
                for (const frame of page.frames()) {
                    try {
                        if ((await frame.locator("body").innerText({ timeout: 250 })).includes(expected))
                            return true;
                    }
                    catch { /* a detached or cross-origin frame is not evidence */ }
                }
                await page.waitForTimeout(100);
            }
            return false;
        };
        try {
            page.setDefaultTimeout(10000);
            for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
                let item = cases[caseIndex]!;
                if (handoffBlockedReason && !handoff?.prerequisiteCaseIds.includes(item.id)) {
                    await record({ id: item.id, title: item.title, status: "blocked", blockKind: "dependency-blocked", detail: `前置接管未能安全完成；目标用例未执行。${handoffBlockedReason}`, durationMs: 0 });
                    continue;
                }
                if (signal?.aborted) {
                    for (const pending of cases.slice(caseIndex))
                        await record({ id: pending.id, title: pending.title, status: "not-run", detail: stoppedDetail(false), durationMs: 0 });
                    break;
                }
                await onCaseStart?.(item);
                activeItem = item;
                const start = Date.now();
                let requestObserver: ((request: any) => void) | undefined;
                let captureFetchOrXhr = false;
                let capturedUrl: string | undefined;
                const observedFetchOrXhr: string[] = [];
                let currentStepIndex = -1;
                let failedStepIndex: number | undefined;
                try {
                    if (item.authorizedWriteOperationId || item.writeResultOperationId) {
                        if (!helpers.authorizedBinding)
                            throw new Error('Blocked: 此执行器未配置单次写入绑定。');
                        item = await helpers.authorizedBinding.resolveCase(item, projectId, runId);
                    }
                    const dependencies = item.dependsOnCaseIds ?? [];
                    const failedDependency = dependencies.find(id => {
                        const result = results.find(candidate => candidate.id === id);
                        return !result || result.status !== "passed" || !establishedCases.has(id);
                    });
                    if (failedDependency) {
                        await record({ id: item.id, title: item.title, status: "blocked", blockKind: "dependency-blocked", detail: `依赖前置 ${failedDependency} 未在本轮共享网页会话中成功建立状态；目标用例未执行。`, durationMs: Date.now() - start });
                        continue;
                    }
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
                    if (!steps.some(step => ["assertControlEnabled", "assertText", "assertVisible", "assertNotVisible", "assertExactVisible", "assertRoleVisible", "assertRoleDisabled", "assertMaxLengthOrMessage", "assertValue", "assertValueByPlaceholder", "assertSelectedByRoleIndex", "assertDisabled", "assertFieldInvalid", "assertCurrentUrlUnchanged", "assertNoFetchOrXhr", "assertNoHorizontalOverflow"].includes(step.action))) {
                        await record({ id: item.id, title: item.title, status: "blocked", detail: "该用例只有操作步骤，没有结果断言；请补充断言后再运行。", durationMs: Date.now() - start });
                        continue;
                    }
                    await page.unrouteAll({ behavior: "wait" }).catch(() => undefined);
                    await page.setViewportSize(viewport ?? { width: 1280, height: 720 }).catch(() => undefined);
                    const allowedOrigin = new URL(caseUrl).origin;
                    let blockAllRequestsForValidation = false;
                    const caseAllowsWrite = (item.steps ?? []).some(step => step.action === "clickSubmit");
                    await page.route("**/*", async (route) => {
                        // 每条用例开始时的 unrouteAll() 会摘掉旧处理器，仍在飞行的请求再调用
                        // route.* 会抛 "Assertion error"；未捕获的 rejection 会直接结束整个服务
                        // 进程并打断正在跑的批次，因此这里必须整体兜住。
                        try {
                            const request = route.request();
                            if (blockAllRequestsForValidation) {
                                await route.abort("blockedbyclient");
                                return;
                            }
                            const isDeclaredWrite = caseAllowsWrite && request.method() === "POST" && request.url().startsWith("https://testapi.yibentushu.com");
                            if (!isDeclaredWrite && !allowBrowserRequest(request.method(), request.url(), projectId, { targetOrigin: allowedOrigin, resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest(), isMainFrameNavigation: request.isNavigationRequest() && request.frame().parentFrame() === null, authenticationPage: isAuthenticationRoute(page.url()) })) {
                                await route.abort("blockedbyclient");
                                return;
                            }
                            if (request.isNavigationRequest() && request.frame().parentFrame() === null) {
                                try {
                                    const requested = new URL(request.url());
                                    if (requested.origin !== allowedOrigin && !/(?:login|signin|sso|auth|accounts|passport)/i.test(`${requested.hostname}${requested.pathname}`)) {
                                        await route.abort("blockedbyclient");
                                        return;
                                    }
                                }
                                catch {
                                    await route.abort("blockedbyclient");
                                    return;
                                }
                            }
                            await route.continue();
                        }
                        catch { /* 路由已被摘除或页面已关闭，忽略即可，不升级为进程级崩溃 */ }
                    });
                    // Independent cases keep the established reload baseline. An explicit
                    // dependency chain shares the same page so its visible state survives.
                    if (dependencies.length === 0) {
                        // The old prerequisite results remain historical facts, but their
                        // live page state is destroyed by an independent baseline reset.
                        establishedCases.clear();
                        try {
                            await resetPersistentCaseBaseline(page, caseUrl, 30000, viewport);
                        }
                        catch (error) {
                            throw new Error(`Blocked: 无法建立用例页面基线：${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                    const clientGate = unsupportedWeChatClientGateMessage(await page.locator("body").innerText().catch(() => ""));
                    if (clientGate) {
                        await onEvidence?.(item, undefined, "可见阻塞：目标页显示客户端访问限制");
                        await record({ id: item.id, title: item.title, status: "blocked", detail: `目标页只显示“${clientGate}”；当前测试浏览器没有进入业务页面，本用例断言未执行。请在可访问的微信/企业微信测试会话中重跑。`, durationMs: Date.now() - start });
                        continue;
                    }
                    if (await isLoginPage(page)) {
                        await onEvidence?.(item, undefined, "可见阻塞：页面需要人工登录");
                        await record({ id: item.id, title: item.title, status: "blocked", detail: "页面重载后出现登录页；为避免重复扫码，本用例已阻塞。请确认原登录会话能在同一浏览器上下文中跨页面重载保持，再重跑。", durationMs: Date.now() - start });
                        continue;
                    }
                    await onCasePrepared?.(item, page);
                    requestObserver = request => {
                        if (captureFetchOrXhr && (request.resourceType() === "fetch" || request.resourceType() === "xhr"))
                            observedFetchOrXhr.push(`${request.method()} ${request.resourceType()}`);
                    };
                    page.on("request", requestObserver);
                    let detail = `${label}：检查通过`;
                    if (item.writeResultSourceRunId)
                        detail += `；只读复核既有提交，来源run=${item.writeResultSourceRunId}，operation=${item.writeResultOperationId}`;
                    const assertionFailures: string[] = [];
                    for (let stepIndex = 0; stepIndex < (item.steps ?? []).length; stepIndex++) {
                        const step = item.steps![stepIndex]!;
                        currentStepIndex = stepIndex;
                        if (signal?.aborted)
                            throw new Error("cancelled by user");
                        await onStep?.(item, stepIndex, "before");
                        try {
                            if (step.action === "captureCurrentUrl") {
                                capturedUrl = page.url();
                            }
                            else if (step.action === "assertCurrentUrlUnchanged") {
                                if (!capturedUrl)
                                    throw new Error("断言失败：尚未捕获当前 URL 基线。");
                                if (page.url() !== capturedUrl)
                                    throw new Error(`断言失败：预期 URL 保持不变，当前 ${page.url()}，基线 ${capturedUrl}。`);
                            }
                            else if (step.action === "setViewport") {
                                await page.setViewportSize({ width: step.width, height: step.height });
                            }
                            else if (step.action === "scrollToRatio") {
                                await page.evaluate((ratio: number) => window.scrollTo({ top: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * ratio, behavior: "instant" }), step.ratio);
                                await page.waitForTimeout(200);
                            }
                            else if (step.action === "setReducedMotion") {
                                await page.emulateMedia({ reducedMotion: step.value ? "reduce" : "no-preference" });
                            }
                            else if (step.action === "startFetchOrXhrCapture") {
                                observedFetchOrXhr.length = 0;
                                captureFetchOrXhr = true;
                            }
                            else if (step.action === "assertNoFetchOrXhr") {
                                if (!captureFetchOrXhr)
                                    throw new Error("断言失败：尚未启动 fetch/XHR 捕获。");
                                await page.waitForTimeout(step.quietMs ?? 1000);
                                captureFetchOrXhr = false;
                                if (observedFetchOrXhr.length)
                                    throw new Error(`断言失败：观察窗口内出现 ${observedFetchOrXhr.length} 个 fetch/XHR 请求（仅记录方法与类型，不记录 URL 或参数）。`);
                            }
                            if (step.action === 'goBack' || step.action === 'assertControlEnabled')
                                await executeReadonlyNavigationCheck(page, step);
                            else if (step.action === "fillByLabel")
                                await (await resolveDocumentField(page, step.label, step.rowIndex)).fill(step.value);
                            else if (step.action === "fillByPlaceholder") {
                                const field = page.getByPlaceholder(step.placeholder, { exact: false }).filter({ visible: true });
                                if (await field.count() !== 1)
                                    throw new Error(`占位符「${step.placeholder}」匹配 ${await field.count()} 个控件；需要唯一匹配才能安全填写。`);
                                await field.fill(step.value);
                            }
                            else if (step.action === "clickSubmit") {
                                const before = page.url();
                                let btn = page.locator("div.button,button").filter({ hasText: step.name }).first();
                                if (await btn.count() !== 1)
                                    btn = page.getByRole("button", { name: step.name, exact: true }).first();
                                if (await btn.count() !== 1)
                                    btn = page.getByText(step.name, { exact: true }).first();
                                if (await btn.count() !== 1)
                                    throw new Error(`提交按钮未唯一定位：${step.name}`);
                                const isDisabled = () => btn.evaluate((el: Element) => {
                                    const node = el.closest("button,div,a") ?? el;
                                    return (node instanceof HTMLButtonElement && node.disabled) || /disabled/i.test(String(node.className));
                                });
                                const enableDeadline = Date.now() + 20000;
                                while (await isDisabled()) {
                                    if (Date.now() > enableDeadline)
                                        throw new Error(`提交按钮一直处于禁用状态：${step.name}`);
                                    await page.waitForTimeout(500);
                                }
                                const handle = await btn.elementHandle();
                                const box = handle ? await handle.boundingBox() : null;
                                if (box) {
                                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                                    await page.waitForTimeout(120);
                                    await page.mouse.down();
                                    await page.waitForTimeout(80);
                                    await page.mouse.up();
                                }
                                else {
                                    await btn.click({ force: true });
                                }
                                const deadline = Date.now() + 20000;
                                while (Date.now() < deadline) {
                                    await page.waitForTimeout(500);
                                    if (page.url() !== before && /#\/apply-detail\//.test(page.url()))
                                        break;
                                }
                                if (!/#\/apply-detail\//.test(page.url())) {
                                    const diag = await page.evaluate(() => {
                                        const toasts = [...document.querySelectorAll('.el-message,.el-message__content,.el-notification__content')].map(e => (e.textContent || '').trim()).filter(Boolean);
                                        const dialogs = [...document.querySelectorAll('.el-message-box,[role=dialog]')].filter(e => e.getClientRects().length).map(e => (e.textContent || '').trim().slice(0, 80));
                                        const btn = [...document.querySelectorAll('div,button')].find(e => (e.textContent || '').trim() === '提交申请');
                                        return { toasts, dialogs, btnClass: btn ? String(btn.className) : 'none' };
                                    }).catch(() => null);
                                    throw new Error(`提交后未跳转：${page.url()} | 提示=${JSON.stringify(diag?.toasts ?? [])} 弹窗=${JSON.stringify(diag?.dialogs ?? [])} 按钮=${diag?.btnClass ?? '未知'}`);
                                }
                            }
                            else if (step.action === "openRoute") {
                                const base = new URL(url);
                                base.hash = step.hash;
                                await page.goto(base.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
                                await page.waitForTimeout(4500);
                            }
                            else if (step.action === "fillByRoleIndex") {
                                const fields = page.getByRole(step.role);
                                if (step.index >= await fields.count())
                                    throw new Error(`可访问性 ${step.role} 控件数量不足，无法定位第 ${step.index + 1} 个。`);
                                await fields.nth(step.index).fill(step.value);
                            }
                            else if (step.action === "blurByLabel")
                                await (await resolveDocumentField(page, step.label, step.rowIndex)).blur();
                            else if (step.action === "blurByPlaceholder") {
                                const locator = page.getByPlaceholder(step.placeholder, { exact: true }).filter({ visible: true });
                                if (await locator.count() !== 1)
                                    throw new Error(`占位符「${step.placeholder}」没有唯一匹配，无法安全触发失焦校验。`);
                                await locator.blur();
                            }
                            else if (step.action === "selectByLabel")
                                await selectDocumentOption(page, step.label, step.value, step.rowIndex);
                            else if (step.action === "selectByPlaceholder")
                                await selectDocumentOptionByPlaceholder(page, step.placeholder, step.value);
                            else if (step.action === "selectByRoleIndex")
                                await selectDocumentOptionByRoleIndex(page, step.index, step.value);
                            else if (step.action === "clickByRole") {
                                const locator = page.getByRole(step.role, { name: step.name, exact: true }).first();
                                const unsafe = await locator.evaluate((el: Element) => (el instanceof HTMLButtonElement && el.type === "submit") || (el instanceof HTMLInputElement && ["submit", "image"].includes(el.type)) || Boolean(el.closest("form") && el instanceof HTMLButtonElement && el.type === "submit"));
                                if (unsafe)
                                    throw new Error("安全策略阻止了表单提交按钮点击。");
                                await locator.click();
                            }
                            else if (step.action === "triggerClientValidation") {
                                const roleSubmit = page.getByRole("button", { name: step.name, exact: true });
                                let submit = roleSubmit;
                                if (await roleSubmit.count() !== 1) {
                                    const visibleText = page.getByText(step.name, { exact: true }).filter({ visible: true });
                                    if (await visibleText.count() !== 1)
                                        throw new Error(`安全校验点击需要唯一可见提交按钮「${step.name}」；按钮角色匹配 ${await roleSubmit.count()} 个，精确文本匹配 ${await visibleText.count()} 个。`);
                                    const isSubmitText = await visibleText.evaluate(element => {
                                        let node: Element | null = element;
                                        for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
                                            if (node instanceof HTMLButtonElement)
                                                return node.type === "submit";
                                            if (node.matches("a,[role=link]"))
                                                return false;
                                            if (node.matches("[role=button],[class*=btn],[class*=button]"))
                                                return true;
                                        }
                                        return false;
                                    });
                                    if (!isSubmitText)
                                        throw new Error(`精确文本「${step.name}」没有关联到可识别的按钮控件。`);
                                    submit = visibleText;
                                }
                                else {
                                    const isSubmit = await roleSubmit.evaluate(element => element instanceof HTMLButtonElement && element.type === "submit");
                                    if (!isSubmit)
                                        throw new Error(`安全校验点击只允许明确标记为 type=submit 的按钮：「${step.name}」。`);
                                }
                                const submitState = await submit.evaluate(element => {
                                    let node: Element | null = element;
                                    for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
                                        if (!(node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node.matches('[role=button],[class*=btn],[class*=button]')))
                                            continue;
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
                                if (submitState.disabled)
                                    throw new Error("Blocked: 提交申请按钮当前禁用；需要除目标手机号外其余必填字段的有效合成夹具，才能安全验证提交触发的客户端校验。");
                                blockAllRequestsForValidation = true;
                                try {
                                    await submit.click({ timeout: 5000 });
                                    await page.waitForTimeout(800);
                                }
                                finally {
                                    blockAllRequestsForValidation = false;
                                }
                            }
                            else if (step.action === "clickExactText") {
                                const locator = page.getByText(step.text, { exact: true }).first();
                                try {
                                    await locator.waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`精确文本控件不可见：${step.text}`);
                                }
                                const target = await locator.evaluate((el: Element) => {
                                    const node = el.closest("button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio]") ?? el;
                                    const label = [node.textContent, node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("name"), node.getAttribute("type")].filter(Boolean).join(" ");
                                    const submit = node instanceof HTMLButtonElement && node.type === "submit" || node instanceof HTMLInputElement && ["submit", "image"].includes(node.type);
                                    return { submit, label };
                                });
                                if (target.submit || /提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(target.label))
                                    throw new Error(`安全策略阻止点击高影响文本：${step.text}`);
                                await locator.click();
                            }
                            else if (step.action === "deleteSampleRow") {
                                // UI-only sample-detail row removal. Restrict to table rows that
                                // actually expose the row-level “删除” link; never a business delete.
                                const rows = page.locator("tbody tr").filter({ has: page.getByText("删除", { exact: true }) });
                                const count = await rows.count();
                                if (!count)
                                    throw new Error("样书明细没有可删除的行。");
                                const rowIndex = step.rowIndex ?? count - 1;
                                if (rowIndex < 0 || rowIndex >= count)
                                    throw new Error(`样书明细行序号超出范围：${rowIndex + 1}/${count}。`);
                                const row = rows.nth(rowIndex);
                                const remove = row.getByText("删除", { exact: true }).first();
                                await remove.waitFor({ state: "visible", timeout: 8000 });
                                await remove.click({ timeout: 8000 });
                                await page.waitForTimeout(300);
                            }
                            else if (step.action === "assertText" || step.action === "assertVisible") {
                                // H5 summary labels and values are often sibling spans. getByText()
                                // requires one DOM node to contain the entire string, so it can
                                // miss copy that is visibly rendered as a composed row.
                                if (!await waitForVisibleText(step.text)) {
                                    const current = new URL(page.url());
                                    const framePaths = page.frames().map(frame => {
                                        try {
                                            const frameUrl = new URL(frame.url());
                                            return `${frameUrl.pathname}${frameUrl.hash}`;
                                        }
                                        catch {
                                            return "unavailable";
                                        }
                                    });
                                    const rendering = await inspectTextRenderSupport(page);
                                    if (rendering.visualOnly)
                                        throw new Error(`Blocked: 页面仅有无可访问文本的 canvas 渲染面；需视觉断言验证预期内容。页面=${current.pathname}${current.hash}；frames=${framePaths.join(",")}`);
                                    throw new Error(`断言失败：期望可见文本未出现在页面或嵌入 frame：${step.text}；页面=${current.pathname}${current.hash}；frames=${framePaths.join(",")}`);
                                }
                            }
                            else if (step.action === "assertNotVisible") {
                                try {
                                    await page.getByText(step.text, { exact: true }).first().waitFor({ state: "hidden", timeout: 2500 });
                                }
                                catch {
                                    throw new Error(`断言失败：不应出现的文本仍可见：${step.text}`);
                                }
                            }
                            else if (step.action === "assertExactVisible") {
                                try {
                                    await page.getByText(step.text, { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：没有完全匹配的可见文本：${step.text}`);
                                }
                            }
                            else if (step.action === "assertSelectedByRoleIndex") {
                                const control = page.getByRole(step.role).nth(step.index);
                                await control.waitFor({ state: 'visible', timeout: 5000 });
                                if (!await control.evaluate((el, expected) => {
                                    if (!el.getClientRects().length)
                                        return false;
                                    if (el instanceof HTMLSelectElement)
                                        return [...el.selectedOptions].some(option => option.textContent?.trim() === expected || option.value === expected);
                                    const selected = el.closest('.el-select')?.querySelector('.el-select__placeholder:not(.is-transparent)') ?? el.closest('.ant-select')?.querySelector('.ant-select-selection-item');
                                    if (selected && selected.getClientRects().length)
                                        return selected.textContent?.trim() === expected;
                                    return el instanceof HTMLInputElement && el.value === expected;
                                }, step.value))
                                    throw new Error('断言失败：第 ' + (step.index + 1) + ' 个选择控件的实际选中值不是 ' + step.value);
                            }
                            else if (step.action === "assertRoleVisible") {
                                try {
                                    await page.getByRole(step.role, { name: step.name, exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：没有完全匹配的可见 ${step.role}：${step.name}`);
                                }
                            }
                            else if (step.action === "assertRoleDisabled") {
                                const control = page.getByRole(step.role, { name: step.name, exact: true }).first();
                                if (await control.count()) {
                                    await control.waitFor({ state: "visible", timeout: 5000 });
                                    if (!(await control.isDisabled()))
                                        throw new Error(`断言失败：${step.role}「${step.name}」应为禁用状态。`);
                                }
                                else {
                                    const text = page.getByText(step.name, { exact: true }).first();
                                    const disabled = await text.evaluate((el: Element) => {
                                        let node: Element | null = el;
                                        for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
                                            if (!node.matches("button,[role=button],[aria-disabled=true],[class*=btn],[class*=button]"))
                                                continue;
                                            const classes = typeof node.className === "string" ? node.className : "";
                                            return node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true" || /disabled/i.test(classes) || getComputedStyle(node).pointerEvents === "none";
                                        }
                                        return false;
                                    });
                                    if (!disabled)
                                        throw new Error(`断言失败：没有找到禁用的 ${step.role}「${step.name}」。`);
                                }
                            }
                            else if (step.action === "assertMaxLengthOrMessage") {
                                const field = await resolveDocumentField(page, step.label);
                                const value = await field.inputValue();
                                if (value.length > step.maxLength) {
                                    try {
                                        await page.getByText(step.message, { exact: false }).first().waitFor({ state: "visible", timeout: 1500 });
                                    }
                                    catch {
                                        throw new Error(`断言失败：字段「${step.label}」长度 ${value.length} 超过 ${step.maxLength}，且没有提示「${step.message}」。`);
                                    }
                                }
                            }
                            else if (step.action === "assertNoHorizontalOverflow")
                                await assertNoHorizontalOverflow(page);
                            else if (step.action === "assertValue") {
                                const field = await resolveDocumentField(page, step.label, step.rowIndex);
                                try {
                                    await field.waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`);
                                }
                                const value = await field.inputValue();
                                if (value !== step.value)
                                    throw new Error(`断言失败：字段值与预期不符：${step.label}`);
                            }
                            else if (step.action === "assertValueByPlaceholder") {
                                let field = page.getByPlaceholder(step.placeholder, { exact: true }).filter({ visible: true });
                                const placeholderCount = await field.count();
                                if (placeholderCount !== 1) {
                                    if (placeholderCount > 1)
                                        throw new Error(`占位符「${step.placeholder}」匹配多个控件，无法安全断言字段值。`);
                                    const valueMatches = await page.locator("input").evaluateAll((elements: Element[], expected: string) => elements.flatMap((element, index) => element instanceof HTMLInputElement && element.getClientRects().length && element.value === expected ? [index] : []), step.value);
                                    if (valueMatches.length !== 1)
                                        throw new Error(`占位符「${step.placeholder}」消失后，当前值也没有唯一匹配。`);
                                    field = page.locator("input").nth(valueMatches[0]!);
                                }
                                try {
                                    await field.waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：占位符字段不可见：${step.placeholder}`);
                                }
                                const value = await field.inputValue();
                                if (value !== step.value)
                                    throw new Error(`断言失败：字段值与预期不符：${step.placeholder}`);
                            }
                            else if (step.action === "assertDisabled") {
                                const field = await resolveDocumentField(page, step.label);
                                try {
                                    await field.waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`);
                                }
                                if (!(await field.isDisabled()))
                                    throw new Error(`断言失败：控件应为禁用：${step.label}`);
                            }
                            else if (step.action === "assertFieldInvalid") {
                                const field = await resolveDocumentField(page, step.label, step.rowIndex);
                                try {
                                    await field.waitFor({ state: "visible", timeout: 5000 });
                                }
                                catch {
                                    throw new Error(`断言失败：字段不可见或标签未匹配：${step.label}`);
                                }
                                // Build the browser callback from a literal string. esbuild/tsx can
                                // inject its Node-side __name helper into callbacks passed through
                                // Playwright, and the serialized function then fails in the page.
                                const invalidEvidence = await field.evaluate(new Function("element", String.raw `
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
              `) as (element: Element) => {
                                    invalid: boolean;
                                    evidence: string[];
                                });
                                if (!invalidEvidence.invalid)
                                    throw new Error(`断言失败：字段「${step.label}」尚无可见无效状态。观察到：${invalidEvidence.evidence.join("; ") || "没有关联样式节点"}`);
                            }
                        }
                        catch (error) {
                            if (signal?.aborted)
                                throw error;
                            const message = error instanceof Error ? error.message : String(error);
                            failedStepIndex ??= stepIndex;
                            try {
                                const key = runId + ":" + item.id;
                                if (!failureShots.has(key))
                                    failureShots.set(key, await page.screenshot({ timeout: 5000 }));
                            }
                            catch { }
                            await onStep?.(item, stepIndex, "failed", message);
                            if (message.startsWith("断言失败：")) {
                                assertionFailures.push(message);
                                continue;
                            }
                            throw error;
                        }
                        await onStep?.(item, stepIndex, "passed");
                    }
                    if (signal?.aborted)
                        throw new Error("cancelled by user");
                    if (assertionFailures.length)
                        throw new Error(assertionFailures.join("；"));
                    if (item.authorizedWriteOperationId) {
                        const writeDetail = await helpers.authorizedBinding!.completeCase(item, projectId, runId, url, page);
                        if (writeDetail)
                            detail += '；' + writeDetail;
                        await onEvidence?.(item, undefined, '本轮单次提交后状态');
                    }
                    await record({ id: item.id, title: item.title, status: item.coverageGap ? "blocked" : "passed", detail: item.coverageGap ? `可见子断言通过，但完整用例仍未验证：${item.coverageGap}` : detail, durationMs: Date.now() - start });
                    if (!item.coverageGap)
                        establishedCases.add(item.id);
                }
                catch (error) {
                    // A failed step may have partially changed the shared page.
                    establishedCases.clear();
                    const detail = error instanceof Error ? error.message : String(error);
                    if (!signal?.aborted)
                        await onEvidence?.(item, failedStepIndex ?? (currentStepIndex >= 0 ? currentStepIndex : undefined), detail).catch(() => undefined);
                    await record({ id: item.id, title: item.title, status: signal?.aborted ? "cancelled" : detail.startsWith("断言失败：") ? "failed" : "blocked", detail: signal?.aborted ? stoppedDetail(true) : detail, durationMs: Date.now() - start });
                }
                finally {
                    if (requestObserver)
                        page.off("request", requestObserver);
                }
                activeItem = undefined;
            }
        }
        catch (error) {
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
    };
}
