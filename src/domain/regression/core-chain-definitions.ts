/** Ordered business journeys reference original cases without modifying them. */
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
const step = (id: string, title: string, expected: string, ids: number[]): CoreStep => ({ id, title, expected, caseIds: ids.map(n => 'xmind-' + n) });
export const departmentCoreChains: CoreChain[] = [
    { id: 'submit-order', title: '提交申请 → 审批通过 → 锁单建单', description: '营销用书、产品用书两个分支；同一申请贯穿提交凭证、审批和订单。', steps: [
            step('submitted', '提交申请与落库', '真实提交成功凭证可追溯，同一申请、本人、商品及提交后待审状态可核验。', [39, 50]),
            step('application-detail', '核对申请明细', '同一申请的收件信息、备注、商品数量及金额与数据库一致。', [75, 78]),
            step('approved', '审批通过回传', '同一申请审批通过，真实进度及前端时间轴与数据库一致。', [54, 119]),
            step('order-created', '锁单成功并生成订单', '同一申请审批通过且锁单成功后生成唯一订单，订单明细对应本人及原商品。', [100, 84]),
            step('outbound', '核验最终出库规则', '营销/产品分支的最终发送备注、旺店通店铺及易诚通出库分类取得同单证据。', [6, 7, 11, 12, 15])
        ] },
    { id: 'reject-reapply', title: '提交申请 → 审批驳回 → 再次申请', description: '复用已驳回申请，检查理由、无订单及重新申请入口。', steps: [
            step('submitted', '核对原申请提交', '真实提交凭证对应本人已存在的申请。', [50]),
            step('rejected', '驳回与理由回传', '同一申请已驳回，页面展示数据库保存的真实驳回理由。', [55, 119]),
            step('no-order', '确认未锁单、未建单', '被驳回申请未锁单、无订单，管理订单列表中无该申请。', [100]),
            step('reapply-entry', '检查重新申请或联系入口', '驳回详情存在重新申请或联系审批人的可用入口。', [55]),
            step('new-application', '再次申请与新编号', '由重新申请流程产生可关联的新申请编号，不覆盖旧驳回申请。', [50, 55])
        ] },
    { id: 'stock-retry', title: '审批通过 → 库存不足 → 重试锁单', description: '依次检查天津回退、两仓不足及重试分支；成功订单不重复锁单。', steps: [
            step('approved', '库存场景申请审批通过', '指定库存场景申请已通过，进度和数据库一致。', [119]),
            step('warehouse', '按仓库优先级检查库存', '取得同笔长沙库存查询及必要时天津回退、实际锁定仓库证据。', [62, 63, 124]),
            step('shortage', '库存不足与失败提示', '真实两仓无货或部分不足时，页面显示锁单失败及协调库存提示。', [64]),
            step('retry', '协调后重试', '在真实失败申请上重试，有货建单、仍缺货保持失败且不重复订单。', [66, 67])
        ] },
    { id: 'order-logistics', title: '查找订单 → 订单详情 → 物流状态', description: '复用本人已存在订单，检查查询、逐行明细与后续物流。', steps: [
            step('search', '查找本人订单', '通过订单号关键词搜索，结果包含对应本人订单。', [82]),
            step('detail', '查看订单明细与金额', '实际打开同一订单，收件信息、商品、小计和总价与申请数据库一致。', [84, 85]),
            step('status', '核对当前订单状态', '页面状态名称、时间、说明与同一订单实时接口一致。', [85]),
            step('tracking', '查看快递单号与物流轨迹', '真实快递单号回传，轨迹内容一致且最新记录置顶。', [69, 85]),
            step('refresh', '核验物流刷新', '取得同一订单上游物流来源与每10分钟实际拉取执行证据。', [85, 126])
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
