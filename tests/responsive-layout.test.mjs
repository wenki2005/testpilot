import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

test('responsive layout assertion rejects clipped interactive content and accepts fitting content', async () => {
  const { assertNoHorizontalOverflow, readResponsiveLayoutMetrics } = await import('../dist/adapters/responsive-layout.js');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<main style="width:980px"><label>收件人<input value="测试"></label></main>');
    const clipped = await readResponsiveLayoutMetrics(page);
    assert.ok(clipped.scrollWidth > clipped.viewport || clipped.outOfBounds.length > 0);
    await assert.rejects(() => assertNoHorizontalOverflow(page), /横向内容未适配/);
    // A hidden-overflow shell can keep document.scrollWidth within the
    // viewport while clipping real content. The assertion must still catch it.
    await page.setContent('<body style="margin:0;overflow-x:hidden"><main style="width:390px"><h1 style="width:390px;white-space:nowrap;overflow:hidden">移动端标题被切掉并且后半段看不到</h1><p style="width:390px;white-space:nowrap;overflow:hidden">这段正文被容器裁切但页面本身没有横向滚动条</p></main></body>');
    const textClipped = await readResponsiveLayoutMetrics(page);
    assert.ok(textClipped.scrollWidth <= textClipped.viewport + 1);
    assert.ok(textClipped.clippedText.length > 0, 'visible text cut off by overflow:hidden must be detected');
    await assert.rejects(() => assertNoHorizontalOverflow(page), /被裁切文本/);
    await page.setContent('<main style="width:min(100%, 980px)"><label>收件人<input style="max-width:100%" value="测试"></label></main>');
    await assertNoHorizontalOverflow(page);
  } finally {
    await browser.close();
  }
});
