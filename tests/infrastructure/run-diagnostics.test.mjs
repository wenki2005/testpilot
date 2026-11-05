import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('model diagnostics distinguish waiting for output, streamed output and an in-flight sample request', { timeout: 40_000 }, async t => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'testpilot-diagnostics-'));
  const original = { ...process.env };
  process.env.TESTPILOT_DATA_DIR = testRoot;
  process.env.TESTPILOT_ARTIFACTS_DIR = testRoot;
  process.env.TESTPILOT_API_KEY = 'local-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_MODEL = 'local-fixture-model';
  t.after(async () => {
    for (const key of ['TESTPILOT_DATA_DIR', 'TESTPILOT_ARTIFACTS_DIR', 'TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_MODEL', 'TESTPILOT_BASE_URL']) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
    const resolved = await realpath(testRoot);
    const temporary = await realpath(os.tmpdir());
    assert.ok(resolved.startsWith(temporary + path.sep));
    await rm(resolved, { recursive: true, force: true });
  });
  const { executeDemo } = await import('../../dist/server/runtime.js');
  const { defaultRequirements } = await import('../../dist/server/local-sample.js');
  const { demoRunTimeoutMs } = await import('../../dist/server/run-diagnostics.js');
  const request = { mode: 'autonomous', provider: 'model', requirements: defaultRequirements, maxActions: 8, target: 'sample' };
  assert.equal(demoRunTimeoutMs(request), 90_000);
  assert.equal(demoRunTimeoutMs({ ...request, mode: 'deterministic' }), 60_000);

  for (const scenario of ['awaiting-output', 'streamed-output', 'http-request', 'cancelled']) {
    await t.test(scenario, { timeout: 9_000 }, async st => {
      const controller = new AbortController();
      let sampleRequests = 0;
      let modelRequests = 0;
      const abort = () => controller.abort(new Error(scenario === 'cancelled' ? 'cancelled' : 'fixture deadline reached'));
      const model = createServer((req, res) => {
        req.resume();
        modelRequests++;
        if (scenario === 'awaiting-output' || scenario === 'cancelled') { setTimeout(abort, 30); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'local-fixture-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (scenario === 'streamed-output') {
          send({ role: 'assistant', content: 'Reading the contract.' });
          setTimeout(abort, 150);
        } else {
          send({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'request_sample', arguments: '{"checkId":"__contract__"}' } }] });
          send({}, 'tool_calls');
          res.end('data: [DONE]\n\n');
        }
      });
      const sample = createServer((req, _res) => {
        sampleRequests++;
        assert.equal(req.url, '/sample/openapi.json');
        setTimeout(abort, 30);
      });
      for (const server of [model, sample]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      st.after(async () => {
        if (!controller.signal.aborted) controller.abort(new Error('cancelled'));
        await Promise.all([model, sample].map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
      });
      process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;
      const run = {
        id: scenario, mode: request.mode, provider: 'model', status: 'queued', startedAt: new Date().toISOString(), durationMs: 0,
        maxActions: 8, actionCount: 0, plan: [], events: [], evidence: [], assertions: [],
        coverage: { visited: [], available: [], untested: [] }, limitations: [], summary: '', fixedTarget: false,
      };
      const watchdog = setTimeout(() => controller.abort(new Error('fixture safety deadline')), 6_000);
      try {
        await executeDemo({ run, signal: controller.signal, baseUrl: `http://127.0.0.1:${sample.address().port}`, emit(kind, title, detail) {
          run.events.push({ id: String(run.events.length), at: new Date().toISOString(), kind, title, detail });
        } }, request);
      } finally { clearTimeout(watchdog); }
      assert.equal(modelRequests, 1, 'only the local model fixture is contacted');
      assert.equal(run.assertions.length, 0);
      assert.equal(run.diagnostics.modelRequests, 1);
      if (scenario === 'cancelled') {
        assert.equal(run.status, 'cancelled');
        assert.doesNotMatch(run.summary, /时间上限/);
      } else {
        assert.equal(run.status, 'blocked');
        assert.equal(run.events.filter(event => event.title === '运行超时诊断').length, 1);
        assert.match(run.summary, /未执行部分未判为通过/);
      }
      if (scenario === 'awaiting-output') {
        assert.equal(run.diagnostics.phase, 'model-request');
        assert.equal(run.diagnostics.modelResponses, 0);
        assert.match(run.summary, /等待第 1 次模型调用/);
      }
      if (scenario === 'streamed-output') {
        assert.equal(run.diagnostics.phase, 'model-response');
        assert.equal(run.diagnostics.modelResponses, 1);
        assert.match(run.summary, /已收到模型输出/);
      }
      if (scenario === 'http-request') {
        assert.equal(sampleRequests, 1);
        assert.equal(run.actionCount, 1);
        assert.equal(run.diagnostics.phase, 'http-request');
        assert.match(run.summary, /HTTP 请求已开始/);
      } else assert.equal(sampleRequests, 0, 'no sample request was sent');
      assert.ok(run.events.some(event => event.title === '模型调用开始'));
      assert.ok(!JSON.stringify(run.diagnostics).includes('local-fixture-key'));
    });
  }
});
