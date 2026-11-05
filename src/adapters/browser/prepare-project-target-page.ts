import type { Browser, Page, Route } from "playwright";
import { isAuthenticationRoute } from './login-handoff.js';
export type ProjectTargetPageDependencies = {
    allowRequest(method: string, requestUrl: string, projectId: string, context: {
        targetOrigin: string;
        resourceType: string;
        isNavigationRequest: boolean;
        isMainFrameNavigation: boolean;
        authenticationPage?: boolean;
    }): boolean;
    navigate(page: Page, targetUrl: string, timeoutMs: number): Promise<unknown>;
    isLoginPage(page: Page): Promise<boolean>;
    waitForUserLogin(projectId: string, runId: string, targetUrl: string, browser: Browser, page: Page, onLoginWait?: (waiting: boolean) => Promise<void>): Promise<unknown>;
};
/** Applies target-origin browser policy and preserves the shared human login handoff. */
export function createProjectTargetPagePreparer(deps: ProjectTargetPageDependencies) {
    return async function prepareProjectTargetPage(targetUrl: string, projectId: string, runId: string, page: Page, onLoginWait?: (waiting: boolean) => Promise<void>): Promise<void> {
        await page.unrouteAll({ behavior: 'wait' }).catch(() => undefined);
        const allowedOrigin = new URL(targetUrl).origin;
        await page.route("**/*", async (route: Route) => {
            const request = route.request();
            const navigation = request.isNavigationRequest();
            const mainFrameNavigation = navigation && request.frame().parentFrame() === null;
            if (!deps.allowRequest(request.method(), request.url(), projectId, {
                targetOrigin: allowedOrigin,
                resourceType: request.resourceType(),
                isNavigationRequest: navigation,
                isMainFrameNavigation: mainFrameNavigation,
                authenticationPage: isAuthenticationRoute(page.url()),
            })) {
                await route.abort("blockedbyclient");
                return;
            }
            if (mainFrameNavigation) {
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
        });
        const target = new URL(targetUrl);
        let current: URL | undefined;
        try {
            current = new URL(page.url());
        }
        catch { /* about:blank */ }
        if (!current || current.origin !== target.origin || current.href !== target.href) {
            await deps.navigate(page, targetUrl, 30000);
        }
        if (await deps.isLoginPage(page)) {
            const browser = page.context().browser();
            if (!browser)
                throw new Error("当前共享测试页没有可用浏览器上下文，无法等待同一窗口登录。");
            await deps.waitForUserLogin(projectId, runId, targetUrl, browser, page, onLoginWait);
        }
    };
}
