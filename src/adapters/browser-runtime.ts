import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveModelSettings, validateBrowserCdpEndpoint } from "./model-settings.js";

const cdpBrowsers = new WeakSet<Browser>();
type PersistentSession = Awaited<ReturnType<typeof createPersistentTestPage>> & { endpoint: string };
type ManagedPageSession = { browser: Browser; context: BrowserContext; page: Page; close: () => Promise<void>; keepBrowserAlive?: true };
const persistentSessions = new Map<string, Promise<PersistentSession>>();

export type BrowserRuntimeStatus = { mode: "isolated" | "edge-cdp"; configured: boolean; reachable: boolean | null; version?: string; contexts: number; openTabs: number; managedTabs: number; message: string };

/** Launch the configured browser, falling back to installed Edge when Playwright's
 * bundled Chromium is missing (a common case on fresh Windows workstations). */
export async function launchTestBrowser(options: { headless?: boolean } = {}): Promise<Browser> {
  const headless = options.headless ?? true;
  const cdpEndpoint = resolveModelSettings().browserCdpEndpoint;
  if (cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 });
    if (!browser.contexts().length) { await browser.close(); throw new Error("已连接 Edge，但没有可用的浏览器上下文。请确认 Edge 正在运行并启用了远程调试。"); }
    cdpBrowsers.add(browser);
    return browser;
  }
  const configuredChannel = process.env.TESTPILOT_BROWSER_CHANNEL?.trim() || undefined;
  if (configuredChannel) return chromium.launch({ headless, channel: configuredChannel });
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    if (process.platform !== "win32" || !/executable|browser|launch/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return chromium.launch({ headless, channel: "msedge" });
  }
}

export async function createTestPage(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  if (cdpBrowsers.has(browser)) {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Edge CDP 浏览器上下文已断开。");
    const page = await context.newPage();
    if (options.viewport) await page.setViewportSize(options.viewport);
    return { context, page, close: () => page.close() };
  }
  const context = await browser.newContext(options);
  const page = await context.newPage();
  return { context, page, close: () => context.close() };
}

/** Return a persistent page to a hash-routed app view without reloading the
 * document. This matters for apps whose authenticated runtime lives in memory
 * (for example, an embedded enterprise H5 session): assigning a route hash
 * keeps the same Page, document, cookies, and sessionStorage alive. Full
 * navigation is used only when the app route cannot be changed in-document. */
export async function navigatePersistentPage(page: Page, targetUrl: string, timeout = 30_000): Promise<"reused" | "hash-route" | "navigated"> {
  const target = new URL(targetUrl);
  let current: URL | undefined;
  try { current = new URL(page.url()); } catch { /* about:blank */ }
  if (current?.href === target.href) return "reused";
  if (current && current.origin === target.origin && current.pathname === target.pathname
    && current.search === target.search && current.hash && target.hash) {
    await page.evaluate(hash => { if (location.hash !== hash) location.hash = hash; }, target.hash);
    await page.waitForFunction(hash => location.hash === hash, target.hash, { timeout }).catch(() => undefined);
    if (new URL(page.url()).href === target.href) return "hash-route";
  }
  await page.goto(target.href, { waitUntil: "domcontentloaded", timeout });
  return "navigated";
}

/**
 * Start a browser case from a fresh application document without replacing
 * the managed tab or browser context. A same-tab navigation resets SPA
 * in-memory state (forms, open menus, transient filters) while preserving
 * cookies and sessionStorage used by the existing authenticated session.
 * Callers must check whether the target now shows a login page; if so, block
 * the case instead of prompting for another QR scan.
 */
export async function resetPersistentCaseBaseline(page: Page, targetUrl: string, timeout = 30_000, viewport = { width: 1280, height: 720 }): Promise<void> {
  const target = new URL(targetUrl);
  let current: URL | undefined;
  try { current = new URL(page.url()); } catch { /* about:blank */ }
  if (!current || current.href !== target.href) {
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout });
  }
  // page.goto to the already-current URL may be optimized or restore form
  // values in some browser modes. An explicit reload guarantees a new SPA
  // document while keeping this same Page, context, cookies and storage.
  await page.reload({ waitUntil: "domcontentloaded", timeout });
  await page.setViewportSize(viewport).catch(() => undefined);
  // Some SPAs and scroll-animation libraries restore scroll after
  // DOMContentLoaded. Let their startup handlers settle, disable browser
  // history restoration for this owned test tab, then establish and verify a
  // top-of-page baseline so the previous case cannot leak its active section
  // into the next visual or deterministic check.
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    history.scrollRestoration = "manual";
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scrollY = await page.evaluate(() => window.scrollY);
  if (scrollY > 1) throw new Error(`无法重置用例滚动基线；预期 scrollY=0，实际为 ${scrollY}。`);
}

