import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

test('XMind and legacy document cases receive stable, reviewable metadata', async t => {
  const previousEnv = Object.fromEntries(['TESTPILOT_DATA_DIR', 'TESTPILOT_API_KEY', 'TESTPILOT_BASE_URL', 'TESTPILOT_MODEL', 'OPENAI_API_KEY'].map(key => [key, process.env[key]]));
  const dataDir = resolve(import.meta.dirname, '..', 'artifacts', 'document-metadata-fixture', String(Date.now()));
  process.env.TESTPILOT_DATA_DIR = dataDir;
  t.after(() => { for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { extractDocument } = await import('../dist/adapters/document-importer.js');
  const { loadDocumentProjects, makeDocumentProject, createReviewCases, validateCases, getDocumentCaseVersion, getDocumentRun, executeDocumentRun, hasAutoRunnableSelectedCase, canAuthorReadOnlyBrowserSteps, browserStepDraftBlockReason, isSafeReadOnlyBrowserCase, hasOnlyGenericShellAssertions, addNoApiNetworkAssertion, draftGroundedReadOnlyBrowserSteps, deriveGroundedEmptyListNavigationSubcheck, deriveGroundedCustomerLookupSubcheck } = await import('../dist/adapters/document-test-workflow.js');
  const { missingDirectAssertion } = await import('../dist/adapters/document-case-quality.js');

  await t.test('generic Markdown extraction ignores front matter, code samples, and documentation-only sections', () => {
    const text = `---\ntitle: Same Moment\ntags:\n  - scroll\nstatus: verified\n---\n# Same Moment\n\n## Experience\n- The opening view starts the scroll story without a start button.\n- Scrolling moves through Shanghai, London, New York and Sydney.\n\n## Run\n\n\`\`\`powershell\npython -m http.server 4173\n\`\`\`\n\n## Structure\n- index.html contains the page structure and city sections.`;
    const cases = createReviewCases(text);
    assert.deepEqual(cases.map(item => item.title), [
      'The opening view starts the scroll story without a start button.',
      'Scrolling moves through Shanghai, London, New York and Sydney.',
    ]);
    assert.ok(cases.every(item => item.expected === '[请在审核前补充页面可见预期]'));
  });

  await t.test('case lifecycle status persists drafts and disabled cases outside regression selection', async () => {
    const base = { title: '可判定用例', source: '需求第 1 条', kind: 'visible', expected: '页面显示成功状态', steps: [] };
    const cases = validateCases([
      { ...base, id: 'draft-case', lifecycleStatus: 'draft' },
      { ...base, id: 'runnable-case', lifecycleStatus: 'runnable' },
      { ...base, id: 'disabled-case', lifecycleStatus: 'disabled' },
    ]);
    assert.deepEqual(cases.map(item => item.lifecycleStatus), ['draft', 'runnable', 'disabled']);
    assert.deepEqual(cases.map(item => item.selectedForRegression), [false, true, false]);
    assert.throws(() => validateCases([{ ...base, id: 'bad-status', lifecycleStatus: 'paused' }]), /lifecycleStatus 必须是 draft、runnable 或 disabled/u);
    assert.throws(() => validateCases([{ ...base, id: 'draft-selected', lifecycleStatus: 'draft', selectedForRegression: true }]), /草稿或停用状态/u);
    const project = { id: 'lifecycle-gate', targetUrl: 'http://127.0.0.1:1/', reviewStatus: 'approved', cases };
    await assert.rejects(() => executeDocumentRun(project, { runMode: 'regression', selectedCaseIds: ['draft-case'] }), /草稿或停用用例不能运行/u);
    await assert.rejects(() => executeDocumentRun(project, { runMode: 'regression', selectedCaseIds: ['disabled-case'] }), /草稿或停用用例不能运行/u);
  });

  await t.test('Markdown importer removes YAML metadata before sending content to case generation', async () => {
    const markdown = `---\ntitle: Same Moment\ntags:\n  - timezones\nstatus: verified\n---\n# Same Moment\n\n## Experience\n- The story scrolls across four cities.`;
    const imported = await extractDocument('README.md', Buffer.from(markdown));
    assert.equal(imported.format, 'markdown');
    assert.doesNotMatch(imported.text, /timezones|status: verified|title: Same Moment/);
    assert.match(imported.text, /The story scrolls across four cities/);
  });

  await t.test('both mode does not preserve heuristic Markdown bullets as user-authored test cases', () => {
    const document = { format: 'markdown', text: '# Requirements\n\n## Experience\n- The opening view starts the scroll story without a start button.\n' };
    const both = makeDocumentProject({ name: 'Markdown requirements', fileName: 'README.md', document, targetUrl: 'http://127.0.0.1:4173/', caseMode: 'both' });
    const existing = makeDocumentProject({ name: 'Markdown requirements', fileName: 'README.md', document, targetUrl: 'http://127.0.0.1:4173/', caseMode: 'existing' });
    assert.equal(both.cases.length, 0, 'AI should synthesize measurable checks instead of retaining unreviewed placeholders');
    assert.equal(existing.cases.length, 1, 'existing-only mode may still show conservative review candidates');
    assert.deepEqual([existing.cases[0].lifecycleStatus, existing.cases[0].selectedForRegression], ['draft', false], 'unverified source bullets remain draft and outside any run');
  });

  await t.test('XMind hierarchy assigns source-based category and marks ambiguous expectations low confidence', async () => {
    const bytes = zipSync({ 'content.json': strToU8(JSON.stringify([{
      title: '部门申样书',
      rootTopic: { title: '申请流程', children: { attached: [
        { title: '权限控制', children: { attached: [{ title: '无权限用户不能导出 P1' }] } },
        { title: '登录', children: { attached: [{ title: '待澄清扫码失败时提示什么' }] } },
      ] } },
    }])) });
    const imported = await extractDocument('requirements.xmind', bytes);
    assert.equal(imported.testCases.length, 2);
    assert.deepEqual(imported.testCases[0].modulePath, ['申请流程', '权限控制']);
    assert.deepEqual(imported.testCases[1].modulePath, ['申请流程', '登录']);
    const project = makeDocumentProject({ name: 'XMind fixture', fileName: 'requirements.xmind', document: imported, targetUrl: 'http://127.0.0.1:4321', caseMode: 'existing' });
    assert.deepEqual(project.cases[0].modulePath, ['申请流程', '权限控制']);
    assert.deepEqual(project.cases[1].modulePath, ['申请流程', '登录']);
    assert.equal(project.cases[0].priority, 'P1');
    assert.equal(project.cases[0].category, 'authorization');
    assert.equal(project.cases[0].confidence, 'medium');
    assert.ok(project.cases[0].coverageAreas.includes('authorization'));
    assert.equal(project.cases[1].category, 'authentication');
    assert.equal(project.cases[1].confidence, 'low');
    assert.match(project.cases[1].expected, /^\[需澄清\]/);
    assert.ok(project.cases.every(item => item.lifecycleStatus === 'draft' && item.selectedForRegression === false), 'imported XMind cases need reviewed steps before they can enter a run');
  });

  await t.test('legacy projects are normalized in memory without changing their IDs', async () => {
    const legacyDir = resolve(dataDir, 'document-tests', 'projects');
    await mkdir(legacyDir, { recursive: true });
    const legacy = {
      id: 'legacy-project', name: 'Legacy project', fileName: 'old.md', format: 'markdown', targetUrl: 'http://127.0.0.1:4321', sourceText: 'old',
      cases: [{ id: 'old-stable-case-id', title: '权限控制阻止未授权导出', source: 'old.md › 权限', kind: 'visible', expected: '拒绝访问', steps: [], sideEffectRisk: 'unknown' }],
      reviewStatus: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await writeFile(resolve(legacyDir, 'legacy-project.json'), JSON.stringify(legacy));
    const projects = await loadDocumentProjects();
    const loaded = projects.find(item => item.id === legacy.id);
    assert.ok(loaded);
    assert.equal(loaded.cases[0].id, 'old-stable-case-id');
    assert.equal(loaded.cases[0].category, 'authorization');
    assert.equal(loaded.cases[0].confidence, 'medium');
    assert.deepEqual(loaded.cases[0].coverageAreas, ['authorization']);
    const disk = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(legacyDir, 'legacy-project.json'), 'utf8'));
    assert.equal(disk.cases[0].category, undefined, 'read migration should not silently rewrite saved project files');
  });

  await t.test('legacy run records report unknown scope instead of implying full coverage', async () => {
    const runDir = resolve(dataDir, 'document-tests', 'runs', 'legacy-run');
    await mkdir(runDir, { recursive: true });
    await writeFile(resolve(runDir, 'run.json'), JSON.stringify({
      id: 'legacy-run', projectId: 'legacy-project', startedAt: '2025-01-01T00:00:00.000Z', completedAt: '2025-01-01T00:01:00.000Z',
      overall: 'passed', finalReady: true, report: '# Historical report', comparisons: [{ id: 'retained-case', title: 'One retained result', deterministic: 'passed', computerUse: 'passed', aligned: true, issue: '' }],
    }));
    const run = await getDocumentRun('legacy-run');
    assert.ok(run);
    assert.equal(run.caseScopeKnown, false);
    assert.deepEqual(run.caseScope.selectedCaseIds, ['retained-case']);
    assert.equal(run.caseScope.totalCases, 1);
    assert.equal(run.reportReady, true);
    assert.equal(run.packageReady, false);
  });

  await t.test('validation rejects invalid categories, confidence and coverage tags', () => {
    const base = { title: 'Case', source: 'spec.md:1', kind: 'visible', expected: 'Ready', steps: [] };
    const legacyNormalized = validateCases([base])[0];
    assert.equal(legacyNormalized.category, 'functional');
    assert.equal(legacyNormalized.confidence, 'medium');
    assert.deepEqual(legacyNormalized.coverageAreas, ['functional']);
    assert.equal(validateCases([{ ...base, id: 'source-case-17' }])[0].id, 'source-case-17', 'validation must preserve a supplied stable case ID');
    assert.throws(() => validateCases([{ ...base, id: 'duplicate-id' }, { ...base, id: 'duplicate-id' }]), /ID「duplicate-id」重复/);
    assert.throws(() => validateCases([{ ...base, id: 'invalid id with spaces' }]), /ID 无效/);
    assert.throws(() => validateCases([{ ...base, category: 'imaginary' }]), /category 无效/);
    assert.throws(() => validateCases([{ ...base, confidence: 'certain' }]), /confidence 必须/);
    assert.throws(() => validateCases([{ ...base, coverageAreas: ['imaginary'] }]), /coverageAreas 包含未知分类/);
    assert.throws(() => validateCases([{ ...base, modulePath: ['申请', ''] }]), /modulePath 必须/u);
    assert.deepEqual(validateCases([{ ...base, modulePath: ['申请流程', '权限控制'] }])[0].modulePath, ['申请流程', '权限控制']);
    const taggedCases = validateCases([{ ...base, id: 'tagged-case', tags: [' smoke ', '核心链路', 'smoke'] }]);
    assert.deepEqual(taggedCases[0].tags, ['smoke', '核心链路'], 'tags are trimmed and deduplicated');
    assert.throws(() => validateCases([{ ...base, tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) }]), /最多 20 项/u);
    assert.throws(() => validateCases([{ ...base, tags: ['x'.repeat(41)] }]), /每项 1–40 字/u);
    assert.notEqual(
      getDocumentCaseVersion({ id: 'tags-project', cases: validateCases([{ ...base, id: 'versioned-case' }]) }),
      getDocumentCaseVersion({ id: 'tags-project', cases: validateCases([{ ...base, id: 'versioned-case', tags: ['smoke'] }]) }),
      'changing tags creates a new case asset version',
    );
    assert.deepEqual(validateCases([{ ...base, steps: [
      { action: 'assertRoleVisible', role: 'button', name: '申请记录' },
      { action: 'assertExactVisible', text: '精确文案' },
      { action: 'assertNotVisible', text: '出版社用书' },
      { action: 'assertFieldInvalid', label: '手机号' },
      { action: 'clickExactText', text: '历史申请' },
    ] }])[0].steps, [
      { action: 'assertRoleVisible', role: 'button', name: '申请记录' },
      { action: 'assertExactVisible', text: '精确文案' },
      { action: 'assertNotVisible', text: '出版社用书' },
      { action: 'assertFieldInvalid', label: '手机号' },
      { action: 'clickExactText', text: '历史申请' },
    ]);
    assert.deepEqual(validateCases([{ ...base, steps: [{ action: 'setViewport', width: 390, height: 844 }, { action: 'assertNoHorizontalOverflow' }] }])[0].steps, [
      { action: 'setViewport', width: 390, height: 844 },
      { action: 'assertNoHorizontalOverflow' },
    ]);
    assert.throws(() => validateCases([{ ...base, steps: [{ action: 'assertRoleVisible', role: 'heading', name: '标题' }] }]), /role 无效/);
    assert.throws(() => validateCases([{ ...base, steps: [{ action: 'clickExactText', text: '提交申请' }] }]), /禁止提交/);
    assert.deepEqual(validateCases([{ ...base, steps: [
      { action: 'fillByLabel', label: '自编码', value: '00000000', rowIndex: 1 },
      { action: 'assertFieldInvalid', label: '自编码', rowIndex: 1 },
      { action: 'assertValue', label: '数量（册）', value: '', rowIndex: 1 },
    ] }])[0].steps, [
      { action: 'fillByLabel', label: '自编码', value: '00000000', rowIndex: 1 },
      { action: 'assertFieldInvalid', label: '自编码', rowIndex: 1 },
      { action: 'assertValue', label: '数量（册）', value: '', rowIndex: 1 },
    ]);
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'assertFieldInvalid', label: '自编码', rowIndex: 10 }] }]), /rowIndex 无效/);

  const noApiCall = validateCases([{ ...base, expected: '非法自编码不得调用接口', steps: [
    { action: 'startFetchOrXhrCapture' },
    { action: 'fillByLabel', label: '自编码', value: 'ABC' },
    { action: 'blurByLabel', label: '自编码' },
    { action: 'assertFieldInvalid', label: '自编码' },
    { action: 'assertNoFetchOrXhr', quietMs: 300 },
  ] }])[0];
  assert.equal(noApiCall.steps.at(-1).action, 'assertNoFetchOrXhr');
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'assertNoFetchOrXhr' }] }]), /必须在首个用户操作前启动 fetch\/XHR 捕获/);
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'fillByLabel', label: '自编码', value: 'ABC' }, { action: 'startFetchOrXhrCapture' }, { action: 'assertNoFetchOrXhr' }] }]), /必须在首个用户操作前启动/);
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'startFetchOrXhrCapture' }, { action: 'assertNoFetchOrXhr' }, { action: 'fillByLabel', label: '自编码', value: 'ABC' }] }]), /断言必须放在最后一个用户操作之后/);
  assert.throws(() => validateCases([{ ...base, steps: [{ action: 'startFetchOrXhrCapture' }, { action: 'assertNoFetchOrXhr', quietMs: 249 }] }]), /quietMs 必须在 250–5000/);
  const existingNoApi = validateCases([{ ...base, id: 'case-27', title: '输入非数字：校验拦截，不调用接口', expected: '输入非数字：校验拦截，不调用接口', steps: [
    { action: 'fillByLabel', label: '自编码', value: 'ABC' }, { action: 'blurByLabel', label: '自编码' },
    { action: 'assertFieldInvalid', label: '自编码' }, { action: 'fillByLabel', label: '自编码', value: '' },
  ] }])[0];
  assert.equal(addNoApiNetworkAssertion(existingNoApi), true, 'repair an existing runnable case without inventing field locators');
  assert.deepEqual(existingNoApi.steps.map(step => step.action), ['startFetchOrXhrCapture', 'fillByLabel', 'blurByLabel', 'assertFieldInvalid', 'fillByLabel', 'assertNoFetchOrXhr']);
  assert.match(existingNoApi.coverageGap, /仅验证操作后的限定观察窗内未出现 fetch\/XHR/);
  assert.equal(addNoApiNetworkAssertion(existingNoApi), false, 'repair is idempotent');
  });

  await t.test('no-confirm gate starts safe selected subset and leaves unresolved cases in scope', () => {
    const safe = { id: 'safe', title: 'Read only', source: 'spec.md', kind: 'visible', expected: 'Visible', steps: [{ action: 'assertVisible', text: 'Visible' }], selectedForRegression: true, sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true, confidence: 'medium' };
    const reviewedLowConfidence = validateCases([{ ...safe, id: 'reviewed-low-confidence', confidence: 'low' }])[0];
    assert.equal(isSafeReadOnlyBrowserCase(reviewedLowConfidence), true, 'low confidence blocks AI authoring, not execution of a reviewed, bounded read-only script');
    assert.equal(canAuthorReadOnlyBrowserSteps(reviewedLowConfidence), false, 'the model must not author new steps from low-confidence expectations');
    assert.equal(hasAutoRunnableSelectedCase(validateCases([reviewedLowConfidence])), true, 'approved no-confirm workflow can run reviewed low-confidence scripts');
    const scrollAndMotion = validateCases([{ ...safe, id: 'scroll-motion', expected: '城市内容随滚动变化并兼容减少动态效果', steps: [{ action: 'scrollToRatio', ratio: 0.5 }, { action: 'setReducedMotion', value: true }, { action: 'assertVisible', text: '城市' }] }])[0];
    assert.equal(isSafeReadOnlyBrowserCase(scrollAndMotion), true);
    assert.throws(() => validateCases([{ ...safe, steps: [{ action: 'scrollToRatio', ratio: 2 }] }]), /滚动比例/u);
    assert.throws(() => validateCases([{ ...safe, steps: [{ action: 'setReducedMotion', value: 'reduce' }] }]), /必须是布尔值/u);
    const blocked = { id: 'blocked', title: 'Needs fixture', source: 'spec.md', kind: 'visible', expected: 'Ready', steps: [], selectedForRegression: true, sideEffectRisk: 'unknown', preconditions: ['QA fixture'], preconditionsConfirmed: false, confidence: 'medium' };
    assert.equal(hasAutoRunnableSelectedCase(validateCases([safe, blocked])), true);
    assert.equal(hasAutoRunnableSelectedCase(validateCases([blocked])), false);
    assert.equal(hasAutoRunnableSelectedCase(validateCases([{ ...safe, selectedForRegression: false }, blocked])), false);
  });

  await t.test('step authoring excludes unresolved/backend checks and generic shell text cannot count as coverage', () => {
    const safe = validateCases([{ id: 'safe-ui', title: 'Quantity validation', source: 'spec.md', kind: 'visible', expected: '提交申请保持禁用', steps: [], selectedForRegression: true, sideEffectRisk: 'none', preconditions: [], preconditionsConfirmed: true, confidence: 'medium' }])[0];
    const clarification = validateCases([{ ...safe, id: 'clarify', title: '待澄清客户接口返回字段', expected: '[需澄清] 客户分类字段', sideEffectRisk: 'unknown' }])[0];
    const backend = validateCases([{ ...safe, id: 'backend', title: '后端推送其他出库单', expected: '后端创建其他出库单', sideEffectRisk: 'irreversible' }])[0];
    const ownerOnly = validateCases([{ ...safe, id: 'owner-only', title: '仅申请发起人本人可见查看明细入口', expected: '仅申请发起人本人可见', steps: [{ action: 'assertRoleVisible', role: 'link', name: '查看明细' }] }])[0];
    const visibleInvalidCode = validateCases([{ ...safe, id: 'visible-invalid-code', title: '物流编码错误时提示未获取图书信息', source: 'XMind › 调用图书校验接口 › 输入错误编码', expected: '输入错误编码后边框变红，显示「未获取图书信息」', steps: [] }])[0];
    const noApiCallCode = validateCases([{ ...safe, id: 'no-api-invalid-code', title: '输入非数字：校验拦截，不调用接口', source: 'XMind › 图书编码校验接口 › 输入非数字', expected: '输入非数字：校验拦截，不调用接口', steps: [] }])[0];
    const visibleBookWeight = validateCases([{ ...safe, id: 'visible-book-weight', title: '无重量图书错误提示', source: 'XMind › bookCheck API 返回错误', expected: '提示「该图书不存在或尚未入库」，图书名称/定价/重量不回显', steps: [] }])[0];
    const orderFixtureGap = validateCases([{ ...safe, id: 'order-fixture-gap', title: '状态按钮置灰', expected: '待审核：状态按钮置灰', steps: [], coverageGap: '依赖/范围：api_data_or_business_fixture_prerequisite' }])[0];
    assert.equal(canAuthorReadOnlyBrowserSteps(safe), true);
    assert.equal(canAuthorReadOnlyBrowserSteps(clarification), false);
    assert.equal(canAuthorReadOnlyBrowserSteps(backend), false);
    assert.equal(isSafeReadOnlyBrowserCase(ownerOnly), false, 'a visible detail link does not prove the identity or authorization rule');
    assert.equal(canAuthorReadOnlyBrowserSteps(visibleInvalidCode), true, 'API breadcrumb does not block authoring a directly observable form result');
    assert.equal(canAuthorReadOnlyBrowserSteps(noApiCallCode), true, 'a browser-observable no-request requirement can be scripted with network capture instead of being blanket-blocked as backend work');
    assert.match(missingDirectAssertion(noApiCallCode), /没有在用户操作前启动 fetch\/XHR 捕获/);
    assert.equal(missingDirectAssertion(validateCases([{ ...noApiCallCode, steps: [{ action: 'startFetchOrXhrCapture' }, { action: 'fillByLabel', label: '自编码', value: 'ABC' }, { action: 'blurByLabel', label: '自编码' }, { action: 'assertNoFetchOrXhr' }] }])[0]), undefined);
    assert.equal(canAuthorReadOnlyBrowserSteps(visibleBookWeight), true, 'UI feedback can be tested without claiming the backend contract passed');
    assert.equal(canAuthorReadOnlyBrowserSteps(orderFixtureGap), true, 'a safe, directly visible sub-check can be authored while the full business fixture remains unresolved');
    assert.match(browserStepDraftBlockReason(orderFixtureGap), /项目已标记此项依赖外部夹具/);

    for (const [id, title, expected] of [
      ['customer', '1004.00 外部客户—合作客户：正常展示可选', '1004.00 外部客户—合作客户：正常展示可选'],
      ['excluded-customer', '其他分类：不展示', '信用客户选项不展示'],
      ['status', '待审核：状态按钮置灰', '待审核：状态按钮置灰'],
      ['copy', '申请编号支持一键复制按钮', '申请编号支持一键复制按钮'],
      ['empty', '无符合条件记录：空状态', '无符合条件记录：空状态'],
      ['paging', '默认展示全部并支持分页20条', '默认展示全部并支持分页20条'],
    ]) {
      const candidate = validateCases([{ ...safe, id, title, expected, steps: [], coverageGap: '需隔离业务记录或 fixture 才能证明完整结果。' }])[0];
      assert.equal(canAuthorReadOnlyBrowserSteps(candidate), true, `${id}: allow grounded visible subcheck drafting while retaining the fixture coverage gap`);
    }

    const broadRiskMetadata = validateCases([{ ...safe, id: 'readonly-plan', title: 'Check the disabled submit state', expected: '必填未完成时提交按钮置灰不可点击', sideEffectRisk: 'irreversible', preconditions: ['需要目标系统专用测试环境和/或测试账号、接口 mock/沙箱数据'], preconditionsConfirmed: false, steps: [{ action: 'assertRoleDisabled', role: 'button', name: '提交申请' }] }])[0];
    assert.equal(canAuthorReadOnlyBrowserSteps(broadRiskMetadata), true, 'business workflow risk must not prevent read-only step drafting');
    assert.equal(isSafeReadOnlyBrowserCase(broadRiskMetadata), true, 'generic importer precondition is not a real unconfirmed fixture dependency');
    assert.equal(hasAutoRunnableSelectedCase(validateCases([broadRiskMetadata])), true);

    const genericDraft = validateCases([{ ...safe, title: '登录用户信息自动带出', expected: '当前企微登录人的姓名与部门自动带出', steps: [{ action: 'assertVisible', text: '样书申请' }] }])[0];
    const substantiveDraft = validateCases([{ ...safe, expected: '申请记录入口可见', steps: [{ action: 'assertRoleVisible', role: 'link', name: '申请记录' }] }])[0];
    assert.equal(hasOnlyGenericShellAssertions(genericDraft), true);
    assert.equal(hasOnlyGenericShellAssertions(substantiveDraft), false);

    const regionRedCase = validateCases([{ ...safe, title: '未选全三级：提交校验标红', expected: '未选全三级：提交校验标红', steps: [
      { action: 'assertVisible', text: '所在地区' },
      { action: 'assertRoleDisabled', role: 'button', name: '提交申请' },
    ] }])[0];
    assert.match(missingDirectAssertion(regionRedCase), /字段自身的无效状态/);
    const responsiveShell = validateCases([{ ...safe, title: 'PC与H5响应式布局适配', expected: 'PC与H5响应式布局适配', steps: [{ action: 'assertVisible', text: '样书申请' }] }])[0];
    assert.match(missingDirectAssertion(responsiveShell), /切换实际 viewport/);
    const responsiveVerified = validateCases([{ ...safe, title: 'PC与H5响应式布局适配', expected: 'PC与H5响应式布局适配', steps: [
      { action: 'setViewport', width: 390, height: 844 }, { action: 'assertNoHorizontalOverflow' },
    ] }])[0];
    assert.equal(missingDirectAssertion(responsiveVerified), undefined);

    const staticCopy = '如有调样、周边产品等样书申请需求，请OA申请';
    const copyCase = validateCases([{ ...safe, title: `页面提示文案「${staticCopy}」`, expected: `页面提示文案「${staticCopy}」`, steps: [] }])[0];
    assert.equal(canAuthorReadOnlyBrowserSteps(copyCase), true, 'an explicit static-copy expectation is executable without a model or fixture');
    assert.deepEqual(draftGroundedReadOnlyBrowserSteps({ title: `页面提示文案「${staticCopy}」`, expected: `页面提示文案「${staticCopy}」` }), [
      { action: 'assertExactVisible', text: staticCopy },
    ]);
    assert.equal(draftGroundedReadOnlyBrowserSteps({ title: '点击操作后 toast 提示「暂无权限」', expected: 'toast提示「暂无权限」' }), undefined, 'a transient message needs an explicit safe trigger path');
    assert.equal(draftGroundedReadOnlyBrowserSteps({ title: '后端备注「发送样书」+审批编号', expected: '备注中包含「发送样书」' }), undefined, 'quoted backend values are not visible page-copy assertions');

    const emptyFilter = validateCases([{ ...safe, id: 'empty-filter', title: '无符合条件记录：空状态', source: 'XMind › 历史申请记录 › 营销用书 › 待审批筛选', expected: '无符合条件记录：空状态', steps: [], coverageGap: '当前列表为空；没有可匹配记录。' }])[0];
    assert.equal(deriveGroundedEmptyListNavigationSubcheck(emptyFilter), true);
    assert.deepEqual(emptyFilter.steps.map(step => step.action), ['clickExactText', 'clickExactText', 'clickExactText', 'assertExactVisible']);
    assert.match(emptyFilter.coverageGap, /没有正向记录对照/u);
    assert.equal(isSafeReadOnlyBrowserCase(emptyFilter), true);

    const usageFilter = validateCases([{ ...safe, id: 'usage-filter-empty', title: '按用途筛选（营销用书/产品用书）生效', source: 'XMind › 历史申请记录 › 营销用书 › 产品用书', expected: '按用途筛选（营销用书/产品用书）生效', steps: [], coverageGap: '需分别预置营销用书与产品用书记录；当前列表为空。' }])[0];
    assert.equal(deriveGroundedEmptyListNavigationSubcheck(usageFilter), true);
    assert.deepEqual(usageFilter.steps.map(step => step.action), ['clickExactText', 'clickExactText', 'clickExactText', 'assertExactVisible']);

    const pagingEmpty = validateCases([{ ...safe, id: 'paging-empty', title: '默认展示全部并支持分页20条', expected: '默认展示全部并支持分页20条', steps: [], coverageGap: '需超过20条隔离申请记录；当前没有记录。' }])[0];
    assert.equal(deriveGroundedEmptyListNavigationSubcheck(pagingEmpty), true);
    assert.deepEqual(pagingEmpty.steps.map(step => step.action), ['clickExactText', 'assertExactVisible', 'clickExactText', 'assertExactVisible']);
    assert.match(pagingEmpty.coverageGap, /未验证实时加载或每页20条分页/u);

    const externalCustomer = validateCases([{
      id: 'case-17', title: '1004.00 外部客户—合作客户：正常展示可选', source: 'XMind › 费用划归客户 › 客户分类过滤',
      expected: '1004.00 外部客户—合作客户：正常展示可选', kind: 'visible', steps: [], sideEffectRisk: 'unknown',
      preconditions: ['需要目标系统专用测试环境和/或测试账号、接口 mock/沙箱数据'], preconditionsConfirmed: false,
    }])[0];
    assert.equal(deriveGroundedCustomerLookupSubcheck(externalCustomer), true);
    assert.deepEqual(externalCustomer.steps.map(step => step.action), ['clickExactText', 'fillByRoleIndex', 'assertExactVisible']);
    assert.match(externalCustomer.coverageGap, /缺少外部客户夹具/u);
    assert.equal(externalCustomer.sideEffectRisk, 'none');

    const freshness = validateCases([{
      id: 'case-24', title: '客户列表为最新数据（非缓存历史快照）', source: 'XMind › 费用划归客户 › 客户数据实时性',
      expected: '客户列表为最新数据（非缓存历史快照）', kind: 'visible', steps: [], sideEffectRisk: 'unknown',
    }])[0];
    assert.equal(deriveGroundedCustomerLookupSubcheck(freshness), true);
    assert.deepEqual(freshness.steps.map(step => step.action), ['clickExactText', 'fillByRoleIndex', 'assertVisible']);
    assert.match(freshness.coverageGap, /缓存旧值/u);
  });

  await t.test('legacy browser-case generation rejects incomplete or altered model output through the local API fixture', async t2 => {
    const candidates = [
      { id: 'WEB-001', title: '未授权导出被拒绝', source: '权限要求第2节', requirementRefs: ['权限要求第2节'], priority: 'P1', category: 'authorization', confidence: 'high', coverageAreas: ['authorization', 'security'], preconditions: [], testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'text', expected: '返回 403', steps: [] },
      { id: 'WEB-002', title: '输入边界需要确认', source: '表单需求', requirementRefs: ['表单需求'], priority: 'P2', category: 'boundary', confidence: 'low', coverageAreas: ['boundary'], preconditions: [], testData: [], sideEffectRisk: 'unknown', cleanup: '', kind: 'visible', expected: '[需澄清] 输入范围', steps: [] },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `WEB-${String(index + 3).padStart(3, '0')}`, title: `补充测试${index + 1}`, source: '功能要求', requirementRefs: ['功能要求'], priority: 'P2', category: 'functional', confidence: 'medium', coverageAreas: ['functional'], preconditions: [], testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible', expected: `可见状态${index + 1}`, steps: [] })),
    ];
    let modelCases = candidates;
    const model = createServer(async (_req, res) => {
      for await (const _chunk of _req) { /* consume request */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ cases: modelCases }) } }] }));
    });
    model.listen(0, '127.0.0.1');
    await once(model, 'listening');
    process.env.TESTPILOT_API_KEY = 'local-case-metadata-key';
    process.env.OPENAI_API_KEY = '';
    process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;
    process.env.TESTPILOT_MODEL = 'local-case-metadata-fixture';
    t2.after(async () => { model.closeAllConnections(); await new Promise(done => model.close(done)); });
    const { generateDocumentBrowserCases } = await import('../dist/demo/runtime.js');
    const output = await generateDocumentBrowserCases('需求：导出权限与输入边界', []);
    assert.equal(output.length, 12);
    assert.equal(output[0].id, 'WEB-001');
    assert.equal(output[0].category, 'authorization');
    assert.equal(output[0].confidence, 'high');
    assert.deepEqual(output[0].coverageAreas, ['authorization', 'security']);
    assert.equal(output[1].id, 'WEB-002');
    assert.equal(output[1].category, 'boundary');
    assert.equal(output[1].confidence, 'low');
    assert.deepEqual(output[1].coverageAreas, ['boundary']);
    const validated = validateCases(output);
    assert.equal(validated[0].category, 'authorization');
    assert.equal(validated[1].confidence, 'low');
    modelCases = [{ ...candidates[0], expected: 'x'.repeat(301) }];
    await assert.rejects(() => generateDocumentBrowserCases('需求：导出权限', []), /cases\.0\.expected/u, 'oversized values must be rejected, never sliced');
    modelCases = [{ ...candidates[0], steps: [{ action: 'assertVisible', text: '导出', inventedSelector: '#secret' }] }];
    await assert.rejects(() => generateDocumentBrowserCases('需求：导出权限', []), /包含不支持或未定义的字段/u, 'unsupported step fields must reject the whole generated artifact');
    modelCases = [{ ...candidates[0], unexpected: true }];
    await assert.rejects(() => generateDocumentBrowserCases('需求：导出权限', []), /cases\.0：Unrecognized key/u, 'unknown case fields must be rejected with a path');
  });

  await t.test('independent generation prompt contains no held-out baseline and rejects silently truncated requirements', async () => {
    const { buildDocumentBrowserCaseMessages } = await import('../dist/demo/runtime.js');
    const { generateTestCaseDrafts } = await import('../dist/adapters/case-generation-agent.js');
    const messages = buildDocumentBrowserCaseMessages('明确需求', [{ title: '公开参考', url: 'https://example.invalid', snippet: '只供覆盖启发' }]);
    assert.doesNotMatch(JSON.stringify(messages), /HOLDOUT_SECRET_156/u);
    assert.throws(() => buildDocumentBrowserCaseMessages('x'.repeat(16_001)), /单轮最多处理 16000/u);
    await assert.rejects(() => generateTestCaseDrafts({ requirementsText: '明确需求', maxCases: 81 }), /maxCases 必须是 1–80 的整数/u);
  });
});
