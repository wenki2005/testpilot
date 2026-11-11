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
                'xmind-2-026', 'xmind-2-054', 'xmind-2-022'
            ]),
            step('pc-application', 'PC 申请入口', '新版 PC 用书申请页面与 H5 入口保持同一申请规则。', [
                'xmind-2-038'
            ]),
            step('application-records', '我的申请列表', '提交后的申请可以在我的申请列表中按新版筛选、状态和详情规则查询。', [
                'xmind-2-061'
            ])
        ] },
    { id: 'reject-reapply', title: '申请撤销与订单取消', description: '只覆盖新版 P0 的申请详情和订单详情，核对撤销、取消及状态回传。', steps: [
            step('application-detail', '申请详情与撤销', '申请详情页能够展示新版字段，并按状态提供撤销或后续处理入口。', [
                'xmind-2-057', 'xmind-2-080', 'xmind-2-085',
                'xmind-2-081', 'xmind-2-090', 'xmind-2-067', 'xmind-2-059',
                'xmind-2-088', 'xmind-2-086', 'xmind-2-069',
                'xmind-2-071'
            ]),
            step('order-detail', '订单详情与取消', '订单详情页能够展示新版订单信息、物流状态和取消限制。', [
                'xmind-2-097', 'xmind-2-103', 'xmind-2-106', 'xmind-2-107'
            ])
        ] },
    { id: 'stock-retry', title: '库存不足与定时补锁', description: '聚合库存不足、补锁任务和重试分支；只挂入用例，不自动触发补锁或业务写入。', steps: [
            step('scheduled-retry', '定时补锁任务', '新版补锁任务的触发条件、幂等性、库存判断和结果记录可按用例核验。', [ ])
        ] },
    { id: 'order-logistics', title: '企微通知与后台追踪', description: '覆盖企微通知、服务端防线、数据审计和管理端后台；需要相应角色或只读数据时再执行。', steps: [
            step('wecom-notifications', '企微消息通知', '新版申请、审批、订单和异常节点的通知内容、接收人及关联编号符合用例预期。', [ ]),
            step('service-defenses', '服务端防线', '服务端校验、存量影响和异常分支符合新版规则，不绕过业务校验。', [ ]),
            step('audit', '数据与审计', '关键状态、字段变更和审计记录可以按新版要求追溯，不能用伪造数据代替。', [ 'xmind-2-119'
            ]),
            step('admin-tracking', '后台订单追踪', '管理端订单查询、筛选和追踪结果符合新版后台用例，执行前需要管理员角色。', [ ])
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
