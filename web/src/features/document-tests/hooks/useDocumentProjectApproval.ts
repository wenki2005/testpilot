import type { Dispatch, SetStateAction } from 'react';
import { canSelectCaseForRun } from '../case-selection';
import { request } from '../api/client';
import type { Project, Run, RunScopePlan, StepProbeResult } from '../types';
export function useDocumentProjectApproval(input: {
    project: Project | undefined;
    targetUrl: string;
    notes: string;
    runMode: 'regression' | 'compare';
    effectiveScopePlan: RunScopePlan;
    siteVersionId?: string;
    baselineRunId: string;
    testDataSetId?: string;
    parameterValues: Record<string, string>;
    setProjects: Dispatch<SetStateAction<Project[]>>;
    setStepProbeResults: Dispatch<SetStateAction<Record<string, StepProbeResult>>>;
    setRun: Dispatch<SetStateAction<Run | null>>;
    setRunMode(value: 'regression' | 'compare'): void;
    setBusy(value: boolean): void;
    setError(message: string): void;
    setMessage(message: string): void;
    setActiveRunId(value: string): void;
    setCancelRequested(value: boolean): void;
    startRun(projectId: string, body: Record<string, unknown>, action?: 'start' | 'retest'): Promise<Run>;
    refreshRunHistory(projectId?: string): unknown;
}) {
    const approve = async () => {
        const { project } = input;
        if (!project)
            return;
        input.setBusy(true);
        input.setError('');
        try {
            await request<Project>(`/api/document-projects/${project.id}/update`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ cases: project.cases, ...(project.siteVersions?.length ? {} : { targetUrl: input.targetUrl }), apiContract: { ...project.apiContract, mappings: project.apiContract?.mappings ?? [], allowNetwork: project.apiContract?.allowNetwork === true } }),
            });
            const updated = await request<Project>(`/api/document-projects/${project.id}/review`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve', notes: input.notes }),
            });
            input.setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
            input.setStepProbeResults({});
            const selectedCaseIds = updated.cases.filter(item => canSelectCaseForRun(item) && item.selectedForRegression !== false).map(item => item.id);
            if (!selectedCaseIds.length)
                throw new Error('没有选中回归用例；请先选择至少一条再运行。');
            const selectedIds = new Set(selectedCaseIds);
            const targetCaseIds = input.effectiveScopePlan.targetCaseIds.filter(id => selectedIds.has(id));
            const impactCaseIds = input.effectiveScopePlan.impactCaseIds.filter(id => selectedIds.has(id) && !targetCaseIds.includes(id));
            const classifiedIds = new Set([...targetCaseIds, ...impactCaseIds]);
            targetCaseIds.push(...selectedCaseIds.filter(id => !classifiedIds.has(id)));
            const approvedScopePlan: RunScopePlan = {
                mode: impactCaseIds.length ? 'impact'
                    : input.effectiveScopePlan.mode === 'impact' ? targetCaseIds.length === 1 ? 'single' : 'feature'
                        : input.effectiveScopePlan.mode === 'single' && targetCaseIds.length !== 1 ? 'custom' : input.effectiveScopePlan.mode,
                targetCaseIds, impactCaseIds,
                ...(input.effectiveScopePlan.impactReasons ? { impactReasons: Object.fromEntries(Object.entries(input.effectiveScopePlan.impactReasons).filter(([id]) => impactCaseIds.includes(id))) } : {}),
            };
            input.setMessage(input.runMode === 'regression' ? '用例已审核，正在运行确定性常规回归…' : '用例已审核，正在运行 AI 辅助对照…');
            const result = await input.startRun(project.id, {
                runMode: input.runMode, selectedCaseIds, scopePlan: approvedScopePlan,
                ...(input.siteVersionId ? { siteVersionId: input.siteVersionId } : {}),
                ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
                ...(input.testDataSetId ? { testDataSetId: input.testDataSetId } : {}), parameterValues: input.parameterValues,
            });
            input.setRun(result);
            input.setRunMode(result.runMode ?? input.runMode);
            void input.refreshRunHistory(project.id);
            input.setMessage(result.overall === 'cancelled' ? '运行已停止；已完成的结果保留，取消或未运行用例可定向重跑。' : result.overall === 'passed' ? '本轮测试通过；报告和脚本包已生成。' : result.overall === 'failed' ? '本轮测试发现失败；已保留逐用例结果和证据。' : '本轮有未验证或阻塞项；已保留部分结果和证据。');
        }
        catch (error) {
            input.setError((error as Error).message);
        }
        finally {
            input.setBusy(false);
            input.setActiveRunId('');
            input.setCancelRequested(false);
        }
    };
    return { approve };
}
