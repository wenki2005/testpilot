import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { ApiSuiteCandidate, ApiSuiteSummary, Project } from '../types';

export function useDocumentApiSuiteCatalog(project: Project | undefined) {
  const [apiSuites, setApiSuites] = useState<ApiSuiteSummary[]>([]);
  const [apiSuiteDetail, setApiSuiteDetail] = useState<ApiSuiteCandidate | null>(null);
  const [apiSuiteLoading, setApiSuiteLoading] = useState(false);
  const [apiSuiteError, setApiSuiteError] = useState('');

  useEffect(() => {
    if (!project) { setApiSuites([]); setApiSuiteDetail(null); setApiSuiteError(''); return; }
    let active = true;
    setApiSuiteLoading(true); setApiSuiteError(''); setApiSuiteDetail(null);
    void (async () => {
      try {
        const candidates = await request<ApiSuiteSummary[]>('/api/api-suites');
        if (!active) return;
        setApiSuites(candidates.filter(item => item.status === 'approved'));
        const suiteId = project.apiContract?.suiteId;
        if (suiteId) {
          const detail = await request<ApiSuiteCandidate>(`/api/api-suites/${encodeURIComponent(suiteId)}`);
          if (active) setApiSuiteDetail(detail);
        } else setApiSuiteDetail(null);
      } catch (error) {
        if (active) { setApiSuiteDetail(null); setApiSuiteError((error as Error).message); }
      } finally { if (active) setApiSuiteLoading(false); }
    })();
    return () => { active = false; };
  }, [project?.id, project?.apiContract?.suiteId]);

  return { apiSuites, apiSuiteDetail, apiSuiteLoading, apiSuiteError };
}
