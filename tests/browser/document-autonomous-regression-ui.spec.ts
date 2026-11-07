import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let child: ChildProcess;
let base: string;
let dataDir: string;

test.beforeAll(async () => {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a local TestPilot UI port');
  const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  dataDir = await mkdtemp(path.join(tmpdir(), 'testpilot-autonomous-impact-ui-'));
  child = spawn(process.execPath, ['dist/server/http-server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      TESTPILOT_DATA_DIR: dataDir,
      TESTPILOT_ARTIFACTS_DIR: path.join(dataDir, 'artifacts'),
      TESTPILOT_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await expect.poll(async () => {
    try { return (await fetch(base)).status; } catch { return 0; }
  }, { timeout: 20000 }).toBe(200);
});

test.afterAll(async () => {
  if (child?.exitCode === null) {
    child.kill();
    await new Promise<void>(resolve => {
      child.once('exit', () => resolve());
      setTimeout(resolve, 3000).unref();
    });
  }
});

async function exerciseCreatedPlanStartPolicy(page: import('@playwright/test').Page, confirmationRequired: boolean) {
  const projectId = confirmationRequired ? 'synthetic-confirmed-autonomous-impact-project' : 'synthetic-autonomous-impact-project';
  const planId = '00000000-0000-4000-8000-000000000024';
  const version = {
    id: 'impact-version', label: 'Synthetic change', environment: 'isolated-local',
    targetUrl: 'http://127.0.0.1:48994/fixture', changeNotes: '更新列表显示文字', createdAt: '2026-11-01T04:00:00.000Z',
  };
  const testCase = {
    id: 'history-list', title: '确认列表显示', source: 'synthetic requirement: list display', requirementRefs: ['fixture/list'],
    kind: 'visible', expected: '列表文字符合要求', steps: [{ action: 'assertVisible', text: '列表' }], modulePath: ['列表'],
    selectedForRegression: true, lifecycleStatus: 'runnable', sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true,
  };
  const project = {
    id: projectId, name: 'Synthetic autonomous impact', fileName: 'synthetic.md', targetUrl: version.targetUrl,
    format: 'markdown', sourceText: 'Synthetic-only impact fixture.', reviewStatus: 'approved', caseMode: 'existing', confirmationRequired,
    platform: { type: 'pc-web', status: 'confirmed' }, executionConfig: { entryUrl: version.targetUrl, browser: 'chromium' },
    siteVersions: [version], activeSiteVersionId: version.id, testDataSets: [], cases: [testCase],
  };
  const plan = {
    id: planId, projectId, siteVersionId: version.id, createdAt: '2026-11-02T04:00:00.000Z', targetUrlSnapshot: version.targetUrl,
    blockers: [], validation: 'current', executionReadiness: 'ready',
    plan: {
      outcome: 'selected', selectedCaseIds: [testCase.id], prerequisiteCaseIds: [], orderedCaseIds: [testCase.id], execution: 'not-started',
      decisions: [{ caseId: testCase.id, reason: '变更说明提到列表显示。', evidence: [
        { source: 'change-notes', quote: '更新列表显示文字' }, { source: 'case-title', quote: '确认列表显示' },
      ] }],
    },
  };
  let executionPosts = 0;
  let executionPostBody: unknown;
  let createPlanBody: unknown;
  const execution = { planId, projectId, runId: 'synthetic-impact-run', state: 'completed', overall: 'passed' };

  await page.route('**/api/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/document-projects', route => route.fulfill({ json: [project] }));
  await page.route(`**/api/document-projects/${projectId}/**`, async route => {
    const url = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (url.endsWith('/autonomous-regression-plans') && method === 'GET') return route.fulfill({ json: [plan] });
    if (url.endsWith('/autonomous-regression-plans') && method === 'POST') {
      createPlanBody = route.request().postDataJSON();
      return route.fulfill({ json: plan });
    }
    if (url.endsWith(`/autonomous-regression-plans/${planId}`)) return route.fulfill({ json: plan });
    if (url.endsWith(`/autonomous-regression-plans/${planId}/execution`) && method === 'GET') {
      return executionPosts ? route.fulfill({ json: execution }) : route.fulfill({ status: 404, json: { error: 'No execution exists.' } });
    }
    if (url.endsWith(`/autonomous-regression-plans/${planId}/execution`) && method === 'POST') {
      executionPosts++;
      executionPostBody = route.request().postDataJSON();
      return route.fulfill({ json: execution });
    }
    if (url.endsWith('/session-profiles')) return route.fulfill({ json: { profiles: [], activeProfileId: null, message: 'Synthetic fixture only.' } });
    if (url.endsWith('/session-status')) return route.fulfill({ json: { state: 'connected', occupied: false, manualLoginRequired: false, checkedAt: version.createdAt, message: 'Synthetic fixture only.' } });
    if (url.endsWith('/runs')) return route.fulfill({ json: [] });
    if (url.endsWith('/revisions')) return route.fulfill({ json: { items: [], total: 0 } });
    if (url.endsWith('/recovery') || url.endsWith('/login')) return route.fulfill({ json: null });
    return route.fulfill({ json: project });
  });
  await page.route('**/api/config', route => route.fulfill({ json: { modelAvailable: false, computerUseAvailable: false, computerUseReason: 'Synthetic UI verification.', computerUseModel: '' } }));

  await page.goto(`${base}/?page=document-tests&documentProject=${projectId}`);
  await page.locator('#doc-management > summary').click();
  await page.locator('#doc-management summary').filter({ hasText: /^版本、资料与变更规划$/ }).click();
  const impactSection = page.locator('section[aria-labelledby="autonomous-regression-heading"]');
  await expect(impactSection.getByRole('heading', { name: '自主回归计划' })).toBeVisible();
  await impactSection.getByRole('button', { name: '创建自主回归计划' }).click();
  expect(createPlanBody).toEqual({ siteVersionId: version.id });
  if (confirmationRequired) {
    await expect(impactSection.getByRole('button', { name: '确认本轮范围并启动回归' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(executionPosts).toBe(0);
    await impactSection.getByRole('button', { name: '确认本轮范围并启动回归' }).click();
    await expect(impactSection.getByText(/执行状态：已完成 · passed/)).toBeVisible();
    expect(executionPosts).toBe(1);
    expect(executionPostBody).toEqual({ confirmBeforeStart: true });
  } else {
    await expect(impactSection.getByText(/执行状态：已完成 · passed/)).toBeVisible();
    expect(executionPosts).toBe(1);
    expect(executionPostBody).toEqual({});
    await expect(impactSection.getByRole('button', { name: '按此计划启动回归' })).toHaveCount(0);
  }
}

test('a newly created grounded plan automatically starts its safe historical scope when policy allows it', async ({ page }) => {
  await exerciseCreatedPlanStartPolicy(page, false);
});

test('a project requiring per-run confirmation never auto-starts and sends explicit confirmation on click', async ({ page }) => {
  await exerciseCreatedPlanStartPolicy(page, true);
});
