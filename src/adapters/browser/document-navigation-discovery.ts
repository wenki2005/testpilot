import type { Page, ElementHandle } from 'playwright';
import { randomUUID } from 'node:crypto';
import { isDiscoveryNavigationLabel, safeDiscoveryRoute, type NavigationSnapshot, type NavigationTarget } from '../../domain/documents/projects/website-map.js';
import { redactSensitiveExportText } from '../documents/evidence/sensitive-data.js';
/** One DOM observation function is used for snapshot and pre-click revalidation. */
function observeNavigationDom() {
    const visible = (el: Element) => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const clean = (s: string | null, max = 180) => (s ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
    const elements = Array.from(document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],li,div,span')).filter(el => {
        if (!visible(el) || el.closest('form') && el.matches('button[type=submit]'))
            return false;
        const text = clean(el.getAttribute('aria-label') || el.textContent);
        if (!text || (el.textContent ?? '').trim().length > 180)
            return false;
        const semantic = el.matches('a,button,[role=button],[role=tab],[role=menuitem]');
        // Pointer styling is inherited: the card/menu root is one target, rather than every child line.
        return semantic || getComputedStyle(el).cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer' || (el as HTMLElement).style.cursor === 'pointer');
    }).slice(0, 300);
    return { elements, route: location.pathname + location.search + location.hash,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).map(el => clean(el.textContent)),
        visibleText: [...new Set((document.body.innerText ?? '').split(/\n+/u).map(s => clean(s)).filter(Boolean))].slice(0, 80),
        controls: Array.from(document.querySelectorAll('input:not([type=hidden]),textarea,select,button,[role=combobox]')).filter(visible).slice(0, 80).map(el => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? '', name: clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el as HTMLInputElement).labels?.[0]?.textContent || el.textContent), disabled: Boolean((el as HTMLInputElement).disabled) })),
        targets: elements.map(el => ({ label: clean(el.getAttribute('aria-label') || el.textContent), kind: el.matches('a[href]') ? 'link' as const : 'control' as const, href: el.getAttribute('href') ?? undefined })) };
}
const observationScript = `(() => { const __name = fn => fn; return (${observeNavigationDom.toString()})(); })()`;
export async function captureNavigationSnapshot(page: Page, targetUrl: string): Promise<NavigationSnapshot> {
    const route = safeDiscoveryRoute(page.url(), targetUrl);
    if (!route)
        throw new Error('当前导航地址不满足同源无凭证路径要求。');
    const raw = await page.evaluate(`(() => { const { elements, ...snapshot } = ${observationScript}; return snapshot; })()`) as Omit<NavigationSnapshot, 'evidenceId' | 'capturedAt' | 'title'>;
    const counts = new Map<string, number>();
    const targets = raw.targets.flatMap(item => {
        const key = `${item.kind}:${item.label}`;
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        if (!isDiscoveryNavigationLabel(item.label) || /\b1[3-9]\d{9}\b|@|password|token|验证码|密钥/iu.test(item.label))
            return [];
        const href = item.kind === 'link' && item.href && !/^javascript:|^#$/iu.test(item.href) ? safeDiscoveryRoute(item.href, page.url()) : undefined;
        if (item.kind === 'link' && item.href && !/^javascript:|^#$/iu.test(item.href) && !href)
            return [];
        return [{ label: redactSensitiveExportText(item.label), kind: item.kind, occurrence, ...(href ? { href } : {}) }];
    }).slice(0, 60);
    return { evidenceId: randomUUID(), capturedAt: new Date().toISOString(), route, title: redactSensitiveExportText(await page.title()), headings: raw.headings.map(redactSensitiveExportText), visibleText: raw.visibleText.map(redactSensitiveExportText), controls: raw.controls, targets };
}
export async function activateNavigationTarget(page: Page, target: NavigationTarget, targetUrl: string): Promise<void> {
    if (!isDiscoveryNavigationLabel(target.label))
        throw new Error('该目标不属于受控只读导航入口。');
    // Resolve observed elements again; the caller also verifies the full snapshot identity.
    const handle = await page.evaluateHandle(`(() => { const data = ${observationScript}; const target = ${JSON.stringify(target)}; return data.elements.filter(el => ((el.matches('a[href]') ? 'link' : 'control') === target.kind) && (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim().slice(0,180) === target.label)[target.occurrence] ?? null; })()`);
    try {
        const element = handle.asElement() as ElementHandle<HTMLElement> | null;
        if (!element)
            throw new Error('导航控件已变化或消失。');
        const disabled = await element.evaluate(el => Boolean((el as HTMLButtonElement).disabled) || el.getAttribute('aria-disabled') === 'true' || el.closest('form') !== null && (el instanceof HTMLButtonElement && el.type === 'submit' || el.getAttribute('type') === 'submit'));
        if (disabled)
            throw new Error('导航控件禁用或属于表单提交。');
        if (target.href && !safeDiscoveryRoute(target.href, targetUrl))
            throw new Error('导航链接不满足同源要求。');
        if (target.href)
            await page.goto(new URL(target.href, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 12000 });
        else
            await element.click({ timeout: 4000 });
        await page.waitForTimeout(350);
        if (!safeDiscoveryRoute(page.url(), targetUrl))
            throw new Error('导航后地址不符合项目范围。');
    }
    finally {
        await handle.dispose();
    }
}
