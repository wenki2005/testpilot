import { approvedChainKind, type ApprovedChainKind } from './approval-order-contract.js';
import type { BrowserCheck } from '../documents/shared/test-model.js';
export type WelfareKind = 'welfare-permission' | 'welfare-migration-totals' | 'welfare-filter' | 'welfare-history-fields';
export type ConnectedKind = 'admin-filter-usage' | 'admin-filter-customer' | 'admin-filter-delivery' | 'admin-filter-identifiers' | ApprovedChainKind | 'admin-order-gating' | 'admin-order-columns' | 'product-outbound-route' | 'product-outbound-count' | 'available-state-detail-entry' | 'approved-appearance' | 'rejected-appearance' | 'owned-order-list-fields' | 'owned-order-detail-navigation' | 'owned-order-details-complete' | WelfareKind | 'publisher-unavailable' | 'nonowner-detail' | 'owner-detail-access' | 'employee-login-fields' | 'stored-application-fields' | 'stored-recipient-fields' | 'copy-identifiers' | 'marketing-remark' | 'product-remark' | 'oa-template-config' | 'marketing-expense' | 'product-expense' | 'approval-readback' | 'customer-category-contract' | 'warehouse-config' | 'shop-config' | 'submit-notification' | 'lock-notification' | 'cancel-notification';
/** Exact source bindings authorize bounded, read-only scenario assertions;
 * they never authorize a submission or relax the original expected result. */
