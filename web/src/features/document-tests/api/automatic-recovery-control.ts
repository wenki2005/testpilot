export type AutomaticRecoveryControlAction = 'pause' | 'continue' | 'cancel';
export type AutomaticRecoveryControlResult = { runId: string; status: string };

const messages = {
  invalid: '自动恢复状态无法核验，请刷新后重试。',
  unavailable: '自动恢复状态读取失败，请刷新后重试。',
  rejected: '恢复子运行操作未被接受，请刷新状态后重试。',
  response: '恢复子运行返回了无法核验的结果，请刷新状态。',
  aborted: '恢复子运行操作已取消。',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function controlAutomaticRecoveryChild(
  input: { parentRunId: string; childRunId: string; action: AutomaticRecoveryControlAction; signal?: AbortSignal },
  fetcher: typeof fetch = fetch,
): Promise<AutomaticRecoveryControlResult> {
  const { parentRunId, childRunId, action, signal } = input;
  if (!['pause', 'continue', 'cancel'].includes(action) || !parentRunId || !childRunId) throw new Error(messages.invalid);
  if (signal?.aborted) throw new Error(messages.aborted);

  let response: Response;
  try {
    response = await fetcher(`/api/document-runs/${encodeURIComponent(parentRunId)}/automatic-recovery`, { method: 'GET', signal });
  } catch { throw new Error(signal?.aborted ? messages.aborted : messages.unavailable); }
  if (!response.ok) throw new Error(messages.unavailable);

  let status: unknown;
  try { status = await response.json(); } catch { throw new Error(messages.invalid); }
  const progress = isRecord(status) && isRecord(status.progress) ? status.progress : undefined;
  const eligible = isRecord(status) && status.state === 'submitted'
    && isRecord(status.record) && status.record.childRunId === childRunId
    && progress?.runId === childRunId
    && progress.cancelRequested !== true
    && (action === 'pause' ? progress.status === 'running'
      : action === 'continue' ? progress.status === 'paused' || progress.status === 'pause-requested'
        : progress.status === 'running' || progress.status === 'pause-requested' || progress.status === 'paused');
  if (!eligible) throw new Error(messages.invalid);
  if (signal?.aborted) throw new Error(messages.aborted);

  try {
    response = await fetcher(`/api/document-runs/${encodeURIComponent(childRunId)}/${action}`, { method: 'POST', signal });
  } catch { throw new Error(signal?.aborted ? messages.aborted : messages.rejected); }
  if (!response.ok) throw new Error(messages.rejected);
  let outcome: unknown;
  try { outcome = await response.json(); } catch { throw new Error(messages.response); }
  if (!isRecord(outcome) || outcome.runId !== childRunId || typeof outcome.status !== 'string') throw new Error(messages.response);

  const accepted = action === 'pause' ? ['requested', 'already-paused'].includes(outcome.status)
    : action === 'continue' ? outcome.status === 'continued'
      : outcome.status === 'requested';
  if (!accepted) throw new Error(messages.rejected);
  return { runId: childRunId, status: outcome.status };
}
