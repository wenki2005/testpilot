import type { DocumentProject, DocumentRunScopePlan } from "../shared/test-model.js";
import { sha256Hex } from "../../shared/sha256.js";
/** Stable case-asset version; deployed website versions are tracked separately. */
export function getDocumentCaseVersion(project: DocumentProject): string {
    const baseline = { id: project.id, caseGeneration: project.caseGeneration, apiContract: project.apiContract, cases: project.cases.map(item => ({ ...item, steps: item.steps ?? [] })) };
    return sha256Hex(JSON.stringify(baseline));
}
/** Stable source-material version; raw document bytes stay out of run records. */
export function getDocumentMaterialVersion(project: DocumentProject): string {
    const materials = (project.sourceMaterials ?? []).map(({ fileName, role, sha256, byteLength }) => ({ fileName, role, sha256, byteLength }))
        .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.role.localeCompare(b.role) || a.sha256.localeCompare(b.sha256));
    const baseline = { sourceTextSha256: sha256Hex(project.sourceText ?? ""), materials };
    return sha256Hex(JSON.stringify(baseline));
}
/** Stable version of the exact data-set identity and resolved values used by a run. */
export function getDocumentTestDataVersion(testDataSetId: string | undefined, parameterValues: Record<string, string> = {}): string {
    const values = Object.fromEntries(Object.entries(parameterValues).sort(([a], [b]) => a.localeCompare(b)));
    return sha256Hex(JSON.stringify({ testDataSetId: testDataSetId ?? null, values }));
}
export function validateDocumentRunScopePlan(value: unknown, selectedCaseIds: string[]): DocumentRunScopePlan | undefined {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("本轮测试范围说明格式无效。");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !["mode", "targetCaseIds", "impactCaseIds", "impactReasons", "prerequisiteCaseIds", "orderedCaseIds", "handoffAfterPrerequisites"].includes(key)))
        throw new Error("本轮测试范围说明包含未知字段。");
    if (input.handoffAfterPrerequisites !== undefined && typeof input.handoffAfterPrerequisites !== "boolean")
        throw new Error("handoffAfterPrerequisites 必须是布尔值。");
    const modes: DocumentRunScopePlan["mode"][] = ["single", "feature", "impact", "full", "custom"];
    if (!modes.includes(input.mode as DocumentRunScopePlan["mode"]))
        throw new Error("本轮测试范围类型无效。");
    const readIds = (key: "targetCaseIds" | "impactCaseIds"): string[] => {
        const values = input[key];
        if (!Array.isArray(values) || values.length > 200 || values.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(id)) || new Set(values).size !== values.length)
            throw new Error(`本轮测试范围的 ${key} 必须是唯一、有效的用例 ID 列表。`);
        return values as string[];
    };
    const targetCaseIds = readIds("targetCaseIds");
    const impactCaseIds = readIds("impactCaseIds");
    if (!targetCaseIds.length && !(input.mode === "impact" && impactCaseIds.length > 0))
        throw new Error("请至少选择一个直接测试目标；纯关联影响重测必须使用 impact 范围。");
    if (input.mode === "single" && (targetCaseIds.length !== 1 || impactCaseIds.length > 0))
        throw new Error("单项测试只能包含一个目标用例，不包含关联用例。");
    if (input.mode === "impact" && impactCaseIds.length === 0)
        throw new Error("影响检查范围至少要包含一条关联影响用例。");
    if (input.mode === "full" && impactCaseIds.length > 0)
        throw new Error("完整回归范围不能把用例标为关联影响项。");
    const targetIds = new Set(targetCaseIds);
    if (impactCaseIds.some(id => targetIds.has(id)))
        throw new Error("直接测试目标和关联影响用例不能重复。");
    const readOptionalIds = (key: "prerequisiteCaseIds" | "orderedCaseIds"): string[] | undefined => {
        if (input[key] === undefined)
            return undefined;
        const values = input[key];
        if (!Array.isArray(values) || values.length > 200 || values.some(id => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(id)) || new Set(values).size !== values.length)
            throw new Error(`本轮测试范围的 ${key} 必须是唯一、有效的用例 ID 列表。`);
        return values as string[];
    };
    const prerequisiteCaseIds = readOptionalIds("prerequisiteCaseIds");
    const orderedCaseIds = readOptionalIds("orderedCaseIds");
    if (prerequisiteCaseIds?.some(id => targetCaseIds.includes(id) || impactCaseIds.includes(id)))
        throw new Error("自动前置用例不能同时归类为直接目标或关联影响。");
    const included = new Set([...targetCaseIds, ...impactCaseIds, ...(prerequisiteCaseIds ?? [])]);
    if (orderedCaseIds) {
        if (orderedCaseIds.length !== included.size || orderedCaseIds.some(id => !included.has(id)))
            throw new Error("依赖执行顺序必须准确覆盖直接目标、关联影响和自动补入前置用例。");
        if (orderedCaseIds.length !== selectedCaseIds.length || orderedCaseIds.some((id, index) => id !== selectedCaseIds[index]))
            throw new Error("本轮执行用例顺序与冻结的依赖顺序不一致。");
    }
    else if (included.size !== selectedCaseIds.length || selectedCaseIds.some(id => !included.has(id)))
        throw new Error("测试范围说明必须准确覆盖本轮实际执行的用例。");
    let impactReasons: Record<string, string[]> | undefined;
    if (input.impactReasons !== undefined) {
        if (!input.impactReasons || typeof input.impactReasons !== "object" || Array.isArray(input.impactReasons))
            throw new Error("关联影响检查依据格式无效。");
        const entries = Object.entries(input.impactReasons as Record<string, unknown>);
        if (entries.length > impactCaseIds.length)
            throw new Error("关联影响检查依据只能对应本轮关联影响用例。");
        impactReasons = {};
        for (const [id, reasons] of entries) {
            if (!impactCaseIds.includes(id) || !Array.isArray(reasons) || reasons.length < 1 || reasons.length > 10 || reasons.some(reason => typeof reason !== "string" || !reason.trim() || reason.length > 300) || new Set(reasons).size !== reasons.length)
                throw new Error(`关联影响用例 ${id} 的依据必须对应本轮影响范围，并包含 1–10 条有效说明。`);
            impactReasons[id] = reasons.map(reason => (reason as string).trim());
        }
        if (Object.keys(impactReasons).length === 0)
            impactReasons = undefined;
    }
    return { mode: input.mode as DocumentRunScopePlan["mode"], targetCaseIds, impactCaseIds, ...(prerequisiteCaseIds ? { prerequisiteCaseIds } : {}), ...(orderedCaseIds ? { orderedCaseIds } : {}), ...(input.handoffAfterPrerequisites !== undefined ? { handoffAfterPrerequisites: input.handoffAfterPrerequisites as boolean } : {}), ...(impactReasons ? { impactReasons } : {}) };
}
