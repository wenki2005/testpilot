import { resolveDocumentSessionProfileKey, type DocumentSessionProfile } from "../domain/document-session-profile.js";
import type { Page } from "playwright";
import { randomUUID } from "node:crypto";
import { redactSensitiveExportText } from "./document-sensitive-data.js";
import type { DocumentPageExplorationSessionPort, DocumentPageExplorationSession } from "../application/ports/document-page-exploration.js";
import { captureNavigationSnapshot, activateNavigationTarget } from './browser/document-navigation-discovery.js';
import type { NavigationSnapshot } from '../domain/document-website-map.js';
import { safeDiscoveryRoute } from '../domain/document-website-map.js';

export type CurrentPageEvidence = { evidenceId: string; sourceUrl: string; origin: string; title: string; visibleText: string; imagePixelsInspected: false; capturedAt: string };

/** Read visible text from the current page only. This helper never navigates, reloads, or captures a screenshot. */
export async function captureCurrentPageEvidence(page: Pick<Page, "url" | "title" | "locator" | "isClosed">, targetUrl: string): Promise<CurrentPageEvidence> {
  if (page.isClosed()) throw new Error("当前页面已关闭；无法读取前置页面证据。");
  let current: URL; let target: URL;
  try { current = new URL(page.url()); target = new URL(targetUrl); } catch { throw new Error("当前页面或目标地址无效；无法验证页面来源。"); }
  if (!/^https?:$/u.test(current.protocol) || current.origin !== target.origin) throw new Error("当前页面来源与项目目标 origin 不一致；已阻断页面观察。");
  const title = redactSensitiveExportText((await page.title()).slice(0, 240));
  const rawText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const visibleText = redactSensitiveExportText(rawText
    .split(/\r?\n/u)
    .map(line => line.replace(/\s+/gu, " ").trim())
    .filter(line => line.length > 1 && !/(?:password|passwd|access.?token|secret|密钥|口令|验证码)/iu.test(line))
    .join("\n")).slice(0, 12_000);
  if (!visibleText && !title) throw new Error("当前页面没有可用的可见文本证据。");
  return { evidenceId: randomUUID(), sourceUrl: current.href.slice(0, 2_000), origin: current.origin, title, visibleText, imagePixelsInspected: false, capturedAt: new Date().toISOString() };
}

export type DocumentPageEvidenceProject = {
  id: string;
  targetUrl: string;
  activeSessionProfileId?: string;
  sessionProfiles?: DocumentSessionProfile[];
  executionConfig?: { browser?: 'chromium' | 'edge' };
};
export type DocumentEvidenceCase = { title: string; expected: string };

export type DocumentPageEvidenceDependencies = {
  acquirePageLease(projectId: string): (() => void) | undefined;
  launchPersistentTestPage(profileDir: string, options?: { browser?: 'chromium' | 'edge' }): Promise<{ page: Page }>;
  promotePersistentTestPage(profileDir: string, page: Page, options?: { browser?: 'chromium' | 'edge' }): Promise<void>;
  navigatePersistentPage(page: Page, targetUrl: string): Promise<unknown>;
  isLoginPage(page: Page): Promise<boolean>;
  unsupportedClientGateMessage(bodyText: string): string | undefined;
  profileDirectory(projectId: string): string;
  allowReadRequest?(method: string, url: string, resourceType: string, targetOrigin: string): boolean;
};

const EXPLORATION_MAX_PAGES = 8;
const EXPLORATION_NAVIGATION_TIMEOUT_MS = 12_000;
type PageWebSocketPolicy = { active: boolean; safeForExplorationRetry: boolean; sockets: Set<import("playwright").WebSocketRoute> };
const pageWebSocketPolicies = new WeakMap<Page, PageWebSocketPolicy>();
const pendingAuthenticationPages = new Map<string, Page>();

const SESSION_BRIDGE_MAX_ENTRIES = 128;
const SESSION_BRIDGE_MAX_UTF16_BYTES = 64 * 1024;

async function assertNoTargetServiceWorker(context: import("playwright").BrowserContext, target: URL): Promise<void> {
  const activeWorker = context.serviceWorkers().some(worker => {
    try { return new URL(worker.url()).origin === target.origin; } catch { return false; }
  });
  let registeredWorker = false;
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    let sameOrigin = false;
    try { sameOrigin = new URL(page.url()).origin === target.origin; } catch { /* blank or non-HTTP page */ }
    if (!sameOrigin) continue;
    registeredWorker = await page.evaluate(async () => {
      if ((window as unknown as { __testpilotServiceWorkerRegistrationBlocked?: boolean }).__testpilotServiceWorkerRegistrationBlocked === true) return false;
      if (!('serviceWorker' in navigator)) return false;
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some(registration => {
        try { return new URL(registration.scope).origin === location.origin; } catch { return true; }
      });
    }).catch(() => true);
    if (registeredWorker) break;
  }
  if (activeWorker || registeredWorker) throw new Error("目标 origin 存在 Service Worker；无法证明探索守卫覆盖其请求，探索已阻断。");
}