async function createPersistentTestPage(userDataDir: string, projectId: string) {
  await mkdir(path.resolve(userDataDir), { recursive: true });
  const headless = process.env.TESTPILOT_BROWSER_HEADLESS === "1";
  if (resolveModelSettings().browserCdpEndpoint) {
    const browser = await launchTestBrowser({ headless });
    const context = browser.contexts()[0];
    if (!context) { await browser.close().catch(() => undefined); throw new Error("Edge CDP 浏览器上下文已断开。"); }
    const sessionFile = projectSessionFile(userDataDir, projectId);
    const savedTargetId = await readSavedTargetId(sessionFile, projectId);
    let page = savedTargetId ? await findPageByTargetId(context, savedTargetId) : undefined;
    if (!page) page = await context.newPage();
    await saveTargetId(sessionFile, projectId, await pageTargetId(context, page));
    // Disconnect TestPilot from Edge at shutdown, but leave the project tab
    // open. The target ID is kept in TestPilot's local data, never injected into
    // the website, so the same browsing context can be reclaimed after restart.
    return { browser, context, page, close: async () => { await browser.close().catch(() => undefined); }, keepBrowserAlive: true as const };
  }

  // On Windows, keep the per-project Edge process outside the TestPilot
  // service lifetime. A loopback-only CDP endpoint lets a restarted service
  // reclaim the same tab and sessionStorage instead of closing Edge and
  // forcing another login. User-configured CDP remains the preferred path.
  if (process.platform === "win32") {
    const saved = await readSavedSession(projectSessionFile(userDataDir, projectId), projectId);
    if (saved?.cdpEndpoint) {
      try {
        const reconnected = await connectManagedEdge(userDataDir, projectId, saved.cdpEndpoint, saved.targetId, saved.pid);
        if (reconnected) return reconnected;
      }
      catch { /* stale endpoint: launch one replacement on this project's profile */ }
    }
    const managed = await launchManagedEdge(userDataDir, projectId, headless);
    if (managed) return managed;
  }

  const configuredChannel = process.env.TESTPILOT_BROWSER_CHANNEL?.trim() || undefined;
  const launch = (channel?: string) => chromium.launchPersistentContext(path.resolve(userDataDir), { headless, ...(channel ? { channel } : {}) });
  let context;
  try {
    context = await launch(configuredChannel ?? (process.platform === "win32" ? "msedge" : undefined));
  } catch (error) {
    if (configuredChannel || process.platform !== "win32" || !/executable|browser|launch/i.test(error instanceof Error ? error.message : String(error))) throw error;
    context = await launch();
  }
  const browser = context.browser();
  if (!browser) { await context.close().catch(() => undefined); throw new Error("持久化测试浏览器没有提供可用的浏览器会话。"); }
  const page = await context.newPage();
  return { browser, context, page, close: () => context.close() };
}

/**
 * Keep one visible browser page per project for the lifetime of the demo server.
 * Reusing the same page preserves sessionStorage based login state and avoids
 * repeatedly opening and closing Edge between runs.
 */
export async function launchPersistentTestPage(userDataDir: string) {
  const key = path.resolve(userDataDir);
  const configuredEndpoint = resolveModelSettings().browserCdpEndpoint ?? "";
  const current = persistentSessions.get(key);
  if (current) {
    const session = await current.catch(() => undefined);
    if (session && !session.page.isClosed() && session.endpoint === configuredEndpoint) return session;
    if (session) await session.close().catch(() => undefined);
    persistentSessions.delete(key);
  }

  const projectId = path.basename(key);
  const creating: Promise<PersistentSession> = createPersistentTestPage(key, projectId).then(session => ({ ...session, endpoint: configuredEndpoint }));
  persistentSessions.set(key, creating);
  try { return await creating; }
  catch (error) { if (persistentSessions.get(key) === creating) persistentSessions.delete(key); throw error; }
}

