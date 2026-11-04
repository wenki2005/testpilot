import type{Page,Request}from'playwright';
import{readDepartmentApplicationSnapshot,readDepartmentGoods}from'./mysql-readonly-browser.js';
import{inspectOrder85Presentation}from'./dify-order85-presentation.js';
type Row=Record<string,any>;type Result={status:string;detail:string};
export type OwnedOrderKind='owned-order-list-fields'|'owned-order-detail-navigation'|'owned-order-details-complete';
export function isOwnedOrderKind(kind:unknown):kind is OwnedOrderKind{return ['owned-order-list-fields','owned-order-detail-navigation','owned-order-details-complete'].includes(String(kind));}
export async function verifyOwnedOrderEvidence(page:Page,kind:OwnedOrderKind,result:Result,target:string){
 const identity=await page.evaluate(async()=>{let token=localStorage.getItem('sample-apply-token');try{token=JSON.parse(token??'null');}catch{}if(typeof token!=='string')throw Error('No auth');const r=await fetch('https://testapi.yibentushu.com/supply-api/getInfo',{headers:{Authorization:'Bearer '+token}});return r.json();});
 const uid=String(identity.user?.userId??'');if(identity.code!==200||!/^\d+$/.test(uid))throw Error('Blocked: 本人订单身份缺失。');
 const fresh=async(path:string,action:()=>Promise<unknown>)=>{const requests=new Set<Request>(),listener=(q:Request)=>{const u=new URL(q.url());if(q.method()==='GET'&&u.origin==='https://testapi.yibentushu.com'&&u.pathname==='/supply-api/'+path)requests.add(q);};page.on('request',listener);const pending=page.waitForResponse(r=>requests.has(r.request()),{timeout:12000}).then(async r=>({url:new URL(r.url()),http:r.status(),body:await r.json()}));try{await action();const reply=await pending;if(reply.http!==200||reply.body.code!==200)throw Error('Blocked: 页面触发的订单查询未成功。');return reply;}finally{page.off('request',listener);void pending.catch(()=>{});}};
 const url=new URL(target);url.hash='/logistics';const open=async()=>{await page.goto('about:blank');return fresh('h5/dept/book/order/myList',()=>page.goto(url.href,{waitUntil:'domcontentloaded',timeout:15000}));};
 const listed=await open(),rows=listed.body.rows as Row[];if(!Array.isArray(rows)||!rows.length||rows.length>100||new Set(rows.map(r=>r.orderId)).size!==rows.length)throw Error('Blocked: 缺本人订单或订单编号不唯一。');
 const main=page.locator('.pc-page-logistics'),cards=main.locator('.logistics-content-item');await cards.first().waitFor({state:'visible',timeout:7000});if(await cards.count()!==rows.length)throw Error('断言失败：订单卡片数与本轮响应不一致。');
 if(kind==='owned-order-list-fields'){
  for(let i=0;i<rows.length;i++){const row=rows[i]!,text=await cards.nth(i).innerText();if(!row.orderId||!row.firstBookName||!row.receiverName||!row.address||!Number.isInteger(Number(row.totalBookNum))||!Number.isFinite(Number(row.orderAmount)))throw Error('Blocked: 订单列表缺原预期字段。');for(const value of [row.orderId,row.firstBookName,row.receiverName,row.address,String(row.totalBookNum),String(row.orderAmount)])if(!text.includes(String(value)))throw Error('断言失败：订单卡片字段未对应本轮列表。');}
  if(listed.url.searchParams.get('pageSize')!=='20')throw Error('断言失败：本人订单卡片字段已核对，但页面发送pageSize='+listed.url.searchParams.get('pageSize')+'，原预期每页20条。');
  result.status='blocked';result.detail='本人订单卡片及每页20条请求已核对；尚需足够记录验证实际第二页及完整倒序，不额外造21笔订单。';return;
 }
 let checked=0,goodsRows=0,traceRows=0;const statusNodes=new Set<string>();
 if(kind==='owned-order-details-complete'&&Number(listed.body.total)!==rows.length)throw Error('Blocked: 本人订单超过当前页，本轮未用不完整第一页代替全部已存在订单。');
 for(let i=0;i<(kind==='owned-order-details-complete'?rows.length:Math.min(rows.length,2));i++){
  if(i){await open();await cards.first().waitFor({state:'visible',timeout:7000});}
  const row=rows[i]!,card=cards.filter({has:page.locator('.header .or').filter({hasText:String(row.orderId)})});if(await card.count()!==1)throw Error('Blocked: 对应订单卡片未唯一定位。');
  const opened=await fresh('h5/dept/book/order/detail/'+encodeURIComponent(row.orderId),()=>card.click({timeout:5000})),detail=opened.body.data as Row;
  if(new URL(page.url()).hash.split('?')[0]!=='#/logistics-detail/'+encodeURIComponent(row.orderId)||detail?.orderId!==row.orderId||!detail.applyNo)throw Error('断言失败：订单卡片未打开对应订单详情。');
  const stored=await readDepartmentApplicationSnapshot(String(detail.applyNo),uid);if(!stored||stored.order_id!==detail.orderId||Number(stored.examine_status)!==1||Number(stored.lock_status)!==1)throw Error('Blocked: 订单未关联本人通过并锁单的申请。');
  const goods=await readDepartmentGoods(String(detail.applyNo));if(!Array.isArray(detail.goodsList)||detail.goodsList.length!==goods.length||!goods.length)throw Error('断言失败：订单商品行与申请数据库不一致。');
  for(const g of goods){const matches=detail.goodsList.filter((v:Row)=>String(v.goodsSn)===String(g.product_id));if(matches.length!==1||Number(matches[0].buyNum)!==Number(g.qty)||Number(matches[0].unitPrice)!==Number(g.price))throw Error('断言失败：订单商品编码/数量/价格与申请数据库不一致。');}
  const body=page.locator('.pc-page-logistics-detail');await body.waitFor({state:'visible',timeout:7000});
  const fields:Record<string,string>={'订单编号：':detail.orderId,'下单时间：':detail.createTime,'收货人：':String(stored.receiver_name),'手机号码：':String(stored.receiver_phone),'收货地址：':[stored.province,stored.city,stored.county,stored.detail_address].join(' ')};
  for(const[label,value]of Object.entries(fields)){const field=body.locator('.word-pc-from-item-preview').filter({has:page.locator('.label').filter({hasText:new RegExp('^'+label+'$')})});if(await field.count()!==1||(await field.locator('.value').textContent())!==value)throw Error('断言失败：订单详情'+label+'未对应同一订单与本人申请。');}
  if(kind==='owned-order-details-complete'){const presentation=await inspectOrder85Presentation(page,detail,goods);goodsRows+=presentation.goodsRows;traceRows+=presentation.traceRows;for(const node of presentation.statusNodes)statusNodes.add(node);}
  checked++;
 }
 result.status=kind==='owned-order-detail-navigation'?'passed':'blocked';result.detail=kind==='owned-order-details-complete'?`已通过的子检查：本人当前全部${checked}笔订单均实际点击卡片，路由、新GET、本人申请与商品数据库关联一致；订单号、下单时间、收货人、手机、地址逐字段一致；${goodsRows}行书名/数量/单价/小计、总本数和独立求和总价正确；页面状态时间轴名称/时间/说明与接口一致（本轮状态：${[...statusNodes].join('、')}）。未验证：${traceRows?`本轮${traceRows}条真实轨迹与页面顺序及时间倒序已核对；`:'本轮真实轨迹0条，空列表不能证明最新轨迹置顶；'}当前未出现的发货/签收/取消/退单展示仍缺本人状态记录；本轮detail契约没有上游来源或拉取执行时间，无法仅凭页面重查证明服务端每10分钟向易查单/自有物流拉取。原85捆绑基础展示和真实物流/周期要求，部分通过保留，整条仍阻塞；不是基础字段不存在，也不是没有订单。`:'实际点击本人最新'+checked+'个订单卡片，路由、新detail响应、本人申请及商品数据库唯一关联；订单号/下单时间/收件信息、商品数量/单价一致。对应订单详情验证完成。';
}
