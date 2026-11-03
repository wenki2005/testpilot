import React, { useEffect, useRef, useState } from 'react';
import { controlAutomaticRecoveryChild } from '../api/automatic-recovery-control';

export type AutomaticRecoveryStatus = { enabled: boolean; policyVersion: number; state: string; reason?: string; overall?: string; record?: { childRunId: string };
  progress?: { runId: string; status: string; stage: string; cancelRequested?: boolean; currentCase?: { id: string; title: string }; progress?: { completed: number; total: number } } };
type RecoveryControlAction = 'pause' | 'continue' | 'cancel';
const reasons: Record<string, string> = {
  disabled: '当前未开启自动恢复。', 'eligible-not-started': '当前符合单次只读恢复条件，尚未记录自动尝试。',
  child_or_checkpoint_recovery: '恢复子运行不会继续自动重试。', authentication_or_blocking_result: '存在认证、权限或其他阻碍，需要人工处理。',
  candidate_count_not_exactly_one: '恢复候选不唯一，需要人工确定范围。', candidate_scope_not_single_case: '恢复范围超出一个目标用例，需要人工确认。',
  advice_not_exclusively_environmental_or_evidenced: '调查结论存在分歧或证据不足，需要人工复核。',
  readiness_missing_blocked_or_mismatched: '恢复条件尚未满足。', advice_unavailable_or_invalid: '尚无可核验的调查建议。',
  missing_autonomous_plan: '此运行不属于原始自主回归。', run_mode_not_regression: '此运行不是常规回归模式。',
  run_outcome_not_recoverable: '此运行结果无需或不支持自动恢复。', 'project-not-approved': '项目当前未审核通过。',
  'api-permissions-enabled': '项目启用了超出只读恢复范围的 API 权限。', 'preparation-changed': '准备期间恢复依据或范围变化，需要重新核对。',
};
export function RunAutomaticRecoveryView({ status, error, onRefresh, onControl, controlBusy, controlMessage, controlError }: {
  status?: AutomaticRecoveryStatus; error?: string; onRefresh?: () => void; onControl?: (action: RecoveryControlAction) => void;
  controlBusy?: boolean; controlMessage?: string; controlError?: string;
}) {
  if (error) return <p role="alert">自动恢复状态暂时无法核验。{onRefresh && <button className="button-secondary" onClick={onRefresh}>重新读取自动恢复状态</button>}</p>;
  if (!status) return <p role="status">正在读取自动恢复状态…</p>;
  const label = status.state === 'completed' ? `自动恢复尝试已结束 · ${status.overall === 'passed' ? '通过' : status.overall === 'failed' ? '失败' : '仍有未验证或取消项'}`
    : status.state === 'investigating' ? 'Agent 正在调查失败证据，完成后评估单次恢复条件。'
      : status.state === 'submitted' ? status.progress?.cancelRequested ? '正在取消恢复子运行并保存部分结果。'
        : status.progress?.status === 'paused' ? '自动恢复已暂停，保留当前页面会话。'
        : status.progress?.status === 'pause-requested' ? '已请求暂停，等待当前步骤安全结束。' : '自动恢复准备或执行中，只尝试一次。'
      : status.state === 'uncertain' ? '自动恢复尝试待核查；不会因重启或刷新重复提交。'
        : status.state === 'failed' ? '自动恢复提交失败；本次不会再次自动提交。'
          : status.state === 'stopped' ? reasons[status.reason ?? ''] ?? '当前自动恢复条件未满足，需要人工复核。'
            : '自动恢复状态未知，需要人工核查。';
  const live = status.state === 'submitted' && Boolean(status.record?.childRunId) && Boolean(status.progress) && status.progress?.runId === status.record?.childRunId;
  const state = live ? status.progress?.status : undefined;
  return <section aria-label="自动恢复状态">
    <p><strong>自动恢复：</strong>{label}</p>
    {status.record?.childRunId && <p>恢复子运行：{status.record.childRunId}。原失败记录保留，请在运行历史中查看子运行结果。</p>}
    {live && <p>当前阶段：{status.progress!.stage}{status.progress?.progress ? ` · 已完成 ${status.progress.progress.completed}/${status.progress.progress.total} 条` : ''}{status.progress?.currentCase ? ` · 当前用例 ${status.progress.currentCase.id}：${status.progress.currentCase.title}` : ''}</p>}
    {live && !status.progress?.cancelRequested && onControl && <div>
      {state === 'running' && <button className="button-secondary" disabled={controlBusy} onClick={() => onControl('pause')}>暂停恢复子运行</button>}
      {(state === 'paused' || state === 'pause-requested') && <button className="button-secondary" disabled={controlBusy} onClick={() => onControl('continue')}>继续恢复子运行</button>}
      {['running', 'pause-requested', 'paused'].includes(state ?? '') && <button className="button-secondary" disabled={controlBusy} onClick={() => onControl('cancel')}>取消恢复子运行</button>}
    </div>}
    {controlMessage && status.state === 'submitted' && <p role="status">{controlMessage}</p>}
    {controlError && <p role="alert">{controlError}</p>}
    {onRefresh && <button className="button-secondary" onClick={onRefresh}>刷新自动恢复状态</button>}
  </section>;
}
export function RunAutomaticRecovery({ runId, overall }: { runId: string; overall: string }) {
  const [value, setValue] = useState<{ runId: string; status?: AutomaticRecoveryStatus; error?: string }>({ runId });
  const [revision, setRevision] = useState(0);
  const pendingControl = useRef<AbortController | undefined>(undefined);
  const [feedback, setFeedback] = useState<{ runId: string; busy: boolean; cancelRequested?: boolean; message?: string; error?: string }>({ runId, busy: false });
  useEffect(() => () => { pendingControl.current?.abort(); pendingControl.current = undefined; }, [runId]);
  useEffect(() => {
    if (overall === 'passed') return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    setValue({ runId });
    const read = async () => {
      try {
        const response = await fetch(`/api/document-runs/${encodeURIComponent(runId)}/automatic-recovery`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const status = await response.json() as AutomaticRecoveryStatus;
        if (controller.signal.aborted) return;
        setValue({ runId, status });
        if (status.state === 'submitted' || status.state === 'investigating') timer = setTimeout(read, 1_500);
      } catch { if (!controller.signal.aborted) setValue({ runId, error: 'unavailable' }); }
    };
    void read(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, overall, revision]);
  if (overall === 'passed') return null;
  const current = value.runId === runId ? value : { runId };
  const command = async (action: RecoveryControlAction) => {
    const childRunId = current.status?.record?.childRunId;
    if (!childRunId || current.status?.state !== 'submitted' || pendingControl.current || feedback.runId === runId && feedback.cancelRequested) return;
    const controller = new AbortController(); pendingControl.current = controller;
    setFeedback({ runId, busy: true });
    try {
      const outcome = await controlAutomaticRecoveryChild({ parentRunId: runId, childRunId, action, signal: controller.signal });
      if (!controller.signal.aborted) setFeedback({ runId, busy: false, ...(action === 'cancel' ? { cancelRequested: true } : {}), message: action === 'cancel' ? '已请求取消恢复子运行；正在保存部分结果。'
        : action === 'continue' ? '恢复子运行已继续。' : outcome.status === 'already-paused' ? '已有暂停请求；请查看最新状态。' : '已请求暂停；当前步骤安全结束后生效。' });
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ runId, busy: false, error: error instanceof Error ? error.message : '操作失败，请刷新恢复状态。' });
    } finally {
      if (pendingControl.current === controller) { pendingControl.current = undefined; if (!controller.signal.aborted) setRevision(n => n + 1); }
    }
  };
  return React.createElement(RunAutomaticRecoveryView, { ...current, onRefresh: () => setRevision(n => n + 1), onControl: command,
    controlBusy: feedback.runId === runId && (feedback.busy || feedback.cancelRequested === true),
    ...(feedback.runId === runId && feedback.message ? { controlMessage: feedback.message } : {}),
    ...(feedback.runId === runId && feedback.error ? { controlError: feedback.error } : {}) });
}
