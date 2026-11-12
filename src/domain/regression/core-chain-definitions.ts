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
        id: 'submit-cancel',
        title: '主干流程：提交申请 → 撤销 → 已取消',
        description: '一条从登录到提交、再撤销刚提交申请的完整主线。链路会真实创建一张申请单并自行取消，不依赖人工准备数据。',
        steps: [
            step('login', '登录与入口', '企微员工直接授权登录进入申请表单页，带出姓名/所属公司/部门。', [
                'xmind-1-001'
            ]),
            step('form', '申请表单', '表单不展示申请人字段，也不出现本人申请/代人申请切换。', [
                'xmind-2-054'
            ]),
            step('detail-rows', '样书明细', '编码带出图书信息，可继续添加与删除明细行，小计、总计与预估总重计算正确。', [
                'xmind-1-025', 'xmind-1-033', 'xmind-1-035', 'xmind-1-029'
            ]),
            step('submit', '填写与提交', '必填未完成时提交按钮置灰；全部填写正确后提交成功并跳转到用书审批详情页。', [
                'xmind-1-052', 'xmind-1-050'
            ]),
            step('echo', '详情回显', '详情页按提交内容原样回显用途、收件信息、备注与数量，且为只读。', [
                'xmind-2-124'
            ]),
            step('cancel', '撤销申请', '二次确认弹窗按钮为暂不取消与确定取消；确认后页面刷新为已取消并新增时间轴节点。', [
                'xmind-2-085', 'xmind-2-081'
            ]),
            step('list-sync', '列表同步', '我的申请列表中对应记录同步显示为已取消。', [
                'xmind-2-090'
            ])
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
