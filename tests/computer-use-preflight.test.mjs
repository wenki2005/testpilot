import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

test('Computer Use preflight distinguishes supported, refused, malformed, unsupported-image and timeout responses', async t => {
  const previous = Object.fromEntries(['TESTPILOT_DATA_DIR', 'TESTPILOT_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  process.env.TESTPILOT_DATA_DIR = resolve(import.meta.dirname, '..', 'artifacts', 'preflight-fixture', String(Date.now()));
  let mode = 'success';
  let requestCount = 0;
  const server = createServer((req, res) => {
    void (async () => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      requestCount++;
      const payload = JSON.parse(raw);
      const content = payload.messages.at(-1)?.content ?? [];
      assert.ok(Array.isArray(content) && content.some(item => item.type === 'image_url'), 'preflight must send a screenshot image');
      if (mode === 'timeout') { await new Promise(done => setTimeout(done, 250)); }
      if (mode === 'unsupported-image') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'image input is not supported by this model' } }));
        return;
      }
      let message;
      if (mode === 'refuse') message = { role: 'assistant', content: 'I cannot use tools.' };
      else {
        const args = mode === 'malformed' ? '{broken-json' : JSON.stringify({ canReadScreenshot: true });
        const name = mode === 'wrong-tool' ? 'another_tool' : 'testpilot_computer_capability_probe';
        message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name, arguments: args } }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'preflight-fixture', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(String(error)); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.TESTPILOT_API_KEY = 'local-preflight-key';
  process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.TESTPILOT_MODEL = 'local-preflight-fixture';
  process.env.OPENAI_API_KEY = '';
  const { preflightComputerUseScreenshot } = await import('../dist/adapters/computer-use.js');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAMSURBVBhXY0ADDAwAABIAAaMn47oAAAAASUVORK5CYII=';
  await t.test('a no-op function call confirms image and tool support', async () => {
    mode = 'success';
    await preflightComputerUseScreenshot(image, 'local-preflight-fixture');
  });
  await t.test('tool refusal is an explicit preflight failure', async () => {
    mode = 'refuse';
    await assert.rejects(preflightComputerUseScreenshot(image, 'local-preflight-fixture'), /能力预检未通过/);
  });
  await t.test('malformed tool JSON is rejected', async () => {
    mode = 'malformed';
    await assert.rejects(preflightComputerUseScreenshot(image, 'local-preflight-fixture'), /无效结果/);
  });
  await t.test('unexpected tool name is rejected', async () => {
    mode = 'wrong-tool';
    await assert.rejects(preflightComputerUseScreenshot(image, 'local-preflight-fixture'), /能力预检未通过/);
  });
  await t.test('unsupported image errors retain the provider reason', async () => {
    mode = 'unsupported-image';
    await assert.rejects(preflightComputerUseScreenshot(image, 'local-preflight-fixture'), /image input is not supported/);
  });
  await t.test('request timeout is surfaced without being treated as support', async () => {
    mode = 'timeout';
    await assert.rejects(preflightComputerUseScreenshot(image, 'local-preflight-fixture', undefined, 25), /timeout|abort|fetch/i);
  });
  assert.equal(requestCount, 6);
});

test('Computer Use admits safe clear no-script cases and allows bounded UI discovery with fixture gaps', async () => {
  const { canAutonomouslyExploreWithoutScript, canPassivelyObserveWithoutScript } = await import('../dist/adapters/computer-use.js');
  const safe = { steps: [], expected: '页面显示明确的空结果提示', sideEffectRisk: 'none' };
  assert.equal(canAutonomouslyExploreWithoutScript(safe), true);
  assert.equal(canAutonomouslyExploreWithoutScript({ steps: [], expected: safe.expected }), false, 'missing risk review must fail closed');
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, sideEffectRisk: 'unknown' }), false);
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, coverageGap: '依赖/范围：clarification-required' }), false);
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, coverageGap: '依赖/范围：na_or_scope_note' }), false);
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, coverageGap: '依赖/范围：api_data_or_business_fixture_prerequisite' }), false);
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, coverageGap: 'unreviewed requirement gap' }), false, 'unknown gaps must fail closed');
  const uiFixtureGap = { ...safe, title: '客户类型正常展示', executionRoute: 'browser-ui', sideEffectRisk: 'unknown', coverageGap: '依赖/范围：api_data_or_business_fixture_prerequisite' };
  assert.equal(canAutonomouslyExploreWithoutScript(uiFixtureGap), true, 'Computer Use may inspect the visible UI while its final status remains blocked by the fixture gap');
  assert.equal(canAutonomouslyExploreWithoutScript({ ...uiFixtureGap, coverageGap: 'clarification-required' }), false, 'unclear expected behavior must not be explored as if it were testable');
  assert.equal(canAutonomouslyExploreWithoutScript({ ...uiFixtureGap, title: '提交订单成功', expected: '创建订单' }), false, 'high-impact actions remain excluded');
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, sideEffectRisk: 'irreversible' }), false);
  assert.equal(canAutonomouslyExploreWithoutScript({ ...safe, expected: '[需澄清] 未确定条件' }), false);
  const gapCase = { ...safe, executionRoute: 'browser-ui', sideEffectRisk: 'unknown', coverageGap: '需要订单 fixture' };
  assert.equal(canPassivelyObserveWithoutScript(gapCase), true, 'unresolved fixtures may still receive screenshot-only observation');
  assert.equal(canPassivelyObserveWithoutScript({ ...gapCase, executionRoute: 'api-contract' }), false, 'API-only cases must not spend a visual pass on irrelevant screenshots');
  assert.equal(canPassivelyObserveWithoutScript({ ...gapCase, executionRoute: 'source-review' }), false, 'source-review cases are not browser observations');
  assert.equal(canPassivelyObserveWithoutScript({ ...gapCase, expected: '[需澄清] 口径未确认' }), false);
  assert.equal(canPassivelyObserveWithoutScript({ ...gapCase, steps: [{ action: 'clickByRole', role: 'button', name: 'Submit' }] }), false);
});

