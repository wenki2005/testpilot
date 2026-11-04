import type{Page}from'playwright';
type Row=Record<string,any>;
const cents=(v:unknown)=>{const n=Number(v);if(!Number.isFinite(n))throw Error('Blocked: 订单金额不是有效数值。');return Math.round(n*100);};
const money=(v:string)=>Number(v.replace(/[¥￥,\s]/g,''));
export type Order85Presentation={goodsRows:number;traceRows:number;statusNodes:string[];totalBooks:number};
/** Validate returned presentation against the same response and independent
 * stored goods. Empty traces never prove sorting or backend polling. */
export async function inspectOrder85Presentation(page:Page,detail:Row,storedGoods:Row[]):Promise<Order85Presentation>{
 if(!Array.isArray(detail.goodsList)||!detail.goodsList.length||!Array.isArray(detail.timeline)||!detail.timeline.length||!Array.isArray(detail.traceList))throw Error('Blocked: 订单商品/状态时间轴/物流轨迹契约不完整。');
 const body=page.locator('.pc-page-logistics-detail'),rows=body.locator('.pc-page-logistics-detail-book-detail tbody tr');await rows.first().waitFor({state:'visible',timeout:7000});
 if(await rows.count()!==detail.goodsList.length)throw Error('断言失败：订单页面商品行数与本轮详情响应不一致。');
 let totalBooks=0,amount=0;
 for(let i=0;i<detail.goodsList.length;i++){
  const g=detail.goodsList[i],stored=storedGoods.filter(v=>String(v.product_id)===String(g.goodsSn));
  const expected=stored[0];if(stored.length!==1||!expected||Number(expected.qty)!==Number(g.buyNum)||cents(expected.price)!==cents(g.unitPrice))throw Error('断言失败：订单商品数量/单价没有对应独立申请明细。');
  if(typeof g.bookName!=='string'||!g.bookName||!Number.isInteger(Number(g.buyNum))||Number(g.buyNum)<=0)throw Error('Blocked: 订单商品缺有效书名/数量。');
  const cells=rows.nth(i).locator('td');if(await cells.count()!==4)throw Error('Blocked: 订单商品列未完整渲染。');
  if((await cells.nth(0).innerText()).trim()!==g.bookName||Number((await cells.nth(1).innerText()).trim())!==Number(g.buyNum)||cents(money(await cells.nth(2).innerText()))!==cents(g.unitPrice)||cents(money(await cells.nth(3).innerText()))!==cents(g.unitPrice)*Number(g.buyNum))throw Error('断言失败：订单页面书名、数量、单价或小计与本轮接口/数据库不一致。');
  totalBooks+=Number(g.buyNum);amount+=cents(expected.price)*Number(expected.qty);
 }
 if(amount!==cents(detail.orderAmount))throw Error('断言失败：订单总价不等于独立商品单价与数量求和。');
 const total=body.locator('.pc-page-logistics-detail-book-detail .total');if(await total.count()!==1||!(await total.innerText()).includes('共'+totalBooks+'本书')||cents(money(await total.locator('.price').innerText()))!==cents(detail.orderAmount))throw Error('断言失败：订单页面总本数/总价未对应本轮订单。');
 const steps=body.locator('.pc-page-logistics-detail-order-status .logistics-list > li'),traces=detail.traceList as Row[],timeline=detail.timeline as Row[];
 await steps.first().waitFor({state:'visible',timeout:7000});if(await steps.count()!==traces.length+timeline.length)throw Error('断言失败：订单页面轨迹及状态节点数量与接口不一致。');
 let previous=Infinity;
 for(let i=0;i<traces.length;i++){
  const trace=traces[i]!,time=Date.parse(String(trace.time).replace(' ','T'));if(!Number.isFinite(time))throw Error('Blocked: 物流轨迹时间不可独立解析。');
  if(time>previous)throw Error('断言失败：实际订单物流轨迹未按最新时间置顶。');previous=time;
  const node=steps.nth(i);if((await node.locator('.head .time').innerText()).trim()!==String(trace.time??'')||(await node.locator('.hint').innerText()).trim()!==String(trace.orderContext??''))throw Error('断言失败：订单页面物流轨迹内容或顺序与本轮接口不一致。');
 }
 for(let i=0;i<timeline.length;i++){
  const item=timeline[i]!,node=steps.nth(traces.length+i);if(typeof item.node!=='string'||!item.node)throw Error('Blocked: 订单状态节点名称缺失。');
  if((await node.locator('.head .name').innerText()).trim()!==item.node||(await node.locator('.head .time').innerText()).trim()!==String(item.time??'')||(await node.locator('.hint').innerText()).trim()!==String(item.desc??''))throw Error('断言失败：订单页面状态名称、时间或说明与本轮接口不一致。');
 }
 return{goodsRows:detail.goodsList.length,traceRows:traces.length,statusNodes:timeline.map(v=>String(v.node)),totalBooks};
}
