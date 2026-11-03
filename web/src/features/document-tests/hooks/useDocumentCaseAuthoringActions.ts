import type { Dispatch, SetStateAction } from 'react';
import { request } from '../api/client';
import type { Check, Project, SiteVersion, StepProbeResult } from '../types';

export function useDocumentCaseAuthoringActions(input: {
  project: Project | undefined;
  targetUrl: string;
  blockedCaseIds: string[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setStepDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setStepProbeResults: Dispatch<SetStateAction<Record<string, StepProbeResult>>>;
  setRun: Dispatch<SetStateAction<import('../types').Run | null>>;
  setBusy(value: boolean): void;
  setError(message: string): void;
  setMessage(message: string): void;
  refreshProjectRevisions(projectId?: string, offset?: number, append?: boolean): Promise<unknown>;
}) {
  const { project, targetUrl, blockedCaseIds, setProjects, setStepDrafts, setStepProbeResults, setRun, setBusy, setError, setMessage, refreshProjectRevisions } = input;

  const saveDraft = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/update`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cases: project.cases, ...((project.siteVersions?.length ?? 0) === 0 ? { targetUrl } : {}), apiContract: { ...project.apiContract, mappings: project.apiContract?.mappings ?? [], allowNetwork: project.apiContract?.allowNetwork === true } }),
      });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setStepProbeResults({}); void refreshProjectRevisions(updated.id, 0, false); setMessage('用例与 API 映射草稿已保存。');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  const createIterationCaseDraft = async (version: SiteVersion | undefined) => {
    if (!project || !version || !version.changeNotes.trim()) return;
    const noteSummary = version.changeNotes.trim().replace(/\s+/gu, ' ').slice(0, 54);
    const item: Check = {
      id: `iteration-${crypto.randomUUID()}`, title: `待补充：${noteSummary}`,
      source: `网站版本 ${version.label} 的迭代说明`, modulePath: [], requirementRefs: [`网站版本：${version.label}`, version.changeNotes.slice(0, 500)],
      priority: 'P2', category: 'functional', confidence: 'low', coverageAreas: ['functional'], lifecycleStatus: 'draft',
      selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'unknown',
      cleanup: '', caseOrigin: 'iteration-impact-draft', kind: 'visible', expected: '', steps: [],
    };
    setBusy(true); setError(''); setMessage('正在保存迭代用例草稿…');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/update`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: [...project.cases, item] }),
      });
      setProjects(rows => rows.map(row => row.id === updated.id ? updated : row));
      setStepDrafts(current => ({ ...current, [item.id]: '[]' })); setRun(null);
      setMessage('迭代用例草稿已保存，处于未选中、待补步骤和预期的状态，不会参与本轮运行。');
    } catch (error) { setError((error as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };

  const generateCases = async () => {
    if (!project) return;
    setBusy(true); setError(''); setMessage('正在按需求文档整理候选，并读取目标页当前可见文字与控件用于页面探索；不会自动登录或触发页面操作。');
    try {
      const updated = await request<Project>(`/api/document-projects/${project.id}/generate-cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setStepDrafts(Object.fromEntries(updated.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)])));
      setRun(null); setMessage(updated.generationWarning ? `已生成 ${updated.cases.length} 条候选用例。${updated.generationWarning}` : `已生成 ${updated.cases.length} 条候选；请复核步骤和前置条件，再手动启动回归。`);
    } catch (error) { setError((error as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };

  const repairBlockedCases = async () => {
    if (!project || !blockedCaseIds.length) return;
    setBusy(true); setError(''); setMessage('Agent 正在读取阻塞原因，并尝试修订可由页面证据支持的步骤…');
    try {
      const result = await request<{ project: Project; attemptedCaseIds: string[]; repairedCaseIds: string[]; blockedCaseIds: string[]; regressionStarted: false }>(`/api/document-projects/${project.id}/repair-steps`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds: blockedCaseIds }),
      });
      setProjects(rows => rows.map(item => item.id === result.project.id ? result.project : item));
      setStepDrafts(Object.fromEntries(result.project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)]))); setRun(null);
      setMessage(result.repairedCaseIds.length
        ? `Agent 修订了 ${result.repairedCaseIds.length} 条用例步骤，已保存为未选中的草稿；请逐条复核、补齐前置条件并重新审核。仍有 ${result.blockedCaseIds.length} 条阻塞，原因见对应卡片。没有启动回归测试。`
        : result.attemptedCaseIds.length
          ? `Agent 已尝试复查 ${result.attemptedCaseIds.length} 条阻塞用例，但没有找到通过校验的修订；未修改用例，也没有启动回归测试。其余用例未交给 Agent，因为验收标准或页面证据不足。请按逐条提示补充信息。`
          : `这些用例未交给 Agent，因为验收标准或页面证据不足；未修改用例，也没有启动回归测试。请按逐条提示补充页面入口、控件或验收标准。`);
    } catch (error) { setError((error as Error).message); setMessage(''); }
    finally { setBusy(false); }
  };

  return { saveDraft, createIterationCaseDraft, generateCases, repairBlockedCases };
}
