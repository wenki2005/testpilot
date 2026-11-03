import type { RunProgress, RunHandoffProgress } from '../types';

export function visibleHandoffForProgress(progress: RunProgress): RunHandoffProgress | undefined {
  const terminal = ['completed', 'cancelled', 'failed'].includes(progress.status);
  if (terminal && progress.handoff?.status !== 'blocked') return undefined;
  if (progress.status === 'running' && progress.handoff?.status === 'ready-to-continue') return { ...progress.handoff, status: 'waiting-prerequisites' };
  return progress.handoff;
}

export function pauseControlForProgress(progress: RunProgress): boolean | undefined {
  if (progress.status === 'paused') return true;
  if (progress.status === 'running' || ['completed', 'cancelled', 'failed'].includes(progress.status)) return false;
  return undefined;
}
