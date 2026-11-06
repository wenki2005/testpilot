import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const build = process.env.TESTPILOT_CHECK_BUILD ?? path.join(repo, 'dist');
const { parseCaseVersionMarkdown } = await import(pathToFileURL(path.join(build, 'adapters/regression/resources/case-markdown-import.js')));
const { prepareCaseVersion } = await import(pathToFileURL(path.join(build, 'adapters/regression/resources/case-version-import.js')));
const { inferImportModule } = await import(pathToFileURL(path.join(build, 'adapters/regression/resources/case-import-matching.js')));
const systemId = '51000000-0000-4000-8000-000000000001', moduleId = '51000000-0000-4000-8000-000000000002';
const parse = text => parseCaseVersionMarkdown('新版.md', Buffer.from(text));
const baseline = () => ({ schema: 1, project: { id: systemId, name: '本机样例' }, modules: [{ id: moduleId, name: '登录模块' }], chains: [], cases: [{ id: 'xmind-1', moduleId, title: '登录成功', expected: '显示首页', sourcePath: ['旧文件', '登录模块'], sourceExpected: '显示首页', prerequisites: [], manualSteps: ['打开页面'], script: { caseId: 'xmind-1', dependsOn: [], steps: [{ action: 'assertText', text: '首页' }] } }] });
const input = text => ({ systemId, fileName: '新版.md', bytesBase64: Buffer.from(text).toString('base64') });

test('markdown accepts exported sections and fences without treating embedded headings as cases', () => {
    const rows = parse('\uFEFF# 登录模块\n## xmind-1 | 登录成功\n### 操作步骤\n1. 打开页面\n2. 输入账号\n### 固定步骤\n```json\n[{"action":"assertText","text":"忽略固定步骤更新"}]\n```\n### 预期结果\n```text\n显示首页\n## 这是原始预期内容\n```\n');
    assert.equal(rows.length, 1); assert.equal(rows[0].id, 'xmind-1');
    assert.deepEqual(rows[0].manualSteps, ['打开页面', '输入账号']);
    assert.equal(rows[0].expected, '显示首页\n## 这是原始预期内容');
    assert.deepEqual(rows[0].sourcePath, ['登录模块']);
});

test('XMind-style trees in Markdown fences preserve expectations, paths and priorities without results', () => {
    const text = '# 新版说明\n> ✅仅为作者分类，不是运行证据。\n```markdown\n- 系统\n  - 登录模块\n    - 打开页面\n      - 页面呈现\n        - ✅ P0 显示首页\n        - ⚠️❌ P1 隐藏其他用户信息\n      - // 澄清说明，不作为用例\n```\n';
    const rows = parse(text); assert.equal(rows.length, 2);
    assert.equal(rows[0].priority, 'P0'); assert.equal(rows[1].priority, 'P1');
    assert.equal(rows[0].expected, '显示首页'); assert.equal(rows[1].expected, '隐藏其他用户信息');
    assert.deepEqual(rows[0].sourcePath, ['系统', '登录模块', '打开页面', '页面呈现']);
    assert.equal('status' in rows[0], false); assert.equal('script' in rows[0], false);
    const reordered = parse(text.replace('        - ✅ P0 显示首页\n        - ⚠️❌ P1 隐藏其他用户信息', '        - ⚠️❌ P1 隐藏其他用户信息\n        - ✅ P0 显示首页'));
    assert.deepEqual(rows.map(row => row.key).sort(), reordered.map(row => row.key).sort());
    assert.throws(() => parse(text.replace('```markdown', '```javascript')), /未识别到完整用例/);
});

