import type { DocumentProject } from '../../domain/document-test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';

export type DocumentCaseSelectionErrorCode = 'not-found' | 'invalid-selection' | 'unknown-cases' | 'unavailable-cases' | 'empty-selection';
export class DocumentCaseSelectionError extends Error {
  constructor(readonly code: DocumentCaseSelectionErrorCode, message: string) { super(message); }
}

export interface DocumentCaseSelectionResult {
  project: DocumentProject;
  selectedCaseIds: string[];
  excludedCaseIds: string[];
  changed: boolean;
}

export function createDocumentCaseSelectionService(deps: {
  projects: Pick<DocumentProjectRepository, 'getProject' | 'saveProject'>;
  requiresManualReview(project: DocumentProject): boolean;
  hasAutoRunnableSelectedCase(cases: DocumentProject['cases']): boolean;
  now(): string;
}) {
  return {
    async select(projectId: string, input: unknown): Promise<DocumentCaseSelectionResult> {
      const project = await deps.projects.getProject(projectId);
      if (!project) throw new DocumentCaseSelectionError('not-found', '文档测试项目不存在。');
      const data = input as { caseIds?: unknown; selected?: unknown } | null;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['caseIds', 'selected'].includes(key)) || !Array.isArray(data.caseIds) || data.caseIds.length < 1 || data.caseIds.length > 200 || data.caseIds.some(id => typeof id !== 'string' || !id.length || id.length > 80) || typeof data.selected !== 'boolean') {
        throw new DocumentCaseSelectionError('invalid-selection', 'case selection requires 1–200 caseIds and a boolean selected value');
      }
      const caseIds = [...new Set<string>(data.caseIds as string[])];
      const knownIds = new Set(project.cases.map(item => item.id));
      const unknownIds = caseIds.filter(id => !knownIds.has(id));
      if (unknownIds.length) throw new DocumentCaseSelectionError('unknown-cases', `以下用例不属于该项目：${unknownIds.join(', ')}`);
      const unavailableIds = data.selected ? caseIds.filter(id => project.cases.some(item => item.id === id && (item.lifecycleStatus === 'draft' || item.lifecycleStatus === 'disabled'))) : [];
      if (unavailableIds.length) throw new DocumentCaseSelectionError('unavailable-cases', `草稿或停用用例不能加入回归范围：${unavailableIds.join(', ')}。请先将完整用例标记为可运行。`);
      const requestedIds = new Set(caseIds);
      const changed = project.cases.some(item => requestedIds.has(item.id) && (item.selectedForRegression !== false) !== data.selected);
      const selectedCaseIds = project.cases.filter(item => item.selectedForRegression !== false).map(item => item.id);
      const excludedCaseIds = project.cases.filter(item => item.selectedForRegression === false).map(item => item.id);
      if (!changed) return { project, selectedCaseIds, excludedCaseIds, changed: false };

      project.cases = project.cases.map(item => requestedIds.has(item.id) ? { ...item, selectedForRegression: data.selected as boolean } : item);
      const nextSelectedCaseIds = project.cases.filter(item => item.selectedForRegression !== false).map(item => item.id);
      if (!nextSelectedCaseIds.length) throw new DocumentCaseSelectionError('empty-selection', '至少保留一条选中用例。');
      if (project.confirmationRequired !== true && !deps.requiresManualReview(project) && deps.hasAutoRunnableSelectedCase(project.cases)) {
        project.reviewStatus = 'approved';
        project.reviewNotes = '用户选择自动运行：仅已就绪的只读用例通过服务端安全门后自动执行；缺步骤、预期不足、风险未定或依赖缺失的用例保留为阻塞。';
      } else {
        project.reviewStatus = 'draft';
        project.reviewNotes = '';
      }
      project.updatedAt = deps.now();
      await deps.projects.saveProject(project);
      return {
        project,
        selectedCaseIds: nextSelectedCaseIds,
        excludedCaseIds: project.cases.filter(item => item.selectedForRegression === false).map(item => item.id),
        changed: true,
      };
    },
  };
}
