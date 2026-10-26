import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Browser, Page } from "playwright";

const execFileAsync = promisify(execFile);
export interface LoginHandoffState {
  projectId: string;
  runId: string;
  status: "waiting_for_user" | "ready_to_continue";
  targetUrl: string;
  message: string;
  requestedAt: string;
}
interface ActiveHandoff extends LoginHandoffState { page: Page; browser: Browser; authOrigins: string[]; }
const handoffs = new Map<string, ActiveHandoff>();

export function getLoginHandoff(projectId: string): LoginHandoffState | undefined {
  const state = handoffs.get(projectId);
  if (!state) return undefined;
  const { page: _page, browser: _browser, authOrigins: _authOrigins, ...publicState } = state;
  return publicState;
}

export function isLoginHandoffActive(projectId: string): boolean { return handoffs.get(projectId)?.status === "waiting_for_user"; }

export interface BrowserRequestPolicyContext {
  targetOrigin: string;
  resourceType: string;
  isNavigationRequest?: boolean;
  isMainFrameNavigation?: boolean;
  loginHandoffActive?: boolean;
  authOrigins?: string[];
}

export function browserRequestAllowed(method: string, requestUrl: string, context: BrowserRequestPolicyContext): boolean {
  // Keep this helper inside the policy function because browserRequestPolicySource()
  // serializes the function body into standalone ZIP runners.
  const registrableSite = (hostname: string): string | undefined => {
    const host = hostname.toLowerCase().replace(/\.$/u, "");
    if (!host || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) || host.includes(":")) return undefined;
    const labels = host.split(".");
    const multiLabelPublicSuffixes = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "org.nz", "com.br", "com.cn", "com.hk", "com.sg", "co.jp", "co.kr"]);
    const suffix = labels.slice(-2).join(".");
    const needed = multiLabelPublicSuffixes.has(suffix) ? 3 : 2;
    return labels.length >= needed ? labels.slice(-needed).join(".") : undefined;
  };
  let request: URL;
  try { request = new URL(requestUrl); } catch { return false; }
  if (request.protocol !== "https:" && request.hostname !== "localhost" && request.hostname !== "127.0.0.1") return false;
  const targetOrigin = context.targetOrigin;
  const sameOrigin = request.origin === targetOrigin;
  const methodIsRead = /^(GET|HEAD)$/i.test(method);
  const passiveAssetTypes = ["stylesheet", "script", "image", "font", "media"];
  const loginPath = /(?:login|signin|sign-in|auth|sso|oauth|token|captcha|session|passport)/i;
  const apiReadPath = /(?:^|\/)(?:get(?:[A-Z_][A-Za-z0-9_-]*)?|query(?:[A-Z_][A-Za-z0-9_-]*)?|list(?:[A-Z_][A-Za-z0-9_-]*)?|search(?:[A-Z_][A-Za-z0-9_-]*)?|detail(?:[A-Z_][A-Za-z0-9_-]*)?|fetch(?:[A-Z_][A-Za-z0-9_-]*)?|read(?:[A-Z_][A-Za-z0-9_-]*)?)$/u;
  const knownReadRoute = /\/system\/(?:dict(?:\/|$)|area\/tree(?:\/|$))/iu;
  const mutationPath = /(?:^|[\/_-])(?:autosave|delete|remove|update|save|submit|create|write|send|pay|lock|cancel|reset)(?:$|[\/_-])/iu;

  // Third-party hosts are only trusted for passive HTTPS assets. In particular,
  // a GET/XHR endpoint is not considered harmless merely because it is a GET.
  if (!sameOrigin) {
    if (methodIsRead && passiveAssetTypes.includes(context.resourceType) && request.protocol === "https:") return true;
    // Enterprise H5 apps commonly host their static shell on a CDN and read
    // bootstrap data from a sibling API host (for example cdn.example.com ->
    // testapi.example.com). Permit only read-shaped fetch/XHR paths on the
    // same registrable site; mutations and cross-site APIs remain blocked.
    const targetHost = (() => { try { return new URL(targetOrigin).hostname; } catch { return ""; } })();
    const sameRegistrableSite = registrableSite(targetHost) !== undefined && registrableSite(targetHost) === registrableSite(request.hostname);
    const apiRequest = /^(?:GET|HEAD|POST|OPTIONS)$/i.test(method) && /^(?:fetch|xhr)$/i.test(context.resourceType)
      && sameRegistrableSite && !mutationPath.test(request.pathname) && (apiReadPath.test(request.pathname) || knownReadRoute.test(request.pathname));
    if (apiRequest && request.protocol === "https:") return true;
    const approvedAuthOrigin = context.loginHandoffActive === true && context.authOrigins?.includes(request.origin) === true;
    if (approvedAuthOrigin && context.isNavigationRequest && loginPath.test(`${request.hostname}${request.pathname}`) && methodIsRead) return true;
    if (approvedAuthOrigin && /^(POST|OPTIONS)$/i.test(method) && /^(fetch|xhr)$/i.test(context.resourceType) && loginPath.test(request.pathname)) return true;
    return false;
  }
  if (methodIsRead) {
    // Legacy applications sometimes mutate state through GET. Block obvious
    // action-shaped paths while allowing page/bootstrap reads such as getInfo.
    try {
      const path = request.pathname;
      if (/(?:autosave|(?:^|[\/_-])(?:delete|remove|update|save|submit|create|write|send|pay|lock|cancel|reset)(?:$|[\/_-]))/i.test(path)) return false;
      return true;
    } catch { return false; }
  }
  // Some H5 applications use POST for read-only bootstrap/query endpoints.
  // Allow only explicit read verbs; keep all mutation-shaped requests blocked.
  if (/^POST$/i.test(method)) {
    try {
      const path = request.pathname;
      // Enterprise H5 apps often use POST for read-only WeCom bootstrap calls
      // such as getUserInfo/getDepartmentList. Permit explicit read verbs while
      // continuing to reject mutation-shaped path segments above.
      if (/(?:^|\/)(?:get(?:[A-Z_].*)?|query(?:[A-Z_].*)?|list(?:[A-Z_].*)?|search(?:[A-Z_].*)?|detail(?:[A-Z_].*)?|fetch(?:[A-Z_].*)?|read(?:[A-Z_].*)?)$/i.test(path)) return true;
    } catch { return false; }
  }
  if (context.loginHandoffActive !== true || !/^(POST|OPTIONS)$/i.test(method)) return false;
  try { return loginPath.test(request.pathname); }
  catch { return false; }
}

