import { createHash } from 'node:crypto';
import type { ProjectResources, ResourceCase } from './project-resource-contract.js';
import type { CaseVersionRow } from './case-markdown-import.js';

/** Deterministic matching hints, not model-generated expectations or runnable scripts. */
export const normalizeCaseText = (text: string) => text.normalize('NFKC')
    .replace(/^\[需澄清\]\s*/u, '').replace(/^[✅❌⚠️🔄\s]*(?:P[0-3]\s*)?/u, '')
    .replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase();
const areaText = (text: string) => normalizeCaseText(text.replace(/[（(][^）)]*[）)]/g, ''))
    .replace(/(?:pc|h5)/g, '').replace(/样书|用书/g, '')
    .replace(/历史申请记录页|我的申请列表|历史记录页/g, '申请记录')
    .replace(/审批详情页|申请详情页/g, '申请详情')
    .replace(/申请表单页|申请页/g, '申请表单');
const grams = (text: string) => {
    const chars = [...text]; return new Set(chars.length < 2 ? chars : chars.slice(0, -1).map((c, i) => c + chars[i + 1]));
};
export function caseTextSimilarity(left: string, right: string) {
    const a = grams(left), b = grams(right);
    return a.size && b.size ? 2 * [...a].filter(token => b.has(token)).length / (a.size + b.size) : 0;
}
export function importArea(path: string[]) { return path.length > 1 ? path[1]! : path[0] ?? ''; }
const compatibleArea = (row: CaseVersionRow, candidate: ResourceCase) => {
    const a = areaText(importArea(row.sourcePath)), b = areaText(importArea(candidate.sourcePath));
    return !!a && !!b && (a === b || caseTextSimilarity(a, b) >= 0.62);
};
export function matchImportedCase(row: CaseVersionRow, cases: ResourceCase[]): { value: ResourceCase; reason: string } | undefined {
    const text = normalizeCaseText(row.expected);
    if (!text) return;
    const exact = cases.filter(c => normalizeCaseText(c.expected) === text || normalizeCaseText(c.sourceExpected) === text);
    const scoped = exact.length > 1 ? exact.filter(c => compatibleArea(row, c)) : exact;
    if (scoped.length === 1) return { value: scoped[0]!, reason: '预期原文一致' };
    // Changed cases require a unique reciprocal candidate and an independent page context.
    // Generic short status/button text cannot establish identity across new scenarios.
    if (text.length < 18) return;
    const ranked = cases.filter(c => compatibleArea(row, c)).map(value => ({ value, score: caseTextSimilarity(text, normalizeCaseText(value.expected)) })).sort((a, b) => b.score - a.score);
    const first = ranked[0];
    if (first && first.score >= 0.6 && first.score - (ranked[1]?.score ?? 0) >= 0.22)
        return { value: first.value, reason: '同页面预期高度相近，脚本需核对' };
}
export function inferImportModule(current: ProjectResources, row: CaseVersionRow): { module: ProjectResources['modules'][number]; created: boolean; reason: string } {
    const named = current.modules.filter(m => row.sourcePath.includes(m.name));
    if (named.length === 1) return { module: named[0]!, created: false, reason: '模块名称一致' };
    const area = importArea(row.sourcePath), normalized = areaText(area);
    if (!normalized)
        return { module: { id: '', name: '' }, created: false, reason: '缺少导航模块' };
    const aliases: Array<[RegExp, RegExp]> = [
        [/员工端h5|样书申请表单|申请表单/, /申样申请与经销商数据/],
        [/员工端pc|pc端适配/, /pc\/h5/],
        [/我的申请|申请记录/, /申请记录与审批详情/],
        [/申请详情|审批详情/, /申请记录与审批详情/],
        [/订单列表|订单详情|物流|补锁/, /订单与物流/],
        [/企微消息|系统配置/, /登录入口与公共基础/],
        [/管理端后台|数据接口|服务端防线/, /订单与物流|申样申请与经销商数据/],
    ];
    const alias = aliases.find(([pattern]) => pattern.test(normalized));
    if (alias) {
        const target = current.modules.find(m => alias[1].test(m.name));
        if (target) return { module: target, created: false, reason: '按业务导航自动归类' };
    }
    const scores = current.modules.map(module => {
        const paths = current.cases.filter(c => c.moduleId === module.id).map(c => importArea(c.sourcePath));
        const score = Math.max(caseTextSimilarity(normalized, areaText(module.name)), ...paths.map(path => caseTextSimilarity(normalized, areaText(path))));
        return { module, score };
    }).sort((a, b) => b.score - a.score);
    if (normalized && scores[0]!.score >= 0.62 && scores[0]!.score - (scores[1]?.score ?? 0) >= 0.15)
        return { module: scores[0]!.module, created: false, reason: '导航页面归属一致' };
    const digest = createHash('sha256').update(current.project.id + ':' + area).digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const name = area.slice(0, 120);
    return { module: { id, name }, created: true, reason: '按新版导航自动建立模块' };
}
