import type { Dispatch, SetStateAction } from 'react';
import type { PreparationTask, Project, Run } from '../types';
import { request } from '../api/client';
import type { ProjectPlatform } from '../project-platform';
type Dependencies = {
    setBusy: Dispatch<SetStateAction<boolean>>;
    setError: Dispatch<SetStateAction<string>>;
    setMessage: Dispatch<SetStateAction<string>>;
    refresh: (preferred?: string) => Promise<void>;
    setStepDrafts: Dispatch<SetStateAction<Record<string, string>>>;
    setRun: Dispatch<SetStateAction<Run | null>>;
};
/** Owns the asynchronous import-to-prepared-project lifecycle. */
export function useDocumentProjectPreparation(deps: Dependencies) {
    return async (input: {
        file: File | null;
        targetUrl: string;
        name: string;
        requireConfirmation: boolean;
        platform?: ProjectPlatform;
    }): Promise<void> => {
        const { file, targetUrl } = input;
        if (!file || !targetUrl.trim()) {
            deps.setError('先选择 PDF/XMind/Markdown/TXT 文件并填写目标网址。');
            return;
        }
        deps.setBusy(true);
        deps.setError('');
        deps.setMessage('');
        try {
            const bytesBase64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('读取文件失败'));
                reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
                reader.readAsDataURL(file);
            });
            const started = await request<{
                preparationId: string;
            }>('/api/document-projects/import', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: input.name, fileName: file.name, bytesBase64, targetUrl, requireConfirmation: input.requireConfirmation, ...(input.platform ? { platform: input.platform } : {}) }),
            });
            let task: PreparationTask;
            do {
                task = await request<PreparationTask>(`/api/document-preparation/${started.preparationId}`);
                deps.setMessage(task.events.at(-1)?.message ?? 'Agent 正在准备测试资料…');
                if (task.status === 'running')
                    await new Promise(resolve => window.setTimeout(resolve, 400));
            } while (task.status === 'running');
            if (task.status === 'failed')
                throw new Error(task.error ?? '资料准备失败。');
            if (!task.projectId)
                throw new Error('资料准备结束，但没有生成测试项目。');
            const project = (await request<Project[]>('/api/document-projects')).find(row => row.id === task.projectId);
            if (!project)
                throw new Error('测试项目已准备，但无法读取项目详情。');
            await deps.refresh(project.id);
            deps.setStepDrafts(Object.fromEntries(project.cases.map(item => [item.id, JSON.stringify(item.steps ?? [], null, 2)])));
            deps.setRun(null);
            deps.setMessage(project.generationWarning ? `资料已整理。${project.generationWarning}` : `已准备 ${project.cases.length} 条用例；请复核步骤和前置条件，再手动启动回归。`);
        }
        catch (error) {
            deps.setError((error as Error).message);
        }
        finally {
            deps.setBusy(false);
        }
    };
}
