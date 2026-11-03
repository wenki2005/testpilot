import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { request } from '../api/client';
import type { Check, Project, TestDataSet } from '../types';
import { filterKnownParameterValues } from '../presentation';

export function useDocumentTestDataSets(input: {
  project: Project | undefined;
  selectedProjectId: string;
  parameterValues: Record<string, string>;
  setParameterValues: Dispatch<SetStateAction<Record<string, string>>>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
  refreshRevisions(projectId: string, offset: number, notify?: boolean): Promise<unknown>;
}) {
  const { project, selectedProjectId, parameterValues, setParameterValues, setProjects, setBusy, setError, setMessage, refreshRevisions } = input;
  const [testDataSetId, setTestDataSetId] = useState('');
  const [testDataSetName, setTestDataSetName] = useState('');
  const selectedTestDataSet = project?.testDataSets?.find(item => item.id === testDataSetId);

  useEffect(() => {
    const onlySavedSet = project?.testDataSets?.length === 1 ? project.testDataSets[0] : undefined;
    setTestDataSetId(onlySavedSet?.id ?? '');
    setTestDataSetName(onlySavedSet?.name ?? '');
    setParameterValues(onlySavedSet ? { ...onlySavedSet.values } : {});
  }, [selectedProjectId]);

  const saveTestDataSet = async () => {
    if (!project || !testDataSetName.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const now = new Date().toISOString();
      const values = filterKnownParameterValues(project.cases as Check[], parameterValues);
      const existing = project.testDataSets?.find(item => item.id === testDataSetId);
      const next: TestDataSet[] = existing
        ? (project.testDataSets ?? []).map(item => item.id === existing.id ? { ...item, name: testDataSetName.trim(), values, updatedAt: now } : item)
        : [...(project.testDataSets ?? []), { id: crypto.randomUUID(), name: testDataSetName.trim(), values, createdAt: now, updatedAt: now }];
      const updated = await request<Project>(`/api/document-projects/${project.id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testDataSets: next }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      void refreshRevisions(updated.id, 0, false);
      const saved = updated.testDataSets?.find(item => item.name === testDataSetName.trim());
      setTestDataSetId(saved?.id ?? '');
      setMessage(saved ? `测试数据组“${saved.name}”已保存，可在后续回归中重复使用。` : '测试数据组已保存。');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  const deleteTestDataSet = async () => {
    if (!project || !selectedTestDataSet) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = (project.testDataSets ?? []).filter(item => item.id !== selectedTestDataSet.id);
      const updated = await request<Project>(`/api/document-projects/${project.id}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testDataSets: next }) });
      setProjects(rows => rows.map(item => item.id === updated.id ? updated : item));
      setTestDataSetId(''); setTestDataSetName(''); setParameterValues({});
      setMessage('测试数据组已删除。');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };

  return { testDataSetId, setTestDataSetId, testDataSetName, setTestDataSetName, selectedTestDataSet, saveTestDataSet, deleteTestDataSet };
}
