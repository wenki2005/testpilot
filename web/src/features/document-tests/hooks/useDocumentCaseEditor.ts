import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { insertDocumentCase, moveDocumentCase } from '../../../../../src/domain/document-case-order';
import type { Check, Project, Run, Step } from '../types';
import { createEditableStep } from '../presentation';
import { applyTestDataRequirementsEdit } from '../test-data-requirements-edit';

/** Keeps case and browser-step edits draft-only until the user saves/reviews the project. */
export function useDocumentCaseEditor(
  project: Project | undefined,
  setProjects: Dispatch<SetStateAction<Project[]>>,
  setRun: Dispatch<SetStateAction<Run | null>>,
  setStepDrafts: Dispatch<SetStateAction<Record<string, string>>>,
) {
  const [editorNotice,setEditorNotice]=useState('');
  const editCase = (index: number, key: keyof Check, value: string) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, [key]: value, lifecycleStatus: 'draft' as const, selectedForRegression: false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const editCaseList = (index: number, key: 'requirementRefs' | 'preconditions' | 'testData' | 'coverageAreas' | 'modulePath' | 'tags' | 'dependsOnCaseIds', value: string) => {
    if (!project) return;
    const values = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    const cases = project.cases.map((item, i) => i === index ? { ...item, [key]: values, lifecycleStatus: 'draft' as const, selectedForRegression: false, ...(key === 'preconditions' ? { preconditionsConfirmed: values.length === 0 } : {}) } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const setTestDataRequirements = (index: number, requirements: NonNullable<Check['testDataRequirements']>) => {
    if (!project) return;
    const updated = applyTestDataRequirementsEdit(project, index, requirements);
    setProjects(current => current.map(item => item.id === project.id ? updated : item));
    setRun(null);
  };
  const setCaseLifecycleStatus = (index: number, lifecycleStatus: NonNullable<Check['lifecycleStatus']>) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, lifecycleStatus, selectedForRegression: lifecycleStatus === 'runnable' ? item.selectedForRegression !== false : false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const confirmCasePreconditions = (index: number, checked: boolean) => {
    if (!project) return;
    const cases = project.cases.map((item, i) => i === index ? { ...item, preconditionsConfirmed: checked, lifecycleStatus: 'draft' as const, selectedForRegression: false } : item);
    setProjects(current => current.map(item => item.id === project.id ? { ...item, cases, reviewStatus: 'draft' } : item));
    setRun(null);
  };
  const updateCaseSteps = (index: number, steps: Step[]) => {
    if (!project) return;
    const item = project.cases[index];
    if (!item) return;
    const cases = project.cases.map((row, position) => position === index ? { ...row, steps, lifecycleStatus: 'draft' as const, selectedForRegression: false } : row);
    setProjects(current => current.map(row => row.id === project.id ? { ...row, cases, reviewStatus: 'draft' } : row));
    setStepDrafts(current => ({ ...current, [item.id]: JSON.stringify(steps, null, 2) }));
    setRun(null);
  };
  const changeStep = (caseIndex: number, stepIndex: number, key: string, value: string) => {
    if (!project) return;
    const steps = [...(project.cases[caseIndex]?.steps ?? [])];
    steps[stepIndex] = { ...steps[stepIndex], [key]: value };
    updateCaseSteps(caseIndex, steps);
  };
  const addStep = (caseIndex: number, action: string) => {
    if (!project || !action) return;
    updateCaseSteps(caseIndex, [...(project.cases[caseIndex]?.steps ?? []), createEditableStep(action)]);
  };
  const removeStep = (caseIndex: number, stepIndex: number) => {
    if (!project) return;
    updateCaseSteps(caseIndex, (project.cases[caseIndex]?.steps ?? []).filter((_step, index) => index !== stepIndex));
  };
  const moveStep = (caseIndex: number, stepIndex: number, delta: number) => {
    if (!project) return;
    const steps = [...(project.cases[caseIndex]?.steps ?? [])];
    const destination = stepIndex + delta;
    if (destination < 0 || destination >= steps.length) return;
    [steps[stepIndex], steps[destination]] = [steps[destination]!, steps[stepIndex]!];
    updateCaseSteps(caseIndex, steps);
  };
  const editSteps = (item: Check, value: string) => {
    setStepDrafts(current => ({ ...current, [item.id]: value }));
    try {
      const steps: unknown = JSON.parse(value);
      const index = project?.cases.indexOf(item) ?? -1;
      if (Array.isArray(steps) && index >= 0) updateCaseSteps(index, steps as Step[]);
    } catch { /* preserve invalid editor text while the user corrects it */ }
  };
  const insertCase = (anchorId?: string, position: 'before'|'after' = 'after') => {
    if (!project) return;
    if(project.cases.length>=200){setEditorNotice('已达到 200 条用例上限，未新增。');return;}
    const anchor=project.cases.find(row=>row.id===anchorId);
    const item: Check = { id: `manual-${crypto.randomUUID()}`, ...(anchor?.modulePath ? {modulePath:[...anchor.modulePath]} : {}), title: '新测试用例', source: '人工补充', requirementRefs: [], priority: 'P2', category: 'functional', confidence: 'low', coverageAreas: ['functional'], lifecycleStatus: 'draft', selectedForRegression: false, preconditions: [], preconditionsConfirmed: false, testData: [], sideEffectRisk: 'unknown', cleanup: '', kind: 'visible', expected: '', steps: [] };
    let cases:Check[];
    try {cases=insertDocumentCase(project.cases,item,anchorId,position);} catch(error){setEditorNotice((error as Error).message);return;}
    setProjects(rows => rows.map(row => row.id === project.id ? { ...row, cases, reviewStatus: 'draft' } : row));
    setStepDrafts(current => ({ ...current, [item.id]: '[]' }));
    setEditorNotice('已插入待审核用例，尚未保存；模块已继承，前置依赖请明确填写。');
    setRun(null);
  };
  const addCase = () => insertCase();
  const moveCase = (caseId:string,delta:-1|1) => {
    if(!project)return;
    try { const cases=moveDocumentCase(project.cases,caseId,delta); setProjects(rows=>rows.map(row=>row.id===project.id?{...row,cases,reviewStatus:'draft'}:row)); setRun(null); setEditorNotice('用例顺序已调整，尚未保存；原有 ID、步骤和依赖保持不变。'); }
    catch(error){setEditorNotice((error as Error).message);}
  };
  const removeCase = (caseId: string) => {
    if (!project) return;
    setProjects(rows => rows.map(row => row.id === project.id ? { ...row, cases: row.cases.filter(item => item.id !== caseId), reviewStatus: 'draft' } : row));
    setEditorNotice('用例已从当前编辑列表移除，尚未保存；若有依赖引用，保存时会提示修正。');
    setRun(null);
  };
  return { editCase, editCaseList, setTestDataRequirements, setCaseLifecycleStatus, confirmCasePreconditions, updateCaseSteps, changeStep, addStep, removeStep, moveStep, editSteps, addCase, insertCase, moveCase, editorNotice, removeCase };
}
