import {departmentOaTemplateBaseline} from './dify-oa-template-configuration.js';
type Row=Record<string,any>;
export function assertExpenseApplication(usage:1|2,stored:Row,data:Row,category:string){
 const expected=usage===1?'1004.00':'1004.06';
 if(category!==expected)throw Error('Blocked: 当前用途的本人记录未提供原预期所述典型客户分类样本；“通常”不作为排斥其他客户分类的强制规则。');
 if(Number(stored.book_usage)!==usage||Number(data.bookUsage)!==usage||data.applyNo!==stored.apply_no||data.costClientId!==stored.cost_client_id||data.costClientName!==stored.cost_client_name)throw Error('断言失败：本人与对应用途的申请详情客户编号/名称与独立数据库记录不一致。');
 if(!stored.cost_client_name)throw Error('Blocked: 数据库未提供可核对的费用划归客户名称。');
}
export function assertApprovalProgress(stored:Row,data:Row){
 const status=Number(stored.examine_status),lock=Number(stored.lock_status),baseline=departmentOaTemplateBaseline.find(b=>b.usage===Number(stored.book_usage));
 if(!baseline||!stored.sp_id||stored.template_id!==baseline.templateId)throw Error('Blocked: 本人申请尚无可核对的审批号及对应用途模板。');
 if(data.applyNo!==stored.apply_no||Number(data.examineStatus)!==status||Number(data.lockStatus)!==lock)throw Error('断言失败：审批进度接口的申请编号、审批状态或锁单状态与数据库不一致。');
 if(!Array.isArray(data.timeline)||!data.timeline.length||data.timeline.some((n:Row)=>typeof n.node!=='string'||!n.node))throw Error('断言失败：审批详情没有返回结构完整的时间轴。');
 if(status===2){if(!stored.reject_reason)throw Error('Blocked: 本人驳回记录没有独立的reject_reason，无法核对理由回传。');if(!data.timeline.some((n:Row)=>String(n.desc??'').includes(String(stored.reject_reason))))throw Error('断言失败：数据库已保存驳回理由，但进度接口时间轴未回传对应理由。');}
 return status;
}

/** The endpoint contract and the independently classified result are separate
 * assertions: a database join does not invent a missing upstream field. */
export function assertClientCategoryResponse(rows:Row[],classifications:Array<{code:string;category:string}>,requested:{code:string;category:string}){
 if(!rows.some(r=>r.agentId===requested.code))throw Error('Blocked: 允许分类的独立客户正样本没有由本轮查询返回。');
 for(const row of rows){const matches=classifications.filter(c=>c.code===row.agentId);if(matches.length!==1)throw Error('Blocked: 返回客户未在测试库唯一匹配分类，无法完成独立核验。');const category=matches[0]!.category;
  if(!['1004.00','1004.06'].includes(category))throw Error('断言失败：客户查询返回了原预期允许范围以外的客户分类。');
  if(row.agentType!==undefined&&row.agentType!==category)throw Error('断言失败：接口客户分类字段与数据库独立分类不一致。');
 }
 return rows.every(row=>typeof row.agentType==='string');
}
