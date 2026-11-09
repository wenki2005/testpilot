/**
 * Ordered business journeys reference the current v2 case catalog without
 * modifying the cases themselves. The stable chain ids are kept so existing
 * run history and links remain readable; only the displayed journey and its
 * case references move to the v2 `case-*` records. Only P0 cases belong to
 * these core journeys; P1/P2 cases stay available under “全部用例”.
 */
export type CoreStatus = 'passed' | 'failed' | 'blocked' | 'not_executed';
export type CoreStep = {
    id: string;
    title: string;
    expected: string;
    caseIds: string[];
};
export type CoreChain = {
    id: string;
    title: string;
    description: string;
    steps: CoreStep[];
};
const step = (id: string, title: string, expected: string, caseIds: string[]): CoreStep => ({ id, title, expected, caseIds });
export const departmentCoreChains: CoreChain[] = [
    { id: 'submit-order', title: '申请提交与申请记录', description: '只覆盖新版 P0 的 H5、PC 申请入口和我的申请列表；其余新增用例仍在全部用例中。', steps: [
            step('h5-application', 'H5 申请入口', '新版 H5 用书申请页面的表单、身份和商品信息符合用例预期。', [
                'case-3e754e26155c5930e5a1', 'case-cefbc9ba6ebd4ef2e460', 'case-3409bfaf862376586052', 'case-1fe3e5498b666b83042a'
            ]),
            step('pc-application', 'PC 申请入口', '新版 PC 用书申请页面与 H5 入口保持同一申请规则。', [
                'case-672965b9f3b8c00ff73b'
            ]),
            step('application-records', '我的申请列表', '提交后的申请可以在我的申请列表中按新版筛选、状态和详情规则查询。', [
                'case-322ab00b2955af001697', 'case-f4a334f27361aed0a094'
            ])
        ] },
    { id: 'reject-reapply', title: '申请撤销与订单取消', description: '只覆盖新版 P0 的申请详情和订单详情，核对撤销、取消及状态回传。', steps: [
            step('application-detail', '申请详情与撤销', '申请详情页能够展示新版字段，并按状态提供撤销或后续处理入口。', [
                'case-029ae95a0a4b9e5b5021', 'case-9a134e661a6001ac08ed', 'case-c09a0a51491c9ca0bccd', 'case-7898f6cb2210d0023c7a',
                'case-a37ebc23b1a322666ac2', 'case-e80db17a4c90b0fc64cd', 'case-44a77f19a03f7fe08842', 'case-15b844e0ce5e282dcd26',
                'case-dfdf16adf2561c28c635', 'case-d2af15b8f26359753a0a', 'case-c3b46b53d51da22f3452', 'case-53399d0dc0703a29daf5',
                'case-5462d257f9a46dafdcd3', 'case-7f4ca87c1b4f85b1cc9d', 'case-e89e22e33c4698d9234c'
            ]),
            step('order-detail', '订单详情与取消', '订单详情页能够展示新版订单信息、物流状态和取消限制。', [
                'case-3bd62acc9c8862c0bb5e', 'case-8e771391bfdf943546d0', 'case-e248710ad10255fa93bd', 'case-ee8781981280a9abf3ad'
            ])
        ] },
    { id: 'stock-retry', title: '库存不足与定时补锁', description: '聚合库存不足、补锁任务和重试分支；只挂入用例，不自动触发补锁或业务写入。', steps: [
            step('scheduled-retry', '定时补锁任务', '新版补锁任务的触发条件、幂等性、库存判断和结果记录可按用例核验。', [
                'case-f797e666e74d4e06340d', 'case-4130330de7ed13c22d12'
            ])
        ] },
    { id: 'order-logistics', title: '企微通知与后台追踪', description: '覆盖企微通知、服务端防线、数据审计和管理端后台；需要相应角色或只读数据时再执行。', steps: [
            step('wecom-notifications', '企微消息通知', '新版申请、审批、订单和异常节点的通知内容、接收人及关联编号符合用例预期。', [
                'case-15958fa8d319efe7fe64', 'case-35ac55aaee12d9e6cebf', 'case-f71714b2fecdc677a34a', 'case-56b6c188bd98e8a4fac4',
                'case-731e893dbff37e2e20a0', 'case-e70b89c79b53b4729c29', 'case-76c223427f2bab07b3e4'
            ]),
            step('service-defenses', '服务端防线', '服务端校验、存量影响和异常分支符合新版规则，不绕过业务校验。', [
                'case-5a9c8926188223badc30', 'case-a80a1a15132393a3b509', 'case-40a6c9c3ccdd7fe61633', 'case-49fecdc4c1ec0331d119',
                'case-a1a32521395daa0e5e80', 'case-c4579af860b2d23ced9a'
            ]),
            step('audit', '数据与审计', '关键状态、字段变更和审计记录可以按新版要求追溯，不能用伪造数据代替。', [
                'case-94ed352a5bc97e2d00ac', 'case-6be9465557e89b1761ba', 'case-dcb8dae296ef7d98dc1f', 'case-e0ae8650a2e8e65c97b1',
                'case-18d1e5ac0d5e2332076b'
            ]),
            step('admin-tracking', '后台订单追踪', '管理端订单查询、筛选和追踪结果符合新版后台用例，执行前需要管理员角色。', [
                'case-80f6ab8bc32e518ea034', 'case-b87cb60edfeb6b4a3e95', 'case-45bee02dd0ac75843900'
            ])
        ] }
];
export type CoreSource = {
    caseId: string;
    moduleId: string;
    versionId: string;
    title: string;
    expected: string;
    source: string;
};
export type CoreStepResult = CoreStep & {
    status: CoreStatus;
    detail: string;
    startedAt?: string;
    finishedAt?: string;
    evidence?: string;
    evidenceKind?: 'current-readback' | 'historical-submission';
    references?: string[];
    sources: CoreSource[];
};
export type CoreChainResult = Omit<CoreChain, 'steps'> & {
    steps: CoreStepResult[];
    references: string[];
};
export type CoreRun = {
    id: string;
    requestId: string;
    systemId: string;
    systemName: string;
    profileId: string;
    targetUrl: string;
    environment: string;
    definitionDigest: string;
    stockApplicationNos?: string[];
    createdAt: string;
    updatedAt: string;
    phase: 'queued' | 'running' | 'awaiting-login' | 'completed' | 'cancelled' | 'interrupted';
    message: string;
    chains: CoreChainResult[];
    difyRuns: Array<{
        chainId: string;
        phase: 'dispatch' | 'report';
        id: string;
        status: 'succeeded' | 'failed';
    }>;
};
export function coreChainStatus(chain: CoreChainResult): CoreStatus { const steps = chain.steps; return steps.some(s => s.status === 'failed') ? 'failed' : steps.every(s => s.status === 'passed') ? 'passed' : steps.some(s => s.status === 'blocked') ? 'blocked' : 'not_executed'; }
export type CoreState = {
    definitions: CoreChain[];
    runs: CoreRun[];
    supported: boolean;
};
