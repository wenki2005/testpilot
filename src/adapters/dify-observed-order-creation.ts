import type{DepartmentCreationBaseline}from'./dify-creation-receipts.js';
import{readDepartmentApplicationSnapshot}from'./mysql-readonly-browser.js';
type Row=Record<string,any>;
export function departmentMinute(value:unknown){const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);return match?Date.parse(match[1]+'T'+match[2]+':00+08:00'):NaN;}
export function assertCreationTimes(before:string,approval:unknown,detail:unknown,trade:unknown){
 const pending=Date.parse(before),approved=departmentMinute(approval),created=departmentMinute(detail),traded=departmentMinute(trade);
 if(![pending,approved,created,traded].every(Number.isFinite))throw Error('Blocked: 真实创建链路的观察时间或接口下单时间缺失，未猜测时间。');
 if(pending>=approved)throw Error('Blocked: 创建收据没有保留审批前的无订单观察，未用当前状态重建历史。');
 if(created<approved)throw Error('断言失败：按接口可用分钟精度，订单时间早于审批完成时间。');
 if(created!==traded)throw Error('断言失败：订单详情创建/下单时间与管理订单tradeTime在共同分钟精度不一致。');
}
export async function verifyObservedOrderCreation(baselines:DepartmentCreationBaseline[],rows:Row[],userId:string,get:(path:string)=>Promise<Row>,snapshot=readDepartmentApplicationSnapshot){
 if(baselines.length>20)throw Error('Blocked: 创建事件超过本轮限定范围。');
 let approved=0,rejected=0,pending=0;const approvedRecords:Array<{usage:number;quantity:number}>=[];
 for(const before of baselines){
  const a=await snapshot(before.applyNo,userId);if(!a)throw Error('Blocked: 创建收据不能按当前本人匹配申请。');
  const status=Number(a.examine_status),lock=Number(a.lock_status),orders=rows.filter(r=>r.applyNo===before.applyNo);
  if(![0,1,2].includes(status))continue;
  const p=(await get('dept/book/apply/progress/'+before.applyNo)).data;
  if(p?.applyNo!==before.applyNo||Number(p.examineStatus)!==status||Number(p.lockStatus)!==lock)throw Error('Blocked: 核验期间审批状态变化或进度与数据库不一致。');
  if(status===0||status===2){
   if(a.order_id||orders.length||p.orderCard?.orderId)throw Error('断言失败：审批未通过的本轮申请出现订单。');
   if(status===2){const node=p.timeline?.find((n:Row)=>n.node==='审批'&&n.reached);if(!node||!(Date.parse(before.verifiedAt)<departmentMinute(node.time)))throw Error('Blocked: 驳回样本缺审批前后时间对照。');rejected++;}else pending++;
   continue;
  }
  if(lock!==1){if(a.order_id||orders.length)throw Error('断言失败：审批通过但锁单未成功的本轮申请出现订单。');continue;}
  if(orders.length!==1||orders[0]!.orderId!==a.order_id||p.orderCard?.orderId!==a.order_id)throw Error('Blocked: 本轮新订单尚未与本人申请、管理列表和进度唯一对应。');
  const detail=(await get('h5/dept/book/order/detail/'+encodeURIComponent(String(a.order_id)))).data,node=p.timeline?.find((n:Row)=>n.node==='审批'&&n.reached);
  if(detail?.applyNo!==before.applyNo||detail.orderId!==a.order_id||!node)throw Error('Blocked: 新订单明细或审批完成节点未对应原申请。');
  assertCreationTimes(before.verifiedAt,node.time,detail.createTime,orders[0]!.tradeTime);
  const quantity=Array.isArray(detail.goodsList)?detail.goodsList.reduce((sum:number,g:Row)=>sum+Number(g.buyNum),0):NaN;if(!Number.isInteger(quantity)||quantity<1||before.quantity!==undefined&&quantity!==before.quantity)throw Error('断言失败：审批后订单总本数与真实提交断点不一致。');
  approvedRecords.push({usage:Number(a.book_usage),quantity});
  approved++;
 }
 return{approved,rejected,pending,approvedRecords,complete:approved>0&&rejected>0};
}
