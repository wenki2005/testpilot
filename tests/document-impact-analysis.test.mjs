import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocumentCaseImpact } from '../dist/adapters/document-impact-analysis.js';

test('iteration impact scan returns deterministic candidates with field evidence and unmatched change terms', () => {
  const cases = [
    {
      id: 'member-export',
      title: '导出会员列表为 CSV',
      modulePath: ['会员管理'],
      requirementRefs: ['REQ-EXPORT-01'],
      expected: '下载文件包含会员列表',
      steps: [{ action: 'clickExactText', text: '导出 CSV' }],
    },
    {
      id: 'profile-password',
      title: '修改个人资料密码',
      modulePath: ['账号设置'],
      requirementRefs: ['REQ-PROFILE-02'],
      expected: '显示密码修改成功',
      steps: [{ action: 'clickExactText', text: '修改密码' }],
    },
  ];
  const notes = '会员列表增加 CSV 导出；筛选条件保持不变。';
  const first = analyzeDocumentCaseImpact(cases, notes);
  const second = analyzeDocumentCaseImpact(cases, notes);

  assert.deepEqual(first, second, 'the scan is repeatable for identical notes and cases');
  assert.equal(first.matchingMethod, 'keyword-evidence');
  assert.ok(first.suggestions.some(item => item.caseId === 'member-export'));
  assert.ok(!first.suggestions.some(item => item.caseId === 'profile-password'));
  const candidate = first.suggestions.find(item => item.caseId === 'member-export');
  assert.ok(candidate.matchedTerms.includes('会员列表'));
  assert.ok(candidate.evidence.some(item => item.includes('用例标题')));
  assert.ok(first.unmatchedTerms.length > 0, 'unmatched terms remain visible for human review');
});

test('iteration impact scan does not invent candidates when no case text matches', () => {
  const result = analyzeDocumentCaseImpact([
    { id: 'profile-password', title: '修改个人资料密码', modulePath: ['账号设置'], expected: '显示密码修改成功' },
  ], '新增审计日志下载与管理员批量归档');

  assert.deepEqual(result.suggestions, []);
  assert.ok(result.unmatchedTerms.length > 0);
});
