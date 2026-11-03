import type { DocumentProject } from '../../domain/document-test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';
import { resolveDocumentSessionProfileKey } from '../../domain/document-session-profile.js';

export type SessionOpenState = {
  requestId: string;
  projectId: string;
  profileId: string | null;
  siteVersionId?: string;
  status: 'opening' | 'waiting_for_user' | 'connected' | 'failed';
  targetUrl: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
};

export class DocumentSessionOpenError extends Error {
  constructor(readonly code: 'not-found' | 'invalid-version' | 'occupied' | 'invalid-profile', message: string) { super(message); }
}

export function createDocumentSessionOpenService<TSession>(deps: {
  projects: Pick<DocumentProjectRepository, 'getProject'>;
  acquirePage(projectId: string): (() => void) | undefined;
  createId(): string;
  now(): string;
  openSession(input: { project: DocumentProject; profileKey: string }): Promise<TSession>;
  prepareTargetPage(input: { project: DocumentProject; requestId: string; targetUrl: string; session: TSession; onLoginWait(waiting: boolean): Promise<void> }): Promise<void>;
  onSettled?(projectId: string): void;
}) {
  const tasks = new Map<string, SessionOpenState>();
  function prune() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, task] of tasks) {
      if ((task.status === 'connected' || task.status === 'failed') && Date.parse(task.updatedAt) < cutoff) tasks.delete(id);
    }
    while (tasks.size > 100) {
      const terminal = [...tasks.values()].find(task => task.status === 'connected' || task.status === 'failed');
      if (!terminal) break;
      tasks.delete(terminal.requestId);
    }
  }

  return {
    async getStatus(projectId: string, siteVersionId?: string) {
      prune();
      const project = await deps.projects.getProject(projectId);
      if (!project) return null;
      const selected = siteVersionId
        ? project.siteVersions?.find(version => version.id === siteVersionId)
        : project.siteVersions?.find(version => version.id === project.activeSiteVersionId);
      if (siteVersionId && !selected) return null;
      const selectedId = selected?.id;
      const targetUrl = selected?.targetUrl ?? project.targetUrl;
      const activeProfileId = project.activeSessionProfileId ?? null;
      const task = [...tasks.values()]
        .filter(item => item.projectId === projectId && item.profileId === activeProfileId && item.siteVersionId === selectedId && item.targetUrl === targetUrl)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
      return task ? { ...task } : null;
    },

    async open(projectId: string, siteVersionId?: string) {
      prune();
      if (tasks.size >= 100) throw new DocumentSessionOpenError('occupied', '会话打开任务达到上限，请稍后重试。');
      const release = deps.acquirePage(projectId);
      if (!release) throw new DocumentSessionOpenError('occupied', '项目浏览器正在运行或被操作；结束当前操作后再打开会话。');

      let project: DocumentProject | undefined;
      try { project = await deps.projects.getProject(projectId); }
      catch (error) { release(); throw error; }
      if (!project) { release(); throw new DocumentSessionOpenError('not-found', '文档测试项目不存在。'); }
      const version = siteVersionId
        ? project.siteVersions?.find(item => item.id === siteVersionId)
        : project.siteVersions?.find(item => item.id === project!.activeSiteVersionId);
      if (siteVersionId && !version) { release(); throw new DocumentSessionOpenError('invalid-version', '网站版本不属于当前项目。'); }

      let profileKey: string;
      try { profileKey = resolveDocumentSessionProfileKey(project); }
      catch { release(); throw new DocumentSessionOpenError('invalid-profile', '当前会话档案无效，请重新选择。'); }

      const now = deps.now();
      const requestId = deps.createId();
      const task: SessionOpenState = {
        requestId, projectId, profileId: project.activeSessionProfileId ?? null,
        ...(version?.id ? { siteVersionId: version.id } : {}),
        status: 'opening', targetUrl: version?.targetUrl ?? project.targetUrl,
        startedAt: now, updatedAt: now,
      };
      tasks.set(requestId, task);

      void (async () => {
        try {
          const session = await deps.openSession({ project, profileKey });
          await deps.prepareTargetPage({
            project, requestId, targetUrl: task.targetUrl, session,
            onLoginWait: async waiting => {
              task.status = waiting ? 'waiting_for_user' : 'opening';
              task.updatedAt = deps.now();
            },
          });
          task.status = 'connected';
          task.updatedAt = deps.now();
        } catch (error) {
          task.status = 'failed';
          const message = error instanceof Error ? error.message : '打开浏览器会话失败。';
          task.error = message.replace(/(?:password|passwd|token|secret|cookie|authorization|密码|口令|令牌|验证码)\s*[:=]\s*\S+/giu, '[敏感值已隐藏]').slice(0, 500);
          task.updatedAt = deps.now();
        } finally {
          try { deps.onSettled?.(projectId); }
          catch (error) {
            task.status = 'failed';
            task.error = '清理登录交接状态失败。';
            task.updatedAt = deps.now();
          } finally { release(); }
        }
      })();
      return { ...task };
    },
  };
}
