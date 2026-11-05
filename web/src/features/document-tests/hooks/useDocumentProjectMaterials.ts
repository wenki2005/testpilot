import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { request } from '../api/client';
import type { Project } from '../types';
type MaterialRole = 'requirements' | 'coverage-reference' | 'held-out-benchmark';
export function useDocumentProjectMaterials(input: {
    project: Project | undefined;
    setProjects: Dispatch<SetStateAction<Project[]>>;
    setBusy: (busy: boolean) => void;
    setError: (message: string) => void;
    setMessage: (message: string) => void;
    refreshRevisions(projectId: string, offset: number, notify?: boolean): Promise<unknown>;
}) {
    const { project, setProjects, setBusy, setError, setMessage, refreshRevisions } = input;
    const [projectMaterialFile, setProjectMaterialFile] = useState<File | null>(null);
    const [projectMaterialRole, setProjectMaterialRole] = useState<MaterialRole>('requirements');
    const [replaceProjectMaterialId, setReplaceProjectMaterialId] = useState('');
    const saveProjectMaterial = async () => {
        if (!project || !projectMaterialFile) {
            setError('请选择要加入项目的资料文件。');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const bytesBase64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('读取资料文件失败。'));
                reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
                reader.readAsDataURL(projectMaterialFile);
            });
            const result = await request<{
                project: Project;
                updatedMaterialId: string;
                materialVersion: string;
            }>(`/api/document-projects/${project.id}/materials`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ fileName: projectMaterialFile.name, bytesBase64, role: projectMaterialRole, ...(replaceProjectMaterialId ? { replaceMaterialId: replaceProjectMaterialId } : {}) }),
            });
            setProjects(rows => rows.map(item => item.id === result.project.id ? result.project : item));
            setProjectMaterialFile(null);
            setReplaceProjectMaterialId('');
            void refreshRevisions(result.project.id, 0, false);
            setMessage(`资料已保存为新版本（${result.materialVersion.slice(0, 12)}…）；正式用例未自动改写，请重新检查依据并审核。`);
        }
        catch (error) {
            setError((error as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    return { projectMaterialFile, setProjectMaterialFile, projectMaterialRole, setProjectMaterialRole, replaceProjectMaterialId, setReplaceProjectMaterialId, saveProjectMaterial };
}