test('Computer Use executes safe exploration, permits passive observation with gaps, and blocks side effects on a local fixture only', { timeout: 90_000 }, async t => {
  const previous = Object.fromEntries(['TESTPILOT_DATA_DIR', 'TESTPILOT_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  process.env.TESTPILOT_DATA_DIR = resolve(import.meta.dirname, '..', 'artifacts', 'computer-use-fixture', String(Date.now()));
  process.env.TESTPILOT_API_KEY = 'local-computer-use-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_MODEL = 'local-computer-use-fixture';
  let posts = 0;
  let legacyGets = 0;
  let modelRequests = 0;
  let flakyTargetHits = 0;
  const target = createServer((req, res) => {
    if (req.method !== 'GET') posts++;
    if (req.url?.startsWith('/legacy-delete') || req.url?.startsWith('/autosave')) legacyGets++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url?.startsWith('/blank')) { res.end('<!doctype html><html><head><title></title></head><body></body></html>'); return; }
    if (req.url?.startsWith('/flaky') && ++flakyTargetHits === 1) { res.end('<!doctype html><html><head><title></title></head><body></body></html>'); return; }
    if (req.url?.startsWith('/legacy-delete') || req.url?.startsWith('/autosave')) { res.end('unexpected mutation reached server'); return; }
    res.end(`<!doctype html><html><body><button id="safe" style="position:absolute;left:20px;top:20px;width:140px;height:48px" onclick="document.querySelector('#ready').hidden=false">Show status</button><button id="submit" style="position:absolute;left:20px;top:90px;width:140px;height:48px" onclick="fetch('/submit',{method:'POST'})">Submit</button><button id="legacy" style="position:absolute;left:20px;top:160px;width:180px;height:48px" onclick="fetch('/legacy-delete?id=1')">Legacy delete (GET)</button><input id="autosave" aria-label="Draft" style="position:absolute;left:20px;top:230px;width:180px;height:40px" oninput="fetch('/autosave?value='+encodeURIComponent(this.value))"><h1 id="ready" hidden>Ready</h1></body></html>`);
  });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  let caseTurn = 0;
  const actionCounts = new Map();
  const plannedActions = {
    'safe-explore': [{ action: 'click', x: 80, y: 44 }],
    'malformed-retry': [{ action: 'click', x: 80, y: 44 }],
    'empty-reply-retry': [{ action: 'click', x: 80, y: 44 }],
    'empty-reply-retry-twice': [{ action: 'click', x: 80, y: 44 }],
    'flaky-recovery': [{ action: 'click', x: 80, y: 44 }],
    'max-safe-action-budget': Array.from({ length: 24 }, () => ({ action: 'wait' })),
    'blocked-submit': [{ action: 'click', x: 80, y: 114 }],
    'blocked-get-write': [{ action: 'click', x: 90, y: 184 }],
    'blocked-autosave': [{ action: 'click', x: 90, y: 250 }, { action: 'type', text: 'draft' }],
  };
  const malformedSent = new Set();
  const emptyReplySent = new Map();
  const model = createServer((req, res) => {
    void (async () => {
      modelRequests++;
      let raw = ''; for await (const part of req) raw += part;
      const payload = JSON.parse(raw);
      const toolName = payload.tools?.[0]?.function?.name;
      const texts = payload.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text) : [String(message.content ?? '')]);
      const caseId = texts.join('\n').match(/Case ID: ([^\.\s]+)/)?.[1];
      let message;
      if (toolName === 'testpilot_computer_capability_probe') {
        message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name: toolName, arguments: JSON.stringify({ canReadScreenshot: true }) } }] };
      } else if ((caseId === 'empty-reply-retry' && (emptyReplySent.get(caseId) ?? 0) < 1)
        || (caseId === 'empty-reply-retry-twice' && (emptyReplySent.get(caseId) ?? 0) < 2)) {
        emptyReplySent.set(caseId, (emptyReplySent.get(caseId) ?? 0) + 1);
        message = { role: 'assistant', content: '' };
      } else if (caseId === 'malformed-retry' && !malformedSent.has(caseId)) {
        malformedSent.add(caseId);
        message = { role: 'assistant', tool_calls: [{ id: `malformed-${++caseTurn}`, type: 'function', function: { name: toolName, arguments: '{broken-json' } }] };
      } else {
        const count = actionCounts.get(caseId) ?? 0;
        const planned = plannedActions[caseId] ?? [];
        if (toolName === 'computer_step' && count < planned.length) {
          actionCounts.set(caseId, count + 1);
          message = { role: 'assistant', tool_calls: [{ id: `action-${++caseTurn}`, type: 'function', function: { name: toolName, arguments: JSON.stringify(planned[count]) } }] };
        } else {
          const exploratorySuccess = caseId === 'safe-explore' || caseId === 'malformed-retry' || caseId === 'empty-reply-retry' || caseId === 'empty-reply-retry-twice' || caseId === 'max-safe-action-budget' || caseId === 'flaky-recovery';
          const status = exploratorySuccess ? 'passed' : 'inconclusive';
          const evidence = exploratorySuccess ? `The screenshot shows the Ready status after the safe control was clicked. ${'Additional visible detail. '.repeat(120)}` : 'The attempted side-effect action was contained by the local read-only guard.';
          message = { role: 'assistant', tool_calls: [{ id: `result-${++caseTurn}`, type: 'function', function: { name: toolName, arguments: JSON.stringify({ action: 'record_case_result', case_id: caseId, status, evidence }) } }] };
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'computer-use-fixture', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'tool_calls' }] }));
    })().catch(error => { if (!res.headersSent) res.writeHead(500); res.end(String(error)); });
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  t.after(async () => {
    await browser.close().catch(() => undefined);
    for (const server of [target, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  const { inspectSharedPageReadiness, runComputerUseLane } = await import('../dist/adapters/computer-use.js');
  const result = await runComputerUseLane(`http://127.0.0.1:${target.address().port}/`, [
    { id: 'safe-explore', title: 'Safe autonomous exploration', source: 'local fixture', expected: 'Clicking Show status reveals Ready and the page URL remains unchanged', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'malformed-retry', title: 'Malformed tool output is retried safely', source: 'local fixture', expected: 'Clicking Show status reveals Ready', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'empty-reply-retry', title: 'Empty model reply is retried safely', source: 'local fixture', expected: 'Clicking Show status reveals Ready', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'empty-reply-retry-twice', title: 'Two consecutive empty model replies are retried safely', source: 'local fixture', expected: 'Clicking Show status reveals Ready', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'max-safe-action-budget', title: 'A case at the safe action limit can still record its result', source: 'local fixture', expected: 'Waiting then recording the result remains within the tool budget', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'blocked-submit', title: 'Submit remains blocked', source: 'local fixture', expected: 'The submit control cannot be activated by autonomous exploration', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'blocked-get-write', title: 'Legacy GET write remains blocked', source: 'local fixture', expected: 'The legacy GET mutation cannot be activated by autonomous exploration', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'blocked-autosave', title: 'Input autosave remains blocked', source: 'local fixture', expected: 'Typing must not reach an autosave endpoint during read-only exploration', steps: [], sideEffectRisk: 'none', coverageGap: '' },
    { id: 'passive-gap', title: 'Fixture-dependent order details', source: 'local fixture', expected: 'An existing order detail shows its recipient and current status', steps: [], executionRoute: 'browser-ui', sideEffectRisk: 'irreversible', coverageGap: '需要已存在的订单 fixture；当前页面观测不能证明字段正确' },
  ], 'local-fixture', 'local-run', page);
  assert.deepEqual(result.results.map(item => item.status), ['passed', 'passed', 'passed', 'passed', 'passed', 'blocked', 'blocked', 'blocked', 'blocked'], JSON.stringify(result.results));
  assert.equal(result.results[0].actions, 1, 'the empty-step case should be explored through an actual safe click');
  assert.match(result.results[0].detail, /Playwright 已确认当前 URL 未变化/u, 'URL stability is verified from the browser page even though it is absent from the screenshot');
  assert.equal(result.results[1].actions, 1, 'after malformed JSON the harness retries and executes only the corrected safe click');
  assert.equal(result.results[2].actions, 1, 'after an empty model reply the harness retries and executes only the corrected safe click');
  assert.equal(result.results[3].actions, 1, 'after two consecutive empty replies the harness retries safely and executes only the valid click');
  assert.equal(result.results[4].actions, 24, 'using all safe actions still leaves one response turn to record the result');
  assert.equal(result.results[8].actions, 0, 'fixture-dependent cases are observed without any interaction');
  assert.match(result.results[8].detail, /仅收集当前页面的只读证据/u);
  assert.match(result.results[5].detail, /read-only guard/i);
  assert.equal(result.results[5].actions, 1, 'the model attempted one submit click and the harness refused it');
  assert.equal(posts, 0, 'the blocked submit action must not generate a POST');
  assert.equal(legacyGets, 0, 'read-only exploration must not reach a legacy GET mutation or input autosave endpoint');

  const blankCases = [
    { id: 'blank-1', title: 'first blank page case', source: 'local fixture', expected: 'A visible heading exists', steps: [], executionRoute: 'fixture-or-role', sideEffectRisk: 'irreversible', coverageGap: 'fixture needed' },
    { id: 'blank-2', title: 'second blank page case', source: 'local fixture', expected: 'A visible button exists', steps: [], executionRoute: 'fixture-or-role', sideEffectRisk: 'irreversible', coverageGap: 'fixture needed' },
  ];
  const baseUrl = `http://127.0.0.1:${target.address().port}`;
  const onCaseResultIds = [];
  const blankPage = await context.newPage();
  await blankPage.goto(`${baseUrl}/blank`);
  const beforeInitialBlank = modelRequests;
  const initialBlank = await runComputerUseLane(`${baseUrl}/`, blankCases, 'local-fixture', 'blank-run', blankPage, undefined, async result => onCaseResultIds.push(result.id));
  assert.deepEqual(initialBlank.results.map(item => [item.id, item.status]), [['blank-1', 'blocked'], ['blank-2', 'blocked']]);
  assert.equal(initialBlank.diagnostics?.length ?? 0, 0, 'the same-tab recovery should clear a stale blank route before lane preflight');
  assert.equal(new URL(blankPage.url()).pathname, '/', 'the recovered page remains in the original browser tab at the verified target');
  assert.deepEqual(onCaseResultIds, ['blank-1', 'blank-2'], 'all case IDs remain recorded after page recovery');
  assert.equal(modelRequests - beforeInitialBlank, 1, 'a healthy recovered page incurs only the single lane capability probe');

  const healthySharedPage = await context.newPage();
  await healthySharedPage.goto(`${baseUrl}/`);
  assert.equal(await inspectSharedPageReadiness(healthySharedPage), undefined, 'a healthy page must pass preflight after TypeScript compilation');
  assert.equal(await inspectSharedPageReadiness(blankPage), undefined, 'the formerly blank tab is healthy after same-tab recovery');
  const beforePostNavigationBlank = modelRequests;
  const navigatedBlank = await runComputerUseLane(`${baseUrl}/blank`, blankCases, 'local-fixture', 'blank-after-goto', healthySharedPage);
  assert.deepEqual(navigatedBlank.results.map(item => [item.id, item.status]), [['blank-1', 'blocked'], ['blank-2', 'blocked']]);
  assert.equal(navigatedBlank.diagnostics?.length, 1, 'a target that remains blank after same-tab recovery is reported once for the lane');
  assert.match(navigatedBlank.diagnostics[0], /页面空白或未加载/u);
  assert.equal(modelRequests - beforePostNavigationBlank, 0, 'a target that remains blank after recovery is stopped before any provider call');
  await healthySharedPage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  assert.equal(await healthySharedPage.getByRole('button', { name: 'Show status' }).isVisible(), true, 'Computer Use must clean per-case network routes so a later navigation still works');
  const recoveredBlank = await runComputerUseLane(`${baseUrl}/flaky`, [
    { id: 'flaky-recovery', title: 'Transient blank response recovers in the same tab', source: 'local fixture', expected: 'Clicking Show status reveals Ready', steps: [], sideEffectRisk: 'none', coverageGap: '' },
  ], 'local-fixture', 'flaky-recovery-run', healthySharedPage);
  assert.equal(flakyTargetHits, 3, 'a single blank response is retried once and the same page is reset before case execution');
  assert.equal(recoveredBlank.results[0]?.status, 'passed', JSON.stringify(recoveredBlank.results[0]));
  assert.equal(recoveredBlank.results[0]?.actions, 1);
  await blankPage.close();
});
