import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocumentCaseTriage, unsupportedWeChatClientGateMessage } from '../dist/adapters/document-test-workflow.js';

test('a WeChat-only splash is treated as an unsupported client gate, not a product assertion failure', () => {
  assert.equal(unsupportedWeChatClientGateMessage('请在微信客户端打开链接'), '请在微信客户端打开链接');
  assert.equal(unsupportedWeChatClientGateMessage('  请在企业微信客户端内打开此链接。  '), '请在企业微信客户端内打开此链接。');
  assert.equal(unsupportedWeChatClientGateMessage('Please open this link in the WeChat Work client.'), 'Please open this link in the WeChat Work client.');
  assert.equal(unsupportedWeChatClientGateMessage('首页说明：请在微信客户端打开链接，查看公司帮助。'), undefined);
  assert.equal(classifyDocumentCaseTriage({
    status: 'blocked',
    detail: '目标页只显示“请在微信客户端打开链接”；业务页面未加载。',
  }).category, 'environment-or-session');
});

test('run triage names a potential product regression only when an unchanged case regresses against its baseline', () => {
  const result = classifyDocumentCaseTriage({
    status: 'failed', detail: '断言失败：期望标题可见，但当前页面显示另一个标题。',
    baselineDisposition: 'regression', regressionMode: true,
  });
  assert.equal(result.category, 'suspected-product-regression');
  assert.equal(result.confidence, 'tentative', 'a baseline delta remains a lead for review, not a confirmed bug');
});

test('changed cases and changed requirements/data stay separate from product regression claims', () => {
  assert.equal(classifyDocumentCaseTriage({
    status: 'failed', detail: '断言失败：预期文案未出现。', baselineDisposition: 'case-changed', caseChanged: true, regressionMode: true,
  }).category, 'case-or-expectation-review');
  assert.equal(classifyDocumentCaseTriage({
    status: 'failed', detail: '断言失败：预期文案未出现。', baselineDisposition: 'regression', materialChanged: true, regressionMode: true,
  }).category, 'case-or-expectation-review');
  assert.equal(classifyDocumentCaseTriage({
    status: 'failed', detail: '断言失败：预期文案未出现。', baselineDisposition: 'regression', testDataChanged: true, regressionMode: true,
  }).category, 'test-data-or-fixture');
});

test('locator, login/session, and fixture evidence are classified without changing execution status', () => {
  assert.equal(classifyDocumentCaseTriage({ status: 'blocked', detail: '字段标签未匹配；步骤未执行。' }).category, 'locator-failure');
  assert.equal(classifyDocumentCaseTriage({ status: 'blocked', detail: '页面重载后出现登录页；请在原会话完成登录。' }).category, 'environment-or-session');
  assert.equal(classifyDocumentCaseTriage({ status: 'blocked', detail: 'API fixture cleanup 未通过，记录未能清理。' }).category, 'test-data-or-fixture');
});

test('unclear failures remain pending review and non-failure states receive no failure triage', () => {
  assert.deepEqual(classifyDocumentCaseTriage({ status: 'blocked', detail: '当前结果没有足够证据。' }), {
    category: 'needs-review', confidence: 'tentative', detail: '现有证据不足以可靠区分产品、用例、数据或环境问题；保留待确认。',
  });
  assert.equal(classifyDocumentCaseTriage({ status: 'cancelled', detail: 'user cancelled' }), undefined);
  assert.equal(classifyDocumentCaseTriage({ status: 'passed', detail: 'ok' }), undefined);
});