/** Disconnect TestPilot from the project's browser page without closing the
 * browser process. Managed Edge keeps the tab (and its in-memory login state)
 * alive, while the next run will reconnect to the saved target. */
export async function disconnectPersistentTestPage(userDataDir: string): Promise<void> {
  const key = path.resolve(userDataDir);
  const pending = persistentSessions.get(key);
  if (!pending) return;
  if (persistentSessions.get(key) === pending) persistentSessions.delete(key);
  const session = await pending.catch(() => undefined);
  await session?.close().catch(() => undefined);
}

/** Look up a live managed page without launching, closing, or replacing a browser session. */
export async function getExistingPersistentTestPage(userDataDir: string) {
  const key = path.resolve(userDataDir);
  let current = persistentSessions.get(key);
  if (!current) {
    const projectId = path.basename(key);
    const configured = resolveModelSettings().browserCdpEndpoint;
    const saved = await readSavedSession(projectSessionFile(key, projectId), projectId);
    const endpoint = configured ?? saved?.cdpEndpoint;
    if (!endpoint || !saved?.targetId) return undefined;
    const connecting: Promise<PersistentSession> = connectManagedEdge(key, projectId, endpoint, saved.targetId, saved.pid, false)
      .then(session => {
        if (!session) throw new Error("The saved project tab is no longer available.");
        return { ...session, endpoint: configured ?? "" } as PersistentSession;
      });
    persistentSessions.set(key, connecting);
    try { await connecting; }
    catch { if (persistentSessions.get(key) === connecting) persistentSessions.delete(key); return undefined; }
    current = connecting;
  }
  if (!current) return undefined;
  const session = await current.catch(() => undefined);
  if (!session || session.page.isClosed() || session.endpoint !== (resolveModelSettings().browserCdpEndpoint ?? "")) return undefined;
  return session;
}

function projectSessionFile(userDataDir: string, projectId: string): string {
  return path.resolve(userDataDir, "..", "..", "browser-sessions", `${projectId}.json`);
}

type SavedProjectSession = { version: 1 | 2; projectId: string; targetId: string; cdpEndpoint?: string; pid?: number };

async function readSavedSession(file: string, projectId: string): Promise<SavedProjectSession | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object") return undefined;
    const item = value as Partial<SavedProjectSession>;
    if (![1, 2].includes(item.version as number) || item.projectId !== projectId || typeof item.targetId !== "string") return undefined;
    const cdpEndpoint = typeof item.cdpEndpoint === "string" ? validateBrowserCdpEndpoint(item.cdpEndpoint) ?? undefined : undefined;
    return { version: item.version as 1 | 2, projectId, targetId: item.targetId, ...(cdpEndpoint ? { cdpEndpoint } : {}), ...(Number.isInteger(item.pid) ? { pid: item.pid } : {}) };
  } catch { return undefined; }
}

async function saveProjectSession(file: string, session: SavedProjectSession): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function availableLoopbackPort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", () => resolve()); server.once("error", reject); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配本机浏览器调试端口。");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function edgeExecutable(): Promise<string | undefined> {
  const candidates = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : "",
  ].filter(Boolean);
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* try next installed Edge location */ } }
  return undefined;
}

async function launchManagedEdge(userDataDir: string, projectId: string, headless: boolean) {
  const executable = await edgeExecutable();
  if (!executable) return undefined;
  const port = await availableLoopbackPort();
  const cdpEndpoint = `http://127.0.0.1:${port}`;
  const args = [
    `--user-data-dir=${path.resolve(userDataDir)}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    ...(headless ? ["--headless=new"] : []), "about:blank",
  ];
  const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: headless });
  child.unref();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error("Edge exited before its local debugging endpoint became ready.");
      try {
        const response = await fetch(`${cdpEndpoint}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Edge is starting */ }
      await delay(100);
    }
    if (!ready) throw new Error("Edge did not expose its loopback debugging endpoint within 15 seconds.");
    return await connectManagedEdge(userDataDir, projectId, cdpEndpoint, undefined, child.pid);
  } catch (error) {
    // Avoid leaving a half-started process when its debugger endpoint failed.
    if (child.pid) {
      try { process.kill(child.pid); } catch { /* it already exited */ }
    }
    throw error;
  }
}

