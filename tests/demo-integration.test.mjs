import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const active = new Set(['queued', 'running']);

test('HTTP evidence, Pi tool loop and unchanged regression expectations form a real round trip', { timeout: 180000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolveClose => reservation.close(resolveClose));
  const dataDir = resolve(root, 'artifacts', 'integration', String(Date.now()));
  await mkdir(dataDir, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  let child;
  let log = '';
  let authoringEndpoint = '';
  async function start() {
    child = spawn(process.execPath, ['dist/demo/server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: authoringEndpoint ? 'mock-key' : '', OPENAI_API_KEY: '', TESTPILOT_BASE_URL: authoringEndpoint, TESTPILOT_MODEL: 'local-authoring-fixture' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.on('data', chunk => { log += chunk.toString(); });
    child.stderr.on('data', chunk => { log += chunk.toString(); });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${log}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
      await delay(75);
    }
    throw new Error(`Server did not start: ${log}`);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const closed = once(child, 'exit');
    child.kill();
    await closed;
  }
  async function api(path, body) {
    const response = await fetch(`${base}${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const value = await response.json();
    return { response, value };
  }
  async function complete(id) {
    for (let i = 0; i < 150; i++) {
      const { value } = await api(`/api/runs/${id}`);
      if (!active.has(value.status)) {
        // Let the terminal report flush before testing persistence or launching another task.
        for (let n = 0; n < 30; n++) {
          try { const persisted = JSON.parse(await readFile(resolve(dataDir, 'runs', id, 'run.json'), 'utf8')); if (!active.has(persisted.status)) return value; } catch {}
          await delay(20);
        }
        return value;
      }
      await delay(40);
    }
    throw new Error(`Run ${id} did not stop`);
  }
  await start();
  t.after(stop);
  const config = (await api('/api/config')).value;
  const request = (mode, extra = {}) => ({ mode, provider: 'offline', requirements: config.defaultRequirements, maxActions: 24, target: 'sample', ...extra });
  let deterministic;
  let exploration;
  let regression;
  let projectRun;
  await t.test('fixed suite captures the seeded negative quantity bug and normal controls', async () => {
    const created = await api('/api/runs', request('deterministic'));
    assert.equal(created.response.status, 202);
    deterministic = await complete(created.value.id);
    assert.equal(deterministic.status, 'failed');
    assert.ok(deterministic.assertions.some(a => a.status === 'passed'));
    assert.ok(deterministic.assertions.some(a => a.status === 'failed' && a.expected.status === 400 && a.actual.status === 201));
    for (const assertion of deterministic.assertions) assert.ok(deterministic.evidence.find(e => e.id === assertion.evidenceId));
    const immediatelyQueued = await api('/api/runs', request('deterministic'));
    assert.equal(immediatelyQueued.response.status, 202, 'once persisted as terminal the previous run must have released the shared execution slot');
    const followup = await complete(immediatelyQueued.value.id);
    assert.equal(followup.status, 'failed');
  });
  await t.test('Pi offline tool loop checks additional contract boundaries with response evidence', async () => {
    const created = await api('/api/runs', request('autonomous'));
    assert.equal(created.response.status, 202);
    exploration = await complete(created.value.id);
    assert.equal(exploration.status, 'failed');
    assert.ok(exploration.assertions.filter(a => a.status === 'failed').length >= 3);
    assert.ok(exploration.evidence.some(e => e.path === '/sample/openapi.json'));
    assert.ok(exploration.events.some(e => e.kind === 'tool'));
    assert.ok(exploration.limitations.some(x => /离线|offline|脚本/i.test(x)));
    assert.ok(exploration.coverage.visited.length > 0);
  });
  await t.test('requirement path runs the supported sample requirements', async () => {
    const created = await api('/api/runs', request('requirements'));
    const run = await complete(created.value.id);
    assert.equal(run.status, 'failed');
    assert.ok(run.assertions.length > 0);
    assert.ok(run.plan.length > 0);
  });
  await t.test('unsupported offline requirements and budget exhaustion never become passes', async () => {
    const unknown = await api('/api/runs', request('requirements', { requirements: '验证仓库盘点和库存补货功能' }));
    const unknownRun = await complete(unknown.value.id);
    assert.equal(unknownRun.status, 'blocked');
    assert.equal(unknownRun.assertions.length, 0);
    const limited = await api('/api/runs', request('autonomous', { maxActions: 1 }));
    const limitedRun = await complete(limited.value.id);
    assert.notEqual(limitedRun.status, 'passed');
    assert.ok(limitedRun.actionCount <= 1);
  });
  await t.test('save an actual failed expectation, reproduce it, then pass unchanged on the preset repair', async () => {
    const failed = exploration.assertions.find(a => a.status === 'failed');
    const saved = await api('/api/regressions', { runId: exploration.id, assertionId: failed.id });
    assert.equal(saved.response.status, 201);
    regression = saved.value;
    assert.deepEqual(regression.expect, failed.expected);
    let created = await api('/api/regressions/run', {});
    assert.equal(created.response.status, 202);
    assert.equal((await complete(created.value.id)).status, 'failed');
    assert.equal((await api('/api/target', { fixed: true })).response.status, 200);
    created = await api('/api/regressions/run', {});
    const repaired = await complete(created.value.id);
    assert.equal(repaired.status, 'passed');
    assert.deepEqual(repaired.assertions[0].expected, failed.expected);
    const all = await api('/api/runs', request('autonomous'));
    const allRepaired = await complete(all.value.id);
    assert.equal(allRepaired.status, 'passed');
    assert.equal(allRepaired.assertions.filter(a => a.status === 'failed').length, 0);
  });
  await t.test('downloads contain actual evidence; invalid inputs and absent model config are explicit', async () => {
    const report = await fetch(`${base}/api/runs/${exploration.id}/report?format=md`);
    assert.equal(report.status, 200);
    assert.match(await report.text(), new RegExp(exploration.id));
    const exported = (await api(`/api/runs/${exploration.id}/report?format=json`)).value;
    assert.deepEqual(exported.assertions, exploration.assertions);
    assert.equal((await api('/api/runs', request('autonomous', { maxActions: -1 }))).response.status, 400);
    const noModel = await api('/api/runs', request('autonomous', { provider: 'model' }));
    if (noModel.response.status === 202) assert.equal((await complete(noModel.value.id)).status, 'blocked');
    else assert.equal(noModel.response.status, 409);
    assert.equal((await api('/api/regressions', { runId: exploration.id, assertionId: 'missing' })).response.status, 404);
    const foreign = await fetch(`${base}/api/target`, { method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: '{"fixed":true}' });
    assert.equal(foreign.status, 403);
  });
  await t.test('run history and reviewed regression survive a server restart', async () => {
    await stop();
    await start();
    assert.ok((await api('/api/runs')).value.some(r => r.id === exploration.id));
    assert.deepEqual((await api('/api/regressions')).value.find(c => c.id === regression.id).expect, regression.expect);
    if (projectRun) assert.ok((await api('/api/project-runs')).value.some(r => r.id === projectRun.id));
  });

  await t.test('registered project profiles run in disposable copies and serve normalized evidence/artifacts', { timeout: 240000 }, async () => {
    const profiles = await api('/api/project-profiles');
    assert.deepEqual(profiles.value.map(profile => profile.id).sort(), ['book-companion', 'demo-hub', 'grammar-lab', 'plural-runner', 'word-runner']);
    assert.equal((await api('/api/project-runs', { profileId: '../grammar-lab' })).response.status, 404);
    assert.equal((await api('/api/project-runs', { profileId: 'grammar-lab', projectRoot: 'C:/', command: 'whoami' })).response.status, 400);
    const foreignOrigin = await fetch(`${base}/api/project-runs`, { method: 'POST', headers: { origin: 'https://example.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ profileId: 'grammar-lab' }) });
    assert.equal(foreignOrigin.status, 403);
    const created = await api('/api/project-runs', { profileId: 'grammar-lab' });
    assert.equal(created.response.status, 202);
    projectRun = created.value;
    assert.equal(projectRun.profileId, 'grammar-lab');
    assert.equal((await api('/api/project-runs', { profileId: 'grammar-lab' })).response.status, 409, 'only one local profile may run at once');
    for (let i = 0; i < 500; i++) {
      const next = await api(`/api/project-runs/${projectRun.id}`);
      projectRun = next.value;
      if (!active.has(projectRun.status)) break;
      await delay(50);
    }
    assert.equal(projectRun.status, 'passed', projectRun.summary);
    assert.equal(projectRun.results[0].actualExitCode, 0);
    assert.match(projectRun.results[0].evidence.find(item => item.kind === 'stdout').content, /playwright|browser|Microsoft Edge/i);
    assert.ok(projectRun.artifactFiles.includes('artifacts/browser-report.json'));
    assert.ok(projectRun.artifactFiles.some(file => file.endsWith('.png')));
    const markdown = await fetch(`${base}/api/project-runs/${projectRun.id}/report?format=md`);
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Grammar Lab existing tests/);
    const normalized = await api(`/api/project-runs/${projectRun.id}/report?format=json`);
    assert.equal(normalized.value.status, 'passed');
    assert.equal(normalized.value.results[0].actualExitCode, 0);
    const artifact = await fetch(`${base}/api/project-runs/${projectRun.id}/artifacts/artifacts/browser-report.json`);
    assert.equal(artifact.status, 200);
    assert.equal((await artifact.json()).errors.length, 0);
    assert.equal((await fetch(`${base}/api/project-runs/${projectRun.id}/artifacts/../../profile-run.json`)).status, 404);
    const pluralStart = await api('/api/project-runs', { profileId: 'plural-runner' });
    assert.equal(pluralStart.response.status, 202);
    let pluralRun = pluralStart.value;
    for (let i = 0; i < 300; i++) {
      const next = await api(`/api/project-runs/${pluralRun.id}`);
      pluralRun = next.value;
      if (!active.has(pluralRun.status)) break;
      await delay(50);
    }
    assert.equal(pluralRun.status, 'passed', pluralRun.summary);
    assert.equal(pluralRun.results[0].actualExitCode, 0);
    assert.match(pluralRun.results[0].evidence.find(item => item.kind === 'stdout').content, /10000随机种子/);
    const bookStart = await api('/api/project-runs', { profileId: 'book-companion' });
    assert.equal(bookStart.response.status, 202);
    let bookRun = bookStart.value;
    for (let i = 0; i < 4000; i++) {
      const next = await api(`/api/project-runs/${bookRun.id}`);
      bookRun = next.value;
      if (!active.has(bookRun.status)) break;
      await delay(50);
    }
    assert.equal(bookRun.status, 'passed', bookRun.summary);
    assert.equal(bookRun.results.length, 2);
    assert.ok(bookRun.results.every(result => result.actualExitCode === 0));
    assert.match(bookRun.results[1].evidence.find(item => item.kind === 'stdout').content, /无浏览器脚本错误/);
    assert.ok(bookRun.artifactFiles.includes('artifacts/browser-report.json'));
    const wordStart = await api('/api/project-runs', { profileId: 'word-runner' });
    assert.equal(wordStart.response.status, 202);
    let wordRun = wordStart.value;
    for (let i = 0; i < 4000; i++) {
      const next = await api(`/api/project-runs/${wordRun.id}`);
      wordRun = next.value;
      if (!active.has(wordRun.status)) break;
      await delay(50);
    }
    assert.equal(wordRun.status, 'passed', wordRun.summary);
    assert.equal(wordRun.results.length, 2);
    assert.ok(wordRun.results.every(result => result.actualExitCode === 0));
    assert.match(wordRun.results[0].evidence.find(item => item.kind === 'stdout').content, /10000种子/);
    assert.match(wordRun.results[1].evidence.find(item => item.kind === 'stdout').content, /原生触摸/);
    assert.ok(wordRun.artifactFiles.includes('artifacts/browser-report.json'));
    const hubStart = await api('/api/project-runs', { profileId: 'demo-hub' });
    assert.equal(hubStart.response.status, 202);
    let hubRun = hubStart.value;
    for (let i = 0; i < 1200; i++) {
      const next = await api(`/api/project-runs/${hubRun.id}`);
      hubRun = next.value;
      if (!active.has(hubRun.status)) break;
      await delay(50);
    }
    assert.equal(hubRun.status, 'passed', hubRun.summary);
    assert.equal(hubRun.results.length, 1);
    assert.equal(hubRun.results[0].actualExitCode, 0);
    const hubOutput = hubRun.results[0].evidence.map(item => item.content).join('\n');
    assert.match(hubOutput, /test_old_database_migration_preserves_records.*ok/s);
    assert.match(hubOutput, /test_backup_verify_restore_and_tamper_rejection.*ok/s);
    const candidateResponse = await api('/api/project-scripts/candidates', { profileId: 'grammar-lab' });
    assert.equal(candidateResponse.response.status, 201);
    let candidate = candidateResponse.value;
    assert.equal(candidate.status, 'candidate');
    assert.equal(candidate.version, 1);
    assert.equal(candidate.origin, 'registered-profile-snapshot', 'candidate was imported from the local profile, not AI-generated');
    assert.equal(candidate.cases.length, 1);
    assert.deepEqual(candidate.files.map(file => file.path).sort(), ['package.json', 'tests/browser.cjs', 'tests/model.cjs']);
    assert.match(candidate.files.find(file => file.path === 'tests/browser.cjs').content, /playwright/);
    assert.ok(candidate.diff.some(line => line.includes('Captured test source tests/browser.cjs')));
    assert.equal((await api(`/api/project-scripts/${candidate.id}/run`, {})).response.status, 409, 'unapproved candidates cannot execute');
    assert.equal((await api('/api/project-scripts/candidates', { profileId: 'grammar-lab' })).response.status, 409, 'only one pending candidate per profile');
    const reviewed = await api(`/api/project-scripts/${candidate.id}/review`, { decision: 'approve', notes: 'Reviewed the existing model and browser suite.' });
    assert.equal(reviewed.response.status, 200);
    candidate = reviewed.value;
    assert.equal(candidate.status, 'approved');
    assert.match(candidate.digest, /^[a-f0-9]{64}$/);
    const approvedRunResponse = await api(`/api/project-scripts/${candidate.id}/run`, {});
    assert.equal(approvedRunResponse.response.status, 202);
    let approvedRun = approvedRunResponse.value;
    for (let i = 0; i < 500; i++) {
      const next = await api(`/api/project-runs/${approvedRun.id}`);
      approvedRun = next.value;
      if (!active.has(approvedRun.status)) break;
      await delay(50);
    }
    assert.equal(approvedRun.status, 'passed', approvedRun.summary);
    assert.equal(approvedRun.scriptId, candidate.id);
    assert.equal(approvedRun.scriptVersion, candidate.version);
    assert.equal(approvedRun.results[0].actualExitCode, 0, 'approved script runs deterministically without a model');
    const normalizedApprovedRun = await api(`/api/project-runs/${approvedRun.id}/report?format=json`);
    assert.deepEqual(normalizedApprovedRun.value.approvedScript, { id: candidate.id, version: candidate.version, digest: candidate.digest });
    await stop();
    await start();
    assert.ok((await api('/api/project-runs')).value.some(run => run.id === projectRun.id), 'profile run survives a server restart');
    assert.ok((await api('/api/project-runs')).value.some(run => run.id === pluralRun.id), 'second project profile run survives a server restart');
    assert.ok((await api('/api/project-runs')).value.some(run => run.id === bookRun.id), 'service-backed browser project run survives a server restart');
    assert.ok((await api('/api/project-runs')).value.some(run => run.id === wordRun.id), 'canvas browser project run survives a server restart');
    assert.ok((await api('/api/project-runs')).value.some(run => run.id === approvedRun.id), 'approved-script run survives a server restart');
    const scriptsAfterRestart = await api('/api/project-scripts');
    assert.equal(scriptsAfterRestart.value.find(script => script.id === candidate.id).status, 'approved');
    assert.equal(scriptsAfterRestart.value.find(script => script.id === candidate.id).reviewerNotes, 'Reviewed the existing model and browser suite.');
    assert.equal((await api('/api/project-scripts/ai-candidates', { profileId: 'grammar-lab', requirement: '验证数量边界应被限制。' })).response.status, 409, 'AI authoring requires configured model access');
    assert.equal((await api('/api/project-scripts/ai-candidates', { profileId: '../grammar-lab', requirement: '验证数量边界应被限制。' })).response.status, 404, 'AI authoring only accepts registered profile IDs');
    assert.equal((await api('/api/project-scripts/ai-candidates', { profileId: 'grammar-lab', requirement: 'short' })).response.status, 400, 'AI authoring validates requirement length');

    let authoringCalls = 0;
    const authoringFixture = createHttpServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw);
      assert.equal(req.url, '/v1/chat/completions');
      assert.ok(payload.tools.some(tool => tool.function.name === 'submit_playwright_candidate'));
      const rawPrompt = payload.messages.find(message => message.role === 'user')?.content ?? '';
      const prompt = typeof rawPrompt === 'string' ? rawPrompt : rawPrompt.map(part => part.text ?? '').join('');
      assert.match(prompt, /数量达到5个后/);
      const args = {
        title: '数量达到上限时禁用增加按钮',
        summary: '验证数量到达五个后无法继续增加，并检查句子同步为复数表达。',
        steps: [
          { action: 'click', selector: '[data-module="quantity"]' },
          { action: 'click', selector: '[data-delta="1"]' },
          { action: 'click', selector: '[data-delta="1"]' },
          { action: 'click', selector: '[data-delta="1"]' },
          { action: 'click', selector: '[data-delta="1"]' },
          { action: 'assertDisabled', selector: '[data-delta="1"]' },
          { action: 'assertText', selector: '#sentence', text: 'There are five apples on the tray.', match: 'exact' },
        ],
      };
      const id = 'grammar-authoring-fixture';
      const chunk = (delta, finish) => ({ id, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] });
      const call = authoringCalls++ === 0
        ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: 'submit_playwright_candidate', arguments: JSON.stringify(args) } }] }
        : { role: 'assistant', content: 'Candidate submitted for human review.' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify(chunk(call, null))}\n\ndata: ${JSON.stringify(chunk({}, authoringCalls === 1 ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`);
    });
    authoringFixture.listen(0, '127.0.0.1');
    await once(authoringFixture, 'listening');
    authoringEndpoint = `http://127.0.0.1:${authoringFixture.address().port}/v1`;
    await stop();
    await start();
    const aiCandidateResponse = await api('/api/project-scripts/ai-candidates', { profileId: 'grammar-lab', requirement: '数量达到5个后，加号按钮应禁用，句子应显示复数表达。' });
    assert.equal(aiCandidateResponse.response.status, 201, JSON.stringify(aiCandidateResponse.value));
    const aiCandidate = aiCandidateResponse.value;
    assert.equal(aiCandidate.origin, 'ai-requirement-candidate');
    assert.equal(aiCandidate.requirement, '数量达到5个后，加号按钮应禁用，句子应显示复数表达。');
    assert.ok(aiCandidate.files.some(file => file.path === 'tests/testpilot-generated.cjs'));
    assert.ok(aiCandidate.files.some(file => file.path === 'tests/testpilot-generated.json' && file.content.includes('数量达到上限')));
    assert.ok(aiCandidate.diff.some(line => line.includes('Changed test source package.json')));
    assert.equal((await api(`/api/project-scripts/${aiCandidate.id}/run`, {})).response.status, 409);
    assert.equal((await api(`/api/project-scripts/${aiCandidate.id}/review`, { decision: 'approve', notes: 'Reviewed requirement and bounded generated steps.' })).response.status, 200);
    await stop();
    authoringEndpoint = '';
    await start();
    assert.equal((await api('/api/config')).value.modelAvailable, false, 'approved run is retried without model configuration');
    const aiRunResponse = await api(`/api/project-scripts/${aiCandidate.id}/run`, {});
    assert.equal(aiRunResponse.response.status, 202);
    let aiRun = aiRunResponse.value;
    for (let i = 0; i < 700; i++) {
      aiRun = (await api(`/api/project-runs/${aiRun.id}`)).value;
      if (!active.has(aiRun.status)) break;
      await delay(50);
    }
    assert.equal(aiRun.status, 'passed', aiRun.summary);
    assert.ok(aiRun.results.some(result => result.caseId.includes('grammar-lab')));
    const aiRunOutput = aiRun.results.flatMap(result => result.evidence.filter(item => item.kind === 'stdout').map(item => item.content)).join('\n');
    assert.match(aiRunOutput, /数量达到上限时禁用增加按钮/);
    assert.match(aiRunOutput, /"steps":7/);
    const aiNormalized = (await api(`/api/project-runs/${aiRun.id}/report?format=json`)).value;
    assert.deepEqual(aiNormalized.approvedScript, { id: aiCandidate.id, version: aiCandidate.version, digest: aiCandidate.digest });
    authoringFixture.closeAllConnections();
    await new Promise(done => authoringFixture.close(done));
  });
});