export async function waitForUserLogin(projectId: string, runId: string, targetUrl: string, browser: Browser, page: Page, onLoginWait?: (waiting: boolean) => Promise<void>): Promise<void> {
  await onLoginWait?.(true);
  const targetOrigin = new URL(targetUrl).origin;
  const authOrigins = [...new Set([page.url(), ...page.frames().map(frame => frame.url())].flatMap(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin !== targetOrigin && /(?:login|signin|sign-in|auth|sso|oauth|token|captcha|session|passport)/i.test(`${url.hostname}${url.pathname}`) ? [url.origin] : [];
    } catch { return []; }
  }))];
  const state: ActiveHandoff = {
    projectId, runId, targetUrl, page, browser, authOrigins, status: "waiting_for_user", requestedAt: new Date().toISOString(),
    message: "测试遇到登录页。请在已置顶的测试浏览器窗口中自行完成登录，再回到 TestPilot 点“我已登录，继续测试”。TestPilot 不会读取或保存你的账号密码。",
  };
  handoffs.set(projectId, state);
  await bringBrowserToFront(browser, page);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const current = handoffs.get(projectId);
    if (!current || current.runId !== runId) throw new Error("登录接力已取消，请重新运行测试。");
    if (current.status === "ready_to_continue") {
      handoffs.delete(projectId);
      await onLoginWait?.(false);
      // The project browser page stays open across runs, so cookies and
      // sessionStorage remain in the same live context without copying tokens.
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  handoffs.delete(projectId);
  throw new Error("等待登录超过 10 分钟，测试已停止；请登录后重新运行。");
}

