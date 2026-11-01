import type { Page } from 'playwright';

/** Decorative SVGs do not establish that missing business text lives in pixels.
 * Only an effectively textless document with a substantial canvas is a known
 * visual-only surface. Mixed pages retain a normal failed text assertion. */
export async function inspectTextRenderSupport(page: Page): Promise<{ visualOnly: boolean; visibleCanvases: number; svgCount: number }> {
  let visibleCanvases = 0;
  let svgCount = 0;
  let textLength = 0;
  for (const frame of page.frames()) {
    try {
      const value = await frame.evaluate(() => ({
        textLength: (document.body?.innerText ?? '').replace(/\s/g, '').length,
        svgCount: document.querySelectorAll('svg').length,
        visibleCanvases: [...document.querySelectorAll('canvas')].filter(node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return rect.width >= 200 && rect.height >= 100 && rect.right > 0 && rect.bottom > 0
            && rect.left < innerWidth && rect.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
        }).length,
      }));
      visibleCanvases += value.visibleCanvases;
      svgCount += value.svgCount;
      textLength += value.textLength;
    } catch { /* a detached frame does not prove visual content */ }
  }
  return { visualOnly: visibleCanvases > 0 && textLength === 0, visibleCanvases, svgCount };
}
