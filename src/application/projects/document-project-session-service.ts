import type { DocumentProject } from '../../domain/document-test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';

export type DocumentProjectSessionErrorCode = 'not-found' | 'invalid-version' | 'invalid-identity' | 'sensitive-identity';
export class DocumentProjectSessionError extends Error {
  constructor(readonly code: DocumentProjectSessionErrorCode, message: string) { super(message); }
}

export interface DocumentProjectSessionDependencies {
  projects: Pick<DocumentProjectRepository, 'getProject' | 'saveProject'>;
  getSessionStatus(project: DocumentProject, targetUrl: string): Promise<unknown>;
  containsCredentialLikeValue(value: string): boolean;
  now(): string;
}

/** Application use cases for reading a project session and saving a non-secret identity hint. */
export function createDocumentProjectSessionService(deps: DocumentProjectSessionDependencies) {
  return {
    async getStatus(projectId: string, requestedVersionId?: string): Promise<unknown> {
      const project = await deps.projects.getProject(projectId);
      if (!project) throw new DocumentProjectSessionError('not-found', '文档测试项目不存在。');
      const selectedVersion = requestedVersionId
        ? project.siteVersions?.find(item => item.id === requestedVersionId)
        : project.siteVersions?.find(item => item.id === project.activeSiteVersionId);
      if (requestedVersionId && !selectedVersion) throw new DocumentProjectSessionError('invalid-version', '会话状态检查的网站版本不属于当前项目。');
      return deps.getSessionStatus(project, selectedVersion?.targetUrl ?? project.targetUrl);
    },
    async saveIdentity(projectId: string, data: unknown): Promise<DocumentProject> {
      const project = await deps.projects.getProject(projectId);
      if (!project) throw new DocumentProjectSessionError('not-found', '文档测试项目不存在。');
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'identityNote') || typeof (data as { identityNote?: unknown }).identityNote !== 'string' || (data as { identityNote: string }).identityNote.length > 160) {
        throw new DocumentProjectSessionError('invalid-identity', '身份或角色备注只能是 160 字以内的文字；清空内容即可删除备注。');
      }
      const identityNote = (data as { identityNote: string }).identityNote.trim();
      if (deps.containsCredentialLikeValue(identityNote)) throw new DocumentProjectSessionError('sensitive-identity', '身份备注疑似含有密码、令牌或 Cookie；请只填写非敏感的账号角色描述。');
      if (identityNote) project.sessionIdentityNote = identityNote;
      else delete project.sessionIdentityNote;
      project.updatedAt = deps.now();
      await deps.projects.saveProject(project);
      return project;
    },
  };
}
