import type { Page } from "playwright";

export type ResponsiveLayoutMetrics = {
  viewport: number;
  scrollWidth: number;
  outOfBounds: Array<{ tag: string; text: string; left: number; right: number }>;
  clippedText: Array<{ tag: string; text: string; left: number; right: number }>;
};

export async function readResponsiveLayoutMetrics(page: Page): Promise<ResponsiveLayoutMetrics> {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const outOfBounds = Array.from(document.querySelectorAll("input,select,textarea,button,a,[role=button],[role=link]")).flatMap(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (!node.getClientRects().length || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return [];
      if (rect.width < 1 || rect.height < 1 || rect.right > viewport + 1 || rect.left < -1) {
        return [{ tag: node.tagName.toLowerCase(), text: (node.textContent ?? "").trim().slice(0, 40), left: Math.round(rect.left), right: Math.round(rect.right) }];
      }
      return [];
    }).slice(0, 5);
    const clippedText = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,li,label,button,a,[role=button],[role=link]" )).flatMap(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || !node.getClientRects().length || style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return [];
      if (rect.width < 1 || rect.height < 1 || rect.bottom <= 0 || rect.top >= window.innerHeight) return [];
      // A page can hide horizontal overflow and still cut off a heading or
      // paragraph. Include those visible text blocks, not only form controls.
      if (rect.right > viewport + 1 || rect.left < -1) return [{ tag: node.tagName.toLowerCase(), text: text.slice(0, 60), left: Math.round(rect.left), right: Math.round(rect.right) }];
      if (["hidden", "clip"].includes(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return [{ tag: node.tagName.toLowerCase(), text: text.slice(0, 60), left: Math.round(rect.left), right: Math.round(rect.right) }];
      return [];
    }).slice(0, 5);
    return { viewport, scrollWidth, outOfBounds, clippedText };
  });
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await readResponsiveLayoutMetrics(page);
  if (metrics.scrollWidth > metrics.viewport + 1 || metrics.outOfBounds.length > 0 || metrics.clippedText.length > 0) {
    throw new Error(`断言失败：横向内容未适配 ${metrics.viewport}px 视口；页面宽度 ${metrics.scrollWidth}px，视口外控件 ${JSON.stringify(metrics.outOfBounds)}，被裁切文本 ${JSON.stringify(metrics.clippedText)}。`);
  }
}
