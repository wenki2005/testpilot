/**
 * Ordered business journeys reference the current v2 case catalog without
 * modifying the cases themselves. The stable chain ids are kept so existing
 * run history and links remain readable; only the displayed journey and its
 * case references move to the v2 `case-*` records.
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
    { id: 'submit-order', title: '申请提交与申请记录', description: '覆盖新版 H5、PC 申请入口和我的申请列表，先完成申请信息，再回看记录和状态。', steps: [
            step('h5-application', 'H5 申请入口', '新版 H5 用书申请页面的表单、身份和商品信息符合用例预期。', [
                'case-3e754e26155c5930e5a1', 'case-cefbc9ba6ebd4ef2e460', 'case-3409bfaf862376586052', 'case-16b9644420d1c88d4704',
                'case-6244905ad06126642093', 'case-b1c6f171667408ab8ba7', 'case-1fe3e5498b666b83042a', 'case-8433f5abc20715a576db',
                'case-dde81c1fb8b8717e0ef6', 'case-43871a872d51d481cfc3', 'case-134e82ecc4891c040e0a', 'case-b7451be291b3c86e3f5b'
            ]),
            step('pc-application', 'PC 申请入口', '新版 PC 用书申请页面与 H5 入口保持同一申请规则。', [
                'case-672965b9f3b8c00ff73b', 'case-79be8fad005d2daf8c83', 'case-54d6b6c901507e96d5be'
            ]),
            step('application-records', '我的申请列表', '提交后的申请可以在我的申请列表中按新版筛选、状态和详情规则查询。', [
                'case-322ab00b2955af001697', 'case-210bd718b380491949b9', 'case-f4a334f27361aed0a094', 'case-6bdf26d823c9cbb61528',
                'case-ac00a3d896e7de8dda02', 'case-32d612b73629092f6a62', 'case-8fc6f78ed7e9d45d7a46', 'case-bf21bce4708bd280e395',
                'case-f9cef3398530e915e5ef'
            ])
        ] },
    { id: 'reject-reapply', title: '申请撤销与订单取消', description: '围绕申请详情和订单详情，核对撤销、取消、状态回传及无效操作提示。', steps: [
            step('application-detail', '申请详情与撤销', '申请详情页能够展示新版字段，并按状态提供撤销或后续处理入口。', [
                'case-029ae95a0a4b9e5b5021', 'case-70f66473051e4c06ebdd', 'case-9a134e661a6001ac08ed', 'case-c09a0a51491c9ca0bccd',
                'case-35b6a36576c23ea0faf8', 'case-7898f6cb2210d0023c7a', 'case-a37ebc23b1a322666ac2', 'case-e80db17a4c90b0fc64cd',
                'case-402894c5a1257bfb929e', 'case-04b0f2fbcc0276c84d89', 'case-44a77f19a03f7fe08842', 'case-8854e311ed0edca10333',
                'case-15b844e0ce5e282dcd26', 'case-dfdf16adf2561c28c635', 'case-d2af15b8f26359753a0a', 'case-4ded51b0862222d6b082',
                'case-323bd5a3ec1d8ff393be', 'case-c3b46b53d51da22f3452', 'case-99611c48a33a75e3182f', 'case-53399d0dc0703a29daf5',
                'case-5462d257f9a46dafdcd3', 'case-53b3738ea8bd28006d51', 'case-80b71eefc374f8fa8268', 'case-7f4ca87c1b4f85b1cc9d',
                'case-e89e22e33c4698d9234c', 'case-4251004625b9bf9da462', 'case-ba1fdfd6e0b845da36d5', 'case-e0614054fd0b2510e0e9',
                'case-ffb72e55e047210a102a'
            ]),
            step('order-detail', '订单详情与取消', '订单详情页能够展示新版订单信息、物流状态和取消限制。', [
                'case-3bd62acc9c8862c0bb5e', 'case-f4205d1aa2d34416a44a', 'case-8e771391bfdf943546d0', 'case-e248710ad10255fa93bd',
                'case-f57459afde3fcf8bed89', 'case-ee8781981280a9abf3ad', 'case-c191ba20e32819f08835'
            ])
        ] },
    { id: 'stock-retry', title: '库存不足与定时补锁', description: '聚合库存不足、补锁任务和重试分支；只挂入用例，不自动触发补锁或业务写入。', steps: [
            step('scheduled-retry', '定时补锁任务', '新版补锁任务的触发条件、幂等性、库存判断和结果记录可按用例核验。', [
                'case-f797e666e74d4e06340d', 'case-639dd4cd8256eb96bfd7', 'case-caaa663e988146340461', 'case-4130330de7ed13c22d12',
                'case-624642c43528bc8733d8', 'case-24065a13a64d25da55b4', 'case-44736b0b48319525cc67', 'case-6febc85365b7d75a478a',
                'case-fa49f9e4188db941e6ae', 'case-2bd159a167a7d07870a5'
            ])
        ] },
    { id: 'order-logistics', title: '企微通知与后台追踪', description: '覆盖企微通知、服务端防线、数据审计和管理端后台；需要相应角色或只读数据时再执行。', steps: [
            step('wecom-notifications', '企微消息通知', '新版申请、审批、订单和异常节点的通知内容、接收人及关联编号符合用例预期。', [
                'case-15958fa8d319efe7fe64', 'case-35ac55aaee12d9e6cebf', 'case-f71714b2fecdc677a34a', 'case-0e5c3167aaae28d4a46b',
                'case-4ce4270494e8eb87c6eb', 'case-56b6c188bd98e8a4fac4', 'case-4a151c119f8cf6052416', 'case-731e893dbff37e2e20a0',
                'case-e70b89c79b53b4729c29', 'case-556c09a5b8424328549a', 'case-7eff30dd84e46d7a6a9f', 'case-a45407483090fe09c9f6',
                'case-76c223427f2bab07b3e4', 'case-384e83181fe7152f4fe1', 'case-6cf2affec2139d7a703e'
            ]),
            step('service-defenses', '服务端防线', '服务端校验、存量影响和异常分支符合新版规则，不绕过业务校验。', [
                'case-5a9c8926188223badc30', 'case-1f4a28efd12a98850cd5', 'case-a80a1a15132393a3b509', 'case-40a6c9c3ccdd7fe61633',
                'case-cc7b858f6b871e4ec413', 'case-41e2689045df1bc8562d', 'case-49fecdc4c1ec0331d119', 'case-5885b7d67c84e9599745',
                'case-a1a32521395daa0e5e80', 'case-c4579af860b2d23ced9a', 'case-369acb7d97cb78caab0b'
            ]),
            step('audit', '数据与审计', '关键状态、字段变更和审计记录可以按新版要求追溯，不能用伪造数据代替。', [
                'case-94ed352a5bc97e2d00ac', 'case-6be9465557e89b1761ba', 'case-cd3fe1342e3fd1e8e02b', 'case-f25a4142f5db4a632017',
                'case-dcb8dae296ef7d98dc1f', 'case-e0ae8650a2e8e65c97b1', 'case-18d1e5ac0d5e2332076b', 'case-f3b024eeb627809d8b38',
                'case-7e01805cdc6e44be5b62', 'case-c3bfcc8b48340a4c4b1c', 'case-5f5afe9f0a619d3dbf11'
            ]),
            step('admin-tracking', '后台订单追踪', '管理端订单查询、筛选和追踪结果符合新版后台用例，执行前需要管理员角色。', [
                'case-80f6ab8bc32e518ea034', 'case-f69ff0988d5f7383b1fd', 'case-b87cb60edfeb6b4a3e95', 'case-86d65314fd4592199324',
                'case-9373349b4d5b7793d8c4', 'case-45bee02dd0ac75843900', 'case-1b67784270acf952887a', 'case-3cb290db4ead65acfb0e',
                'case-a8b0e17bce01b233f288', 'case-c560a44fd4aa356654b1', 'case-2b66b7a2c3e7368a35a6', 'case-3b62b92dda65204f4876',
                'case-5d73261941d507fb7586', 'case-b0453264c326665f9aa3', 'case-638ca9b23f2b1aa999f3'
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
