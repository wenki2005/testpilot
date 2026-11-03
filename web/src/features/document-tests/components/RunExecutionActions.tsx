import type { Project } from '../types';
import { canSelectCaseForRun } from '../case-selection';

interface RunExecutionActionsProps {
  project: Project;
  busy: boolean;
  activeRunId: string;
  cancelRequested: boolean;
  pauseRequested: boolean;
  selectedCaseCount: number;
  runMode: 'regression' | 'compare';
  computerUseAvailable: boolean;
  computerUseReason: string;
  computerUseModel: string;
  modelAvailable: boolean;
  stepDrafts: Record<string, string>;
  onCancel(): void;
  onPause(): void;
  onContinue(): void;
  onSave(): void;
  onApprove(): void;
  onExecute(): void;
}

export function RunExecutionActions({
  project, busy, activeRunId, cancelRequested, pauseRequested, selectedCaseCount,
  runMode, computerUseAvailable, computerUseReason, computerUseModel, modelAvailable,
  stepDrafts, onCancel, onPause, onContinue, onSave, onApprove, onExecute,
}: RunExecutionActionsProps) {
  const hasUnresolvedExpected = project.cases.some(item =>
    (!item.expected.trim() || item.expected.startsWith('[请在') || item.expected.startsWith('[需澄清]'))
    && canSelectCaseForRun(item) && item.selectedForRegression !== false
    && !(item.steps ?? []).some(step => ['assertText', 'assertVisible', 'assertExactVisible', 'assertRoleVisible', 'assertValue', 'assertDisabled'].includes(step.action)));
  const hasInvalidStepDrafts = project.cases.some(item => {
    try { return canSelectCaseForRun(item) && item.selectedForRegression !== false && !Array.isArray(JSON.parse(stepDrafts[item.id] ?? JSON.stringify(item.steps))); }
    catch { return canSelectCaseForRun(item) && item.selectedForRegression !== false; }
  });
  const modeLabel = runMode === 'regression' ? '运行' : '对照';
  const compareUnavailable = runMode === 'compare' && !computerUseAvailable;
  const cannotApprove = busy || !selectedCaseCount || hasUnresolvedExpected || hasInvalidStepDrafts || compareUnavailable;
  const cannotExecute = busy || !selectedCaseCount || compareUnavailable;

  return <>
    <div className="doc-buttons">
      {busy && activeRunId && <>
        <button className="button-secondary" disabled={cancelRequested} onClick={onCancel}>{cancelRequested ? '正在停止…' : '中断当前运行'}</button>
        {pauseRequested
          ? <button className="button-secondary" disabled={cancelRequested} onClick={onContinue}>继续运行</button>
          : <button className="button-secondary" disabled={cancelRequested} onClick={onPause}>暂停运行</button>}
      </>}
      <button className="button-secondary" disabled={busy} onClick={onSave}>保存修改</button>
      {project.reviewStatus !== 'approved'
        ? <button className="button-primary" disabled={cannotApprove} title={compareUnavailable ? computerUseReason : undefined} onClick={onApprove}>{runMode === 'regression' ? `审核并运行所选范围（${selectedCaseCount}）` : `审核并对照所选范围（${selectedCaseCount}）`}</button>
        : <button className="button-primary" disabled={cannotExecute} title={compareUnavailable ? computerUseReason : undefined} onClick={onExecute}>{modeLabel}所选范围（{selectedCaseCount}）</button>}
    </div>
    <small className="doc-run-scope-note">当前勾选只用于本轮运行；如需改变以后默认选择，再点“保存修改”。</small>
    <small>手动启动；已有步骤直接复跑；缺少步骤时可由模型补全。Edge 复用登录态，高影响操作会拦截。{runMode === 'compare' ? computerUseAvailable ? ` 已配置：${computerUseModel}。` : ` 当前不可用：${computerUseReason}` : ''} {modelAvailable ? '模型已配置。' : '尚未配置模型密钥。'}</small>
  </>;
}
