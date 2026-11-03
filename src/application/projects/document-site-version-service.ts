import type { DocumentProject, DocumentSiteVersion } from '../../domain/document-test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';

export type DocumentSiteVersionErrorCode = 'not-found' | 'invalid-input' | 'limit-reached' | 'duplicate-version';
export class DocumentSiteVersionError extends Error {
  constructor(readonly code: DocumentSiteVersionErrorCode, message: string) { super(message); }
}

export function createDocumentSiteVersionService(deps: {
  projects: Pick<DocumentProjectRepository, 'getProject' | 'saveProject'>;
  validateTarget(targetUrl: string): string;
  newId(): string;
  now(): string;
}) {
  return {
    async register(projectId: string, input: unknown): Promise<DocumentProject> {
      const project = await deps.projects.getProject(projectId);
      if (!project) throw new DocumentSiteVersionError('not-found', '文档测试项目不存在。');
      const data = input as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          Object.keys(data).some(key => !['label', 'environment', 'targetUrl', 'changeNotes'].includes(key)) ||
          typeof data.label !== 'string' || !data.label.trim() || data.label.length > 80 ||
          typeof data.environment !== 'string' || !data.environment.trim() || data.environment.length > 80 ||
          typeof data.targetUrl !== 'string' || typeof data.changeNotes !== 'string' || data.changeNotes.length > 2000) {
        throw new DocumentSiteVersionError('invalid-input', '网站版本需要不超过 80 字的版本标识和环境名、有效网址，以及不超过 2000 字的迭代说明。');
      }
      const label = data.label as string;
      const environment = data.environment as string;
      const submittedTargetUrl = data.targetUrl as string;
      const changeNotes = data.changeNotes as string;
      const targetUrl = deps.validateTarget(submittedTargetUrl);
      const versions = project.siteVersions ?? [];
      if (versions.length >= 200) throw new DocumentSiteVersionError('limit-reached', '单个测试项目最多保留 200 个网站版本记录。');
      if (versions.some(item => item.label.trim() === label.trim() && item.environment.trim() === environment.trim())) {
        throw new DocumentSiteVersionError('duplicate-version', '该环境已登记相同版本标识；版本记录不可覆盖，请使用新的版本标识。');
      }
      const version: DocumentSiteVersion = {
        id: deps.newId(), label: label.trim(), environment: environment.trim(),
        targetUrl, changeNotes: changeNotes.trim(), createdAt: deps.now(),
      };
      project.siteVersions = [...versions, version];
      project.activeSiteVersionId = version.id;
      project.targetUrl = version.targetUrl;
      project.updatedAt = deps.now();
      await deps.projects.saveProject(project);
      return project;
    },
  };
}
