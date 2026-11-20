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
    {
        id: 'apply-flow',
        title: '用书申请：提交 → 待审批 → 记录明细',
        description: '从提交一张测试申请单开始，检查待审核状态、审批人文案、明细回显与全部状态入口。提交会真实创建一条待审批记录。',
        steps: [
            step('submit', '提交申请', '全部必填完成且格式正确：提交按钮可点击，跳转用书审批详情页并创建待审核记录。', ['xmind-1-050']),
            step('pending', '待审核状态', '待审核状态按钮置灰，展示申请编号与申请信息。', ['xmind-1-053']),
            step('approver', '审批人文案', '待审批记录展示「审批人 张三（待审批）」。', ['xmind-2-089']),
            step('rows', '样书明细', '多行明细逐行展示小计，总计与预估总重计算正确。', ['xmind-1-075']),
            step('echo', '字段回显', '收件人、手机号、地址与备注按提交内容原样回显。', ['xmind-1-078']),
            step('status-entry', '全部状态入口', '各审批状态均展示「查看明细」入口。', ['xmind-1-056'])
        ]
    },
    {
        id: 'order-flow',
        title: '订单与物流：列表 → 详情',
        description: '从订单列表进入详情，再取消待发货订单并撤回申请，检查按钮消失与时间轴节点。取消属于写操作。',
        steps: [
            step('order-list', '订单列表', '订单列表展示订单号、状态与查看明细入口。', ['xmind-1-080']),
            step('order-detail', '订单详情', '展示对应订单详情。', ['xmind-1-084'])
        ]
    }
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
