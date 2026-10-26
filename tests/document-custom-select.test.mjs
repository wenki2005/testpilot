import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { selectDocumentOptionByPlaceholder, selectDocumentOptionByRoleIndex } from '../dist/adapters/document-test-workflow.js';

async function launchBrowser() {
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    if (process.platform === 'win32' && /executable|browser|launch/i.test(String(error))) return chromium.launch({ headless: true, channel: 'msedge' });
    throw error;
  }
}

test('selects an option from a uniquely identified custom combobox', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label>所在地区<input role="combobox" placeholder="请选择省" aria-expanded="false"></label>
      <div role="listbox" hidden><div role="option">内蒙古自治区</div></div>
      <script>
        const input = document.querySelector('input');
        const listbox = document.querySelector('[role=listbox]');
        input.addEventListener('click', () => { listbox.hidden = false; input.setAttribute('aria-expanded', 'true'); });
        listbox.querySelector('[role=option]').addEventListener('click', () => {
          input.value = '内蒙古自治区'; listbox.hidden = true; input.setAttribute('aria-expanded', 'false');
        });
      </script>`);
    await selectDocumentOptionByPlaceholder(page, '请选择省', '内蒙古自治区');
    assert.equal(await page.getByPlaceholder('请选择省', { exact: true }).inputValue(), '内蒙古自治区');
  } finally {
    await browser.close();
  }
});

test('refuses an ambiguous placeholder instead of selecting an arbitrary control', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<input placeholder="请选择省"><input placeholder="请选择省">');
    await assert.rejects(selectDocumentOptionByPlaceholder(page, '请选择省', '内蒙古自治区'), /匹配 2 个控件/);
  } finally {
    await browser.close();
  }
});

test('selects a unique option through an ordinal accessible combobox', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input role="combobox" aria-label="省份" aria-expanded="false">
      <input role="combobox" aria-label="城市" aria-expanded="false">
      <div role="listbox" hidden><div class="option">通辽市</div></div>
      <script>
        const controls = [...document.querySelectorAll('[role=combobox]')];
        const list = document.querySelector('[role=listbox]');
        controls[1].addEventListener('click', () => { list.hidden = false; });
        list.querySelector('.option').addEventListener('click', () => {
          controls[1].value = '通辽市'; list.hidden = true;
        });
      </script>`);
    await selectDocumentOptionByRoleIndex(page, 1, '通辽市');
    assert.equal(await page.getByRole('combobox').nth(1).inputValue(), '通辽市');
  } finally {
    await browser.close();
  }
});
