import type{Page}from'playwright';import{readDepartmentAdminFilterEvidence}from'./mysql-readonly-browser.js';
import type{DepartmentCreationBaseline}from'./dify-creation-receipts.js';
import{verifyObservedOrderCreation}from'./dify-observed-order-creation.js';
type Row=Record<string,any>;type Result={status:string;detail:string};
export type AdminRecordKind='admin-order-gating'|'admin-order-columns'|'product-outbound-route'|'product-outbound-count';
export function isAdminRecordKind(kind:unknown):kind is AdminRecordKind{return ['admin-order-gating','admin-order-columns','product-outbound-route','product-outbound-count'].includes(String(kind));}
export async function verifyAdminOrderRecords(page:Page,kind:AdminRecordKind,result:Result,database=readDepartmentAdminFilterEvidence,baselines:DepartmentCreationBaseline[]=[]){
 const read=async(path:string)=>page.evaluate(async p=>{let token=localStorage.getItem('sample-apply-token');try{token=JSON.parse(token??'null');}catch{}if(typeof token!=='string'||!token)throw Error('Authentication missing');const r=await fetch('https://testapi.yibentushu.com/supply-api/'+p,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});return{http:r.status,body:await r.json()};},path).catch(()=>{throw Error('Blocked: 后台订单记录只读接口未完成。');});
 const ok=async(path:string)=>{const r=await read(path);if(r.http!==200||r.body.code!==200)throw Error('Blocked: 后台订单记录接口未成功。');return r.body;};
 const identity=await ok('getInfo');if(!/^\d{1,20}$/.test(String(identity.user?.userId??'')))throw Error('Blocked: 当前认证身份不完整。');
 const base=await ok('dept/book/manage/orderList?pageNum=1&pageSize=100'),rows=base.rows;
 if(!Array.isArray(rows)||!rows.length||rows.length>100||rows.length!==Number(base.total)||rows.some((r:Row)=>!r.orderId)||new Set(rows.map((r:Row)=>String(r.orderId))).size!==rows.length)throw Error('Blocked: 后台订单基线缺完整性或唯一性，未比较截断第一页。');
 const keys=[...new Set(rows.map((r:Row)=>r.applyNo).filter((v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)))].map(String),stored=await database(keys,[]);
 if(!stored.applications.length)throw Error('Blocked: 没有独立申请数据库对照样本。');
 let matched=0,approvedLocked=0,amountMatches=0;
 for(const r of rows.filter((r:Row)=>keys.includes(r.applyNo))){const a=stored.applications.filter(a=>a.applyNo===r.applyNo);if(a.length!==1||a[0]!.orderId!==String(r.orderId))throw Error('Blocked: 后台订单与独立申请引用未唯一匹配。');const record=a[0]!;
  if(r.spId!==record.approvalId||Number(r.bookUsage)!==record.usage||r.costClientId!==record.customerId||r.costClientName!==record.customerName)throw Error('Blocked: 后台订单与独立申请字段尚未形成一致基线，不能据此判断创建时门槛或页面显示。');
  matched++;if(record.examineStatus===1&&record.lockStatus===1)approvedLocked++;if(Number(r.orderAmount)===record.amount)amountMatches++;
 }
 const fieldNames=['costClientName','bookUsage','deliveryWay','logisticsNo','spId','remark'],presence=fieldNames.map(k=>({field:k,rows:rows.filter((r:Row)=>Object.hasOwn(r,k)).length}));
 let extra='';if(kind==='admin-order-columns'){
  const doc=await read('v3/api-docs');if(doc.http!==200)throw Error('Blocked: 后台订单VO契约读取失败。');
  const properties=doc.body.components?.schemas?.DeptBookManageOrderVO?.properties;if(!properties||typeof properties!=='object')throw Error('Blocked: 本轮契约未明确后台订单VO。');
  const candidates=Object.entries(properties).filter(([key,value])=>/其他出库单/.test(String((value as Row).title??(value as Row).description??''))||/^(?:otherOut(?:Order|Bill)?No|otherOutboundNo|outboundOrderNo)$/.test(key)).map(([k])=>k);
  const fieldsWithValue=candidates.filter(k=>rows.some((r:Row)=>r[k]!==undefined&&r[k]!==null&&r[k]!==''));
  extra=`原要求展示的划归客户/用途/发货方式/物流号/审批号/备注字段存在行数分别${presence.map(p=>p.rows).join('/')}（总${rows.length}）。其他出库单号在本轮VO中候选字段${candidates.length}项、实际非空候选${fieldsWithValue.length}项。`+(candidates.length?'仍需后台页面确认完整展示及与其他出库源关联。':'接口契约存在展示字段缺口疑点，但缺后台页面及独立其他出库号基线，未仅凭VO缺字段判定页面失败。');
 }
 const observed=kind!=='admin-order-columns'&&baselines.length?await verifyObservedOrderCreation(baselines,rows,String(identity.user.userId),ok):undefined;
 const final=await ok('dept/book/manage/orderList?pageNum=1&pageSize=100'),finalStored=await database(keys,[]);
 const signature=(rs:Row[])=>JSON.stringify(rs.map(r=>[r.orderId,r.applyNo,r.spId,r.orderStatus,r.tradeTime,r.orderAmount,...fieldNames.map(k=>r[k])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 if(!Array.isArray(final.rows)||Number(final.total)!==rows.length||signature(rows)!==signature(final.rows)||JSON.stringify(stored.applications)!==JSON.stringify(finalStored.applications))throw Error('Blocked: 核验期间订单或申请基线变化，未判产品缺陷。');
 if(kind==='product-outbound-route'||kind==='product-outbound-count'){const product=observed?.approvedRecords.filter(r=>r.usage===2)??[],quantities=[...new Set(product.map(r=>r.quantity))].sort((a,b)=>a-b);result.status='blocked';result.detail=`已执行产品出库专用只读检查：${product.length}笔本人产品申请由真实提交断点、审批结果、锁单状态、管理订单及订单详情交叉关联，订单本数为${quantities.join('、')||'当前未取得'}本。`+([3,5].every(n=>quantities.includes(n))?'产品3本和5本样本已齐备，不再归为缺测试夹具。':'尚需产品3本和5本各自完整关联记录。')+(kind==='product-outbound-route'?'剩余仅为同单实际旺店通“部门用书店铺”及易诚通“赠送出库”类别的最终发送/接收记录，管理订单VO没有这些字段，不能用订单生成代替出库映射。':'剩余为两笔同单易诚通最终出库类别是否都等于“赠送出库”；当前本地申请及管理订单字段未提供最终类别，不能从用途和本数推断。');return;}
 if(observed?.complete){result.status='passed';result.detail=`已接入完整校验来源摘要的真实提交断点：提交后待审批/未锁单/无订单，后续同一账号${observed.approved}笔人工审批通过且锁单成功后出现对应管理订单，${observed.rejected}笔驳回及${observed.pending}笔仍待审批未建单。逐笔核对当前数据库、progress审批时间轴、订单卡及订单详情；订单详情createTime与管理订单tradeTime在接口共同提供的分钟精度一致，且不早于审批完成。未用申请create_time/update_time代替订单时间，未新增申请或要求额外后台页面。`;return;}
 result.status='blocked';
 result.detail=`本轮完整${rows.length}条管理订单，${matched}条独立匹配申请，${rows.length-matched}条缺申请号未强行归属；匹配记录中${approvedLocked}条当前审批通过且锁单成功，${amountMatches}条订单金额与申请相符，前后数据稳定。`+(kind==='admin-order-gating'?`${approvedLocked===matched?'历史状态门槛子检查符合':'部分历史记录当前状态不满足门槛，但可能是创建后的合法状态变化，未据此判定建单时违规'}；${rows.filter((r:Row)=>!!r.tradeTime).length}条接口有下单时间，但没有独立订单创建时间读回，不拿申请create_time冒充下单时间，也没有新审批→建单事件链，原100仍阻塞。`:extra)+'当前未执行管理后台页面，员工H5截图不作为后台展示通过证据。';
}