test('tree import can map a module without inventing scripts, and priority survives resource roundtrip', async t => {
    const text = '```markdown\n- 系统\n  - 登录模块\n    - 测试上下文\n      - ✅ P0 显示新版首页\n```';
    const preview = await prepareCaseVersion(baseline(), input(text));
    assert.equal(preview.issues.length, 0); assert.equal(preview.added.length, 1);
    const c = preview.resources.cases[0]; assert.equal(c.priority, 'P0'); assert.equal(c.scriptReview.status, 'pending'); assert.deepEqual(c.script.steps, []);
    const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
    const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-tree-priority-'));
    const load = file => import(pathToFileURL(path.join(build, file)));
    const {DifyWebModuleStore} = await load('adapters/regression/execution/module-execution-service.js');
    const {SystemModuleRegression} = await load('adapters/regression/catalog/module-regression-service.js');
    const no = async () => { throw Error('Business forbidden'); }, deps = {cloud:no,inspect:no,author:no,execute:no,cancel:no,continueLogin:no,recover:async()=>undefined,saveProject:async()=>{}};
    const store = new DifyWebModuleStore(dir, deps), catalog = new SystemModuleRegression(dir, store, deps);
    t.after(async () => {catalog.close();store.close();await rm(dir,{recursive:true,force:true});});
    await catalog.initializeResources(preview.resources, {targetUrl:'https://example.test',environment:'fixture'});
    const saved = catalog.exportResources(systemId); assert.equal(saved.resources.cases[0].priority, 'P0');
    const module = catalog.getModule(moduleId), pack = store.getModule(module.versions.at(-1).id);
    assert.equal(pack.project.cases[0].priority, 'P0'); assert.equal(store.state().jobs.length, 0);
    assert.equal(catalog.editorCatalog(systemId).cases[0].status, 'not_executed');
});

test('markdown accepts table aliases, line breaks and escaped pipes', () => {
    const rows = parse('# 登录模块\n| ID | 用例名称 | 测试步骤 | 期望结果 |\n| --- | --- | --- | --- |\n| xmind-1 | 登录成功 | 1. 打开页面<br>2. 输入账号 | 显示首页\\|欢迎信息 |\n');
    assert.equal(rows.length, 1); assert.equal(rows[0].expected, '显示首页|欢迎信息');
    assert.deepEqual(rows[0].manualSteps, ['打开页面', '输入账号']);
    const noOuter = parse('case_id | title | expected_result\n--- | --- | ---\nxmind-1 | 登录成功 | 显示首页\\|\n');
    assert.equal(noOuter[0].expected, '显示首页|');
});

test('markdown accepts bold field lists, alternate heading syntax and UTF16 BOM', () => {
    const text = '# 登录模块\n- **用例编号**：xmind-1\n- **用例名称**：登录成功\n- 操作步骤：打开页面\n- 预期：显示首页\n\n## TC-002：退出成功\n### 预期输出\n返回登录页\n';
    const rows = parse(text); assert.equal(rows.length, 2); assert.deepEqual(rows[0].sourcePath, ['登录模块']);
    assert.equal(rows[1].id, 'TC-002'); assert.equal(rows[1].title, '退出成功');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    assert.deepEqual(parseCaseVersionMarkdown('新版.markdown', utf16), rows);
});

test('markdown rejects incomplete cases, duplicate IDs, malformed tables and unclosed fences', () => {
    assert.throws(() => parse('## TC-001 登录成功\n### 操作步骤\n打开页面'), /缺少预期结果/);
    assert.throws(() => parse('## TC-001 登录成功\n预期：首页\n## TC-001 退出成功\n预期：登录页'), /重复用例/);
    assert.throws(() => parse('| 编号 | 用例名称 | 预期 |\n| --- | --- | --- |\n| 1 | 登录 |'), /列数不一致/);
    assert.throws(() => parse('## TC-001 登录成功\n预期：\n```text\n首页'), /未闭合/);
    assert.throws(() => parse('# 会议说明\n普通说明文字'), /未识别到完整用例/);
    assert.throws(() => parseCaseVersionMarkdown('乱码.md', Uint8Array.from([0xff, 0xff])), /编码/);
});

