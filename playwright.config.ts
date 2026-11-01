import { defineConfig } from '@playwright/test';
import path from 'node:path';

const evidenceRoot = process.env.TESTPILOT_TEST_RUN_DIR || './test-artifacts';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/seed.spec.ts',
  outputDir: path.join(evidenceRoot, 'playwright'),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: path.join(evidenceRoot, 'playwright-results.json') }]],
  use: { channel: process.env.TESTPILOT_BROWSER_CHANNEL || 'msedge', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