async function connectManagedEdge(userDataDir: string, projectId: string, cdpEndpoint: string, targetId?: string, pid?: number, allowCreate = true): Promise<ManagedPageSession | undefined> {
  const safeEndpoint = validateBrowserCdpEndpoint(cdpEndpoint);
  if (!safeEndpoint) throw new Error("项目 Edge 会话地址不是受信任的本机端点。");
  const browser = await chromium.connectOverCDP(safeEndpoint, { timeout: 5000 });
  const context = browser.contexts()[0];
  if (!context) { await browser.close().catch(() => undefined); throw new Error("项目 Edge 会话没有可用的浏览器上下文。"); }
  let page = targetId ? await findPageByTargetId(context, targetId) : undefined;
  if (!page && allowCreate) page = context.pages().find(item => !item.isClosed()) ?? await context.newPage();
  if (!page) { await browser.close().catch(() => undefined); return undefined; }
  const actualTargetId = await pageTargetId(context, page);
  await saveProjectSession(projectSessionFile(userDataDir, projectId), { version: 2, projectId, targetId: actualTargetId, cdpEndpoint: safeEndpoint, ...(pid ? { pid } : {}) });
  // Browser.close() disconnects this service from externally launched Edge;
  // it deliberately leaves the process and user-visible project tab running.
  return { browser, context, page, close: async () => { await browser.close().catch(() => undefined); }, keepBrowserAlive: true as const };
}

async function readSavedTargetId(file: string, projectId: string): Promise<string | undefined> {
  return (await readSavedSession(file, projectId))?.targetId;
}

async function saveTargetId(file: string, projectId: string, targetId: string): Promise<void> {
  // connectManagedEdge persists the endpoint and owned process ID so a later
  // run can reconnect and test cleanup can stop its isolated Edge process.
  // Refreshing the target ID must not downgrade that record to the legacy
  // target-only shape.
  const saved = await readSavedSession(file, projectId);
  await saveProjectSession(file, {
    version: saved?.version ?? 1,
    projectId,
    targetId,
    ...(saved?.cdpEndpoint ? { cdpEndpoint: saved.cdpEndpoint } : {}),
    ...(saved?.pid ? { pid: saved.pid } : {}),
  });
}

async function pageTargetId(context: Awaited<ReturnType<Browser["newContext"]>>, page: Awaited<ReturnType<Browser["newPage"]>>): Promise<string> {
  const session = await context.newCDPSession(page);
  try {
    const result = await session.send("Target.getTargetInfo");
    const targetId = (result as { targetInfo?: { targetId?: unknown } }).targetInfo?.targetId;
    if (typeof targetId !== "string" || !targetId) throw new Error("无法读取 Edge 测试标签页的 DevTools target ID。");
    return targetId;
  } finally { await session.detach().catch(() => undefined); }
}

async function findPageByTargetId(context: Awaited<ReturnType<Browser["newContext"]>>, targetId: string) {
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    if (await pageTargetId(context, page).catch(() => "") === targetId) return page;
  }
  return undefined;
}