test('markdown updates manual steps, keeps executable scripts and marks content changes pending review', async () => {
    const before = baseline(); before.cases[0].sourceId = 'xmind:original-topic';
    const preview = await prepareCaseVersion(before, input('# 登录模块\n## xmind-1 | 登录成功\n### 操作步骤\n1. 打开页面\n2. 输入账号\n### 预期结果\n显示首页'));
    assert.equal(preview.issues.length, 0); assert.equal(preview.changed.length, 1);
    assert.equal(preview.scriptsToReview.length, 1); assert.equal(preview.removed.length, 0);
    const updated = preview.resources.cases[0]; assert.deepEqual(updated.script, before.cases[0].script);
    assert.equal(updated.sourceId, 'xmind:original-topic', 'switching file formats preserves the existing XMind identity');
    assert.deepEqual(updated.manualSteps, ['打开页面', '输入账号']);
    assert.equal(preview.recognized[0].expected, '显示首页');
});

test('markdown can match missing IDs by unique title and bind external IDs for later renamed cases', async () => {
    const noId = await prepareCaseVersion(baseline(), input('# 登录模块\n## 登录成功\n预期结果：显示首页'));
    assert.equal(noId.resources.cases[0].id, 'xmind-1'); assert.equal(noId.unchanged.length, 1);
    const external = await prepareCaseVersion(baseline(), input('# 登录模块\n## TC-001 登录成功\n预期结果：显示首页'));
    assert.equal(external.resources.cases[0].id, 'xmind-1'); assert.equal(external.resources.cases[0].sourceId, 'markdown:TC-001');
    const renamed = await prepareCaseVersion(external.resources, input('# 登录模块\n## TC-001 登录并跳转首页\n预期结果：显示新首页'));
    assert.equal(renamed.resources.cases[0].id, 'xmind-1'); assert.equal(renamed.added.length, 0);
    assert.equal(renamed.changed.length, 1);
});

test('ambiguous Markdown names require a mapping and removals still respect core references', async () => {
    const before = baseline(); const other = '51000000-0000-4000-8000-000000000003';
    before.modules.push({ id: other, name: '另一个模块' });
    before.cases.push({ ...structuredClone(before.cases[0]), id: 'xmind-2', moduleId: other, sourcePath: ['另一个模块'], script: { caseId: 'xmind-2', dependsOn: [], steps: [] } });
    const ambiguous = await prepareCaseVersion(before, input('## 登录成功\n预期：显示首页'));
    assert.equal(ambiguous.unresolved.length, 1); assert.ok(ambiguous.issues.length);
    assert.equal(ambiguous.removed.length, 0, 'unresolved rows must not advertise old cases as deleted');
    assert.equal(ambiguous.resources.cases.length, before.cases.length);
    const resolved = await prepareCaseVersion(before, input('# 登录模块\n## 登录成功\n预期：显示首页'));
    assert.equal(resolved.unresolved.length, 0); assert.equal(resolved.resources.cases[0].id, 'xmind-1');
    before.chains = [{ id: 'core', title: '核心流程', description: '', steps: [{ id: 'step', title: '步骤', expected: '', caseIds: ['xmind-2'] }] }];
    const missing = await prepareCaseVersion(before, input('# 登录模块\n## xmind-1 | 登录成功\n预期：显示首页'));
    assert.ok(missing.issues.some(issue => issue.includes('核心链路')));
});

test('automatic module mapping uses business aliases and does not require one selector per imported case', () => {
    const current = baseline(); current.modules.push({ id: '51000000-0000-4000-8000-000000000003', name: '订单与物流' }, { id: '51000000-0000-4000-8000-000000000004', name: '登录入口与公共基础' });
    current.cases.push({ ...structuredClone(current.cases[0]), id: 'xmind-2', moduleId: '51000000-0000-4000-8000-000000000003', sourcePath: ['旧文件', '订单与物流'] });
    const row = { key: 'tree:1', title: '订单详情 — 展示订单物流', expected: '展示订单物流', sourcePath: ['V1.1.0', '员工端-订单详情页'], structured: true };
    const inferred = inferImportModule(current, row);
    assert.equal(inferred.module.name, '订单与物流'); assert.equal(inferred.created, false);
    const other = { ...row, key: 'tree:2', sourcePath: ['V1.1.0', '企微消息通知'] };
    assert.equal(inferImportModule(current, other).module.name, '登录入口与公共基础');
});
