import type{BrowserCheck}from './document-test-model.js';
export type ConnectedKind='publisher-unavailable'|'nonowner-detail'|'owner-detail-access'|'employee-login-fields'|'stored-application-fields'|'stored-recipient-fields'|'copy-identifiers'|'marketing-remark'|'product-remark'|'oa-template-config'|'marketing-expense'|'product-expense'|'approval-readback'|'customer-category-contract'|'warehouse-config'|'shop-config'|'submit-notification'|'lock-notification'|'cancel-notification';
/** Exact source bindings authorize bounded, read-only scenario assertions;
 * they never authorize a submission or relax the original expected result. */
export function connectedEvidenceKind(c:Pick<BrowserCheck,'expected'|'source'>):ConnectedKind|undefined{
 const e=c.expected,s=c.source??'';
 if(s.includes('企微消息通知')){
  if(e==='推送文案「员工"XXX"发起部门用书申请单，申请单号XXX，请立即查看」至对应上级')return 'submit-notification';
  if(e==='推送文案「订单锁单失败库存不足，请联系运营查看锁定库存」')return 'lock-notification';
  if(e==='推送文案「订单72小时未发货，已为你取消订单，请联系运营查看」')return 'cancel-notification';
 }
 if(e==='费用划归客户通常为外部客户（合作客户）'&&s.includes('选择营销用书'))return 'marketing-expense';
 if(e==='费用划归客户通常为内部部门（部门费用）'&&s.includes('选择产品用书'))return 'product-expense';
 if(e==='通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页'&&s.includes('数据接口层')&&s.includes('企微审批接口'))return 'approval-readback';
 if(e==='客户接口按客户分类返回（1004.00/1004.06）供H5过滤'&&s.includes('数据接口层')&&s.includes('易诚通接口'))return 'customer-category-contract';
 if(e==='快递仓仓库ID配置正确（长沙仓/天津仓）'&&s.includes('系统配置依赖'))return 'warehouse-config';
 if(e==='旺店通两个店铺ID配置正确（样书出库店铺/部门用书店铺）'&&s.includes('系统配置依赖'))return 'shop-config';
 if(e==='企微OA审批模板ID配置正确'&&s.includes('系统配置依赖')&&s.includes('关键配置项就绪校验'))return 'oa-template-config';
 if(e==='在企微架构内的在职员工：直接授权登录，进入申请表单页，自动带出姓名/所属公司/部门'&&s.includes('企微工作台入口')&&s.includes('身份校验'))return 'employee-login-fields';
 if(e==='仅申请发起人本人可见并可进入「查看明细」入口'&&s.includes('员工端-用书审批详情页')&&s.includes('查看申请明细'))return 'owner-detail-access';
 if(e==='本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）'&&s.includes('出版社用书'))return 'publisher-unavailable';
 if(e==='越权：非发起人通过URL/申请单号直接访问他人明细，返回无权限且不展示数据'&&s.includes('员工端-用书审批详情页'))return 'nonowner-detail';
 if(e==='申请单自身字段（申请人/用途/收件信息/备注/数量）实时读申请单记录，与提交内容一致'&&s.includes('员工端-申请表单明细展示页'))return 'stored-application-fields';
 if(e==='收件人/手机号/所在地区/详细地址、备注按提交内容完整原样回显'&&s.includes('员工端-申请表单明细展示页'))return 'stored-recipient-fields';
 if(e==='申请编号/订单号支持一键复制按钮（H5设计稿已确认新增，便于技术排查）'&&s.includes('员工端-历史申请记录页'))return 'copy-identifiers';
 if(e==='后端备注=「发送样书」+该流程企微审批编号+用户选填备注'&&s.includes('选择营销用书'))return 'marketing-remark';
 if(e==='后端备注=「内部样书」+企微审批编号+用户选填备注'&&s.includes('选择产品用书'))return 'product-remark';
}
