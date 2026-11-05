import type { DocumentProjectRepository } from '../ports/document-project-repository.js';
import type { DocumentSessionProfile } from '../../domain/documents/projects/session-profile.js';
import type { DocumentProject } from '../../domain/documents/shared/test-model.js';
import { isSafeSessionProfileText } from '../../domain/documents/projects/session-profile.js';
export class DocumentSessionProfileError extends Error {
    readonly code: 'not-found' | 'invalid-profile' | 'occupied';
    constructor(code: 'not-found' | 'invalid-profile' | 'occupied', message: string) { super(message); this.code = code; }
}
export function createDocumentSessionProfileService(deps: {
    projects: Pick<DocumentProjectRepository, 'getProject' | 'saveProject'>;
    mutateProject?(projectId: string, update: (project: DocumentProject) => void): Promise<DocumentProject | undefined>;
    acquirePage(projectId: string): (() => void) | undefined;
    now(): string;
    createId(): string;
}) {
    return {
        async list(projectId: string) {
            const project = await deps.projects.getProject(projectId);
            if (!project)
                throw new DocumentSessionProfileError('not-found', '文档测试项目不存在。');
            return { profiles: project.sessionProfiles ?? [], activeProfileId: project.activeSessionProfileId ?? null,
                message: '档案名称和角色是用户提供的非秘密备注；选择档案不会验证目标系统账号或权限。' };
        },
        async add(projectId: string, data: unknown) {
            if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => k !== 'name' && k !== 'role') || typeof (data as any).name !== 'string' || typeof (data as any).role !== 'string')
                throw new DocumentSessionProfileError('invalid-profile', '档案只接受 name 和 role 两项文字。');
            const name = (data as any).name.trim(), role = (data as any).role.trim();
            if (!isSafeSessionProfileText(name) || !isSafeSessionProfileText(role))
                throw new DocumentSessionProfileError('invalid-profile', '档案名称和角色各需为 1 至 80 字的非秘密描述。');
            const release = deps.acquirePage(projectId);
            if (!release)
                throw new DocumentSessionProfileError('occupied', '项目浏览器正在运行或被操作；请结束当前操作后再新增档案。');
            try {
                let result: DocumentSessionProfile | undefined;
                const update = (project: DocumentProject) => {
                    if ((project.sessionProfiles ?? []).length >= 20)
                        throw new DocumentSessionProfileError('invalid-profile', '每个项目最多保存 20 个会话档案。');
                    if ((project.sessionProfiles ?? []).some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
                        throw new DocumentSessionProfileError('invalid-profile', '档案名称已存在，请使用不同名称。');
                    const id = deps.createId();
                    if (!id || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id) || (project.sessionProfiles ?? []).some(p => p.id === id))
                        throw new DocumentSessionProfileError('invalid-profile', '档案 ID 无效或冲突，请重试。');
                    const now = deps.now();
                    result = { id, name, role, createdAt: now, updatedAt: now };
                    project.sessionProfiles = [...(project.sessionProfiles ?? []), result];
                    project.updatedAt = now;
                };
                const saved = deps.mutateProject ? await deps.mutateProject(projectId, update) : await (async () => {
                    const project = await deps.projects.getProject(projectId);
                    if (!project)
                        return undefined;
                    update(project);
                    await deps.projects.saveProject(project);
                    return project;
                })();
                if (!saved)
                    throw new DocumentSessionProfileError('not-found', '文档测试项目不存在。');
                return result!;
            }
            finally {
                release();
            }
        },
        async select(projectId: string, profileId: string | null) {
            const release = deps.acquirePage(projectId);
            if (!release)
                throw new DocumentSessionProfileError('occupied', '项目浏览器正在运行或被操作；请结束当前操作后再切换档案。');
            try {
                const update = (project: DocumentProject) => {
                    if (profileId !== null && !(project.sessionProfiles ?? []).some(p => p.id === profileId))
                        throw new DocumentSessionProfileError('invalid-profile', '所选档案不属于当前项目。');
                    if (profileId)
                        project.activeSessionProfileId = profileId;
                    else
                        delete project.activeSessionProfileId;
                    project.updatedAt = deps.now();
                };
                const saved = deps.mutateProject ? await deps.mutateProject(projectId, update) : await (async () => {
                    const project = await deps.projects.getProject(projectId);
                    if (!project)
                        return undefined;
                    update(project);
                    await deps.projects.saveProject(project);
                    return project;
                })();
                if (!saved)
                    throw new DocumentSessionProfileError('not-found', '文档测试项目不存在。');
                return { activeProfileId: profileId, message: '所选档案仅决定后续浏览器使用的隔离会话；登录和账号权限仍需在目标系统中人工完成并确认。' };
            }
            finally {
                release();
            }
        },
    };
}
