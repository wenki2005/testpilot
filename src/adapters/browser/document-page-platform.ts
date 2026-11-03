import type { CDPSession, Page } from 'playwright';
import type { DocumentProjectExecutionConfig } from '../../domain/document-test-model.js';

export const documentMobileUserAgent = 'Mozilla/5.0 (Linux; Android 13; TestPilot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const overrides = new WeakMap<Page, { session: CDPSession; original: string }>();

/** Apply explicit mobile mode before navigation while retaining the account context. */
export async function configureDocumentPagePlatform(page: Page, config?: DocumentProjectExecutionConfig): Promise<void> {
  if (config?.viewport) await page.setViewportSize(config.viewport);
  let override = overrides.get(page);
  if (!override && config?.isMobile) {
    override = { session: await page.context().newCDPSession(page), original: await page.evaluate(() => navigator.userAgent) };
    overrides.set(page, override);
  }
  if (override) {
    await override.session.send('Emulation.setUserAgentOverride', { userAgent: config?.isMobile ? documentMobileUserAgent : override.original });
    await override.session.send('Emulation.setTouchEmulationEnabled', { enabled: config?.isMobile === true });
  }
}
