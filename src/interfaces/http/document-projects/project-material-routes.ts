import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveDocumentInputRoles, type DocumentInputRole } from '../../../adapters/documents/cases/source-roles.js';
import type { ImportedDocument } from '../../../domain/documents/shared/test-contracts.js';
import type { DocumentProject } from '../../../domain/documents/shared/test-model.js';
import { documentBody, fail, json } from '../shared/http-utils.js';
export interface DocumentProjectMaterialRouteDependencies {
    getProject(projectId: string): Promise<DocumentProject | undefined>;
    extractDocument(fileName: string, bytes: Buffer): Promise<ImportedDocument>;
    readSource(project: DocumentProject, materialId: string): Promise<Buffer>;
    writeSource(project: DocumentProject, bytes: Buffer, fileName: string, index: number): Promise<void>;
    saveProject(project: DocumentProject): Promise<void>;
    getMaterialVersion(project: DocumentProject): ReturnType<typeof import('../../../domain/documents/runs/run-scope.js').getDocumentMaterialVersion>;
}
/** HTTP adapter for adding or replacing project source material. */
export async function handleDocumentProjectMaterialRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: DocumentProjectMaterialRouteDependencies): Promise<boolean> {
    const { getProject: getDocumentProject, extractDocument, readSource: readDocumentSource, writeSource: writeDocumentSource, saveProject: saveDocumentProject, getMaterialVersion: getDocumentMaterialVersion } = deps;
    const projectMaterialsRoute = pathname.match(/^\/api\/document-projects\/([^/]+)\/materials$/u);
    if (req.method === "POST" && projectMaterialsRoute) {
        const projectId = decodeURIComponent(projectMaterialsRoute[1]!);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId)) {
            fail(res, 400, "项目 ID 无效。");
            return true;
        }
        const project = await getDocumentProject(projectId);
        if (!project) {
            fail(res, 404, "文档测试项目不存在。");
            return true;
        }
        let data: any;
        try {
            data = await documentBody(req);
        }
        catch (error) {
            fail(res, 400, String((error as Error).message));
            return true;
        }
        if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["fileName", "bytesBase64", "role", "replaceMaterialId"].includes(key)) || typeof data.fileName !== "string" || !data.fileName.trim() || data.fileName.length > 200 || /[\\/]/u.test(data.fileName) || typeof data.bytesBase64 !== "string" || data.bytesBase64.length > 13000000 || !["requirements", "coverage-reference", "held-out-benchmark"].includes(data.role) || data.replaceMaterialId !== undefined && (typeof data.replaceMaterialId !== "string" || !/^[0-9a-f-]{36}$/iu.test(data.replaceMaterialId))) {
            fail(res, 400, "资料更新需要文件名、Base64 文件内容和明确的资料角色；文件最多 9 MB，可选择替换当前项目的一份资料。");
            return true;
        }
        try {
            const bytes = Buffer.from(data.bytesBase64, "base64");
            if (!bytes.length || bytes.byteLength > 9 * 1024 * 1024)
                throw new Error("资料不能为空且不能超过 9 MB。");
            const currentMaterials = (project.sourceMaterials ?? []).filter(item => item.role !== "website-content");
            const replaceIndex = data.replaceMaterialId === undefined ? -1 : currentMaterials.findIndex(item => item.id === data.replaceMaterialId);
            if (data.replaceMaterialId !== undefined && replaceIndex < 0)
                throw new Error("要替换的资料不存在或不属于当前项目。");
            if (replaceIndex < 0 && currentMaterials.length >= 5)
                throw new Error("单项目最多保存 5 份上传资料；请替换旧资料或拆分项目。");
            const duplicateName = currentMaterials.some((item, index) => index !== replaceIndex && item.fileName.toLocaleLowerCase() === data.fileName.trim().toLocaleLowerCase());
            if (duplicateName)
                throw new Error("项目内资料文件名必须唯一；请修改名称或替换同一份资料。");
            const uploadedDocument = await extractDocument(data.fileName.trim(), bytes);
            const importedSources: Array<{
                fileName: string;
                requestedRole: DocumentInputRole;
                document: ImportedDocument;
            }> = [];
            for (let index = 0; index < currentMaterials.length; index++) {
                if (index === replaceIndex)
                    continue;
                const material = currentMaterials[index]!;
                const storedText = project.materialTexts?.[material.id];
                if (typeof storedText === "string") {
                    const originalBytes = await readDocumentSource(project, material.id);
                    const document = await extractDocument(material.fileName, originalBytes);
                    importedSources.push({ fileName: material.fileName, requestedRole: material.role as DocumentInputRole, document: { ...document, text: storedText } });
                }
                else {
                    const originalBytes = await readDocumentSource(project, material.id);
                    importedSources.push({ fileName: material.fileName, requestedRole: material.role as DocumentInputRole, document: await extractDocument(material.fileName, originalBytes) });
                }
            }
            const newMaterial = { id: randomUUID(), fileName: data.fileName.trim(), role: data.role as "requirements" | "coverage-reference" | "held-out-benchmark", sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength, createdAt: new Date().toISOString() };
            importedSources.splice(replaceIndex < 0 ? importedSources.length : Math.min(replaceIndex, importedSources.length), 0, { fileName: newMaterial.fileName, requestedRole: newMaterial.role, document: uploadedDocument });
            const resolvedSources = resolveDocumentInputRoles(importedSources);
            const websiteMaterial = (project.sourceMaterials ?? []).find(item => item.role === "website-content");
            let websiteText = websiteMaterial ? project.materialTexts?.[websiteMaterial.id] : undefined;
            if (websiteMaterial && typeof websiteText !== "string") {
                const marker = `# 网站可公开读取的页面文字\n\n`;
                const start = project.sourceText.indexOf(marker);
                if (start >= 0)
                    websiteText = project.sourceText.slice(start + marker.length).split(/\n\n## 用户补充的测试重点/u, 1)[0]!.trim();
            }
            const contextText = project.contextText ?? project.sourceText.match(/## 用户补充的测试重点\s*\n([\s\S]*)$/u)?.[1]?.trim() ?? "";
            const websiteBlock = websiteText ? `# 网站可公开读取的页面文字\n\n${websiteText}` : "";
            let sourceText = [resolvedSources.requirementsText, websiteBlock, contextText ? `## 用户补充的测试重点\n${contextText}` : ""].filter(Boolean).join("\n\n---\n\n");
            if (!sourceText.trim() && project.caseMode !== "existing")
                sourceText = `# 网站探索目标\n\n目标网址：${project.targetUrl}\n\n请根据目标页面中实际可观察到的内容设计测试用例；业务规则或登录后状态无法确认时，明确标注待澄清，不得猜测预期。`;
            if (sourceText.length > 100000)
                throw new Error(`更新后的需求资料共 ${sourceText.length} 字符，项目上限为 100000；不会静默截断。`);
            const materialCreatedAt = new Date().toISOString();
            const files = importedSources.map((item, index) => {
                if (item.fileName === newMaterial.fileName)
                    return newMaterial;
                const existing = currentMaterials.find(material => material.fileName === item.fileName);
                if (!existing)
                    throw new Error(`资料 ${item.fileName} 的项目关联丢失。`);
                return existing;
            });
            project.sourceMaterials = [...files, ...(websiteMaterial ? [websiteMaterial] : [])];
            project.materialTexts = Object.fromEntries([
                ...importedSources.map((item, index) => [files[index]!.id, item.document.text] as const),
                ...(websiteMaterial && websiteText ? [[websiteMaterial.id, websiteText] as const] : []),
            ]);
            project.sourceFiles = files.map(item => item.fileName);
            project.sourceRoles = [...resolvedSources.sourceRoles, ...(websiteMaterial ? [{ fileName: websiteMaterial.fileName, role: "website-content" as const }] : [])];
            project.sourceText = sourceText;
            project.contextText = contextText;
            project.fileName = files[0]?.fileName ?? project.fileName;
            project.researchExamples = [...(project.researchExamples ?? []).filter(item => !item.url.startsWith("uploaded-coverage-reference:")), ...resolvedSources.coverageReferences];
            project.reviewStatus = "draft";
            project.reviewNotes = "";
            project.updatedAt = materialCreatedAt;
            project.workflowPlan = [...(project.workflowPlan ?? []), `${data.replaceMaterialId ? "替换" : "新增"}资料版本：${newMaterial.fileName}（${newMaterial.role}）；正式用例未自动改写，需重新复核测试依据。`];
            const newMaterialIndex = project.sourceMaterials.findIndex(item => item.id === newMaterial.id);
            await writeDocumentSource(project, bytes, newMaterial.fileName, newMaterialIndex + 1);
            await saveDocumentProject(project);
            json(res, 200, { project, updatedMaterialId: newMaterial.id, materialVersion: getDocumentMaterialVersion(project) });
        }
        catch (error) {
            fail(res, 422, error instanceof Error ? error.message : "资料版本更新失败。");
        }
        return true;
    }
    return false;
}