export async function requestLoginContinue(projectId: string): Promise<LoginHandoffState> {
  const state = handoffs.get(projectId);
  if (!state) throw new Error("当前没有等待登录的测试。");
  if (await isLoginPage(state.page)) throw new Error("测试浏览器仍显示登录页。请完成登录后再继续。");
  state.status = "ready_to_continue";
  state.message = "已确认登录完成，正在从当前浏览器会话继续测试。";
  return getLoginHandoff(projectId)!;
}

export function clearLoginHandoff(projectId: string): void { handoffs.delete(projectId); }

export async function isLoginPage(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const loginUrl = /(?:\/|#)(?:login|signin|sign-in|auth|sso)(?:[/?#]|$)/i;
  // Do not treat a logged-in page that merely mentions the WeCom brand or a
  // generic "请登录" hint as an authentication screen. Such false positives
  // used to surface the QR handoff again while the shared session was valid.
  const loginText = /企业微信(?:扫码|登录)|微信扫码登录|扫码登录|扫描二维码登录|二维码已过期|用户登录|统一身份认证|请先登录|登录后继续|please\s+sign\s*in|sign\s*in\s+to\s+continue|please\s+log\s*in/i;
  // Enterprise SSO providers commonly render the QR flow inside a cross-origin iframe.
  // Playwright can inspect its frame URL and rendered text, while page.locator('body') cannot.
  for (let attempt = 0; attempt < 7; attempt++) {
    if (page.isClosed()) return false;
    const frames = page.frames();
    for (const frame of frames) {
      const url = frame.url();
      if (!/(?:callback|redirect|token)/i.test(url) && loginUrl.test(url)) return true;
      if (await frame.locator('input[type="password"], input[autocomplete="current-password"], input[autocomplete="one-time-code"]').count().catch(() => 0)) return true;
      const text = await frame.locator("body").innerText().catch(() => "");
      if (loginText.test(text)) return true;
    }
    if (attempt < 6) await page.waitForTimeout(350).catch(() => undefined);
  }
  return false;
}

export function browserRequestPolicySource(): string { return `(${browserRequestAllowed.toString()})`; }

export function allowBrowserRequest(method: string, requestUrl: string, projectId: string, context?: BrowserRequestPolicyContext): boolean {
  const handoff = handoffs.get(projectId);
  return browserRequestAllowed(method, requestUrl, {
    targetOrigin: context?.targetOrigin ?? (() => { try { return new URL(requestUrl).origin; } catch { return ""; } })(),
    resourceType: context?.resourceType ?? "document",
    ...(context?.isNavigationRequest !== undefined ? { isNavigationRequest: context.isNavigationRequest } : {}),
    ...(context?.isMainFrameNavigation !== undefined ? { isMainFrameNavigation: context.isMainFrameNavigation } : {}),
    loginHandoffActive: handoff?.status === "waiting_for_user",
    authOrigins: handoff?.authOrigins ?? [],
  });
}

async function bringBrowserToFront(browser: Browser, page: Page): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  if (process.platform !== "win32") return;
  const pid = (browser as any).process?.()?.pid;
  const title = (await page.title().catch(() => "")).replaceAll("'", "''").slice(0, 180);
  if (!pid && !title) return;
  const findWindow = pid ? `$pidTarget=${pid}; $windows=Get-Process | Where-Object { $_.Id -eq $pidTarget }` : `$titleTarget='${title}'; $windows=Get-Process msedge,chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$titleTarget*" }`;
  const script = `${findWindow}; $pidTarget=if($windows){$windows[0].Id}else{0}; Add-Type @'
using System;
using System.Runtime.InteropServices;
public class TestPilotWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
'@; [TestPilotWindow]::EnumWindows({ param($h,$l) $owner=0; [void][TestPilotWindow]::GetWindowThreadProcessId($h,[ref]$owner); if ($owner -eq $pidTarget -and [TestPilotWindow]::IsWindowVisible($h)) { [void][TestPilotWindow]::ShowWindow($h,9); [void][TestPilotWindow]::SetForegroundWindow($h); [void][TestPilotWindow]::SetWindowPos($h,[IntPtr](-1),0,0,0,0,0x0001 -bor 0x0002 -bor 0x0040); return $false }; return $true },[IntPtr]::Zero) | Out-Null`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { timeout: 5000, windowsHide: true }).catch(() => undefined);
}
