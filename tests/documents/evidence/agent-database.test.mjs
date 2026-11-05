import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabaseApplicationTotals } from '../../../src/domain/documents/shared/database-evidence.ts';
import { createDocumentAuthoringContextReader } from '../../../src/adapters/documents/cases/authoring-context.ts';
import { isDepartmentDatabaseTarget, bindDepartmentDatabaseFixture, missingDepartmentDatabaseFixtureAssertion } from '../../../src/adapters/documents/evidence/agent-database.ts';
import { validateCases } from '../../../src/domain/documents/cases/case-validation.ts';
import { missingDirectAssertion } from '../../../src/domain/documents/cases/case-assertion-quality.ts';

const application = { apply_no: '202611030001', total_amount: '43.00', total_weight: '370.000' };
const goods = [
  { apply_no: application.apply_no, qty: 2, price: '14.00', subtotal: '28.00', unit_weight: '92.000', total_weight: '184.000' },
  { apply_no: application.apply_no, qty: 3, price: '5.00', subtotal: '15.00', unit_weight: '62.000', total_weight: '186.000' },
];
test('database checks use exact decimal sums, per-row values and nonempty joined records', () => {
  const [result] = checkDatabaseApplicationTotals([application], goods);
  assert.equal(result.amount, '43.00'); assert.equal(result.weightGrams, '370.000'); assert.equal(result.quantityTotal, 5);
  assert.equal(result.amountConsistent, true); assert.equal(result.weightConsistent, true);
  const [badPrice] = checkDatabaseApplicationTotals([application], [{ ...goods[0], subtotal: '29.00' }, goods[1]]);
  assert.equal(badPrice.amountConsistent, false); assert.equal(badPrice.weightConsistent, true);
  assert.equal(checkDatabaseApplicationTotals([application], [])[0].amountConsistent, false);
  assert.throws(() => checkDatabaseApplicationTotals([application], [{ ...goods[0], price: '14.001' }]), /精度/u);
  assert.throws(() => checkDatabaseApplicationTotals([application], [{ ...goods[0], qty: -1 }]), /数量/u);
});
test('only the explicitly bound department project and origin can query department evidence', () => {
  const p = { id: 'eaf7b01a-51a2-4e66-bb5e-37d662c4306c', targetUrl: 'https://cdn.yibentushu.com/test-sample-apply/#/home' };
  assert.equal(isDepartmentDatabaseTarget(p), true);
  assert.equal(isDepartmentDatabaseTarget({ ...p, id: 'other' }), false);
  assert.equal(isDepartmentDatabaseTarget({ ...p, targetUrl: 'https://evil.test/test-sample-apply/' }), false);
});

test('an actual multi-row database fixture opens only the two readonly detail checks and enforces numeric requirements', () => {
  const project = { id: 'eaf7b01a-51a2-4e66-bb5e-37d662c4306c', targetUrl: 'https://cdn.yibentushu.com/test-sample-apply/#/home' };
  const item = { id: 'case-75', confidence: 'medium', title: '多行样书明细', preconditions: [], testData: [], expected: 'original expectation' };
  const context = { databaseEvidence: { projectId: project.id, id: 'actual-read', capturedAt: new Date().toISOString(), applicationChecks: checkDatabaseApplicationTotals([application], goods), queries: [{ key: 'goods', rows: goods.map((row,i) => ({ ...row, product_id: '202260004' + (i+6) })) }] } };
  const bound = bindDepartmentDatabaseFixture(project, item, context);
  assert.equal(bound.expected, item.expected); assert.equal(bound.requiredAssertions, undefined);
  for (const value of ['28.00','15.00','43.00','0.37']) assert.ok(bound.testData.join(' ').includes(value));
  const complete = { ...bound, steps: ['2022600046','2022600047','28.00','15.00','43.00','0.37'].map(text=>({action:'assertText',text})) };
  const validated = validateCases([{ ...complete, kind:'visible',source:'original fixture requirement',requirementRefs:[],priority:'P1',category:'functional',coverageAreas:['functional'],selectedForRegression:true,preconditionsConfirmed:true,sideEffectRisk:'none',cleanup:'只读' }])[0];
  assert.equal(validated.expected,item.expected);
  assert.equal(missingDepartmentDatabaseFixtureAssertion(project,complete,context),undefined);
  assert.match(missingDepartmentDatabaseFixtureAssertion(project,{...complete,steps:complete.steps.slice(0,-1)},context),/0\.37/u);
  assert.equal(missingDepartmentDatabaseFixtureAssertion(project,{...complete,id:'case-50'},context),undefined);
  assert.equal(bindDepartmentDatabaseFixture(project, { ...item, id: 'case-50' }, context), undefined);
  assert.equal(bindDepartmentDatabaseFixture(project, { ...item, preconditions: ['必须切换审批人'], preconditionsConfirmed: false }, context), undefined);
  assert.equal(bindDepartmentDatabaseFixture(project, item, { databaseEvidence: { ...context.databaseEvidence, capturedAt: '2020-01-01T00:00:00Z' } }), undefined);
  assert.equal(bindDepartmentDatabaseFixture(project, item, { databaseEvidence: { ...context.databaseEvidence, applicationChecks: [] } }), undefined);
});
test('agent context supplies actual query evidence separately from connection status and preserves source failure', async () => {
  const evidence = { id: 'db-evidence', capturedAt: new Date().toISOString(), queries: [{ key: 'customers', rows: [{ agent_id: '129249', agent_type: '1004.00', is_valid: 0 }] }] };
  const reader = createDocumentAuthoringContextReader({ manifestPath: 'test-artifacts/no-such-db-authoring-manifest.json', databaseStatus: () => ({ connected: true }), databaseEvidence: async () => evidence });
  const context = await reader({ id: 'p', targetUrl: 'https://example.test/' }, { id: 'c' });
  assert.equal(context.database.resultEvidence, false, 'query observations do not count as a passed case');
  assert.deepEqual(context.databaseEvidence, evidence); assert.ok(context.warnings.length);
});
test('multiline totals, readonly controls and full submissions reject the known superficial assertions', () => {
  assert.match(missingDirectAssertion({ title: '多行样书明细逐行展示小计，总计=∑小计', expected: '总重正确', steps: [{ action: 'assertText', text: '总计：0.00' }] }), /数值断言/u);
  assert.match(missingDirectAssertion({ title: '页面纯只读，无编辑/提交/删除入口', expected: '只读', steps: [{ action: 'assertText', text: '小额样书申请' }] }), /均不存在/u);
  assert.match(missingDirectAssertion({ title: '全部必填完成，跳转并创建待审核记录', expected: '', steps: [{ action: 'assertControlEnabled', text: '提交申请' }] }), /单次提交证据/u);
});
