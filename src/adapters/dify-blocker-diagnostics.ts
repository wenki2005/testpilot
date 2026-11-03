import type {BrowserCheck} from './document-test-workflow.js';
import type {RegressionDatabaseEvidence} from '../domain/regression-database-contract.js';

/** Append current, account-scoped facts, without changing verdicts or expected results. */
export function departmentBlockerDiagnostic(check:Pick<BrowserCheck,'source'|'expected'>,evidence?:RegressionDatabaseEvidence):string|undefined{
 const v=evidence?.blockerInventory;if(!v)return;
 const own=v.states.filter(s=>s.own),total=(key:'count'|'multiLine'|'orderReferences',rows=v.states)=>rows.reduce((n,s)=>n+s[key],0);
 const states=own.map(s=>`审批状态${s.status}/锁定状态${s.lockStatus}/用途${s.usage}：${s.count}条`).join('；')||'本人申请0条';
 const s=check.source??'',e=check.expected,l=v.links;
 if(s.includes('员工端-用书审批详情页')&&/审核通过：|审核驳回：|全部审批状态/.test(e))return `已查biz_dept_book_apply.examine_status、lock_status、book_usage，当前认证账号${total('count',own)}条申请（${states}）；全库${total('count')}条。其他账号的状态样本不能代替本人页面验收。`;
 if(s.includes('员工端-申请表单明细展示页')&&e==='多行样书明细逐行展示小计，总计=∑小计、预估总重=∑(数量×单本重量)')return `已按biz_dept_book_apply_goods.apply_id关联申请，当前认证账号多行申请${total('multiLine',own)}条，全库多行申请${total('multiLine')}条；数量qty、定价price、小计subtotal、单本重量unit_weight字段存在。缺的是当前账号可访问的多行样本，不是缺表或缺字段。`;
 if(s.includes('员工端-申请表单明细展示页')&&/实时调易诚通商品接口|商品接口查询失败/.test(e))return `本人申请${total('count',own)}条，详情接口和明细表均可读取；本地有product_id、qty、price、unit_weight，但存储快照不能证明易诚通实时调用。biz_third_party_failure_log.business_ref按申请号/审批号/订单引用关联${l.linkedFailures}条；当前缺相应上游调用跟踪或可控失败契约，未用整个详情接口失败冒充商品接口失败。`;
 if(s.includes('系统配置依赖')){
  if(e==='企微OA审批模板ID配置正确')return `已查biz_dept_book_apply.template_id与biz_wechat_oa_template.template_id，${l.applications}条申请中${l.matchingTemplates}条命中有效模板。模板字段与记录存在；仍需本环境应使用哪个模板的独立基线，存在/关联成功不等于配置正确。`;
  if(/仓库ID|店铺ID/.test(e))return `sys_config按dept/warehouse/wdt/template/shop检索配置键${v.configurationKeys}条；已查到仓库表biz_carrier_warehouse及关联表biz_carrier_warehouse_rel。尚未取得本流程长沙仓/天津仓和两个旺店通店铺的权威ID映射，不能用任意仓库或其他业务店铺顶替。`;
 }
 if(s.includes('企微消息通知'))return `申请表存在sp_id、approver_userid、lock_fail_notified、auto_restock_notified；全库锁单失败已通知标记${v.notificationFlags.lockFailure}条、自动补货已通知标记${v.notificationFlags.restock}条。biz_sync_outbox.aggregate_key按申请号/订单引用关联${l.linkedOutbox}条；这些字段不能代替本条通知对象、原文和投递成功证据。`;
 if((s.includes('数据接口层')||s.includes('订单')||s.includes('物流'))&&/订单|出库|物流|锁单|库存|推送/.test(e))return `申请表order_id非空${l.orderReferences}条，按biz_order.order_id/out_order_id/主键三种候选关系命中${l.matchedOrders}条，按biz_order_logistics.order_id关联${l.linkedLogistics}条；当前账号订单引用${total('orderReferences',own)}条。已定位字段，但当前关联数据和服务端事件证据不足，未将其他业务订单或状态字段当流程执行成功。`;
}
