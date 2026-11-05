import type { Dispatch, SetStateAction } from 'react';
import type { LoginHandoff, Project, Recovery, Run, RunScopePlan } from '../types';
import { request } from '../api/client';
type StartRun = (projectId: string, body: Record<string, unknown>, action?: 'start' | 'retest' | 'checkpoint-retry') => Promise<Run>;
/** Owns user commands that resume, cancel, finalize, or retest document-test runs. */
export function useDocumentRunActions(input: {
    project?: Project;
    run: Run | null;
    recovery: Recovery | null;
    retestCaseIds: string[];
    selectedCaseIds: string[];
    runMode: 'regression' | 'compare';
    effectiveScopePlan: RunScopePlan;
    selectedSiteVersionId?: string;
    baselineRunId: string;
    testDataSetId?: string;
    parameterValues: Record<string, string>;
    activeRunId: string;
    cancelRequested: boolean;
    pauseRequested: boolean;
    setRun: Dispatch<SetStateAction<Run | null>>;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setError: Dispatch<SetStateAction<string>>;
    setMessage: Dispatch<SetStateAction<string>>;
    setRunMode: Dispatch<SetStateAction<'regression' | 'compare'>>;
    setActiveRunId: Dispatch<SetStateAction<string>>;
    setCancelRequested: Dispatch<SetStateAction<boolean>>;
    setPauseRequested: Dispatch<SetStateAction<boolean>>;
    setRecovery: Dispatch<SetStateAction<Recovery | null>>;
    setLoginHandoff: Dispatch<SetStateAction<LoginHandoff | null>>;
    startRun: StartRun;
    refreshRunHistory(projectId?: string): void;
}) {
    const execute = async () => {
        const { project } = input;
        if (!project)
            return;
        input.setBusy(true);
        input.setError('');
        input.setMessage(input.runMode === 'regression' ? '正在运行确定性常规回归…' : '正在运行确定性脚本与视觉 Computer Use 对照…');
        try {
            if (!input.selectedCaseIds.length)
                throw new Error('没有选中回归用例；请选择至少一条。');
            const result = await input.startRun(project.id, {
                runMode: input.runMode, selectedCaseIds: input.selectedCaseIds, scopePlan: input.effectiveScopePlan,
                ...(input.selectedSiteVersionId ? { siteVersionId: input.selectedSiteVersionId } : {}),
                ...(input.baselineRunId ? { baselineRunId: input.baselineRunId } : {}),
                ...(input.testDataSetId ? { testDataSetId: input.testDataSetId } : {}), parameterValues: input.parameterValues,
            });
            input.setRun(result);
            input.setRunMode(result.runMode ?? input.runMode);
            input.refreshRunHistory(project.id);
            input.setMessage(result.overall === 'cancelled' ? '运行已停止；已完成的结果保留，取消或未运行用例可定向重跑。' : result.overall === 'passed' ? '本轮测试通过；报告和脚本包已生成。' : result.overall === 'failed' ? '本轮测试发现失败；已保留逐用例结果和证据。' : '本轮有未验证或阻塞项；已保留部分结果和证据。');
        }
        catch (error) {
            input.setError((error as Error).message);
            input.setMessage('');
        }
        finally {
            input.setBusy(false);
            input.setActiveRunId('');
            input.setCancelRequested(false);
        }
    };
    const retestUnresolved = async () => {
        const { project, run } = input;
        if (!project || !run || !input.retestCaseIds.length)
            return;
        input.setBusy(true);
        input.setError('');
        try {
            input.setMessage(`正在安全校验并定向重测 ${input.retestCaseIds.length} 条差异或未验证用例…`);
            const result = await input.startRun(project.id, { parentRunId: run.id, caseIds: input.retestCaseIds, runMode: run.runMode ?? 'compare', notes: '依据父运行差异/未验证/失败诊断进行定向重测；保留原用例与预期。' }, 'retest');
            input.setRun(result);
            input.setMessage(result.finalReady ? '定向重测完成；结果已与父运行关联，报告和脚本包已更新。' : '定向重测仍有未对齐项；父运行关系和逐用例证据已写入报告。');
        }
        catch (error) {
            input.setError((error as Error).message);
            input.setMessage('');
        }
        finally {
            input.setBusy(false);
            input.setActiveRunId('');
            input.setCancelRequested(false);
        }
    };
    const retryCheckpoint = async (caseId: string, stepIndex: number, adviceRecordId?: string) => {
        const { project, run } = input;
        if (!project || !run || input.activeRunId)
            return;
        input.setBusy(true);
        input.setError('');
        input.setMessage('正在从历史检查点建立新运行：重建只读前置，并从当前用例起点验证，保留原失败记录。');
        try {
            const result = await input.startRun(project.id, { parentRunId: run.id, caseId, stepIndex, ...(adviceRecordId ? { adviceRecordId } : {}) }, 'checkpoint-retry');
            input.setRun(result);
            input.refreshRunHistory(project.id);
            input.setMessage('检查点恢复已结束；这是关联父运行的新尝试，原始失败和截图仍可在历史中查看。');
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
    const resumeInterrupted = async () => {
        const { project, recovery } = input;
        if (!project || !recovery?.canResume)
            return;
        input.setBusy(true);
        input.setError('');
        input.setMessage('正在复用上次浏览器会话，跳过已完成用例并检查中断项的副作用风险…');
        input.setActiveRunId(recovery.runId);
        try {
            const result = await request<Run>(`/api/document-projects/${project.id}/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: recovery.runId }) });
            input.setRun(result);
            input.setRecovery(null);
            input.setMessage(result.finalReady ? '恢复运行完成，两侧结果已对齐；报告和脚本包已生成。' : '恢复运行完成，但存在未对齐项；请查看部分报告与逐用例结果。');
        }
        catch (error) {
            input.setError((error as Error).message);
            input.setMessage('');
        }
        finally {
            input.setBusy(false);
            input.setActiveRunId('');
            input.setCancelRequested(false);
        }
    };
    const finalizeInterruptedPackage = async () => {
        const { project, recovery } = input;
        if (!project || !recovery?.canFinalizePackage)
            return;
        input.setBusy(true);
        input.setError('');
        input.setMessage('正在使用已保存的执行结果重试报告与脚本包；不会重新打开目标网站。');
        try {
            const result = await request<Run>(`/api/document-runs/${encodeURIComponent(recovery.runId)}/finalize-package`, { method: 'POST' });
            input.setRun(result);
            input.setRecovery(null);
            input.refreshRunHistory(project.id);
            input.setMessage('报告和脚本包已从保存的执行快照完成；本次没有重跑用例。');
        }
        catch (error) {
            input.setError((error as Error).message);
            input.setMessage('');
        }
        finally {
            input.setBusy(false);
        }
    };
    const cancelRun = async () => {
        if (!input.activeRunId || input.cancelRequested)
            return;
        input.setCancelRequested(true);
        input.setMessage('正在请求停止当前运行并保存部分结果…');
        try {
            const outcome = await request<{
                status: string;
            }>(`/api/document-runs/${encodeURIComponent(input.activeRunId)}/cancel`, { method: 'POST' });
            input.setMessage(outcome.status === 'requested' ? '已请求停止；正在保存停止前的结果…' : '用例执行已结束，正在完成报告。');
        }
        catch (error) {
            input.setCancelRequested(false);
            input.setError((error as Error).message);
        }
    };
    const pauseRun = async () => {
        if (!input.activeRunId || input.pauseRequested)
            return;
        try {
            const outcome = await request<{
                status: string;
                message?: string;
            }>(`/api/document-runs/${encodeURIComponent(input.activeRunId)}/pause`, { method: 'POST' });
            if (outcome.status === 'requested' || outcome.status === 'already-paused') {
                input.setPauseRequested(true);
                input.setMessage(outcome.message || '已请求暂停；当前浏览器步骤安全完成后会停住。');
            }
        }
        catch (error) {
            input.setError((error as Error).message);
        }
    };
    const continuePausedRun = async () => {
        if (!input.activeRunId)
            return;
        try {
            await request<{
                status: string;
            }>(`/api/document-runs/${encodeURIComponent(input.activeRunId)}/continue`, { method: 'POST' });
            input.setPauseRequested(false);
            input.setMessage('运行已从当前浏览器页面会话继续。');
        }
        catch (error) {
            input.setError((error as Error).message);
        }
    };
    const continueAfterLogin = async () => {
        const { project } = input;
        if (!project)
            return;
        try {
            const state = await request<LoginHandoff>(`/api/document-projects/${project.id}/login/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            input.setLoginHandoff(state);
            input.setMessage('收到确认，测试 Agent 正在恢复当前运行…');
        }
        catch (error) {
            input.setError((error as Error).message);
        }
    };
    return { retryCheckpoint, execute, retestUnresolved, resumeInterrupted, finalizeInterruptedPackage, cancelRun, pauseRun, continuePausedRun, continueAfterLogin };
}
