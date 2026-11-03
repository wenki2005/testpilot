import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutonomousRegressionPlans, ExecutionStatusView, PlanCaseDetails, canAutoStartCreatedPlan, canStartAutonomousPlan } from '../web/src/features/document-tests/components/AutonomousRegressionPlans.tsx';

const project = { id: 'project-1', name: '回归项目', fileName: 'cases.md', format: 'markdown', targetUrl: 'https://example.test', cases: [], sourceText: '', siteVersions: [] };

test('自主回归计划面板用真实 React SSR 展示空版本约束', () => {
  const html = renderToStaticMarkup(React.createElement(AutonomousRegressionPlans, { project }));
  assert.match(html, /自主回归计划/);
  assert.match(html, /先登记并选择一个网站版本/);
  assert.match(html, /disabled=""/);
});

test('没有变更说明时 SSR 禁止创建计划', () => {
  const withVersion = { ...project, siteVersions: [{ id: 'v1', label: '版本一', environment: '测试', targetUrl: 'https://example.test', changeNotes: '  ', createdAt: '2026-10-31T00:00:00Z' }] };
  const html = renderToStaticMarkup(React.createElement(AutonomousRegressionPlans, { project: withVersion, version: withVersion.siteVersions[0] }));
  assert.match(html, /当前网站版本没有变更说明/);
  assert.match(html, /创建自主回归计划/);
  assert.match(html, /disabled=""/);
});

test('过期计划不能启动，execution record 不会重复显示启动入口', () => {
  const stale = { validation: 'stale', executionReadiness: 'blocked' };
  assert.equal(canStartAutonomousPlan(stale, null, false), false);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready' }, null, false, 'loading'), false);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready' }, null, false, 'unknown'), false);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready' }, null, false, 'absent'), true);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready' }, { state: 'submitted' }, false, 'present'), false);
  const html = renderToStaticMarkup(React.createElement(ExecutionStatusView, { projectId: 'project-1', execution: { state: 'submitted', runId: 'run-1', planId: 'plan-1', projectId: 'project-1' } }));
  assert.match(html, /查看运行结果/);
  assert.doesNotMatch(html, /按此计划启动回归/);
});

test('只有当前、就绪且有执行范围的新计划才允许自动提交，逐次确认项目必须手动确认', () => {
  const ready = { validation: 'current', executionReadiness: 'ready', plan: { outcome: 'selected', orderedCaseIds: ['case-1'] } };
  assert.equal(canAutoStartCreatedPlan(ready), true);
  assert.equal(canAutoStartCreatedPlan(ready, true), false);
  assert.equal(canAutoStartCreatedPlan({ ...ready, validation: 'stale' }), false);
  assert.equal(canAutoStartCreatedPlan({ ...ready, executionReadiness: 'blocked' }), false);
  assert.equal(canAutoStartCreatedPlan({ ...ready, plan: { outcome: 'needs-clarification', orderedCaseIds: ['case-1'] } }), false);
  assert.equal(canAutoStartCreatedPlan({ ...ready, plan: { outcome: 'no-relevant-cases', orderedCaseIds: [] } }), false);
  assert.equal(canAutoStartCreatedPlan({ ...ready, plan: { outcome: 'selected', orderedCaseIds: [] } }), false);
});

test('逐次确认项目 SSR 明确显示人工确认启动入口', () => {
  const confirmedProject = { ...project, confirmationRequired: true, siteVersions: [{ id: 'v1', label: '版本一', environment: '隔离测试', targetUrl: 'https://example.test', changeNotes: '更新列表文字', createdAt: '2026-11-02T00:00:00Z' }] };
  const html = renderToStaticMarkup(React.createElement(AutonomousRegressionPlans, { project: confirmedProject, version: confirmedProject.siteVersions[0] }));
  assert.match(html, /每次启动前由你确认本轮范围/);
});

