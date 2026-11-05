import type { BaselineComparison, BaselineDisposition, BaselineScopeGroup, CaseCategory, Check, Recovery, RunScopePlan, Step, TriageCategory, } from './types';
export const categoryOptions: Array<{
    value: CaseCategory;
    label: string;
}> = [
    { value: 'functional', label: '功能流程' }, { value: 'input-validation', label: '输入校验' }, { value: 'boundary', label: '边界条件' },
    { value: 'authentication', label: '身份认证' }, { value: 'authorization', label: '权限控制' }, { value: 'state-transition', label: '状态流转' },
    { value: 'navigation', label: '导航跳转' }, { value: 'accessibility', label: '无障碍' }, { value: 'visual', label: '视觉布局' },
    { value: 'security', label: '安全' }, { value: 'performance', label: '性能' }, { value: 'compatibility', label: '兼容性' },
    { value: 'resilience', label: '异常恢复' }, { value: 'other', label: '其他' },
];
export const baselineDispositionLabels: Record<BaselineDisposition, string> = { regression: '疑似回归', fixed: '已修复', unchanged: '未变化', 'case-changed': '用例已变更', added: '新增用例', removed: '已移除', 'not-run': '本轮未运行', 'no-baseline-result': '基线无结果', unresolved: '无法比较' };
export const baselineStatusLabels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', 'not-run': '未运行', cancelled: '已取消', 'not-applicable': '不适用' };
export const runScopeLabels: Record<RunScopePlan['mode'], string> = { single: '单项测试', feature: '功能测试', impact: '影响检查', full: '全量回归', custom: '自定义范围' };
export function normalizedSiteOrigin(targetUrl?: string): string {
    try {
        return targetUrl ? new URL(targetUrl).origin.toLocaleLowerCase() : '';
    }
    catch {
        return '';
    }
}
export const baselineScopeGroupLabels: Record<BaselineScopeGroup, string> = { target: '直接目标', impact: '关联影响检查', unselected: '本轮未选 · 未验证', removed: '已从当前项目移除', unknown: '历史范围未标注' };
export function baselineScopeGroup(item: BaselineComparison, scope?: RunScopePlan): BaselineScopeGroup {
    if (item.disposition === 'removed')
        return 'removed';
    if (!scope)
        return 'unknown';
    if (scope.targetCaseIds.includes(item.caseId))
        return 'target';
    if (scope.impactCaseIds.includes(item.caseId))
        return 'impact';
    return 'unselected';
}
export const runOutcomeLabels: Record<string, string> = { passed: '通过', failed: '发现失败', partial: '部分完成', unresolved: '未验证', cancelled: '已取消' };
export const recoveryCaseStatusLabels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', cancelled: '已取消', 'not-run': '未运行', 'not-applicable': '不适用' };
export const triageLabels: Record<TriageCategory, string> = { 'suspected-product-regression': '疑似产品回归', 'case-or-expectation-review': '用例或预期需复核', 'locator-failure': '元素定位失效', 'environment-or-session': '环境或登录会话问题', 'test-data-or-fixture': '测试数据或 fixture 问题', 'needs-review': '待确认' };
export const editableStepActions: Array<{
    value: string;
    label: string;
}> = [
    { value: 'fillByLabel', label: '填写字段' }, { value: 'fillByPlaceholder', label: '按占位提示填写' },
    { value: 'selectByLabel', label: '选择字段选项' }, { value: 'selectByPlaceholder', label: '按占位提示选择' },
    { value: 'clickByRole', label: '点击控件' }, { value: 'clickExactText', label: '点击完全匹配文本' },
    { value: 'triggerClientValidation', label: '触发前端校验' },
    { value: 'assertText', label: '断言页面包含文本' }, { value: 'assertExactVisible', label: '断言完全匹配文本可见' },
    { value: 'assertVisible', label: '断言文本可见' }, { value: 'assertNotVisible', label: '断言文本不可见' },
    { value: 'assertValue', label: '断言字段值' }, { value: 'assertValueByPlaceholder', label: '断言占位字段值' },
    { value: 'assertDisabled', label: '断言字段禁用' }, { value: 'assertFieldInvalid', label: '断言字段无效' },
    { value: 'assertRoleVisible', label: '断言控件可见' },
];
export const stepFieldSpecs: Record<string, Array<{
    key: string;
    label: string;
    kind?: 'role';
}>> = {
    fillByLabel: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '输入值（可用参数）' }],
    fillByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '输入值（可用参数）' }],
    selectByLabel: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '选项文本或值' }],
    selectByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '选项文本或值' }],
    clickByRole: [{ key: 'role', label: '控件类型', kind: 'role' }, { key: 'name', label: '控件名称' }],
    clickExactText: [{ key: 'text', label: '完全匹配文本' }],
    triggerClientValidation: [{ key: 'name', label: '提交按钮名称' }],
    assertText: [{ key: 'text', label: '预期文本（可用参数）' }],
    assertExactVisible: [{ key: 'text', label: '预期文本（可用参数）' }],
    assertVisible: [{ key: 'text', label: '预期文本（可用参数）' }],
    assertNotVisible: [{ key: 'text', label: '不应出现的文本' }],
    assertValue: [{ key: 'label', label: '字段标签' }, { key: 'value', label: '预期值（可用参数）' }],
    assertValueByPlaceholder: [{ key: 'placeholder', label: '占位提示' }, { key: 'value', label: '预期值（可用参数）' }],
    assertDisabled: [{ key: 'label', label: '字段标签' }],
    assertFieldInvalid: [{ key: 'label', label: '字段标签' }],
    assertRoleVisible: [{ key: 'role', label: '控件类型', kind: 'role' }, { key: 'name', label: '控件名称' }],
};
export function createEditableStep(action: string): Step {
    const step: Step = { action };
    for (const field of stepFieldSpecs[action] ?? [])
        step[field.key] = field.kind === 'role' ? 'button' : '';
    return step;
}
export function parameterNames(cases: Check[]): string[] {
    const names = new Set<string>();
    for (const item of cases) {
        for (const requirement of item.testDataRequirements ?? [])
            if (requirement.required && requirement.key.trim())
                names.add(requirement.key.trim());
        for (const step of item.steps ?? [])
            for (const field of ['value', 'text', 'name']) {
                const value = step[field];
                if (typeof value !== 'string')
                    continue;
                for (const match of value.matchAll(/\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu))
                    names.add(match[1]!);
            }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}
/** All keys accepted by a project data set, including optional fixture fields. */
export function knownParameterNames(cases: Check[]): string[] {
    const names = new Set(parameterNames(cases));
    for (const item of cases)
        for (const requirement of item.testDataRequirements ?? [])
            if (requirement.key.trim())
                names.add(requirement.key.trim());
    return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}
export function filterKnownParameterValues(cases: Check[], values: Record<string, string>): Record<string, string> {
    const allowed = new Set(knownParameterNames(cases));
    return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}
export function parameterDescriptions(cases: Check[]): Record<string, string> {
    const descriptions = new Map<string, Set<string>>();
    for (const item of cases)
        for (const requirement of item.testDataRequirements ?? []) {
            const key = requirement.key.trim();
            const description = requirement.description.trim();
            if (!key || !description)
                continue;
            const values = descriptions.get(key) ?? new Set<string>();
            values.add(description);
            descriptions.set(key, values);
        }
    return Object.fromEntries([...descriptions].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, values]) => [key, [...values].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('；')]));
}
export function parameterLabel(key: string, descriptions: Record<string, string>): string {
    const description = descriptions[key];
    return description ? `${key} · ${description}` : key;
}
export function parameterInputModels(cases: Check[]): Array<{
    key: string;
    required: boolean;
    label: string;
}> {
    const required = new Set(parameterNames(cases));
    const descriptions = parameterDescriptions(cases);
    return knownParameterNames(cases).map(key => ({ key, required: required.has(key), label: parameterLabel(key, descriptions) }));
}
export const recoveryStageLabel: Record<Recovery['stage'], string> = { starting: '准备浏览器会话', deterministic: '确定性测试执行', 'computer-use': 'AI 视觉测试', 'awaiting-login': '等待同一浏览器窗口登录', analysis: '结果差异分析', report: '撰写结果报告', packaging: '打包报告和复用脚本' };