/** Build a same-origin inert document without running target scripts. Session
 * state is copied only browser-to-browser over an unguessable BroadcastChannel;
 * the Node process receives a count/size acknowledgement, never values. */
async function createSessionBridgePage(context: import("playwright").BrowserContext, target: URL, source?: Page): Promise<Page> {
  await assertNoTargetServiceWorker(context, target);

  const page = await context.newPage();
  const nonce = randomUUID();
  const routeGuard = async (route: import("playwright").Route) => {
    const request = route.request();
    try {
      const url = new URL(request.url());
      if (!/^https?:$/u.test(url.protocol) || url.origin !== target.origin) {
        await route.abort("blockedbyclient");
        return;
      }
      if (!["GET", "HEAD"].includes(request.method())) { await route.abort("blockedbyclient"); return; }
      // Continue the genuine same-origin request so Chromium records its real
      // network address space; route.fulfill would make later local WebSocket
      // policy checks treat the blank document as a synthetic origin.
      await route.continue();
    } catch { await route.abort("blockedbyclient").catch(() => undefined); }
  };
  let cdp: import("playwright").CDPSession | undefined;
  try {
    await page.route("**/*", routeGuard);
    cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: EXPLORATION_NAVIGATION_TIMEOUT_MS });
    if (new URL(page.url()).origin !== target.origin) throw new Error("内部会话桥接导航离开了目标 origin；已阻断。");
    const frameTree = await cdp.send("Page.getFrameTree") as { frameTree?: { frame?: { id?: string } } };
    const frameId = frameTree.frameTree?.frame?.id;
    if (!frameId) throw new Error("无法确认内部会话桥接页的主 frame；已阻断。");
    await cdp.send("Page.setDocumentContent", { frameId, html: "<!doctype html><meta charset=utf-8><title></title><body></body>" });
    await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
    await cdp.send("Network.setBypassServiceWorker", { bypass: false });
    await cdp.detach();
    cdp = undefined;
    if (new URL(page.url()).origin !== target.origin || await page.locator("body").innerText({ timeout: 1_000 })) throw new Error("内部会话桥接文档未通过同源空白校验；已阻断。");

    if (source && !source.isClosed() && new URL(source.url()).origin === target.origin) {
      const channelName = `testpilot-session-${nonce}`;
      const stateKey = `__testpilotSessionBridge_${nonce.replace(/-/gu, "")}`;
      await page.evaluate(({ channelName, nonce, maxEntries, maxBytes, stateKey }) => {
        const channel = new BroadcastChannel(channelName);
        const scope = window as unknown as Record<string, unknown>;
        scope[stateKey] = new Promise<{ count: number; bytes: number }>((resolve, reject) => {
          const timer = setTimeout(() => { channel.close(); reject(new Error("session bridge acknowledgement timeout")); }, 3_000);
          channel.onmessage = event => {
            const data = event.data;
            if (data?.type === "hello" && data.nonce === nonce) { channel.postMessage({ type: "ready", nonce }); return; }
            if (!data || data.type !== "seed" || data.nonce !== nonce || !Array.isArray(data.entries) || data.entries.length > maxEntries) return;
            let bytes = 0;
            for (const pair of data.entries) {
              if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") { channel.close(); clearTimeout(timer); reject(new Error("invalid session bridge payload")); return; }
              bytes += (pair[0].length + pair[1].length) * 2;
              if (bytes > maxBytes) { channel.close(); clearTimeout(timer); reject(new Error("session bridge payload too large")); return; }
            }
            try {
              sessionStorage.clear();
              for (const [key, value] of data.entries as Array<[string, string]>) sessionStorage.setItem(key, value);
            } catch { channel.close(); clearTimeout(timer); reject(new Error("session bridge storage write failed")); return; }
            clearTimeout(timer);
            channel.postMessage({ type: "ack", nonce, count: data.entries.length, bytes });
            channel.close();
            resolve({ count: data.entries.length, bytes });
          };
        });
        return true;
      }, { channelName, nonce, maxEntries: SESSION_BRIDGE_MAX_ENTRIES, maxBytes: SESSION_BRIDGE_MAX_UTF16_BYTES, stateKey });
      const sent = await source.evaluate(({ channelName, nonce, maxEntries, maxBytes }) => new Promise<{ count: number; bytes: number }>((resolve, reject) => {
        const channel = new BroadcastChannel(channelName);
        const timer = setTimeout(() => { channel.close(); reject(new Error("session bridge acknowledgement timeout")); }, 3_000);
        channel.onmessage = event => {
          if (!event.data || event.data.nonce !== nonce) return;
          if (event.data.type === "ready") {
            const entries: Array<[string, string]> = [];
            let bytes = 0;
            for (let index = 0; index < sessionStorage.length; index++) {
              const key = sessionStorage.key(index);
              if (key === null) continue;
              const value = sessionStorage.getItem(key) ?? "";
              bytes += (key.length + value.length) * 2;
              if (entries.length >= maxEntries || bytes > maxBytes) { channel.close(); clearTimeout(timer); reject(new Error("session bridge source exceeds transfer bound")); return; }
              entries.push([key, value]);
            }
            channel.postMessage({ type: "seed", nonce, entries });
          }
          if (event.data.type === "ack" && Number.isInteger(event.data.count) && Number.isInteger(event.data.bytes)) {
            clearTimeout(timer);
            channel.close();
            resolve({ count: event.data.count, bytes: event.data.bytes });
          }
        };
        channel.postMessage({ type: "hello", nonce });
      }), { channelName, nonce, maxEntries: SESSION_BRIDGE_MAX_ENTRIES, maxBytes: SESSION_BRIDGE_MAX_UTF16_BYTES });
      const received = await page.evaluate(async stateKey => {
        const scope = window as unknown as Record<string, unknown>;
        const value = await scope[stateKey] as { count: number; bytes: number };
        delete scope[stateKey];
        return value;
      }, stateKey);
      if (sent.count !== received.count || sent.bytes !== received.bytes) throw new Error("session bridge acknowledgement mismatch");
    }
    await page.evaluate(path => history.replaceState(null, "", path), `/.testpilot-session-bridge-${nonce}`);
    if (new URL(page.url()).origin !== target.origin || !new URL(page.url()).pathname.startsWith("/.testpilot-session-bridge-")) throw new Error("内部会话桥接路径校验失败；已阻断。");
    await page.unroute("**/*", routeGuard);
    return page;
  } catch (error) {
    await page.unroute("**/*", routeGuard).catch(() => undefined);
    await cdp?.send("Emulation.setScriptExecutionDisabled", { value: false }).catch(() => undefined);
    await cdp?.send("Network.setBypassServiceWorker", { bypass: false }).catch(() => undefined);
    await cdp?.detach().catch(() => undefined);
    await page.close().catch(() => undefined);
    throw error;
  }
}

