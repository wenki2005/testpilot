import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserCheck, DocumentProject, DocumentProjectRevision, DocumentProjectRevisionKind, DocumentProjectRevisionSummary, DocumentRun, DocumentSourceMaterial } from "../../domain/documents/shared/test-model.js";
import { getDocumentMaterialVersion } from "../../domain/documents/runs/run-scope.js";
import { caseCategories, confidenceFromExpectation, inferCaseCategory, type CaseCategory } from "../../domain/documents/shared/test-types.js";
import { planCaseExecution } from "../../domain/documents/cases/case-routing.js";
import type { DocumentProjectRepository } from "../../application/ports/document-project-repository.js";
import { canonicalCasesJSON } from '../../domain/documents/cases/case-markdown.js';
import { documentProjectRevisionDigest } from "../../domain/documents/projects/project-revision-digest.js";
export function createDocumentProjectStore(baseDir: string) {
    const projectsDir = path.join(baseDir, "projects");
    const runsDir = path.join(baseDir, "runs");
    const revisionsDir = path.join(baseDir, "revisions");
    const projectSaveTails = new Map<string, Promise<void>>();
    type DocumentProjectRevisionIndex = {
        version: 1;
        projectId: string;
        revisions: DocumentProjectRevisionSummary[];
    };
    function projectRevisionDirectory(projectId: string): string {
        const projectKey = createHash("sha256").update(projectId).digest("hex");
        return path.join(revisionsDir, projectKey);
    }
    function sourceMaterialStorageKey(projectId: string, material: DocumentSourceMaterial): string {
        const projectKey = createHash("sha256").update(projectId).digest("hex");
        const safeName = path.basename(material.fileName).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-96) || "material.bin";
        const safeId = material.id.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 48) || "material";
        const safeDigest = /^[0-9a-f]{64}$/iu.test(material.sha256) ? material.sha256.toLowerCase() : createHash("sha256").update(`${material.sha256}:${material.byteLength}`).digest("hex");
        return `sources/${projectKey}/${safeId}-${safeDigest}-${safeName}`;
    }
    async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
        await mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporaryPath, contents, "utf8");
            for (let attempt = 0;; attempt += 1) {
                try {
                    await rename(temporaryPath, filePath);
                    break;
                }
                catch (error) {
                    const code = (error as NodeJS.ErrnoException).code;
                    if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? ""))
                        throw error;
                    await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
                }
            }
        }
        finally {
            await unlink(temporaryPath).catch(() => undefined);
        }
    }
    async function readRevisionIndex(projectId: string): Promise<DocumentProjectRevisionIndex | undefined> {
        const indexPath = path.join(projectRevisionDirectory(projectId), "index.json");
        try {
            const parsed = JSON.parse(await readFile(indexPath, "utf8")) as DocumentProjectRevisionIndex;
            if (parsed.version !== 1 || parsed.projectId !== projectId || !Array.isArray(parsed.revisions))
                throw new Error("项目修订索引格式无效。");
            return parsed;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
            throw error;
        }
    }
    async function appendProjectRevision(index: DocumentProjectRevisionIndex, kind: DocumentProjectRevisionKind, entityId: string, snapshot: unknown, createdAt: string, source: DocumentProjectRevisionSummary["source"], summary: string): Promise<void> {
        const digest = documentProjectRevisionDigest(kind, entityId, snapshot);
        const related = index.revisions.filter(item => item.kind === kind && item.entityId === entityId);
        if (related.at(-1)?.digest === digest)
            return;
        const revision: DocumentProjectRevisionSummary = {
            id: randomUUID(), projectId: index.projectId, kind, entityId,
            version: (related.at(-1)?.version ?? 0) + 1, digest, createdAt, source, summary,
        };
        const record: DocumentProjectRevision = { ...revision, snapshot: structuredClone(snapshot) };
        await atomicWriteFile(path.join(projectRevisionDirectory(index.projectId), `${revision.id}.json`), JSON.stringify(record, null, 2));
        index.revisions.push(revision);
    }
    async function appendProjectCasesRevisions(index: DocumentProjectRevisionIndex, cases: BrowserCheck[], createdAt: string, source: DocumentProjectRevisionSummary["source"]): Promise<void> {
        for (const item of cases) {
            await appendProjectRevision(index, "case", item.id, item, createdAt, source, item.title || item.id);
            const steps = Array.isArray(item.steps) ? item.steps : [];
            await appendProjectRevision(index, "steps", item.id, steps, createdAt, source, `${item.title || item.id} · ${steps.length} 步`);
        }
        await appendProjectRevision(index, "case-set", "cases", cases.map(item => ({ id: item.id, title: item.title, modulePath: item.modulePath ?? [], lifecycleStatus: item.lifecycleStatus ?? "runnable" })), createdAt, source, `${cases.length} 条用例`);
    }
    async function appendProjectStateRevisions(index: DocumentProjectRevisionIndex, project: DocumentProject, createdAt: string, source: DocumentProjectRevisionSummary["source"]): Promise<void> {
        await appendProjectCasesRevisions(index, Array.isArray(project.cases) ? project.cases : [], createdAt, source);
        if (project.caseGeneration && !index.revisions.some(item => item.kind === "case-generation" && item.entityId === project.caseGeneration!.artifactId)) {
            const generation = project.caseGeneration;
            // A generation batch is an immutable event. Never rebind it to later case/material revisions.
            const caseRevisionIds = generation.transferredCases.flatMap(link => {
                const revision = [...index.revisions].reverse().find(item => item.kind === "case" && item.entityId === link.projectCaseId);
                return revision ? [{ sourceCaseId: link.sourceCaseId, projectCaseId: link.projectCaseId, revisionId: revision.id, digest: revision.digest }] : [];
            });
            const stepEvidenceRevisionIds = generation.transferredCases.flatMap(link => index.revisions.filter(item => item.kind === "step-evidence" && item.entityId === link.projectCaseId).map(item => item.id));
            const snapshot = {
                artifactId: generation.artifactId, version: generation.version, generatedAt: generation.generatedAt, digest: generation.digest,
                requirements: generation.requirements, qualitySummary: generation.qualitySummary, warnings: generation.warnings, sources: generation.sources,
                provenance: (generation as typeof generation & {
                    provenance?: unknown;
                }).provenance ?? { status: "missing" },
                transferredCases: caseRevisionIds,
                stepEvidenceRevisionIds,
                reviewStatus: project.reviewStatus ?? "draft",
            };
            await appendProjectRevision(index, "case-generation", generation.artifactId, snapshot, createdAt, source, `生成批次 v${generation.version} · ${caseRevisionIds.length} 条候选`);
        }
        for (const result of project.stepAuthoring?.results ?? []) {
            if (!result.pageEvidence)
                continue;
            const snapshot = {
                generatedAt: project.stepAuthoring?.generatedAt ?? createdAt,
                status: result.status,
                stepCount: result.stepCount,
                pageEvidence: result.pageEvidence,
                ...(result.authoringContext ? { authoringContext: result.authoringContext } : {}),
            };
            await appendProjectRevision(index, "step-evidence", result.caseId, snapshot, createdAt, source, `${result.caseId} · 步骤生成依据`);
        }
        for (const dataSet of project.testDataSets ?? [])
            await appendProjectRevision(index, "test-data", dataSet.id, dataSet, createdAt, source, dataSet.name);
        const materialsSnapshot = {
            fileName: project.fileName,
            sourceFiles: project.sourceFiles ?? [project.fileName],
            sourceRoles: project.sourceRoles ?? [],
            sourceMaterials: (project.sourceMaterials ?? []).map(item => ({ ...item, ...(item.role === "website-content" ? {} : { storageKey: sourceMaterialStorageKey(project.id, item) }) })),
            materialTexts: project.materialTexts ?? {},
            contextText: project.contextText ?? "",
            sourceText: project.sourceText ?? "",
            materialVersion: getDocumentMaterialVersion(project),
            sourceTextAvailable: true,
        };
        const materialNames = (project.sourceMaterials ?? []).map(item => item.fileName).join("、") || project.fileName;
        await appendProjectRevision(index, "materials", "materials", materialsSnapshot, createdAt, source, `${materialNames} · ${(project.sourceText ?? "").length} 字`);
    }
    async function bootstrapProjectRevisionHistory(projectId: string, previousProject?: DocumentProject): Promise<DocumentProjectRevisionIndex> {
        const index: DocumentProjectRevisionIndex = { version: 1, projectId, revisions: [] };
        const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
        const historicalRuns: Array<{
            createdAt: string;
            run: Partial<DocumentRun>;
        }> = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            try {
                const run = JSON.parse(await readFile(path.join(runsDir, entry.name, "run.json"), "utf8")) as Partial<DocumentRun>;
                if (run.projectId !== projectId || !Array.isArray(run.caseSnapshots))
                    continue;
                historicalRuns.push({ createdAt: run.startedAt ?? run.completedAt ?? new Date(0).toISOString(), run });
            }
            catch { /* ignore legacy or partial run folders; the run store remains authoritative */ }
        }
        historicalRuns.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        for (const { createdAt, run } of historicalRuns) {
            await appendProjectCasesRevisions(index, run.caseSnapshots!, createdAt, "run-snapshot");
            if (run.materialVersion || run.sourceMaterialsSnapshot?.length) {
                const snapshot = { fileName: previousProject?.fileName ?? "历史运行资料", sourceFiles: previousProject?.sourceFiles ?? [], sourceRoles: previousProject?.sourceRoles ?? [], sourceMaterials: run.sourceMaterialsSnapshot ?? [], sourceText: null, materialVersion: run.materialVersion ?? null, sourceTextAvailable: false };
                const materialNames = (run.sourceMaterialsSnapshot ?? []).map(item => item.fileName).join("、") || "资料内容未由该历史运行保存";
                await appendProjectRevision(index, "materials", "materials", snapshot, createdAt, "run-snapshot", `${materialNames} · 历史运行快照`);
            }
        }
        if (previousProject)
            await appendProjectStateRevisions(index, previousProject, previousProject.updatedAt ?? previousProject.createdAt ?? new Date().toISOString(), "saved-project");
        return index;
    }
    async function loadDocumentProjects(): Promise<DocumentProject[]> {
        await mkdir(projectsDir, { recursive: true });
        const { readdir } = await import("node:fs/promises");
        const values: DocumentProject[] = [];
        for (const name of await readdir(projectsDir).catch(() => [])) {
            try {
                const project = JSON.parse(await readFile(path.join(projectsDir, name), "utf8")) as DocumentProject;
                // Old projects did not encode their client surface. Do not infer it from names or URLs.
                if (!project.platform)
                    project.platform = { type: "unknown", status: "needs-confirmation" };
                if (Array.isArray(project.cases))
                    project.cases = project.cases.map((item: BrowserCheck) => {
                        const category = caseCategories.includes(item?.category) ? item.category : inferCaseCategory(`${item?.title ?? ""} ${item?.source ?? ""}`);
                        const confidence = item?.confidence === "high" || item?.confidence === "low" || item?.confidence === "medium" ? item.confidence : confidenceFromExpectation(typeof item?.expected === "string" ? item.expected : "");
                        const existingAreas = Array.isArray(item?.coverageAreas) ? item.coverageAreas.filter(area => caseCategories.includes(area)) : [];
                        const normalized = { ...item, category, confidence, coverageAreas: [...new Set<CaseCategory>([category, ...existingAreas])] };
                        const plan = planCaseExecution(normalized);
                        return { ...normalized, executionRoute: plan.route, executionReason: plan.reason, nextAction: plan.nextAction };
                    });
                values.push(project);
            }
            catch { /* ignore partial files */ }
        }
        return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async function saveDocumentProjectSerial(project: DocumentProject): Promise<void> {
        await mkdir(projectsDir, { recursive: true });
        const projectPath = path.join(projectsDir, `${project.id}.json`);
        let previousProject: DocumentProject | undefined;
        try {
            previousProject = JSON.parse(await readFile(projectPath, "utf8")) as DocumentProject;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
        }
        // Writers that loaded an old record and saved it without a platform selection must retain
        // the explicit unknown state. Never guess from project name, URL, or historical cases.
        const projectToSave: DocumentProject = project.platform
            ? project
            : { ...project, platform: { type: "unknown", status: "needs-confirmation" } };
        await atomicWriteFile(projectPath, JSON.stringify(projectToSave, null, 2));
        let index = await readRevisionIndex(project.id);
        if (!index)
            index = await bootstrapProjectRevisionHistory(project.id, previousProject);
        await appendProjectStateRevisions(index, projectToSave, projectToSave.updatedAt ?? new Date().toISOString(), "saved-project");
        await atomicWriteFile(path.join(projectRevisionDirectory(project.id), "index.json"), JSON.stringify(index, null, 2));
    }
    async function saveDocumentProject(project: DocumentProject): Promise<void> {
        const previous = projectSaveTails.get(project.id) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(() => saveDocumentProjectSerial(project));
        projectSaveTails.set(project.id, operation);
        try {
            await operation;
        }
        finally {
            if (projectSaveTails.get(project.id) === operation)
                projectSaveTails.delete(project.id);
        }
    }
    /** Compare inside the same save queue used by every project writer. */
    async function importCasesIfDigest(projectId: string, expectedDigest: string, cases: BrowserCheck[]): Promise<boolean> {
        let imported = false;
        const previous = projectSaveTails.get(projectId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            const project = await getDocumentProject(projectId);
            if (!project || createHash('sha256').update(canonicalCasesJSON(project.cases)).digest('hex') !== expectedDigest)
                return;
            const updated = { ...project, cases: structuredClone(cases), reviewStatus: 'draft' as const, updatedAt: new Date().toISOString() };
            await saveDocumentProjectSerial(updated);
            imported = true;
        });
        projectSaveTails.set(projectId, operation);
        try {
            await operation;
        }
        finally {
            if (projectSaveTails.get(projectId) === operation)
                projectSaveTails.delete(projectId);
        }
        return imported;
    }
    /** Mutate metadata against the latest persisted project within the shared save queue. */
    async function mutateProject(projectId: string, update: (project: DocumentProject) => void): Promise<DocumentProject | undefined> {
        let updated: DocumentProject | undefined;
        const previous = projectSaveTails.get(projectId) ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            const project = await getDocumentProject(projectId);
            if (!project)
                return;
            update(project);
            await saveDocumentProjectSerial(project);
            updated = structuredClone(project);
        });
        projectSaveTails.set(projectId, operation);
        try {
            await operation;
        }
        finally {
            if (projectSaveTails.get(projectId) === operation)
                projectSaveTails.delete(projectId);
        }
        return updated;
    }
    async function ensureProjectRevisionIndex(projectId: string): Promise<DocumentProjectRevisionIndex | undefined> {
        const existing = await readRevisionIndex(projectId);
        if (existing)
            return existing;
        const project = await getDocumentProject(projectId);
        if (!project)
            return undefined;
        const index = await bootstrapProjectRevisionHistory(projectId, project);
        await appendProjectStateRevisions(index, project, project.updatedAt ?? project.createdAt ?? new Date().toISOString(), "saved-project");
        await atomicWriteFile(path.join(projectRevisionDirectory(projectId), "index.json"), JSON.stringify(index, null, 2));
        return index;
    }
    async function listDocumentProjectRevisions(projectId: string, options: {
        kind?: DocumentProjectRevisionKind;
        entityId?: string;
        offset?: number;
        limit?: number;
    } = {}): Promise<{
        items: DocumentProjectRevisionSummary[];
        total: number;
    }> {
        const index = await ensureProjectRevisionIndex(projectId);
        if (!index)
            return { items: [], total: 0 };
        const filtered = index.revisions.filter(item => (!options.kind || item.kind === options.kind) && (!options.entityId || item.entityId === options.entityId))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.version - left.version || right.id.localeCompare(left.id));
        const offset = Math.max(0, Math.floor(options.offset ?? 0));
        const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
        return { items: filtered.slice(offset, offset + limit), total: filtered.length };
    }
    async function getDocumentProjectRevision(projectId: string, revisionId: string): Promise<DocumentProjectRevision | undefined> {
        if (!/^[0-9a-f-]{36}$/iu.test(revisionId))
            return undefined;
        const index = await ensureProjectRevisionIndex(projectId);
        const summary = index?.revisions.find(item => item.id === revisionId);
        if (!summary)
            return undefined;
        const record = JSON.parse(await readFile(path.join(projectRevisionDirectory(projectId), `${revisionId}.json`), "utf8")) as DocumentProjectRevision;
        if (record.projectId !== projectId || record.id !== revisionId || record.digest !== summary.digest || documentProjectRevisionDigest(record.kind, record.entityId, record.snapshot) !== record.digest)
            throw new Error("项目修订快照校验失败；为避免展示被改写的历史内容，已拒绝读取。");
        return record;
    }
    async function writeDocumentSource(project: DocumentProject, bytes: Uint8Array, originalName = project.fileName, index = 1): Promise<void> {
        const material = project.sourceMaterials?.[index - 1];
        if (!material || material.role === "website-content" || material.fileName !== originalName)
            throw new Error("保存的原始资料与项目资料清单不匹配。");
        const actualDigest = createHash("sha256").update(bytes).digest("hex");
        if (actualDigest !== material.sha256 || bytes.byteLength !== material.byteLength)
            throw new Error(`原始资料 ${originalName} 的内容与项目记录摘要不匹配；拒绝覆盖或保存不一致的文件。`);
        const key = sourceMaterialStorageKey(project.id, material);
        const filePath = path.join(projectsDir, ...key.split("/"));
        await mkdir(path.dirname(filePath), { recursive: true });
        try {
            await writeFile(filePath, bytes, { flag: "wx" });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                throw error;
            const existing = await readFile(filePath);
            if (createHash("sha256").update(existing).digest("hex") !== material.sha256 || existing.byteLength !== material.byteLength)
                throw new Error(`已存在的资料文件 ${originalName} 与记录摘要不一致；拒绝覆盖。`);
        }
    }
    async function readDocumentSource(project: DocumentProject, materialId: string): Promise<Buffer> {
        const index = (project.sourceMaterials ?? []).findIndex(item => item.id === materialId);
        const material = project.sourceMaterials?.[index];
        if (!material || material.role === "website-content")
            throw new Error("项目资料不存在或不是已上传的原始文件。");
        const key = sourceMaterialStorageKey(project.id, material);
        const currentPath = path.join(projectsDir, ...key.split("/"));
        const legacyName = `${project.id}-${index + 1}-${path.basename(material.fileName).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-120)}`;
        let bytes: Buffer;
        try {
            bytes = await readFile(currentPath);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            bytes = await readFile(path.join(projectsDir, legacyName));
        }
        if (bytes.byteLength !== material.byteLength || createHash("sha256").update(bytes).digest("hex") !== material.sha256)
            throw new Error(`原始资料 ${material.fileName} 与项目中的 SHA-256 记录不匹配；拒绝使用损坏或已被改写的资料。`);
        return bytes;
    }
    async function getDocumentProject(id: string): Promise<DocumentProject | undefined> { return (await loadDocumentProjects()).find(item => item.id === id); }
    /** Inspect only an already-open project Edge page; this never launches, navigates, or replaces a browser. */
    const repository: DocumentProjectRepository = {
        loadProjects: loadDocumentProjects,
        getProject: getDocumentProject,
        saveProject: saveDocumentProject,
        listRevisions: listDocumentProjectRevisions,
        getRevision: getDocumentProjectRevision,
        writeSource: writeDocumentSource,
        readSource: readDocumentSource,
    };
    return {
        ...repository,
        importCasesIfDigest,
        mutateProject,
        // Compatibility names used by the previous workflow module.
        loadDocumentProjects,
        saveDocumentProject,
        listDocumentProjectRevisions,
        getDocumentProjectRevision,
        writeDocumentSource,
        readDocumentSource,
        getDocumentProject,
    };
}