export async function closePersistentTestPages(): Promise<void> {
  const entries = [...persistentSessions.entries()];
  const sessions = await Promise.all(entries.map(([, item]) => item.catch(() => undefined)));
  persistentSessions.clear();
  await Promise.all(sessions.filter((item): item is PersistentSession => Boolean(item)).map(item => item.close().catch(() => undefined)));
  // Automated fixtures opt into full cleanup. Normal service shutdown only
  // disconnects; it leaves the visible project Edge window and login session
  // open for the next TestPilot process to reclaim.
  if (process.platform === "win32" && process.env.TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN === "0") {
    for (const [profileDir] of entries) {
      const projectId = path.basename(profileDir);
      const saved = await readSavedSession(projectSessionFile(profileDir, projectId), projectId);
      if (!saved?.pid) continue;
      await new Promise<void>(resolve => {
        const killer = spawn("taskkill", ["/PID", String(saved.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => resolve());
        killer.once("exit", () => resolve());
      });
    }
  }
}

export async function testBrowserCdpConnection(endpoint: unknown = resolveModelSettings().browserCdpEndpoint): Promise<{ version: string; contexts: number }> {
  const safeEndpoint = validateBrowserCdpEndpoint(endpoint);
  if (!safeEndpoint) throw new Error("请先配置本机 Edge CDP 地址。");
  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(safeEndpoint, { timeout: 5000 });
    return { version: browser.version(), contexts: browser.contexts().length };
  } finally { await browser?.close().catch(() => undefined); }
}

export async function getBrowserRuntimeStatus(): Promise<BrowserRuntimeStatus> {
  const endpoint = resolveModelSettings().browserCdpEndpoint;
  const active = (await Promise.all([...persistentSessions.values()].map(async pending => {
    const session = await pending.catch(() => undefined);
    return session && !session.page.isClosed() ? 1 : 0;
  }))).reduce<number>((sum, count) => sum + count, 0);
  const sessionsDir = path.resolve(process.env.TESTPILOT_DATA_DIR ?? path.join(process.cwd(), "artifacts", "demo"), "document-tests", "browser-sessions");
  const sessionFiles = (await readdir(sessionsDir).catch(() => [])).filter(name => name.endsWith(".json")).slice(0, 32);
  const savedSessions = (await Promise.all(sessionFiles.map(file => readSavedSession(path.join(sessionsDir, file), file.slice(0, -5))))).filter((item): item is SavedProjectSession => Boolean(item));
  if (!endpoint) {
    const groups = new Map<string, SavedProjectSession[]>();
    for (const session of savedSessions) if (session.cdpEndpoint) groups.set(session.cdpEndpoint, [...(groups.get(session.cdpEndpoint) ?? []), session]);
    let contexts = 0; let openTabs = active; let managedTabs = 0; let version: string | undefined; let checked = 0;
    for (const [managedEndpoint, mappings] of groups) {
      if (checked++ >= 8) break;
      let managedBrowser: Browser | undefined;
      try {
        managedBrowser = await chromium.connectOverCDP(managedEndpoint, { timeout: 1500 });
        const browserContexts = managedBrowser.contexts();
        const pages = browserContexts.flatMap(context => context.pages().filter(page => !page.isClosed()).map(page => ({ context, page })));
        const liveTargets = new Set(await Promise.all(pages.map(({ context, page }) => pageTargetId(context, page).catch(() => ""))));
        contexts += browserContexts.length; openTabs += pages.length; version ??= managedBrowser.version();
        managedTabs += mappings.filter(item => liveTargets.has(item.targetId)).length;
      } catch { /* a saved per-project Edge endpoint may be stale or already closed */ }
      finally { await managedBrowser?.close().catch(() => undefined); }
    }
    return { mode: "isolated", configured: false, reachable: groups.size ? managedTabs > 0 : null, ...(version ? { version } : {}), contexts, openTabs, managedTabs, message: managedTabs ? `TestPilot 的独立 Edge 会话仍打开；找到 ${managedTabs} 个可复用标签页，服务重启后可以接回原登录会话。` : "未配置外部 Edge 地址；测试会使用每个项目独立的持久化浏览器会话。" };
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 3000 });
    const contexts = browser.contexts();
    const pages = contexts.flatMap(context => context.pages().filter(page => !page.isClosed()).map(page => ({ context, page })));
    const targetIds = new Set(savedSessions.map(item => item.targetId));
    const liveTargets = new Set(await Promise.all(pages.map(({ context, page }) => pageTargetId(context, page).catch(() => ""))));
    const managedTabs = [...targetIds].filter(id => liveTargets.has(id)).length;
    return { mode: "edge-cdp", configured: true, reachable: true, version: browser.version(), contexts: contexts.length, openTabs: pages.length, managedTabs, message: managedTabs ? `Edge 已连接；找到 ${managedTabs} 个可复用的 TestPilot 标签页。` : "Edge 已连接；尚未找到已登记的 TestPilot 标签页，首次运行会创建一个。" };
  } catch (error) {
    return { mode: "edge-cdp", configured: true, reachable: false, contexts: 0, openTabs: 0, managedTabs: 0, message: `CDP 无法连接：${error instanceof Error ? error.message : "检查 Edge 远程调试端口是否开启。"}` };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
