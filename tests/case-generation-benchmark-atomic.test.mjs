import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTestCaseDrafts } from '../dist/adapters/case-generation-agent.js';
import { createExecutionDraftFromCaseGeneration } from '../dist/adapters/case-generation-handoff.js';

test('malformed semantic review cannot duplicate benchmark rows or block a valid generation handoff', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-benchmark-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-benchmark-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-benchmark-atomic-fixture';
  const generationBaselineMarker = 'BASELINE_MUST_ONLY_REACH_POST_GENERATION_REVIEW_8062';
  const requests = [];

  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    let content;
    if (system.includes('测试用例生成 Agent')) {
      content = JSON.stringify({
        requirements: [{ id: 'R1', text: '首页展示测试标题 Ready', source: '需求 §1', priority: 'P1', confidence: 'high', scopeStatus: 'in-scope', scopeRationale: '需求明确' }],
        cases: [{ title: '首页展示 Ready 标题', requirementIds: ['R1'], sourceRefs: ['需求 §1'], scenarioType: 'positive', priority: 'P1', preconditions: [], testData: [], actions: ['打开首页', '核对标题文字'], expectedResult: '首页精确显示标题“Ready”。', confidence: 'high', clarificationNeeded: [] }],
      });
    } else if (system.includes('独立测试设计审查员')) {
      const user = payload.messages.find(message => message.role === 'user')?.content ?? '';
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId, 'comparison input should contain the generated AI case id');
      content = JSON.stringify({
        items: [
          { aiCaseId, relation: 'overlap', referenceCaseIds: ['EXISTING-001'], rationale: '一部分步骤相同。' },
          { aiCaseId, relation: 'novel', referenceCaseIds: [], rationale: '返回第二个冲突判断。' },
        ],
        // Reproduces the production failure: comparison rows are valid, but
        // semantic review violates the prompt's maximum of two issues.
        caseReviews: [{ aiCaseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: ['问题一', '问题二', '问题三'] }],
      });
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const generation = await generateTestCaseDrafts({
      requirementsText: '需求资料：网站首页展示标题 Ready。',
      existingCases: [{ title: generationBaselineMarker, source: '留出基准', expected: '标题不同' }],
      maxCases: 1,
    });
    const aiCases = generation.cases.filter(item => item.origin === 'ai-draft');
    const benchmark = generation.quality.benchmarkComparison;
    assert.equal(aiCases.length, 1);
    assert.equal(benchmark.items.length, 1, 'each AI case must have exactly one canonical comparison row');
    assert.equal(benchmark.evaluatedCases, 1);
    assert.equal(new Set(benchmark.items.map(item => item.aiCaseId)).size, 1);
    assert.equal(benchmark.items[0].aiCaseId, aiCases[0].id);
    assert.equal(benchmark.items[0].relation, 'uncertain', 'conflicting relation duplicates must fail closed');
    assert.equal(generation.quality.semanticReview.assessedCases, 0, 'invalid quality feedback is omitted independently');
    assert.ok(generation.warnings.some(item => /语义质量审查批次/u.test(item)));

    const generationPrompt = JSON.stringify(requests[0].messages);
    const comparisonPrompt = JSON.stringify(requests[1].messages);
    assert.equal(generationPrompt.includes(generationBaselineMarker), false, 'held-out benchmark must not leak to generation');
    assert.equal(comparisonPrompt.includes(generationBaselineMarker), true, 'held-out benchmark is used only after generation');

    const project = createExecutionDraftFromCaseGeneration({ targetUrl: 'https://example.test/', generation });
    assert.equal(project.cases.length, 1, 'strict handoff should accept canonical benchmark output');
    assert.equal(project.cases[0].caseGenerationTrace.sourceCaseId, aiCases[0].id);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('missing requirement scope is kept uncertain instead of silently included in the current release', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-scope-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-scope-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-scope-fixture';
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({
    requirements: [{ id: 'R1', text: '订单列表展示订单编号', source: '需求 §1' }],
    cases: [],
  }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await generateTestCaseDrafts({ requirementsText: '需求资料：订单列表展示订单编号。', maxCases: 1 });
    assert.equal(result.requirements[0].scopeStatus, 'uncertain');
    assert.equal(result.coverageMatrix[0].coverageStatus, 'uncertain');
    assert.equal(result.quality.scopeSummary.inScope, 0);
    assert.equal(result.quality.scopeSummary.uncertain, 1);
    assert.ok(result.warnings.some(item => /范围待确认/u.test(item)));
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('over-broad requirement links are rejected with the offending case and field identified', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-generation-schema-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-generation-schema-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-schema-fixture';
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    assert.match(system, /requirementIds[^.]{0,120}最多 5 个/u, 'generation prompt must discourage broad requirement links');
    const requirements = Array.from({ length: 6 }, (_, index) => ({ id: `R${index + 1}`, text: `行为 ${index + 1}`, source: '需求 §1', scopeStatus: 'in-scope' }));
    const content = JSON.stringify({
      requirements,
      cases: [{ title: '宽泛用例', requirementIds: requirements.map(item => item.id), sourceRefs: ['需求 §1'], actions: ['打开页面'], expectedResult: '页面展示预期内容。' }],
    });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await assert.rejects(
      generateTestCaseDrafts({ requirementsText: '测试需求', maxCases: 1 }),
      /第 1 条用例「宽泛用例」）的 requirementIds 无效：收到 6 项，最多 5 项/u,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('missing quality review rows are retried without sending held-out references', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-generation-review-retry-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-generation-review-retry-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-review-retry-fixture';
  const baselineMarker = 'REVIEW_RETRY_BASELINE_MUST_NOT_LEAK_41';
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    const user = payload.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
    let content;
    if (system.includes('测试用例生成 Agent')) {
      content = JSON.stringify({
        requirements: [{ id: 'R1', text: '首页显示 Ready', source: '需求 §1', scopeStatus: 'in-scope' }],
        cases: [{ title: '首页显示 Ready', requirementIds: ['R1'], sourceRefs: ['需求 §1'], scenarioType: 'positive', actions: ['打开首页', '核对标题'], expectedResult: '首页显示 Ready。' }],
      });
    } else if (system.includes('独立测试设计审查员')) {
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId);
      content = JSON.stringify({ items: [{ aiCaseId, relation: 'novel', referenceCaseIds: [], rationale: '本分片未发现相似项。' }], caseReviews: [] });
    } else if (system.includes('独立测试用例质量审查员')) {
      assert.equal(user.includes(baselineMarker), false, 'the dedicated quality retry must not receive held-out cases');
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId);
      content = JSON.stringify({ caseReviews: [{ aiCaseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 1 }, issues: ['测试数据需要在执行前确认'] }] });
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateTestCaseDrafts({
      requirementsText: '需求资料：首页显示 Ready。',
      existingCases: [{ title: baselineMarker, source: '留出基准', expected: '基准预期' }],
      maxCases: 1,
    });
    assert.equal(result.quality.semanticReview.assessedCases, 1);
    assert.equal(result.quality.semanticReview.cases[0].dimensions.fixtureReadiness, 1);
    assert.equal(result.warnings.some(item => /语义质量审查批次补齐后仍有/u.test(item)), false);
    const retry = requests.find(payload => payload.messages.some(message => message.role === 'system' && message.content.includes('独立测试用例质量审查员')));
    assert.ok(retry, 'the missing quality row should receive a dedicated retry');
    assert.equal(JSON.stringify(retry.messages).includes(baselineMarker), false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('four valid same-chunk reference matches do not invalidate the whole benchmark batch', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-generation-reference-cap-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-generation-reference-cap-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-reference-cap-fixture';
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    const user = payload.messages.find(message => message.role === 'user')?.content ?? '';
    let content;
    if (system.includes('测试用例生成 Agent')) {
      content = JSON.stringify({
        requirements: [{ id: 'R1', text: '首页显示 Ready', source: '需求 §1', scopeStatus: 'in-scope' }],
        cases: [{ title: '首页显示 Ready', requirementIds: ['R1'], sourceRefs: ['需求 §1'], scenarioType: 'positive', actions: ['打开首页'], expectedResult: '首页显示 Ready。' }],
      });
    } else if (system.includes('独立测试设计审查员')) {
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId);
      const referenceIds = [...new Set([...user.matchAll(/"id":"(EXISTING-\d{3})"/g)].map(match => match[1]))];
      assert.equal(referenceIds.length, 4);
      content = JSON.stringify({
        items: [{ aiCaseId, relation: 'overlap', referenceCaseIds: referenceIds, rationale: '本分片找到多个真实相关场景。' }],
        caseReviews: [{ aiCaseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: [] }],
      });
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateTestCaseDrafts({
      requirementsText: '需求资料：首页显示 Ready。',
      existingCases: Array.from({ length: 4 }, (_, index) => ({ title: `基准场景 ${index + 1}`, source: `来源 ${index + 1}`, expected: `预期 ${index + 1}` })),
      maxCases: 1,
    });
    assert.equal(result.quality.benchmarkComparison.evaluatedCases, 1);
    assert.equal(result.quality.benchmarkComparison.items[0].relation, 'overlap');
    assert.deepEqual(result.quality.benchmarkComparison.items[0].referenceCaseIds, ['EXISTING-001', 'EXISTING-002', 'EXISTING-003']);
    assert.equal(result.warnings.some(item => /基准比较批次/u.test(item)), false);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('a valid JSON response with the wrong top-level shape receives one original-input regeneration', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-generation-shape-recovery-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-generation-shape-recovery-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-shape-recovery-fixture';
  const requests = [];
  let generationCount = 0;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    const user = payload.messages.filter(message => message.role === 'user').at(-1)?.content ?? '';
    let content;
    if (system.includes('测试用例生成 Agent')) {
      generationCount += 1;
      if (generationCount === 1) content = JSON.stringify({ summary: '没有返回规定数组' });
      else {
        assert.match(user, /重新生成完整结果/u, 'the retry must explicitly recover the original requested schema');
        content = JSON.stringify({
          requirements: [{ id: 'R1', text: '首页显示 Ready', source: '需求 §1', scopeStatus: 'in-scope' }],
          cases: [{ title: '首页显示 Ready', requirementIds: ['R1'], sourceRefs: ['需求 §1'], scenarioType: 'positive', actions: ['打开首页'], expectedResult: '首页显示 Ready。' }],
        });
      }
    } else if (system.includes('独立测试设计审查员')) {
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId);
      content = JSON.stringify({ items: [{ aiCaseId, relation: 'novel', referenceCaseIds: [], rationale: '基准为空。' }], caseReviews: [{ aiCaseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: [] }] });
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateTestCaseDrafts({ requirementsText: '需求资料：首页显示 Ready。', maxCases: 1 });
    assert.equal(result.cases.filter(item => item.origin === 'ai-draft').length, 1);
    assert.ok(result.warnings.some(item => /首轮输出格式或结构无效/u.test(item)));
    assert.equal(generationCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('benchmark comparison visits every reference in chunks without truncating the 156-case tail', async () => {
  const envKeys = ['TESTPILOT_API_KEY', 'OPENAI_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'TESTPILOT_DATA_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.TESTPILOT_API_KEY = 'local-benchmark-batching-fixture-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = 'http://127.0.0.1:1/v1';
  process.env.TESTPILOT_MODEL = 'local-benchmark-batching-fixture';
  process.env.TESTPILOT_DATA_DIR = 'artifacts/case-generation-benchmark-batching-fixture';
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    const system = payload.messages.find(message => message.role === 'system')?.content ?? '';
    let content;
    if (system.includes('测试用例生成 Agent')) {
      content = JSON.stringify({
        requirements: [{ id: 'R1', text: '首页显示待验收标题 Ready', source: '需求 §1', priority: 'P1', confidence: 'high', scopeStatus: 'in-scope', scopeRationale: '本期需求' }],
        cases: [{ title: '首页显示 Ready', requirementIds: ['R1'], sourceRefs: ['需求 §1'], scenarioType: 'positive', priority: 'P1', preconditions: [], testData: [], actions: ['打开首页'], expectedResult: '首页显示 Ready 标题', confidence: 'high', clarificationNeeded: [] }],
      });
    } else if (system.includes('独立测试设计审查员')) {
      const user = payload.messages.find(message => message.role === 'user')?.content ?? '';
      const aiCaseId = user.match(/"id":"([0-9a-f-]{36})"/i)?.[1];
      assert.ok(aiCaseId, 'the comparison prompt should include the AI case');
      content = JSON.stringify({
        items: [{ aiCaseId, relation: 'novel', referenceCaseIds: [], rationale: '当前分片未发现相似用例。' }],
        caseReviews: [{ aiCaseId, dimensions: { actionability: 2, observability: 2, grounding: 2, atomicity: 2, fixtureReadiness: 2 }, issues: [] }],
      });
    } else {
      throw new Error(`Unexpected model request: ${system.slice(0, 100)}`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const existingCases = Array.from({ length: 156 }, (_, index) => ({
      title: `REFERENCE_TITLE_${String(index + 1).padStart(3, '0')}_${'T'.repeat(70)}`,
      source: `REFERENCE_SOURCE_${String(index + 1).padStart(3, '0')}_${'S'.repeat(120)}`,
      expected: `REFERENCE_EXPECTED_${String(index + 1).padStart(3, '0')}_${'E'.repeat(240)}`,
    }));
    const result = await generateTestCaseDrafts({
      requirementsText: '需求资料：网站首页显示待验收标题 Ready。',
      existingCases,
      maxCases: 1,
    });
    const generationRequest = requests.find(payload => payload.messages.some(message => message.role === 'system' && message.content.includes('测试用例生成 Agent')));
    assert.ok(generationRequest);
    assert.equal(JSON.stringify(generationRequest.messages).includes('REFERENCE_TITLE_'), false, 'held-out references must remain excluded from generation');
    const comparisonRequests = requests.filter(payload => payload.messages.some(message => message.role === 'system' && message.content.includes('独立测试设计审查员')));
    assert.ok(comparisonRequests.length > 1, 'the 156 reference cases should be split across multiple comparison requests');
    assert.ok(comparisonRequests.length <= 4, 'bounded larger chunks should avoid dozens of serial model calls');
    const referencedIds = new Set(comparisonRequests.flatMap(payload => {
      const user = payload.messages.find(message => message.role === 'user')?.content ?? '';
      return [...user.matchAll(/"id":"(EXISTING-\d{3})"/g)].map(match => match[1]);
    }));
    assert.equal(referencedIds.size, 156, 'every held-out benchmark ID, including the final ID, must reach the comparison model');
    assert.ok(referencedIds.has('EXISTING-001'));
    assert.ok(referencedIds.has('EXISTING-156'));
    assert.equal(result.quality.benchmarkComparison.referenceCount, 156);
    assert.equal(result.quality.benchmarkComparison.items[0].relation, 'novel');
    assert.match(result.quality.benchmarkComparison.items[0].rationale, /全部 156 条/u);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
