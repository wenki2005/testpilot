import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const baselineMarker = 'HELD_OUT_BASELINE_MUST_NOT_LEAK_TO_GENERATION';

test('case-generation agent runs through trace-preserving review, browser lanes, report and verifiable package', { timeout: 180_000 }, async t => {
  const dataDir = resolve(root, 'artifacts', 'document-case-generation-vertical', String(Date.now()));
  await mkdir(dataDir, { recursive: true });
  const modelRequests = [];
  const target = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Local case generator fixture</title></head><body><main><h1>Ready</h1></main></body></html>');
  });
  const model = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const part of req) body += part;
      const payload = JSON.parse(body);
      modelRequests.push(payload);
      const system = payload.messages?.find(message => message.role === 'system')?.content ?? '';
      const toolName = payload.tools?.[0]?.function?.name;
      let message;
      if (toolName === 'testpilot_computer_capability_probe') {
        message = { role: 'assistant', tool_calls: [{ id: 'probe', type: 'function', function: { name: toolName, arguments: JSON.stringify({ canReadScreenshot: true }) } }] };
      } else if (toolName === 'submit_browser_steps') {
        message = { role: 'assistant', tool_calls: [{ id: 'steps', type: 'function', function: { name: toolName, arguments: JSON.stringify({ steps: [{ action: 'assertExactVisible', text: 'Ready' }] }) } }] };
      } else if (toolName === 'computer_step') {
        message = { role: 'assistant', tool_calls: [{ id: 'visual', type: 'function', function: { name: toolName, arguments: JSON.stringify({ action: 'record_case_result', status: 'passed', evidence: '当前截图明确显示标题 Ready，符合本用例的精确可见预期。' }) } }] };
      } else if (system.includes('测试用例生成 Agent')) {
        message = { role: 'assistant', content: JSON.stringify({
          requirements: [{ id: 'R1', text: '首页展示 Ready 标题', source: '需求资料 §1', priority: 'P1', confidence: 'high', scopeStatus: 'in-scope', scopeRationale: '明确列在本期需求中' }],
          cases: [{ title: '首页显示 Ready 标题', requirementIds: ['R1'], sourceRefs: ['需求资料 §1：首页验收'], scenarioType: 'positive', priority: 'P1', preconditions: [], testData: [], actions: ['打开目标网站首页'], expectedResult: '首页精确显示 Ready 标题', confidence: 'high', clarificationNeeded: [] }],
        }) };
      } else if (system.includes('独立测试设计审查员')) {
        const content = payload.messages?.at(-1)?.content ?? '';
        const caseId = content.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
        if (!caseId) throw new Error(`Could not locate generated case ID in review prompt: ${String(content).slice(0, 500)}`);
        message = { role: 'assistant', content: JSON.stringify({
          items: [{ aiCaseId: caseId, relation: 'novel', referenceCaseIds: [], rationale: '目标动作与预期未在留出样例中出现。' }],
          caseReviews: [{ aiCaseId: caseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: [] }],
        }) };
      } else {
        message = { role: 'assistant', content: '报告依据本地合成页面和本轮结构化证据生成。' };
      }
      if (payload.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const chunks = [];
        if (message.tool_calls?.length) {
          const call = message.tool_calls[0];
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] } }] });
          chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: call.function.arguments } }] } }] });
          chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        } else chunks.push({ choices: [{ index: 0, delta: { content: message.content ?? '' }, finish_reason: 'stop' }] });
        for (const chunk of chunks) res.write(`data: ${JSON.stringify({ id: 'vertical-fixture', object: 'chat.completion.chunk', model: 'local-vertical-fixture', ...chunk })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'vertical-fixture', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
      }
    })().catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  for (const server of [target, model]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const demoPort = portServer.address().port;
  await new Promise(done => portServer.close(done));

  const demoBase = `http://127.0.0.1:${demoPort}`;
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;
  const xmind = zipSync({ 'content.json': strToU8(JSON.stringify([{
    title: 'Held-out benchmark',
    rootTopic: { title: '基准用例', children: { attached: [{ title: baselineMarker }] } },
  }])) });
  const env = {
    ...process.env,
    PORT: String(demoPort),
    TESTPILOT_DATA_DIR: dataDir,
    TESTPILOT_API_KEY: 'local-vertical-fixture-key',
    OPENAI_API_KEY: '',
    TESTPILOT_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
    TESTPILOT_MODEL: 'local-vertical-fixture',
    TESTPILOT_BROWSER_CDP_ENDPOINT: '',
    TESTPILOT_BROWSER_HEADLESS: '1',
    TESTPILOT_BROWSER_CHANNEL: '',
    TESTPILOT_BROWSER_KEEP_EDGE_ON_SHUTDOWN: '0',
    TESTPILOT_DISABLE_PUBLIC_SEARCH: '1',
  };
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let demoLog = '';
  demo.stdout.on('data', chunk => { demoLog += chunk.toString(); });
  demo.stderr.on('data', chunk => { demoLog += chunk.toString(); });
  t.after(async () => {
    if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; }
    for (const server of [target, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });

  for (let i = 0; i < 120; i++) {
    if (demo.exitCode !== null) throw new Error(`Demo server exited early: ${demoLog}`);
    try { if ((await fetch(`${demoBase}/api/health`)).ok) break; } catch {}
    if (i === 119) throw new Error(`Demo server did not start: ${demoLog}`);
    await delay(100);
  }

  const generationResponse = await fetch(`${demoBase}/api/case-generator/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requirementsText: '需求资料：网站首页应展示 Ready 标题。',
      websiteUrl: targetUrl,
      websiteText: '首页标题为 Ready。',
      maxCases: 1,
      searchExamples: false,
      files: [{ fileName: 'held-out.xmind', bytesBase64: Buffer.from(xmind).toString('base64'), role: 'held-out-benchmark' }],
    }),
  });
  const generationText = await generationResponse.text();
  assert.equal(generationResponse.status, 201, generationText);
  const generationResponseBody = JSON.parse(generationText);
  const generation = generationResponseBody.generationArtifact;
  assert.ok(generation, 'generate endpoint returns the strict handoff artifact separately from UI metadata');
  assert.equal(Object.hasOwn(generation, 'research'), false);
  assert.equal(Object.hasOwn(generation.quality.benchmarkComparison, 'semanticReviews'), false);
  assert.equal(generationResponseBody.research.count, 0);
  assert.equal(generation.quality.benchmarkComparison.referenceCount, 1);
  assert.equal(generation.cases.filter(item => item.origin === 'ai-draft').length, 1);
  const firstGeneratorCall = modelRequests.find(call => call.messages?.some(message => message.role === 'system' && message.content.includes('测试用例生成 Agent')));
  const comparisonCall = modelRequests.find(call => call.messages?.some(message => message.role === 'system' && message.content.includes('独立测试设计审查员')));
  assert.ok(firstGeneratorCall, 'the AI case-generation model was invoked');
  assert.ok(comparisonCall, 'the independent post-generation comparison model was invoked');
  const firstGeneratorPrompt = JSON.stringify(firstGeneratorCall.messages);
  const comparisonPrompt = JSON.stringify(comparisonCall.messages);
  assert.equal(firstGeneratorPrompt.includes(baselineMarker), false, 'held-out benchmark text must not reach generation');
  assert.equal(comparisonPrompt.includes(baselineMarker), true, 'held-out benchmark is supplied only to post-generation comparison');

  const handoffResponse = await fetch(`${demoBase}/api/case-generator/execute-draft`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation, targetUrl, name: 'Vertical isolated fixture' }),
  });
  const handoffText = await handoffResponse.text();
  assert.equal(handoffResponse.status, 201, handoffText);
  const handoff = JSON.parse(handoffText);
  const projectId = handoff.projectId;
  const getProject = async () => (await fetch(`${demoBase}/api/document-projects`)).json().then(items => items.find(item => item.id === projectId));
  let project = await getProject();
  assert.equal(project.cases.length, 1, 'held-out baseline is not transferred as an executable case');
  assert.equal(project.cases[0].caseGenerationTrace.original.actions[0], '打开目标网站首页');
  assert.equal(project.caseGeneration.rawResult.cases.find(item => item.origin === 'ai-draft').actions[0], '打开目标网站首页');

  // A browser/UI edit may change reviewable case metadata, but cannot replace
  // the trusted source trace that came from the generation handoff.
  const maliciousTrace = { ...project.cases[0].caseGenerationTrace, actions: ['forged action'] };
  const editedCase = { ...project.cases[0], sideEffectRisk: 'none', preconditionsConfirmed: true, caseGenerationTrace: maliciousTrace };
  const updateResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: [editedCase] }),
  });
  const updateText = await updateResponse.text();
  assert.equal(updateResponse.status, 200, updateText);
  project = JSON.parse(updateText);
  assert.equal(project.cases[0].caseGenerationTrace.actions[0], '打开目标网站首页');
  assert.equal(project.cases[0].caseGenerationTrace.original.actions[0], '打开目标网站首页');

  // No page is pre-opened: the authoring endpoint must recover/create this
  // project's one persistent session, navigate that same page to the verified
  // target, and gather grounded evidence without a per-case browser launch.
  const stepResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/generate-steps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: ['AI-001'] }),
  });
  const stepText = await stepResponse.text();
  assert.equal(stepResponse.status, 200, stepText);
  assert.deepEqual(JSON.parse(stepText).generatedCaseIds, ['AI-001'], `${stepText}\n${JSON.stringify(modelRequests.map(call => ({ url: call.model, tools: call.tools?.map(tool => tool.function?.name), system: call.messages?.[0]?.content?.slice?.(0, 100) })))}`);
  const stepAuthoringCall = modelRequests.find(call => call.tools?.some(tool => tool.function?.name === 'submit_browser_steps'));
  assert.ok(stepAuthoringCall, 'the step-authoring agent was invoked');
  const stepAuthoringPrompt = JSON.stringify(stepAuthoringCall.messages);
  assert.match(stepAuthoringPrompt, /Original manual design actions/u, 'step author receives the original manual action context');
  assert.match(stepAuthoringPrompt, /打开目标网站首页/u, 'the original generated action is preserved through the authoring handoff');
  project = await getProject();
  assert.deepEqual(project.cases[0].steps, [{ action: 'assertExactVisible', text: 'Ready' }]);
  assert.deepEqual(project.stepAuthoring.results.map(item => ({ caseId: item.caseId, status: item.status, stepCount: item.stepCount })), [{ caseId: 'AI-001', status: 'generated', stepCount: 1 }]);
  assert.match(project.stepAuthoring.results[0].detail, /尚未执行/u, 'generation status must distinguish a runnable draft from execution success');
  assert.equal(project.cases[0].caseGenerationTrace.original.actions[0], '打开目标网站首页');

  const reviewResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: '孤立本地纵向流程审核：只读文本断言。' }),
  });
  const reviewText = await reviewResponse.text();
  assert.equal(reviewResponse.status, 200, reviewText);
  project = JSON.parse(reviewText);
  assert.equal(project.cases[0].caseGenerationTrace.original.actions[0], '打开目标网站首页');
  assert.ok(project.workflowId);

  const startResponse = await fetch(`${demoBase}/api/document-projects/${projectId}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runMode: 'compare', selectedCaseIds: ['AI-001'] }) });
  const startText = await startResponse.text();
  assert.equal(startResponse.status, 202, startText);
  const start = JSON.parse(startText);
  let progress;
  for (let i = 0; i < 500; i++) {
    const response = await fetch(`${demoBase}/api/document-runs/${start.runId}/progress`);
    if (response.ok) {
      progress = await response.json();
      if (progress.status === 'completed' || progress.status === 'failed') break;
    }
    await delay(200);
  }
  assert.equal(progress?.status, 'completed', `run did not complete: ${JSON.stringify(progress)}\n${demoLog}`);
  const runResponse = await fetch(`${demoBase}/api/document-runs/${start.runId}`);
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.deterministic.results[0].status, 'passed');
  assert.equal(run.ai.results[0].status, 'passed', JSON.stringify({ ai: run.ai, deterministic: run.deterministic, comparisons: run.comparisons, modelCalls: modelRequests.map(call => ({ stream: call.stream, tool: call.tools?.[0]?.function?.name })) }));
  assert.equal(run.finalReady, true);
  assert.equal(run.overall, 'passed');
  assert.equal(run.workflowId, project.workflowId);

  const workflowResponse = await fetch(`${demoBase}/api/document-workflows/${project.workflowId}`);
  assert.equal(workflowResponse.status, 200);
  const workflow = await workflowResponse.json();
  assert.equal(workflow.status, 'completed');
  const generationStage = workflow.stages.find(stage => stage.stageId === 'generate-cases' && stage.status === 'completed');
  assert.ok(generationStage.outputArtifactIds.some(id => id.startsWith(`case-generation:${project.caseGeneration.artifactId}:v${project.caseGeneration.version}:`)));
  for (const stageId of ['generate-cases', 'review-cases', 'author-steps', 'human-approval', 'deterministic-execution', 'computer-use-execution', 'analyze-results', 'generate-report', 'package-artifacts']) {
    assert.ok(workflow.stages.some(stage => stage.stageId === stageId && stage.status === 'completed'), `workflow stage ${stageId} must be persisted as complete`);
  }

  const reportResponse = await fetch(`${demoBase}/api/document-runs/${start.runId}/report`);
  assert.equal(reportResponse.status, 200);
  const report = await reportResponse.text();
  assert.match(report, /AI 独立用例|生成 artifact|用例生成/);
  assert.match(report, /顺序复用本轮浏览器页面|共享浏览器/);
  const packageResponse = await fetch(`${demoBase}/api/document-runs/${start.runId}/package`);
  assert.equal(packageResponse.status, 200);
  const packageBytes = new Uint8Array(await packageResponse.arrayBuffer());
  const archive = unzipSync(packageBytes);
  for (const name of ['case-generation.json', 'cases.json', 'run.json', 'report.md', 'run.mjs', 'artifacts.json']) assert.ok(archive[name], `package should contain ${name}`);
  const packagedGeneration = JSON.parse(strFromU8(archive['case-generation.json']));
  assert.equal(packagedGeneration.rawResult.cases.find(item => item.origin === 'ai-draft').actions[0], '打开目标网站首页');
  assert.equal(packagedGeneration.rawResult.cases.find(item => item.origin === 'existing').title.includes(baselineMarker), true);
  const manifest = JSON.parse(strFromU8(archive['artifacts.json']));
  assert.equal(manifest.runId, start.runId);
  const listed = new Map(manifest.artifacts.map(item => [item.path, item]));
  for (const path of Object.keys(archive).filter(path => path !== 'artifacts.json')) {
    const entry = listed.get(path);
    assert.ok(entry, `manifest lists ${path}`);
    assert.equal(entry.sizeBytes, archive[path].byteLength, `${path} size agrees with manifest`);
    assert.equal(entry.sha256, createHash('sha256').update(archive[path]).digest('hex'), `${path} digest agrees with manifest`);
  }
  assert.equal(listed.get('case-generation.json').sources[0].id, packagedGeneration.artifactId);
  assert.equal(listed.get('case-generation.json').sources[0].digest, packagedGeneration.digest);
  const packagedCases = JSON.parse(strFromU8(archive['cases.json']));
  assert.equal(packagedCases.cases.length, 1);
  assert.equal(packagedCases.cases[0].caseGenerationTrace.original.actions[0], '打开目标网站首页');

  const validationDir = resolve(root, 'artifacts', 'validation', '2026-10-19');
  await mkdir(validationDir, { recursive: true });
  await writeFile(join(validationDir, `testpilot-case-generation-${start.runId}.zip`), packageBytes);
  await writeFile(join(validationDir, `testpilot-case-generation-${start.runId}-report.md`), report, 'utf8');
});
