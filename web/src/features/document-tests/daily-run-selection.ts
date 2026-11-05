import { canSelectCaseForRun } from './case-selection';
import type { Check } from './types';
export const allDailyCasesKey = '__all__';
/** Display classification only: preserve the original case and its source breadcrumb. */
export function dailyCaseModulePath(item: Check): string[] {
    if (/(?:^|-)subcheck(?:-|$)/u.test(item.id))
        return ['补充检查', '页面局部检查'];
    const source = (item.source ?? '').split(' › ').map(part => part.trim());
    if (source.length >= 3 && /\.(?:xmind|docx?|pdf|md|txt)$/iu.test(source[0] ?? ''))
        return [source[1]!];
    const explicit = item.modulePath?.filter(Boolean) ?? [];
    if (explicit[0] === '07只读子检查')
        return ['补充检查', '提交后只读核对'];
    if (explicit[0] === 'PC核心回归')
        return ['补充检查', 'PC核心候选'];
    return explicit;
}
export function dailyModuleOptions(cases: Check[]): Array<[
    string,
    string[]
]> {
    const paths = new Map<string, string[]>([[allDailyCasesKey, ['全部用例']]]);
    for (const item of cases) {
        const parts = dailyCaseModulePath(item);
        if (!parts.length) {
            paths.set('__unassigned__', ['未分类']);
            continue;
        }
        for (let depth = 1; depth <= parts.length; depth++) {
            const prefix = parts.slice(0, depth);
            paths.set(JSON.stringify(prefix), prefix);
        }
    }
    return [...paths.entries()];
}
function belongsToDailyModule(item: Check, key: string): boolean {
    if (key === allDailyCasesKey)
        return true;
    const parts = dailyCaseModulePath(item);
    return key === '__unassigned__' ? !parts.length : parts.some((_, index) => JSON.stringify(parts.slice(0, index + 1)) === key);
}
/** Preselect only one unambiguous, approved, read-only execution scope. Never starts it. */
export function suggestedDailyModule(cases: Check[], modules: Array<[
    string,
    string[]
]>): string {
    const scopes = new Map<string, string>();
    for (const [key] of modules) {
        if (key === '__unassigned__' || key === allDailyCasesKey)
            continue;
        const ids = dailyModuleCaseIds(cases, key);
        const preview = previewDailyDependencies(cases, ids);
        const execution = preview.ordered.map(id => cases.find(item => item.id === id)!);
        if (!ids.length || preview.error || dailyExecutionIssues(execution).length
            || execution.some(item => item.selectedForRegression === false || item.sideEffectRisk !== 'none' || item.authorizedWriteOperationId))
            continue;
        const signature = JSON.stringify([...ids].sort());
        if (!scopes.has(signature))
            scopes.set(signature, key);
    }
    return scopes.size === 1 ? [...scopes.values()][0]! : '';
}
/** Returns runnable target cases for one explicitly selected module path. */
export function dailyModuleCaseIds(cases: Check[], moduleKey: string): string[] {
    if (!moduleKey)
        return [];
    return cases.filter(item => {
        return belongsToDailyModule(item, moduleKey) && canSelectCaseForRun(item);
    }).map(item => item.id);
}
export function dailyModuleSummary(cases: Check[], moduleKey: string) {
    const members = cases.filter(item => !!moduleKey && belongsToDailyModule(item, moduleKey));
    const runnable = members.filter(canSelectCaseForRun);
    return { total: members.length, runnable: runnable.length, partial: runnable.filter(item => item.coverageGap?.trim()).length, excluded: members.filter(item => !canSelectCaseForRun(item)).map(item => ({ id: item.id, title: item.title, status: item.lifecycleStatus })) };
}
export function dailyExecutionIssues(cases: Check[]): string[] {
    return cases.flatMap(item => {
        const issues: string[] = [];
        if (!item.steps?.length)
            issues.push(`${item.id} 缺少已保存步骤`);
        if (!item.expected?.trim())
            issues.push(`${item.id} 缺少可判定预期`);
        const prerequisites = item.preconditions?.filter(value => !value.includes('需要目标系统专用测试环境和/或测试账号、接口 mock/沙箱数据')) ?? [];
        if (prerequisites.length && item.preconditionsConfirmed !== true)
            issues.push(`${item.id} 的前置条件未确认`);
        return issues;
    });
}
/** Mirrors execution ordering for a quick-start readiness preview. */
export function previewDailyDependencies(cases: Check[], targetIds: string[]) {
    const byId = new Map(cases.map(item => [item.id, item]));
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string, chain: string[]) => {
        if (visiting.has(id))
            throw new Error(`前置依赖循环：${[...chain, id].join(' → ')}`);
        if (visited.has(id))
            return;
        const item = byId.get(id);
        if (!item)
            throw new Error(`缺少前置用例 ${id}`);
        if (item.lifecycleStatus === 'draft' || item.lifecycleStatus === 'disabled')
            throw new Error(`前置用例 ${id} 为草稿或停用状态`);
        visiting.add(id);
        for (const dependency of item.dependsOnCaseIds ?? [])
            visit(dependency, [...chain, id]);
        visiting.delete(id);
        visited.add(id);
        ordered.push(id);
    };
    try {
        for (const id of targetIds)
            visit(id, []);
        const targets = new Set(targetIds);
        return { ordered, prerequisites: ordered.filter(id => !targets.has(id)), error: '' };
    }
    catch (error) {
        return { ordered: targetIds, prerequisites: [] as string[], error: (error as Error).message };
    }
}