test('真实 plan.decisions 格式 SSR 展示 selection、原因、quote 证据和前置用例', () => {
  const plan = {
    selectedCaseIds: ['case-main'], prerequisiteCaseIds: ['case-setup'], orderedCaseIds: ['case-setup', 'case-main'], execution: 'not-started',
    decisions: [{ caseId: 'case-main', reason: '变更影响结算确认流程', evidence: [
      { source: 'change-notes', quote: '更新结算确认' }, { source: 'case-title', quote: '确认结算' },
    ] }],
  };
  const projectWithCases = { ...project, cases: [
    { id: 'case-setup', title: '准备结算单' },
    { id: 'case-main', title: '确认结算', preconditions: ['结算单已生成'], preconditionsConfirmed: true },
  ] };
  const html = renderToStaticMarkup(React.createElement(PlanCaseDetails, { project: projectWithCases, plan }));
  assert.match(html, /case-setup · 前置用例/);
  assert.match(html, /影响推断（待人工复核）：变更影响结算确认流程/);
  assert.match(html, /依据（change-notes）：更新结算确认/);
  assert.match(html, /依据（case-title）：确认结算/);
  assert.match(html, /前置条件：结算单已生成（已确认）/);
});

test('无相关历史用例结论 SSR 显示规划状态、理由与原文，且不冒充测试结果', () => {
  const plan = {
    selectedCaseIds: [], prerequisiteCaseIds: [], orderedCaseIds: [], execution: 'not-started', decisions: [],
    outcome: 'no-relevant-cases', assessmentReason: '变更涉及新增导出格式，历史用例未覆盖该功能。',
    assessmentEvidence: [{ source: 'change-notes', quote: '新增 CSV 导出' }],
  };
  const html = renderToStaticMarkup(React.createElement(PlanCaseDetails, { project, plan }));
  assert.match(html, /未发现相关历史用例（规划判断，未执行测试）/);
  assert.match(html, /新增导出格式/);
  assert.match(html, /依据（change-notes）：新增 CSV 导出/);
  assert.match(html, /未匹配到可纳入本次回归的历史用例/);
  assert.doesNotMatch(html, /通过|测试完成/);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready', plan }, null, false, 'absent'), false);
});

test('需要补充资料结论 SSR 展示理由和引用，并阻止启动', () => {
  const plan = {
    selectedCaseIds: [], prerequisiteCaseIds: [], orderedCaseIds: [], execution: 'not-started', decisions: [],
    outcome: 'needs-clarification', assessmentReason: '变更说明未指明受影响的用户流程。',
    assessmentEvidence: [{ source: 'change-notes', quote: '优化体验' }],
  };
  const html = renderToStaticMarkup(React.createElement(PlanCaseDetails, { project, plan }));
  assert.match(html, /信息不足，需要补充资料/);
  assert.match(html, /变更说明未指明受影响的用户流程/);
  assert.match(html, /依据（change-notes）：优化体验/);
  assert.match(html, /补充变更范围或相关资料/);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready', plan }, null, false, 'absent'), false);
});

test('旧计划没有 outcome 时按 selected 处理并保留启动资格', () => {
  const plan = { selectedCaseIds: [], prerequisiteCaseIds: [], orderedCaseIds: [], execution: 'not-started', decisions: [] };
  const html = renderToStaticMarkup(React.createElement(PlanCaseDetails, { project, plan }));
  assert.match(html, /计划暂未纳入历史用例/);
  assert.doesNotMatch(html, /未发现相关历史用例|信息不足，需要补充资料/);
  assert.equal(canStartAutonomousPlan({ validation: 'current', executionReadiness: 'ready', plan }, null, false, 'absent'), true);
});

test('uncertain 状态明确提示待核查且不显示启动或自动重试入口', () => {
  const html = renderToStaticMarkup(React.createElement(ExecutionStatusView, { projectId: 'project-1', execution: { state: 'uncertain', runId: 'run-1', planId: 'plan-1', projectId: 'project-1' } }));
  assert.match(html, /提交状态待核查，不会自动重试/);
  assert.match(html, /核查提交状态/);
  assert.doesNotMatch(html, /按此计划启动回归|重新启动|重试启动/);
});