test('model transport fixture verifies dynamic plans, completeness and cancellation without paid inference', { timeout: 30000 }, async t => {
  const savedEnv = Object.fromEntries(['TESTPILOT_DATA_DIR', 'TESTPILOT_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL'].map(key => [key, process.env[key]]));
  // model-settings resolves its data directory at module load. Use a new, empty
  // directory before importing runtime so a developer's saved API key/base URL
  // cannot bypass this local protocol fixture or incur external inference.
  process.env.TESTPILOT_DATA_DIR = resolve(root, 'artifacts', 'integration-model-fixture', String(Date.now()));
  const { executeDemo } = await import('../dist/demo/runtime.js');
  const { handleSample, defaultRequirements } = await import('../dist/demo/sample.js');
  let phase = 0;
  let scenario = 'complete';
  let checks = [];
  let transportError;
  let onStalledRequest;
  const candidate = { id: 'candidate-full-discount', title: '100% 折扣总额为零', method: 'POST', path: '/sample/orders', body: { items: [{ productId: 'sku-1', quantity: 1 }], discountPercent: 100 }, expect: { status: 201, json: { total: 0 } } };
  const sample = createHttpServer((req, res) => { void handleSample(req, res, true); });
  const model = createHttpServer((req, res) => {
    void (async () => {
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        assert.equal(req.url, '/v1/chat/completions');
        const payload = JSON.parse(raw);
        if (scenario === 'stall') { onStalledRequest?.(); return; }
        let tool;
        if (phase === 0) {
          const task = payload.messages.find(m => m.role === 'user');
          const text = typeof task.content === 'string' ? task.content : task.content.map(x => x.text ?? '').join('');
          const match = text.match(/source labels: (\[[\s\S]*\])\. For each call/);
          assert.ok(match, 'runtime prompt provides the immutable assigned checks');
          checks = [...JSON.parse(match[1]), candidate];
          tool = { name: 'request_sample', arguments: { checkId: '__contract__' } };
        } else if (phase === 1) tool = { name: 'register_checks', arguments: { checks: [candidate] } };
        else if (phase === 2) tool = { name: 'record_plan', arguments: { checkIds: checks.map(c => c.id), steps: ['验证固定业务规则与额外需求'] } };
        else {
          const runnable = scenario === 'omit-candidate' ? checks.slice(0, -1) : checks;
          const index = Math.floor((phase - 3) / 2);
          if (index < runnable.length) {
            const check = runnable[index];
            if ((phase - 3) % 2 === 0) tool = { name: 'request_sample', arguments: { checkId: check.id } };
            else {
              const lastTool = payload.messages.filter(m => m.role === 'tool').at(-1);
              const text = typeof lastTool.content === 'string' ? lastTool.content : lastTool.content.map(x => x.text ?? '').join('');
              tool = { name: 'assert_response', arguments: { checkId: check.id, evidenceId: JSON.parse(text).evidenceId } };
            }
          }
        }
        const id = `fixture-${phase++}`;
        const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: 'assistant', content: 'Protocol fixture finished; runtime must decide verdict.' };
        const chunk = (value, finish) => ({ id, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, tool ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`);
      } catch (error) { transportError = error; res.writeHead(500); res.end(String(error)); }
    })();
  });
  for (const server of [sample, model]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  process.env.TESTPILOT_API_KEY = 'local-protocol-fixture-token';
  process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;
  process.env.TESTPILOT_MODEL = 'fixture';
  t.after(async () => {
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const server of [sample, model]) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  });
  function context(signal) {
    const run = { id: 'fixture', mode: 'requirements', provider: 'model', status: 'queued', startedAt: new Date().toISOString(), durationMs: 0, maxActions: 24, actionCount: 0, plan: [], events: [], evidence: [], assertions: [], coverage: { visited: [], available: [], untested: [] }, limitations: [], summary: '', fixedTarget: true };
    return { run, signal, baseUrl: `http://127.0.0.1:${sample.address().port}`, emit: (kind, title, detail) => run.events.push({ id: String(run.events.length), at: new Date().toISOString(), kind, title, detail }) };
  }
  const request = { mode: 'requirements', provider: 'model', requirements: `${defaultRequirements} 额外验证100%折扣订单总额必须为零。`, maxActions: 24, target: 'sample' };
  await t.test('a generated candidate executes through the actual Pi Chat Completions adapter', async () => {
    phase = 0; scenario = 'complete';
    const ctx = context(new AbortController().signal);
    await executeDemo(ctx, request);
    assert.equal(transportError, undefined);
    assert.equal(ctx.run.status, 'passed', JSON.stringify({ summary: ctx.run.summary, error: ctx.run.error, limitations: ctx.run.limitations }));
    assert.equal(ctx.run.assertions.length, checks.length);
    assert.match(ctx.run.assertions.find(a => a.id === candidate.id).source, /model-proposed/);
  });
  await t.test('a candidate registered in the plan but not executed keeps the run incomplete', async () => {
    phase = 0; scenario = 'omit-candidate';
    const ctx = context(new AbortController().signal);
    await executeDemo(ctx, request);
    assert.equal(ctx.run.status, 'blocked');
    assert.equal(ctx.run.assertions.length, checks.length - 1);
  });
  await t.test('cancel stops an in-flight model request and a previously cancelled request performs no HTTP action', async () => {
    scenario = 'stall';
    const controller = new AbortController();
    const ctx = context(controller.signal);
    const received = new Promise(done => { onStalledRequest = done; });
    const running = executeDemo(ctx, request);
    await received;
    controller.abort(new Error('cancelled'));
    await running;
    assert.equal(ctx.run.status, 'cancelled');
    assert.equal(ctx.run.actionCount, 0);
    const preCancelled = context(controller.signal);
    await executeDemo(preCancelled, request);
    assert.equal(preCancelled.run.status, 'cancelled');
    assert.equal(preCancelled.run.evidence.length, 0);
  });
});
