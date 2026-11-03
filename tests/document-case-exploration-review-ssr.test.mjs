import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentCaseEditorList } from '../web/src/features/document-tests/components/DocumentCaseEditorList.tsx';

const result = (extra = {}) => ({ caseId: 'draft-1', status: 'partial', stepCount: 0, detail: 'Candidate requires human review.', pageEvidence: { sha256: 'a'.repeat(64), capturedAt: '2026-11-02T00:00:00.000Z', route: '/home', matchedLocators: [], pages: [{ evidenceId: 'page-home', sha256: 'b'.repeat(64), capturedAt: '2026-11-02T00:00:00.000Z', route: '/home', matchedLocators: [] }], ...extra } });

function render(stepResult) {
  return renderToStaticMarkup(React.createElement(DocumentCaseEditorList, {
    project: { id: 'p', reviewStatus: 'draft', cases: [{ id: 'draft-1', title: 'Draft', source: 'Synthetic requirement', expected: 'Pending confirmation', kind: 'visible', steps: [], lifecycleStatus: 'draft', selectedForRegression: false }], stepAuthoring: { generatedAt: '2026-11-02T00:00:00.000Z', results: [stepResult] } },
    scope: { targetCaseIds: [], impactCaseIds: [] }, busy: false, onRunCase: () => {}, stepDrafts: {}, probeBusyKey: '', probeResults: {},
    cases: { toggleSelection: () => {}, selectOnly: () => {}, remove: () => {}, edit: () => {}, editList: () => {}, setTestDataRequirements: () => {}, setLifecycle: () => {}, confirmPreconditions: () => {}, editSteps: () => {} },
    steps: { update: () => {}, change: () => {}, add: () => {}, remove: () => {}, move: () => {}, probe: async () => {} },
  }));
}

test('review UI shows stored exploration trace with evidence ids and exact followed link', () => {
  const html = render(result({ explorationStatus: 'stopped', decisionTrace: [
    { sequence: 1, decision: 'follow-link', inputEvidenceIds: ['evidence-home'], latestEvidenceId: 'evidence-home', linkIndex: 0, selectedLabel: 'Orders', selectedPath: '/orders', resultingEvidenceId: 'evidence-orders', status: 'followed' },
    { sequence: 2, decision: 'stop', inputEvidenceIds: ['evidence-home', 'evidence-orders'], latestEvidenceId: 'evidence-orders', reason: 'No more in-scope links.', status: 'stopped' },
  ] }));
  assert.match(html, /AI 页面探索决策复核/);
  assert.match(html, /跟随第 1 个可见链接「Orders」/);
  assert.match(html, /evidence-home/);
  assert.match(html, /evidence-orders/);
  assert.match(html, /No more in-scope links/);
  assert.match(html, /不代表穷尽/);
  assert.match(html, /草稿/);
});

test('legacy trace-less evidence is visibly marked incomplete and unknown', () => {
  const html = render(result());
  assert.match(html, /旧版证据未保存 AI 决策轨迹，探索完整性未知/);
});

test('review UI renders a pre-page blocked exploration with its empty bounded trace', () => {
  const blocked = { ...result(), status: 'blocked', pageEvidence: {
    sha256: 'c'.repeat(64), capturedAt: '2026-11-02T00:00:00.000Z', route: '', matchedLocators: [], pages: [],
    explorationStatus: 'incomplete', decisionTrace: [{ sequence: 1, decision: 'incomplete', inputEvidenceIds: [], reason: 'Initial page capture failed; no page evidence was collected.', status: 'incomplete' }],
  } };
  const html = render(blocked);
  assert.match(html, /步骤状态：阻塞/);
  assert.match(html, /探索未完成，候选需人工复核/);
  assert.match(html, /Initial page capture failed/);
  assert.match(html, /路径未记录/);
  assert.match(html, /0 个定位器/);
  assert.doesNotMatch(html, /evidenceId|当前证据|输入证据/);
});
