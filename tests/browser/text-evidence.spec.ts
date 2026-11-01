import { test, expect } from '@playwright/test';
import { inspectTextRenderSupport } from '../../src/adapters/browser-text-evidence.js';

test('decorative SVGs do not turn a missing business assertion into a visual blocker', async ({ page }) => {
  await page.setContent('<h1>Sample application</h1><svg width="24" height="24"><path d="M0 0h20v20z"/></svg><p>Book lookup failed</p>');
  await expect(page.getByText('Book lookup failed', { exact: true })).toBeVisible();
  const result = await inspectTextRenderSupport(page);
  expect(result.svgCount).toBe(1);
  expect(result.visualOnly).toBe(false);
});

test('textless canvas remains explicitly unsupported by text-only assertions', async ({ page }) => {
  await page.setContent('<canvas width="800" height="400"></canvas>');
  expect((await inspectTextRenderSupport(page)).visualOnly).toBe(true);
});

test('hidden canvas and mixed DOM text are not evidence that missing text is pixel-rendered', async ({ page }) => {
  await page.setContent('<canvas width="800" height="400" style="display:none"></canvas>');
  expect((await inspectTextRenderSupport(page)).visualOnly).toBe(false);
  await page.setContent('<p>Inventory</p><canvas width="800" height="400"></canvas>');
  expect((await inspectTextRenderSupport(page)).visualOnly).toBe(false);
});

test('embedded DOM text prevents a false visual-only classification', async ({ page }) => {
  await page.setContent('<canvas width="800" height="400"></canvas><iframe srcdoc="<p>Book details</p>"></iframe>');
  await expect(page.frameLocator('iframe').getByText('Book details')).toBeVisible();
  expect((await inspectTextRenderSupport(page)).visualOnly).toBe(false);
});
