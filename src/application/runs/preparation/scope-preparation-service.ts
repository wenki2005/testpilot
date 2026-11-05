import { validateDocumentRunScopePlan } from "../../../domain/documents/runs/run-scope.js";
import type { BrowserCheck, DocumentProject, DocumentRunScopePlan } from "../../../domain/documents/shared/test-model.js";
import type { CaseCategory } from "../../../domain/documents/shared/test-types.js";
import type { CoverageSummary } from "../../../domain/documents/shared/test-model.js";
export interface DocumentRunScopePreparationInput {
    project: DocumentProject;
    selectedCaseIds?: string[] | undefined;
    journalSelectedCaseIds?: string[] | undefined;
    scopePlan?: DocumentRunScopePlan | undefined;
    journalScopePlan?: DocumentRunScopePlan | undefined;
    isResume: boolean;
    isChildRetest: boolean;
}
/** Validate and freeze the executable case scope before any browser/session work. */
export function prepareDocumentRunScope(input: DocumentRunScopePreparationInput) {
    const { project, isResume } = input;
    const selectedCaseIds = input.selectedCaseIds ?? (isResume ? input.journalSelectedCaseIds : undefined);
    if (!isResume && !Array.isArray(input.selectedCaseIds))
        throw new Error("新运行必须显式固定 selectedCaseIds；不会回退到项目全量选中用例。");
    if (!selectedCaseIds?.length)
        throw new Error("selectedCaseIds 不能为空；拒绝启动空范围或扩大到项目全量用例。");
    if (new Set(selectedCaseIds).size !== selectedCaseIds.length)
        throw new Error("selectedCaseIds 必须由唯一用例 ID 组成。");
    if (isResume && input.selectedCaseIds && input.journalSelectedCaseIds && (input.selectedCaseIds.length !== input.journalSelectedCaseIds.length || input.selectedCaseIds.some((id, index) => id !== input.journalSelectedCaseIds![index]))) {
        throw new Error("恢复请求的用例范围与 journal 原始范围不同；拒绝扩展或缩小运行范围。");
    }
    const projectCaseIds = new Set(project.cases.map(item => item.id));
    const unknownSelectedCases = selectedCaseIds.filter(id => !projectCaseIds.has(id));
    if (unknownSelectedCases.length)
        throw new Error("用例不属于当前项目：" + unknownSelectedCases.join(", "));
    const unavailableSelectedCases = selectedCaseIds.filter(id => project.cases.some(item => item.id === id && (item.lifecycleStatus === "draft" || item.lifecycleStatus === "disabled")));
    if (unavailableSelectedCases.length)
        throw new Error(`草稿或停用用例不能运行：${unavailableSelectedCases.join(", ")}。请将完整用例标记为可运行后，再明确选择本轮范围。`);
    const validatedScopePlan = validateDocumentRunScopePlan(input.scopePlan ?? input.journalScopePlan, selectedCaseIds);
    const runnableCaseIds = project.cases.filter(item => item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled").map(item => item.id);
    const inferredFullScope = runnableCaseIds.length === selectedCaseIds.length && runnableCaseIds.every(id => selectedCaseIds.includes(id));
    const inferredScopePlan: DocumentRunScopePlan = {
        mode: inferredFullScope ? "full" : selectedCaseIds.length === 1 ? "single" : "custom",
        targetCaseIds: [...selectedCaseIds],
        impactCaseIds: [],
    };
    const scopePlan = validatedScopePlan ?? (!isResume ? inferredScopePlan : undefined);
    if (!isResume && !input.isChildRetest && scopePlan?.impactCaseIds.length) {
        const missingReasons = scopePlan.impactCaseIds.filter(id => !scopePlan.impactReasons?.[id]?.length);
        if (missingReasons.length)
            throw new Error(`每条关联影响用例都要有可追溯依据后才能启动：${missingReasons.join(", ")}。请重新分析或逐条确认关联关系。`);
    }
    if (isResume && input.scopePlan !== undefined) {
        const originalScopePlan = validateDocumentRunScopePlan(input.journalScopePlan, selectedCaseIds);
        const canonicalize = (plan: DocumentRunScopePlan | undefined) => plan ? JSON.stringify({
            mode: plan.mode,
            targetCaseIds: [...plan.targetCaseIds].sort(),
            impactCaseIds: [...plan.impactCaseIds].sort(),
            prerequisiteCaseIds: [...(plan.prerequisiteCaseIds ?? [])].sort(),
            orderedCaseIds: plan.orderedCaseIds ?? [],
            impactReasons: Object.fromEntries(Object.entries(plan.impactReasons ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, reasons]) => [id, [...reasons].sort()])),
        }) : undefined;
        if (!originalScopePlan || canonicalize(scopePlan) !== canonicalize(originalScopePlan))
            throw new Error("恢复请求不能改写 journal 中已固定的直接目标或关联影响范围。");
    }
    const selectedSet = new Set(selectedCaseIds);
    const byId = new Map(project.cases.map(item => [item.id, item]));
    const selectedCases = selectedCaseIds.map(id => byId.get(id)!).filter(Boolean);
    if (!selectedCases.length)
        throw new Error("本轮没有选中任何回归用例；请至少选择一条用例后再运行。");
    if (!isResume && scopePlan?.mode === "full" && (runnableCaseIds.length !== selectedCaseIds.length || runnableCaseIds.some(id => !selectedSet.has(id)))) {
        throw new Error("全量回归范围必须包含项目中的全部可运行用例。");
    }
    const caseScope = {
        selectedCaseIds: selectedCases.map(item => item.id),
        excludedCaseIds: project.cases.filter(item => !selectedSet.has(item.id)).map(item => item.id),
        totalCases: project.cases.length,
    };
    const runCaseSnapshots = new Map(project.cases.map(item => [item.id, structuredClone(item)]));
    const updateRunCaseSnapshots = (generatedCaseIds: string[]) => {
        for (const id of generatedCaseIds) {
            if (!selectedSet.has(id))
                continue;
            const updated = project.cases.find(item => item.id === id);
            if (updated)
                runCaseSnapshots.set(id, structuredClone(updated));
        }
    };
    const areasFor = (cases: BrowserCheck[]) => [...new Set(cases.flatMap(item => [item.category, ...(item.coverageAreas ?? [])]))].sort() as CaseCategory[];
    const projectAreas = areasFor(project.cases);
    const selectedAreas = areasFor(selectedCases);
    const coverageSummary: CoverageSummary = { projectAreas, selectedAreas, notCoveredThisRun: projectAreas.filter(area => !selectedAreas.includes(area)) };
    return { selectedCaseIds, scopePlan, selectedCases, caseScope, runCaseSnapshots, updateRunCaseSnapshots, coverageSummary };
}
