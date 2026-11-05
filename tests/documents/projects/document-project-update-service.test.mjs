import assert from 'node:assert/strict';
import test from 'node:test';

test('case order conflicts fail before saving or replacing the existing case array',async()=>{
 const {createDocumentProjectUpdateService}=await import('../../../dist/application/projects/document-project-update-service.js');
 let saves=0;
 const service=createDocumentProjectUpdateService({projects:{saveProject:async()=>{saves++;}},validateTarget:v=>v,validateCases:v=>v,containsCredentialLikeValue:()=>false,requiresManualReview:()=>true,hasAutoRunnableSelectedCase:()=>false,now:()=>new Date().toISOString()});
 const cases=[{id:'before'},{id:'after',dependsOnCaseIds:['before']}];
 const project={id:'order-check',cases,reviewStatus:'draft'};
 await assert.rejects(service.update(project,{cases:[cases[1],cases[0]]}),/前置/);
 assert.equal(project.cases,cases); assert.equal(saves,0);
 const inserted={id:'new',lifecycleStatus:'draft',selectedForRegression:false};
 const saved=await service.update(project,{cases:[cases[0],inserted,cases[1]]});
 assert.deepEqual(saved.cases.map(c=>c.id),['before','new','after']);
 assert.equal(saved.cases[1].lifecycleStatus,'draft');assert.equal(saves,1);
});

test('saving data on a draft project does not approve its existing runnable cases', async () => {
  const { createDocumentProjectUpdateService } = await import('../../../dist/application/projects/document-project-update-service.js');
  const service = createDocumentProjectUpdateService({
    projects: { saveProject: async () => {} }, validateTarget: value => value,
    validateCases: value => value, containsCredentialLikeValue: () => false,
    requiresManualReview: () => false, hasAutoRunnableSelectedCase: () => true,
    now: () => '2026-11-02T00:00:00.000Z',
  });
  const project = { id: 'draft-data', targetUrl: 'http://127.0.0.1:1', reviewStatus: 'draft', reviewNotes: 'PC template still needs review', cases: [{ id: 'ready-case', lifecycleStatus: 'runnable', selectedForRegression: true }] };
  const datasets = [{ id: '11111111-1111-4111-8111-111111111111', name: 'incomplete', values: { count: '2' } }];
  const saved = await service.update(project, { testDataSets: datasets });
  assert.equal(saved.reviewStatus, 'draft');
  assert.equal(saved.reviewNotes, 'PC template still needs review');
  assert.equal(saved.testDataSets[0].values.count, '2');
  const caseUpdated = await service.update(saved, { cases: saved.cases });
  assert.equal(caseUpdated.reviewStatus, 'approved', 'explicit case updates retain existing reduced-confirmation policy');
});

test('project update service keeps safe test data, approved mappings and review gates', async () => {
  const { createDocumentProjectUpdateService } = await import('../../../dist/application/projects/document-project-update-service.js');
  const project = {
    id: 'project-1', targetUrl: 'http://127.0.0.1:4317/v1',
    siteVersions: [{ id: 'v1', targetUrl: 'http://127.0.0.1:4317/v1' }],
    cases: [{ id: 'case-1', title: 'existing' }], reviewStatus: 'approved', reviewNotes: 'previous',
    testDataSets: [{ id: '11111111-1111-4111-8111-111111111111', name: 'valid data', values: { count: '1' }, createdAt: 'created', updatedAt: 'old' }],
  };
  let saved = 0;
  const service = createDocumentProjectUpdateService({
    projects: { saveProject: async () => { saved += 1; } },
    validateTarget: value => new URL(value).href,
    validateCases: value => value,
    containsCredentialLikeValue: value => /bearer|cookie/iu.test(value),
    requiresManualReview: candidate => candidate.apiContract?.allowMutations === true,
    hasAutoRunnableSelectedCase: () => true,
    now: () => '2026-10-28T03:00:00.000Z',
  });
  const updated = await service.update(project, {
    testDataSets: [
      { id: project.testDataSets[0].id, name: 'valid data', values: { count: '2' }, createdAt: 'caller', updatedAt: 'caller' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'second data', values: { region: 'north' } },
    ],
    apiContract: { suiteId: '33333333-3333-4333-8333-333333333333', allowMutations: true, mappings: [{ documentCaseId: 'case-1', apiCaseIds: ['get-item'] }] },
  });
  assert.equal(saved, 1);
  assert.deepEqual(updated.testDataSets[0], { id: project.testDataSets[0].id, name: 'valid data', values: { count: '2' }, createdAt: 'created', updatedAt: '2026-10-28T03:00:00.000Z' });
  assert.equal(updated.testDataSets[1].createdAt, '2026-10-28T03:00:00.000Z');
  assert.equal(updated.apiContract.allowMutations, true);
  assert.equal(updated.apiContract.mappings[0].apiCaseIds[0], 'get-item');
  assert.equal(updated.reviewStatus, 'draft', 'new mutation authorization requires manual review');
  assert.equal(updated.reviewNotes, '');
  await assert.rejects(() => service.update(project, { targetUrl: 'http://127.0.0.1:4317/v2' }), /请登记一个新版本/u);
  await assert.rejects(() => service.update(project, { testDataSets: [{ id: '44444444-4444-4444-8444-444444444444', name: 'unsafe', values: { token: 'fake' } }] }), /无效或敏感参数/u);
  await assert.rejects(() => service.update(project, { testDataSets: [{ id: '55555555-5555-4555-8555-555555555555', name: 'unsafe', values: { session: 'Bearer synthetic-placeholder' } }] }), /疑似含有令牌/u);
  assert.equal(saved, 1);
});
