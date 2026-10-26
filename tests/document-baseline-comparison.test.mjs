import test from 'node:test';
import assert from 'node:assert/strict';
import { compareDocumentRunToBaseline, isDocumentBaselineEligible } from '../dist/adapters/document-test-workflow.js';

function run({
  id,
  statuses,
  selected = Object.keys(statuses),
  versions = Object.fromEntries(Object.keys(statuses).map(caseId => [caseId, 'same-revision'])),
  mode = 'regression',
  overall = 'passed',
  finalReady = true,
} = {}) {
  return {
    id,
    projectId: 'project-1',
    runMode: mode,
    startedAt: '2026-10-21T08:00:00.000Z',
    completedAt: '2026-10-21T08:01:00.000Z',
    caseScopeKnown: true,
    caseScope: { selectedCaseIds: selected, excludedCaseIds: [], totalCases: Object.keys(versions).length },
    caseVersions: versions,
    caseTitles: Object.fromEntries(Object.keys(versions).map(caseId => [caseId, `Title ${caseId}`])),
    caseVersion: 'project-revision',
    finalReady,
    overall,
    comparisons: Object.entries(statuses).map(([id, value]) => typeof value === 'string'
      ? { id, title: `Title ${id}`, deterministic: value, computerUse: 'not-applicable', aligned: value === 'passed' || value === 'failed', resolution: value === 'passed' || value === 'failed' ? 'aligned' : 'unresolved', issue: '' }
      : { id, title: `Title ${id}`, ...value, issue: '' }),
  };
}

function disposition(current, baseline, caseId) {
  return compareDocumentRunToBaseline(current, baseline).find(item => item.caseId === caseId);
}

test('baseline comparison classifies stable pass/fail changes and changed cases', () => {
  const baseline = run({ id: 'baseline', statuses: { stable: 'passed', fixed: 'failed', changed: 'passed' } });
  const current = run({ id: 'current', overall: 'failed', statuses: { stable: 'failed', fixed: 'passed', changed: 'passed' }, versions: { stable: 'same-revision', fixed: 'same-revision', changed: 'revision-2' } });

  assert.equal(disposition(current, baseline, 'stable').disposition, 'regression');
  assert.equal(disposition(current, baseline, 'fixed').disposition, 'fixed');
  assert.equal(disposition(current, baseline, 'changed').disposition, 'case-changed');
});

test('baseline comparison identifies added, removed, unselected, missing-baseline, and unresolved cases', () => {
  const baseline = run({ id: 'baseline', statuses: { removed: 'passed', notSelected: 'passed', missingResult: 'passed', unresolved: 'passed' } });
  const current = run({
    id: 'current',
    overall: 'unresolved',
    selected: ['added', 'missingResult', 'unresolved'],
    versions: { added: 'new', notSelected: 'same-revision', missingResult: 'same-revision', unresolved: 'same-revision' },
    statuses: {
      added: 'passed',
      missingResult: 'passed',
      unresolved: { deterministic: 'blocked', computerUse: 'not-applicable', aligned: false, resolution: 'unresolved' },
    },
  });
  const baselineNotSelected = run({ id: 'baseline-unselected', selected: [], statuses: { noBaseline: 'passed' } });
  const currentMissingBaselineResult = run({ id: 'current-missing', statuses: { noBaseline: 'passed' } });

  assert.equal(disposition(current, baseline, 'removed').disposition, 'removed');
  assert.equal(disposition(current, baseline, 'notSelected').disposition, 'not-run');
  assert.equal(disposition(currentMissingBaselineResult, baselineNotSelected, 'noBaseline').disposition, 'no-baseline-result');
  assert.equal(disposition(current, baseline, 'unresolved').disposition, 'unresolved');
});

test('compare-mode results need aligned deterministic and visual outcomes to serve as a baseline', () => {
  const baseline = run({
    id: 'baseline', mode: 'compare', finalReady: false, statuses: {
      aligned: { deterministic: 'passed', computerUse: 'passed', aligned: true, resolution: 'aligned' },
      disagreement: { deterministic: 'passed', computerUse: 'failed', aligned: false, resolution: 'mismatch' },
    },
  });
  const current = run({
    id: 'current', mode: 'compare', statuses: {
      aligned: { deterministic: 'failed', computerUse: 'failed', aligned: true, resolution: 'aligned' },
      disagreement: { deterministic: 'passed', computerUse: 'passed', aligned: true, resolution: 'aligned' },
    }, overall: 'failed',
  });

  assert.equal(disposition(current, baseline, 'aligned').disposition, 'regression');
  assert.equal(disposition(current, baseline, 'disagreement').disposition, 'unresolved');
  assert.equal(isDocumentBaselineEligible(baseline), false);
});

test('baseline eligibility requires completed, fixed-scope and settled execution outcomes', () => {
  const clean = run({ id: 'clean', statuses: { one: 'passed' } });
  assert.equal(isDocumentBaselineEligible(clean), true);
  assert.equal(isDocumentBaselineEligible(run({ id: 'cancelled', statuses: { one: 'passed' }, overall: 'cancelled' })), false);
  assert.equal(isDocumentBaselineEligible(run({ id: 'unresolved', statuses: { one: 'blocked' }, overall: 'unresolved' })), false);
  assert.equal(isDocumentBaselineEligible({ ...clean, caseScopeKnown: false }), false);
  assert.equal(isDocumentBaselineEligible({ ...clean, caseVersion: undefined }), false);
});

test('normal API-only regression cases provide stable outcomes for baseline eligibility and comparison', () => {
  const apiRun = run({
    id: 'api-baseline',
    statuses: {
      apiCase: { deterministic: 'not-applicable', computerUse: 'not-applicable', apiContract: 'passed', aligned: true, resolution: 'aligned' },
    },
  });
  const apiRegression = run({
    id: 'api-current',
    overall: 'failed',
    statuses: {
      apiCase: { deterministic: 'not-applicable', computerUse: 'not-applicable', apiContract: 'failed', aligned: false, resolution: 'unresolved' },
    },
  });

  assert.equal(isDocumentBaselineEligible(apiRun), true);
  assert.equal(disposition(apiRegression, apiRun, 'apiCase').baselineStatus, 'passed');
  assert.equal(disposition(apiRegression, apiRun, 'apiCase').currentStatus, 'failed');
  assert.equal(disposition(apiRegression, apiRun, 'apiCase').disposition, 'regression');
});

test('runs from different projects cannot be compared', () => {
  const current = run({ id: 'current', statuses: { one: 'passed' } });
  const baseline = { ...run({ id: 'baseline', statuses: { one: 'passed' } }), projectId: 'another-project' };
  assert.throws(() => compareDocumentRunToBaseline(current, baseline), /same test project/u);
});