export function connectedEvidenceKind(c: Pick<BrowserCheck, 'expected' | 'source'>): ConnectedKind | undefined {
    const chain = approvedChainKind(c);
    if (chain)
        return chain;
    const e = c.expected, s = c.source ?? '';
    if (s.includes('管理端后台') && s.includes('部门用书订单')) {
        if (e === '用书类型筛选（全部/营销用书/产品用书）生效') return 'admin-filter-usage';
        if (e === '划归客户支持下拉筛选与模糊搜索') return 'admin-filter-customer';
        if (e === '发货方式（全部/快递仓发货/物流仓发货）筛选生效') return 'admin-filter-delivery';
        if (e === '物流单号/企微审批单号支持模糊与精准搜索') return 'admin-filter-identifiers';
    }
    if (s.includes('选择产品用书') && e === '推送至旺店通「部门用书店铺」→ 易诚通其他出库单分类=「赠送出库」')
        return 'product-outbound-route';
    if (s.includes('选择产品用书') && e === '产品用书不论本数（3本/5本）均归为赠送出库类型')
        return 'product-outbound-count';
    if (s.includes('管理端后台（经销商系统服务端）') && s.includes('部门用书订单') && e === 'OA审批通过且锁单成功才创建订单至本页，创建订单时间即下单时间')
        return 'admin-order-gating';
    if (s.includes('管理端后台（经销商系统服务端）') && s.includes('部门用书订单') && e === '展示划归客户、用书类型、发货方式、物流单号、关联企微审批单号、易诚通其他出库单号、备注')
        return 'admin-order-columns';
    if (s.includes('员工端-用书审批详情页') && e === '审核通过：状态按钮绿色')
        return 'approved-appearance';
    if (s.includes('员工端-用书审批详情页') && e === '审核驳回：状态按钮红色，展示驳回原因文案，支持重新申请或联系审批人')
        return 'rejected-appearance';
    if (s.includes('员工端-用书审批详情页') && e === '全部审批状态（待审批/已通过/已驳回/锁单失败/已下单/已发货/已签收/已取消）均展示「查看明细」入口')
        return 'available-state-detail-entry';
    if (s.includes('员工端-订单列表页') && e === '展示对应订单详情' && s.includes('点击订单卡片'))
        return 'owned-order-detail-navigation';
    if (s.includes('员工端-订单列表页') && e === '展示订单号、状态、价格、收货信息、第一种书名称及总本数，分页每次加载20条')
        return 'owned-order-list-fields';
    if (s.includes('员工端-订单详情页') && e === '展示订单号/下单时间/收货人/手机号/地址/总价、图书明细(书名/数量/价格)、订单状态(已下单/已发货/已签收/已取消/已退单)，物流轨迹最新状态置顶，数据来自易查单/自有物流接口每10分钟刷新一次')
        return 'owned-order-details-complete';
    if (s.includes('管理端后台（经销商系统服务端）')) {
        if (s.includes('员工福利订单')) {
            if (e === '「内部图书订单管理员」与管理员角色可访问员工福利订单，其他角色不可见')
                return 'welfare-permission';
            if (e === '迁移后订单数据完整，订单总数、金额、状态与迁移前一致（数据一致性比对）')
                return 'welfare-migration-totals';
            if (e === '迁移后按原有筛选项（订单号/客户/状态等）查询结果正确')
                return 'welfare-filter';
            if (e === '迁移后历史订单详情、物流信息、备注字段无丢失')
                return 'welfare-history-fields';
        }
    }
    if (s.includes('企微消息通知')) {
        if (e === '推送文案「员工"XXX"发起部门用书申请单，申请单号XXX，请立即查看」至对应上级')
            return 'submit-notification';
        if (e === '推送文案「订单锁单失败库存不足，请联系运营查看锁定库存」')
            return 'lock-notification';
        if (e === '推送文案「订单72小时未发货，已为你取消订单，请联系运营查看」')
            return 'cancel-notification';
    }
    if (e === '费用划归客户通常为外部客户（合作客户）' && s.includes('选择营销用书'))
        return 'marketing-expense';
    if (e === '费用划归客户通常为内部部门（部门费用）' && s.includes('选择产品用书'))
        return 'product-expense';
    if (e === '通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页' && s.includes('数据接口层') && s.includes('企微审批接口'))
        return 'approval-readback';
    if (e === '客户接口按客户分类返回（1004.00/1004.06）供H5过滤' && s.includes('数据接口层') && s.includes('易诚通接口'))
        return 'customer-category-contract';
    if (e === '快递仓仓库ID配置正确（长沙仓/天津仓）' && s.includes('系统配置依赖'))
        return 'warehouse-config';
    if (e === '旺店通两个店铺ID配置正确（样书出库店铺/部门用书店铺）' && s.includes('系统配置依赖'))
        return 'shop-config';
    if (e === '企微OA审批模板ID配置正确' && s.includes('系统配置依赖') && s.includes('关键配置项就绪校验'))
        return 'oa-template-config';
    if (e === '在企微架构内的在职员工：直接授权登录，进入申请表单页，自动带出姓名/所属公司/部门' && s.includes('企微工作台入口') && s.includes('身份校验'))
        return 'employee-login-fields';
    if (e === '仅申请发起人本人可见并可进入「查看明细」入口' && s.includes('员工端-用书审批详情页') && s.includes('查看申请明细'))
        return 'owner-detail-access';
    if (e === '本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）' && s.includes('出版社用书'))
        return 'publisher-unavailable';
    if (e === '越权：非发起人通过URL/申请单号直接访问他人明细，返回无权限且不展示数据' && s.includes('员工端-用书审批详情页'))
        return 'nonowner-detail';
    if (e === '申请单自身字段（申请人/用途/收件信息/备注/数量）实时读申请单记录，与提交内容一致' && s.includes('员工端-申请表单明细展示页'))
        return 'stored-application-fields';
    if (e === '收件人/手机号/所在地区/详细地址、备注按提交内容完整原样回显' && s.includes('员工端-申请表单明细展示页'))
        return 'stored-recipient-fields';
    if (e === '申请编号/订单号支持一键复制按钮（H5设计稿已确认新增，便于技术排查）' && s.includes('员工端-历史申请记录页'))
        return 'copy-identifiers';
    if (e === '后端备注=「发送样书」+该流程企微审批编号+用户选填备注' && s.includes('选择营销用书'))
        return 'marketing-remark';
    if (e === '后端备注=「内部样书」+企微审批编号+用户选填备注' && s.includes('选择产品用书'))
        return 'product-remark';
}
