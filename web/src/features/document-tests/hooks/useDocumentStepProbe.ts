import { useState } from 'react';
import { request } from '../api/client';
import type { Project, StepProbeResult } from '../types';

/** Probes one saved deterministic step against the selected project site version. */
export function useDocumentStepProbe(input: {
  project?: Project;
  siteVersionId?: string;
  setError: (message: string) => void;
}) {
  const [results, setResults] = useState<Record<string, StepProbeResult>>({});
  const [busyKey, setBusyKey] = useState('');

  async function probe(caseId: string, stepIndex: number): Promise<void> {
    const { project, siteVersionId, setError } = input;
    if (!project) return;
    const key = `${caseId}:${stepIndex}`;
    setBusyKey(key);
    setError('');
    try {
      const result = await request<StepProbeResult>(`/api/document-projects/${project.id}/probe-step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, stepIndex, ...(siteVersionId ? { siteVersionId } : {}) }),
      });
      setResults(current => ({ ...current, [key]: result }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusyKey('');
    }
  }

  return { results, setResults, busyKey, probe };
}
