import type { BrowserCheck, DocumentProject, DocumentRun } from "../shared/test-model.js";
import { checkpointRetrySelection } from "./checkpoint-retry.js";
import { planDocumentCaseDependencies } from "../cases/dependency-plan.js";
import { isSafeReadOnlyBrowserCase } from "../cases/case-authoring.js";
import { getDocumentMaterialVersion } from "./run-scope.js";
/** Compare immutable, pre-parameterization case assets with the current project DSL. */
export function compareDocumentRecoveryCaseSnapshot(frozen: BrowserCheck | undefined, current: BrowserCheck): string | undefined {
    if (!frozen)
        return `父运行缺少用例 ${current.id} 的原始资产快照，不能验证恢复完整性。`;
    const asset = (item: BrowserCheck) => ({
        expected: item.expected,
        steps: item.steps,
        entryPath: item.entryPath,
        baseline: item.baseline,
        testData: item.testData,
        preconditions: item.preconditions ?? [],
        preconditionsConfirmed: item.preconditionsConfirmed ?? false,
        dependsOnCaseIds: item.dependsOnCaseIds ?? [],
        requiredAssertions: item.requiredAssertions ?? [],
        sideEffectRisk: item.sideEffectRisk,
        authorizedWriteOperationId: item.authorizedWriteOperationId,
        writeResultOperationId: item.writeResultOperationId,
        writeResultSourceRunId: item.writeResultSourceRunId,
    });
    if (JSON.stringify(asset(frozen)) !== JSON.stringify(asset(current)))
        return `用例 ${current.id} 的步骤、预期或依赖已变化；请作为新运行重新审核，不得称为恢复旧断点。`;
}
export function planCheckpointRecovery(project: DocumentProject, parent: DocumentRun, caseId: string, stepIndex: number) {
    if (parent.projectId !== project.id)
        throw new Error("父运行不属于当前项目。");
    if (parent.materialVersion && parent.materialVersion !== getDocumentMaterialVersion(project))
        throw new Error("项目需求或测试资料版本已变化；请启动新运行。");
    if (project.reviewStatus !== "approved")
        throw new Error("当前项目尚未审核通过，不能恢复历史断点。");
    if (!parent.completedAt || !Number.isFinite(Date.parse(parent.completedAt)) || !["failed", "cancelled", "unresolved", "partial"].includes(parent.overall))
        throw new Error("仅允许恢复有合法完成时间的失败、中断或未验证运行。");
    if ((parent.sessionProfileSnapshot?.id ?? null) !== (project.activeSessionProfileId ?? null))
        throw new Error("当前账号档案与父运行不同；请选择原档案或启动新运行。");
    const version = parent.siteVersionSnapshot;
    if ((project.siteVersions?.length ?? 0) > 0 && !version)
        throw new Error("父运行没有网站版本快照；不能推测原版本，需启动新运行。");
    if (!version && (typeof parent.targetUrlSnapshot !== "string" || parent.targetUrlSnapshot !== project.targetUrl))
        throw new Error("父运行没有可验证的目标网址快照，或当前目标网址已变化；请启动新运行。");
    if (version) {
        const registered = project.siteVersions?.find(item => item.id === version.id);
        if (!registered || JSON.stringify(registered) !== JSON.stringify(version))
            throw new Error("父运行的网站版本不存在或快照已变化；请启动新运行。");
    }
    const selectedCaseIds = checkpointRetrySelection(parent, caseId, stepIndex);
    if (project.apiContract?.allowMutations === true || project.apiContract?.allowNetwork === true || project.apiContract?.allowConcurrency === true)
        throw new Error("当前项目 API 配置允许网络、写请求或并发，无法确认重放安全性；禁止自动恢复。");
    const frozenCases = new Map((parent.caseSnapshots ?? []).map(item => [item.id, item]));
    const currentCases = new Map(project.cases.map(item => [item.id, item]));
    const dependencyPlan = planDocumentCaseDependencies(project.cases, selectedCaseIds);
    const directIds = new Set(selectedCaseIds);
    const parameters = parent.parameterValues ?? {};
    for (const current of dependencyPlan.orderedCases) {
        const id = current.id;
        if (!currentCases.has(id))
            throw new Error(`恢复范围用例 ${id} 已从当前项目移除；请启动新运行。`);
        const drift = compareDocumentRecoveryCaseSnapshot(frozenCases.get(id), current);
        if (drift)
            throw new Error(drift);
        if (current.authorizedWriteOperationId || current.lifecycleStatus !== "runnable" || current.sideEffectRisk !== "none" || (current.preconditions?.length ?? 0) > 0 && current.preconditionsConfirmed !== true || !isSafeReadOnlyBrowserCase(current))
            throw new Error(`恢复范围用例 ${id} 尚未满足可运行、已确认前置且只读的条件；单次授权提交不得通过断点恢复重放。`);
        if (directIds.has(id) && current.selectedForRegression === false)
            throw new Error(`直接恢复用例 ${id} 当前未纳入回归选择；请重新启用后再恢复。`);
        const tokens = current.steps.flatMap(step => {
            const fields = step as unknown as Record<string, unknown>;
            return [fields.value, fields.text, fields.name].filter((value): value is string => typeof value === "string");
        }).flatMap(value => [...value.matchAll(/\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu)].map(match => match[1]).filter((name): name is string => Boolean(name)));
        const missingParameters = [...new Set(tokens)].filter(name => !Object.hasOwn(parameters, name));
        if (missingParameters.length)
            throw new Error(`父运行未保存用例 ${id} 所需的历史参数 ${missingParameters.join(", ")}；不能用当前数据组替代。`);
    }
    return {
        selectedCaseIds,
        orderedCaseIds: dependencyPlan.orderedCases.map(item => item.id),
        prerequisiteCaseIds: dependencyPlan.prerequisiteCaseIds,
    };
}
