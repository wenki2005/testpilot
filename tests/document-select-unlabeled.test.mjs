import test from 'node:test';
import assert from 'node:assert/strict';

test('document runner selects a native option by its nearby visible label when the markup has no accessible label', async t => {
  const { launchTestBrowser } = await import('../dist/adapters/browser-runtime.js');
  const { selectDocumentOption } = await import('../dist/adapters/document-test-workflow.js');
  const browser = await launchTestBrowser({ headless: true });
  const page = await browser.newPage();
  t.after(async () => { await page.close().catch(() => undefined); await browser.close(); });
  await page.setContent(`<!doctype html><html><body>
    <section><span>样书用途</span><select id="usage"><option>营销用书</option><option>产品用书</option></select><output id="selected">营销用书</output></section>
    <section><span>其他选项</span><select><option>产品用书</option></select></section>
    <script>document.querySelector('#usage').addEventListener('change', e => document.querySelector('#selected').textContent = e.target.value)</script>
  </body></html>`);
  await selectDocumentOption(page, '样书用途', '产品用书');
  assert.equal(await page.locator('#usage').inputValue(), '产品用书');
  assert.equal(await page.locator('#selected').innerText(), '产品用书');
  await assert.rejects(selectDocumentOption(page, '缺失标签', '产品用书'), /只有 0 个匹配|无法定位字段/);
});

test('document runner selects a unique native option by an exact visible placeholder', async t => {
  const { launchTestBrowser } = await import('../dist/adapters/browser-runtime.js');
  const { selectDocumentOptionByPlaceholder } = await import('../dist/adapters/document-test-workflow.js');
  const browser = await launchTestBrowser({ headless: true });
  const page = await browser.newPage();
  t.after(async () => { await page.close().catch(() => undefined); await browser.close(); });
  await page.setContent(`<label>省<select aria-label="省" placeholder="请选择省"><option value="">请选择省</option><option value="hn">湖南省</option></select></label>`);
  await selectDocumentOptionByPlaceholder(page, '请选择省', '湖南省');
  assert.equal(await page.getByLabel('省').inputValue(), 'hn');
  await assert.rejects(selectDocumentOptionByPlaceholder(page, '不存在', '湖南省'), /匹配 0 个控件/);
});
