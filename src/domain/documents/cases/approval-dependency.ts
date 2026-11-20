/** 「这条用例是不是必须等审批通过才有意义」——决定本轮发不发企微、要不要等审批。 */
type Step = {
    action: string;
    status?: string;
    pattern?: string;
    text?: string;
};
export type ApprovalDependencyInput = {
    approvalDependent?: boolean | undefined;
    expected?: string;
    steps?: Step[];
};
const EXPECT = /已通过|审批通过|审核通过|审批后|审核后|审批结果|审核结果|审批进度|审核进度|驳回理由|审批同意|审核同意|已审批|已处理/u;
export function approvalDependencyOf(check: ApprovalDependencyInput): boolean {
    // 显式标记优先：编辑用例时勾了「需要审批通过」就按勾选走。
    if (check.approvalDependent === true)
        return true;
    if (check.approvalDependent === false)
        return false;
    const expected = String(check.expected ?? '');
    if (EXPECT.test(expected))
        return true;
    const steps = check.steps ?? [];
    // 打开「已通过」记录，或断言里要求审批同意的文案，都说明这条用例依赖审批结果。
    if (steps.some(step => step.action === 'openLatestRecord' && String(step.status ?? '').includes('已通过')))
        return true;
    if (steps.some(step => step.action === 'assertMatch' && /已同意|审批通过|审核通过/u.test(String(step.pattern ?? ''))))
        return true;
    return false;
}
