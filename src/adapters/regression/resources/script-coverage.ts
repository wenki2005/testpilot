import { connectedEvidenceKind } from '../../../domain/regression/connected-evidence-contract.js';
import type { ResourceCase } from './project-resource-contract.js';
import { scriptGapRequirement } from './script-gap-requirements.js';
import { employeeApplicationReadOnlyKind } from '../scenarios/records/employee-application-readonly.js';
export type ScriptSupport = { kind: 'steps' | 'specialized' | 'authorized-write' | 'clarification' | 'outside' | 'missing'; label: string; handler: string; source: string; nextAction: string };
/** Implementation coverage only; never reads or manufactures an execution verdict. */
export function scriptSupport(c: Pick<ResourceCase, 'title' | 'expected' | 'sourcePath' | 'script'>): ScriptSupport {
    const source = c.sourcePath.join(' > ');
    if (/本期不做统计看板|兼职暂不涉及|^\/\/ 前置：本期均走/.test(c.expected)) return { kind: 'outside', label: '范围外', handler: '', source: '', nextAction: '保留原用例和原始范围说明，不算自动化通过。' };
    if (/待澄清|需澄清/.test(c.expected)) return { kind: 'clarification', label: '待澄清', handler: '', source: '', nextAction: '确认原始预期后更新用例版本，再编写完整断言。' };
        if (c.script.steps.length) return { kind: 'steps', label: '已保存步骤', handler: 'browser-steps', source: 'src/adapters/regression/browser/module-browser.ts', nextAction: '仍需满足前置、账号、数据及覆盖审核，按真实结果判定。' };
    const connected = connectedEvidenceKind({ expected: c.expected, source });
    if (connected?.startsWith('admin-filter-')) return { kind: 'specialized', label: '专项执行器（接口子检查）', handler: connected, source: 'src/adapters/regression/scenarios/orders/admin-filter-contract.ts', nextAction: '已补OpenAPI参数、完整分页、筛选集合及基线稳定性断言；后台控件、模糊交互和角色页面仍待实际验证，不算整条通过。' };
    if (connected) return { kind: 'specialized', label: '专项执行器', handler: connected, source: 'src/adapters/regression/scenarios/connected-systems.ts', nextAction: '运行时核对页面、接口、数据库及同单证据；缺条件保留具体阻塞，不以页面外壳通过。' };
    if (/全部必填完成且格式正确/.test(c.expected) && source.includes('提交申请')) return { kind: 'authorized-write', label: '授权提交执行器', handler: 'department-submit', source: 'src/adapters/regression/scenarios/application/submit-application.ts', nextAction: '使用当前轮授权、指定测试数据及唯一标记；真实提交后独立查库，未知结果先查不重放。' };
    const gap = scriptGapRequirement(c);
    if (gap) return { kind: 'missing', handler: '', source: '', ...gap };
    if (/实时调易诚通商品接口|商品接口查询失败|库存查询失败|开单接口返回错误|72小时/.test(c.expected)) return { kind: 'missing', label: '需补专项断言', handler: '', source: '', nextAction: '需正确上游调用、失败注入或调度事件的读回接口；不能用整页接口失败或SQL伪造状态代替。' };
    if (source.includes('管理端后台')) return { kind: 'missing', label: '需补后台界面断言', handler: '', source: '', nextAction: '数据库可验证迁移数据；菜单、筛选、导出和角色权限仍需对应页面/API及角色。不得仅因缺后台入口断言数据不存在。' };
    if (/审批流=/.test(c.expected)) return { kind: 'missing', label: '需补审批节点断言', handler: '', source: '', nextAction: '关联同一申请的真实审批节点、直属上级和流程配置；审批号存在不能证明单级路由正确。' };
    return { kind: 'missing', label: '需补专项断言', handler: '', source: '', nextAction: '结合前端、接口与数据库定位完整预期的证据；保留缺失字段或事件，不用占位步骤凑覆盖率。' };
}
export function scriptCoverage(cases: ResourceCase[]) {
    const rows = cases.map(c => ({ moduleId: c.moduleId, id: c.id, title: c.title, savedSteps: c.script.steps.length, ...scriptSupport(c) }));
    return { total: rows.length, missingStepFiles: rows.filter(c => !c.savedSteps).length, counts: Object.fromEntries(['steps', 'specialized', 'authorized-write', 'clarification', 'outside', 'missing'].map(kind => [kind, rows.filter(c => c.kind === kind).length])), rows };
}