function safeExplorationHref(raw: unknown, currentHref: string, origin: string): { path: string; url: string } | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(raw) || raw.startsWith("//")) return undefined;
  const rawPath = raw.split(/[?#]/u, 1)[0] ?? "";
  if (rawPath.includes("\\") || rawPath.split("/").some(segment => {
    try { const decoded = decodeURIComponent(segment); return decoded === "." || decoded === ".." || /[\u0000-\u001f\u007f]/u.test(decoded); }
    catch { return true; }
  })) return undefined;
  try {
    const base = new URL(currentHref);
    const url = new URL(raw, base);
    if (!/^https?:$/u.test(url.protocol) || url.origin !== origin || url.username || url.password) return undefined;
    if (url.search || (url.hash && !/^#(?:\/[A-Za-z0-9/_-]*)?$/u.test(url.hash))) return undefined;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return { path, url: url.href };
  } catch { return undefined; }
}

async function captureExplorationSnapshot(page: Page, origin: string): Promise<string> {
  const current = new URL(page.url());
  if (current.origin !== origin || !/^https?:$/u.test(current.protocol)) throw new Error("当前页面来源与探索会话不一致。");
  const title = redactSensitiveExportText((await page.title()).slice(0, 240));
  const snapshot = await page.evaluate(String.raw`(() => {
    const visible = element => { const style = getComputedStyle(element); return Boolean(element.getClientRects().length) && style.visibility !== "hidden" && style.display !== "none"; };
    const clean = (value, max = 180) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const safeText = value => !/(?:\b1[3-9]\d{9}\b|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{17}[\dXx]\b|password|passwd|access.?token|secret|密钥|口令|验证码)/iu.test(value);
    const anchors = Array.from(document.querySelectorAll("a[href]")).filter(visible).slice(0, 80).map(anchor => ({ label: clean(anchor.getAttribute("aria-label") || anchor.textContent, 120), href: anchor.getAttribute("href") || "" }));
    const headings = [...new Set(Array.from(document.querySelectorAll("h1,h2,h3")).filter(visible).map(item => clean(item.textContent, 120)).filter(safeText))].slice(0, 40);
    const controls = Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select,button,.button,.btn,[role=button],[role=tab],[role=checkbox],[role=radio]")).filter(visible).slice(0, 80).map(element => {
      const html = element;
      const labels = html.labels ? Array.from(html.labels).map(label => clean(label.innerText || label.textContent, 120)) : [];
      const cell = element.closest("td");
            const column = cell?.parentElement ? Array.from(cell.parentElement.children).indexOf(cell) : -1;
            const tableName = column >= 0 ? clean(cell?.closest("table")?.querySelector("tr")?.children[column]?.textContent) : "";
            let caption = "";
            for (let parent = element.parentElement, depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
              if (parent.querySelectorAll("input:not([type=hidden]),textarea,select").length !== 1) continue;
              const label = parent.querySelector("label");
              if (label) { caption = clean(label.textContent).replace(/[：:*＊]/g, ""); break; }
            }
            const name = tableName || caption || clean(element.getAttribute("aria-label")) || clean(element.getAttribute("title")) || labels.find(Boolean) || clean(element.getAttribute("placeholder"));
      return { tag: element.tagName.toLowerCase(), role: clean(element.getAttribute("role")), name: safeText(name) ? name : "", visibleText: safeText(clean(element.textContent)) ? clean(element.textContent) : "", readOnly: Boolean(html.readOnly), disabled: Boolean(html.disabled || element.getAttribute("aria-disabled") === "true") };
    });
    const visibleText = [...new Set((document.body?.innerText ?? "").split(/\n+/u).map(line => clean(line)).filter(line => line.length > 1 && safeText(line)))].slice(0, 80);
    const safeHash = /^#(?:\/[A-Za-z0-9/_-]*)?$/u.test(location.hash) ? location.hash : "";
    return { route: location.pathname + safeHash, visibleText, headings, controls, links: anchors.filter(item => safeText(item.label)) };
  })()`) as { route: string; visibleText: string[]; headings: string[]; controls: Array<{ tag: string; role: string; name: string; visibleText: string; disabled: boolean }>; links: Array<{ label: string; href: string }> };
  const links = snapshot.links.flatMap(item => {
    const safe = safeExplorationHref(item.href, current.href, origin);
    return safe && item.label ? [{ label: redactSensitiveExportText(item.label).slice(0, 120), href: safe.path }] : [];
  });
  return JSON.stringify({ evidenceId: randomUUID(), capturedAt: new Date().toISOString(), route: snapshot.route.slice(0, 240), title, headings: snapshot.headings, controls: snapshot.controls, visibleText: snapshot.visibleText.map(line => redactSensitiveExportText(line)).slice(0, 80), links });
}

/** One leased persistent page with latest-snapshot-index navigation and request-level read-only enforcement. */
export function createDocumentPageExplorationAdapter(deps: DocumentPageEvidenceDependencies): DocumentPageExplorationSessionPort {
  return { async open(project) {
    const release = deps.acquirePageLease(project.id);
    if (!release) throw new Error("该项目正在运行测试或使用共享浏览器页面；页面探索未启动。");
    let page: Page | undefined;
    let promotedPage: Page | undefined;
    let routeInstalled = false;
    let closed = false;
    let socketPolicy: PageWebSocketPolicy | undefined;
    let pageCdp: import("playwright").CDPSession | undefined;
    let serviceWorkerBlockerIdentifier: string | undefined;
    let offOriginRedirectBlocked = false;
    let latest: { evidenceId: string; links: Array<{ label: string; href: string }> } | undefined;
    const followed = new Set<string>();
    let navigationLatest: NavigationSnapshot | undefined;
    const navigationHistory = new Map<string, NavigationSnapshot>();
    let navigationActions = 0;
    let setupStage = '连接项目浏览器';
    const target = new URL(project.targetUrl);
    const profileKey = resolveDocumentSessionProfileKey(project);
    if (!/^https?:$/u.test(target.protocol) || target.username || target.password) { release(); throw new Error("探索目标仅允许不含凭据的 HTTP(S) URL。"); }
    const guard = async (route: import("playwright").Route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (url.protocol === "ws:" || url.protocol === "wss:") { await route.continue(); return; }
        const isRead = ["GET", "HEAD"].includes(request.method());
        const allowedSource = deps.allowReadRequest ? deps.allowReadRequest(request.method(), url.href, request.resourceType(), target.origin) : url.origin === target.origin;
        const crossOriginDocument = request.isNavigationRequest() && request.frame().parentFrame() === null && url.origin !== target.origin;
        if (!/^https?:$/u.test(url.protocol) || !isRead || !allowedSource || crossOriginDocument || /(?:delete|remove|submit|logout|approve|reject|relock|payment|sendMessage)/iu.test(url.pathname)) { await route.abort("blockedbyclient"); return; }
        // Resolve redirects at the interception layer so the browser never
        // sends a follow-up request to an off-origin authentication host.
        const response = await route.fetch({ maxRedirects: 0, timeout: EXPLORATION_NAVIGATION_TIMEOUT_MS });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) {
          const redirected = new URL(location, url);
          if (!/^https?:$/u.test(redirected.protocol) || redirected.origin !== target.origin) {
            offOriginRedirectBlocked = true;
            await route.fulfill({ status: 403, contentType: "text/plain; charset=utf-8", body: "Off-origin redirect blocked during read-only exploration." });
            return;
          }
        }
        await route.fulfill({ response });
      } catch { await route.abort("blockedbyclient").catch(() => undefined); }
    };
    const websocketGuard = (socket: import("playwright").WebSocketRoute) => {
      const policy = page ? pageWebSocketPolicies.get(page) : undefined;
      if (policy?.active) {
        policy.sockets.add(socket);
        socket.onClose(() => policy.sockets.delete(socket));
        socket.onMessage(() => undefined);
        return;
      }
      // Playwright cannot remove this handler. Keep one page-lifetime route,
      // but proxy new connections transparently outside the exploration lease.
      if (policy) policy.safeForExplorationRetry = false;
      socket.connectToServer();
    };
    const ensureOpen = () => { if (closed || !page || page.isClosed()) throw new Error("页面探索会话已关闭。"); };
    const capture = async () => {
      ensureOpen();
      const text = await page!.locator("body").innerText().catch(() => "");
      const gate = deps.unsupportedClientGateMessage(text);
      if (gate) throw new Error(`目标页只显示“${gate}”；页面探索保持阻断。`);
      if (await deps.isLoginPage(page!)) throw new Error("目标页仍需登录；请在同一浏览器窗口完成人工登录后重试。");
      const captured = await captureExplorationSnapshot(page!, target.origin);
      latest = JSON.parse(captured) as { evidenceId: string; links: Array<{ label: string; href: string }> };
      const parsed = JSON.parse(captured) as { title: string; visibleText: string[]; links: unknown[] };
      if (!parsed.title && !parsed.visibleText.length && !parsed.links.length) throw new Error("页面没有可用的可见证据。");
      return captured;
    };
    try {
      const session = await deps.launchPersistentTestPage(deps.profileDirectory(profileKey), project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined);
      await assertNoTargetServiceWorker(session.page.context(), target);
      const pendingAuthPage = pendingAuthenticationPages.get(profileKey);
      if (pendingAuthPage?.isClosed()) pendingAuthenticationPages.delete(profileKey);
      if (pendingAuthPage && !pendingAuthPage.isClosed()) {
        let pendingOrigin = "";
        try { pendingOrigin = new URL(pendingAuthPage.url()).origin; } catch { /* leave pending handoff intact */ }
        if (pendingOrigin !== target.origin) {
          throw new Error("人工认证尚未返回项目目标 origin；请在保留的同一浏览器窗口完成认证并返回目标页面后重试。");
        }
        // Create an independently owned target, rather than a window.open popup
        // whose target may be detached/disowned by the current page or browser.
        // Copy storage browser-to-browser; keep the handoff until that succeeds.
        setupStage = '复制已认证会话到受控探索页';
        page = await createSessionBridgePage(session.page.context(), target, pendingAuthPage);
        pendingAuthenticationPages.delete(profileKey);
        await pendingAuthPage.close().catch(() => undefined);
      } else {
        let persistentOrigin = "";
        try { persistentOrigin = new URL(session.page.url()).origin; } catch { /* blank page */ }
        setupStage = '创建受控探索页';
        page = persistentOrigin === target.origin
          ? await createSessionBridgePage(session.page.context(), target, session.page)
          : await session.page.context().newPage();
      }
      setupStage = '连接探索页控制通道';
      pageCdp = await page.context().newCDPSession(page);
      if (project.executionConfig?.viewport) await page.setViewportSize(project.executionConfig.viewport);
      await pageCdp.send("Page.enable");
      const serviceWorkerBlocker = await pageCdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
        Object.defineProperty(window, 'open', { configurable: false, value: () => null });
        if ('serviceWorker' in navigator) Object.defineProperty(Navigator.prototype, 'serviceWorker', { configurable: false, get: () => undefined });
        Object.defineProperty(window, '__testpilotServiceWorkerRegistrationBlocked', { configurable: false, value: true });
      })();` }) as { identifier?: unknown };
      if (typeof serviceWorkerBlocker.identifier !== "string") throw new Error("无法安装页面级 Service Worker 注册守卫；探索已阻断。");
      serviceWorkerBlockerIdentifier = serviceWorkerBlocker.identifier;
      await pageCdp.send("Network.enable");
      await pageCdp.send("Network.setBypassServiceWorker", { bypass: true });
      socketPolicy = pageWebSocketPolicies.get(page);
      if (socketPolicy && !socketPolicy.safeForExplorationRetry) {
        throw new Error("当前探索页面可能已有未受控的活动 WebSocket；为避免其绕过只读策略，本轮探索已阻断。请关闭该页并重试。");
      }
      if (!socketPolicy) {
        const createdPolicy: PageWebSocketPolicy = { active: false, safeForExplorationRetry: true, sockets: new Set() };
        await page.routeWebSocket("**/*", websocketGuard);
        pageWebSocketPolicies.set(page, createdPolicy);
        socketPolicy = createdPolicy;
      }
      socketPolicy.active = true;
      // Install both controls before the first target request. If authentication
      // redirects off-origin, fail closed, remove the HTTP route, and let the
      // user complete login in this same window before retrying exploration.
      await page.route("**/*", guard);
      routeInstalled = true;
      setupStage = '加载受只读守卫保护的目标页面';
      await deps.navigatePersistentPage(page, project.targetUrl);
      const swGuardReady = await page.evaluate(() => (window as unknown as { __testpilotServiceWorkerRegistrationBlocked?: boolean }).__testpilotServiceWorkerRegistrationBlocked === true && (!('serviceWorker' in navigator) || navigator.serviceWorker === undefined));
      if (!swGuardReady) throw new Error("无法确认页面 Service Worker 注册已被阻止；探索已失败关闭。");
      if (offOriginRedirectBlocked) throw new Error("off-origin auth redirect blocked");
      await page.waitForTimeout(300);
      await capture();
      const api: DocumentPageExplorationSession = {
        capture,
        async navigationSnapshot() {
          ensureOpen();
          // Let read-only SPA loading finish before freezing card identities.
          // Polling pages remain bounded and still receive a current snapshot.
          await page!.waitForLoadState('networkidle',{timeout:2000}).catch(()=>undefined);
          navigationLatest = await captureNavigationSnapshot(page!, project.targetUrl);
          const loginHint = /登录|扫码|认证|sign\s*in|log\s*in/iu.test(navigationLatest.route + ' ' + navigationLatest.visibleText.join(' '));
          if (loginHint && await deps.isLoginPage(page!)) throw new Error('目标页面需要登录，探索暂停。');
          if (!navigationLatest.headings.length && !navigationLatest.visibleText.length && !navigationLatest.controls.length && !navigationLatest.targets.length) throw new Error('页面仅有标题或尚未加载业务内容，不能把空白页面记为探索完成。请先打开项目会话并确认业务页面已加载。');
          navigationHistory.set(navigationLatest.evidenceId, navigationLatest);
          return navigationLatest;
        },
        async restoreNavigation(evidenceId) {
          ensureOpen();
          const observed = navigationHistory.get(evidenceId);
          const path = observed && safeDiscoveryRoute(observed.route, project.targetUrl);
          if (!path) throw new Error('只能返回本轮真实观察过的页面。');
          if (++navigationActions > 80) throw new Error('导航探索已达到 80 次操作上限。');
          await deps.navigatePersistentPage(page!, new URL(path, project.targetUrl).href);
          await page!.waitForTimeout(350);
          return api.navigationSnapshot!();
        },
        async resetNavigation() {
          ensureOpen();
          if (++navigationActions > 80) throw new Error('导航探索已达到 80 次操作上限。');
          await deps.navigatePersistentPage(page!, project.targetUrl);
          await page!.waitForTimeout(350);
          return api.navigationSnapshot!();
        },
        async activateNavigation(evidenceId, index) {
          ensureOpen();
          if (!navigationLatest || navigationLatest.evidenceId !== evidenceId || !Number.isInteger(index) || !navigationLatest.targets[index]) throw new Error('导航快照已过期或索引无效。');
          const prior = navigationLatest;
          const current = await captureNavigationSnapshot(page!, project.targetUrl);
          if (current.route !== prior.route || JSON.stringify(current.targets) !== JSON.stringify(prior.targets)) throw new Error('页面导航控件发生变化，需重新采集证据。');
          if (++navigationActions > 80) throw new Error('导航探索已达到 80 次操作上限。');
          await activateNavigationTarget(page!, prior.targets[index]!, project.targetUrl);
          return api.navigationSnapshot!();
        },
        async followLink(evidenceId, index) {
          ensureOpen();
          if (!latest || evidenceId !== latest.evidenceId) throw new Error("页面证据已过期；请先采集当前页面。");
          if (!Number.isInteger(index) || index < 0 || index >= latest.links.length) throw new Error("页面链接索引越界。");
          const followKey = `${evidenceId}:${index}`;
          if (followed.has(followKey)) throw new Error("该页面链接索引已在本轮探索中使用。");
          if (followed.size >= EXPLORATION_MAX_PAGES - 1) throw new Error("页面探索已达到页面上限。");
          const selected = latest.links[index]!;
          const safe = safeExplorationHref(selected.href, page!.url(), target.origin);
          if (!safe || safe.path !== selected.href) throw new Error("链接路径不安全或不再匹配当前页面证据。");
          followed.add(followKey);
          await page!.goto(safe.url, { waitUntil: "domcontentloaded", timeout: EXPLORATION_NAVIGATION_TIMEOUT_MS });
          await page!.waitForTimeout(100);
          return capture();
        },
        async promoteSession() {
          ensureOpen();
          if (promotedPage) return;
          const clone = await createSessionBridgePage(page!.context(), target, page);
          try {
            await deps.promotePersistentTestPage(deps.profileDirectory(profileKey), clone, project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined);
            promotedPage = clone;
          } catch (error) {
            await clone.close().catch(() => undefined);
            throw error;
          }
        },
        async close() {
          if (closed) return;
          closed = true;
          if (socketPolicy) {
            socketPolicy.active = false;
            for (const socket of socketPolicy.sockets) await socket.close({ code: 1000, reason: "Exploration session closed" }).catch(() => undefined);
            socketPolicy.sockets.clear();
          }
          try { if (routeInstalled && page && !page.isClosed()) await page.unroute("**/*", guard); }
          finally {
            if (serviceWorkerBlockerIdentifier) await pageCdp?.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: serviceWorkerBlockerIdentifier }).catch(() => undefined);
            await pageCdp?.send("Network.setBypassServiceWorker", { bypass: false }).catch(() => undefined);
            await pageCdp?.detach().catch(() => undefined);
            if (page && !page.isClosed()) await page.close().catch(() => undefined);
            if (pendingAuthenticationPages.get(profileKey) === page) pendingAuthenticationPages.delete(profileKey);
            release();
          }
        },
      };
      return api;
    } catch (error) {
      if (socketPolicy) {
        socketPolicy.active = false;
        for (const socket of socketPolicy.sockets) await socket.close({ code: 1000, reason: "Exploration setup failed" }).catch(() => undefined);
        socketPolicy.sockets.clear();
      }
      if (routeInstalled && page && !page.isClosed()) await page.unroute("**/*", guard).catch(() => undefined);
      if (serviceWorkerBlockerIdentifier) await pageCdp?.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: serviceWorkerBlockerIdentifier }).catch(() => undefined);
      await pageCdp?.send("Network.setBypassServiceWorker", { bypass: false }).catch(() => undefined);
      await pageCdp?.detach().catch(() => undefined);
      const manualAuthRequired = error instanceof Error && /login|auth|登录|认证|blockedbyclient|off-origin/iu.test(`${error.name} ${error.message}`);
      if (page && !page.isClosed()) {
        if (manualAuthRequired) pendingAuthenticationPages.set(profileKey, page);
        else await page.close().catch(() => undefined);
      }
      if (!manualAuthRequired && pendingAuthenticationPages.get(profileKey) === page) pendingAuthenticationPages.delete(profileKey);
      release();
      const detail = manualAuthRequired
        ? "目标页需要人工登录或认证；已移除探索 HTTP 守卫，专用探索页仍保留在同一浏览器上下文供人工认证后重试。继续认证前请刷新该专用页，以恢复浏览器 Service Worker API；随后完成认证并返回项目目标 origin。重试时会通过浏览器内同源桥接保留 sessionStorage，不读取或记录其中的值。"
        : `${setupStage}失败：${error instanceof Error ? error.message : "页面探索启动失败。"}`;
      throw new Error(detail);
    }
  } };
}

/** Collect bounded, credential-filtered visible UI facts from the project's existing browser session. */
export function createDocumentPageEvidenceAdapter(deps: DocumentPageEvidenceDependencies) {
  async function collect(project: DocumentPageEvidenceProject, existingPage?: Page): Promise<string> {
    const releasePageLease = existingPage ? undefined : deps.acquirePageLease(project.id);
    if (!existingPage && !releasePageLease) throw new Error("该项目正在运行测试或使用共享浏览器页面；步骤生成未启动，结束后再重试。");
    try {
      let page = existingPage;
      if (!page) {
        const session = await deps.launchPersistentTestPage(
          deps.profileDirectory(resolveDocumentSessionProfileKey(project)),
          project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined,
        );
        page = session.page;
      }
      const target = new URL(project.targetUrl);
      try {
        await deps.navigatePersistentPage(page, project.targetUrl);
      } catch (error) {
        let currentOrigin = "未知";
        try { currentOrigin = new URL(page.url()).origin; } catch { /* blank or closed page */ }
        throw new Error(`无法在项目的同一浏览器窗口打开目标页面（当前：${currentOrigin}；目标：${target.origin}）：${error instanceof Error ? error.message : String(error)}`);
      }
      await page.waitForTimeout(300);
      const clientGate = deps.unsupportedClientGateMessage(await page.locator("body").innerText().catch(() => ""));
      if (clientGate) throw new Error(`目标页只显示“${clientGate}”；当前测试浏览器没有进入业务页面，不能根据这张门禁页编写业务步骤。请改用可访问的微信/企业微信测试会话。`);
      if (await deps.isLoginPage(page)) throw new Error("项目的同一测试浏览器窗口已打开目标站点，但当前仍需登录。请在这个窗口完成一次登录，然后在 TestPilot 重试生成步骤；不会为用例另开窗口或要求重复扫码。");
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
        const controls = Array.from(document.querySelectorAll("input:not([type=hidden]),textarea,select,button,.button,.btn,[role=button],[role=tab],[role=checkbox],[role=radio]"))
          .filter(visible).slice(0, 100).map(element => {
            const html = element;
            const labels = html.labels ? Array.from(html.labels).map(label => clean(label.innerText || label.textContent, 100)) : [];
            const cell = element.closest("td");
            const column = cell?.parentElement ? Array.from(cell.parentElement.children).indexOf(cell) : -1;
            const tableName = column >= 0 ? clean(cell?.closest("table")?.querySelector("tr")?.children[column]?.textContent) : "";
            let caption = "";
            for (let parent = element.parentElement, depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
              if (parent.querySelectorAll("input:not([type=hidden]),textarea,select").length !== 1) continue;
              const label = parent.querySelector("label");
              if (label) { caption = clean(label.textContent).replace(/[：:*＊]/g, ""); break; }
            }
            const name = tableName || caption || clean(element.getAttribute("aria-label")) || clean(element.getAttribute("title")) || labels.find(Boolean) || clean(element.getAttribute("placeholder"));
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
        evidenceId: randomUUID(),
        capturedAt: new Date().toISOString(),
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

  return { collect };
}

/** Deterministic assertion repair constrained to explicit case text and current visible evidence. */
export function draftEvidenceBoundUiCheck(item: DocumentEvidenceCase, pageEvidence: string) {
  let snapshot: { controls?: Array<{ tag?: string; name?: string; placeholder?: string; visibleText?: string; disabled?: boolean }>; visibleText?: string[] };
  try { snapshot = JSON.parse(pageEvidence); } catch { return undefined; }
  const expected = `${item.title} ${item.expected}`;
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
      if (matches.length > 1 && ordinalNumber !== undefined && ordinalNumber >= 1 && ordinalNumber <= matches.length && ordinalNumber <= 10) return [{ action: "assertFieldInvalid" as const, label, rowIndex: ordinalNumber - 1 }];
    }
  }
  if (/(?:文案|提示|显示|可见|展示|文中|text|message|visible)/iu.test(item.expected)) {
    const literals = [...item.expected.matchAll(/[「“"]([^」”"]{2,120})[」”"]/gu)].map(match => match[1]!.trim());
    const matched = literals.filter(literal => (snapshot.visibleText ?? []).some(line => line.includes(literal)));
    if (matched.length === 1) return [{ action: "assertVisible" as const, text: matched[0]! }];
  }
  return undefined;
}

