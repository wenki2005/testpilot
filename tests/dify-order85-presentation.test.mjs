import test from'node:test';import assert from'node:assert/strict';import{chromium}from'playwright';import{inspectOrder85Presentation}from'../dist/adapters/dify-order85-presentation.js';
const base={orderAmount:68.4,goodsList:[{goodsSn:'B1',bookName:'合成图书',buyNum:3,unitPrice:22.8}],traceList:[],timeline:[{node:'已下单',time:'2026-11-04 12:00',desc:'合成订单创建'}]},stored=[{product_id:'B1',qty:3,price:22.8}];
function html(d,mode='normal'){
 const traces=d.traceList.map(t=>`<li><div class="head"><div class="time">${t.time}</div></div><div class="hint">${t.orderContext}</div></li>`).join(''),nodes=d.timeline.map(t=>`<li><div class="head"><div class="name">${t.node}</div><div class="time">${t.time}</div></div><div class="hint">${mode==='timeline'?'错误说明':t.desc}</div></li>`).join('');
 return `<main class="pc-page-logistics-detail"><div class="pc-page-logistics-detail-book-detail"><table><tbody>${d.goodsList.map(g=>`<tr><td>${mode==='book'?'错误图书':g.bookName}</td><td>${g.buyNum}</td><td>￥${g.unitPrice}</td><td>￥${(g.buyNum*g.unitPrice).toFixed(2)}</td></tr>`).join('')}</tbody></table><div class="total">共3本书 合计：<span class="price">¥${mode==='total'?999:d.orderAmount}</span></div></div><div class="pc-page-logistics-detail-order-status"><ul class="logistics-list">${traces+nodes}</ul></div></main>`;
}
test('order85 presentation verifies each state label, independent totals and real trace ordering; empty trace is recorded as zero',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 for(const state of ['已下单','已发货','已签收','已取消','已退单']){const d=structuredClone(base);d.timeline[0].node=state;await page.setContent(html(d));const seen=await inspectOrder85Presentation(page,d,stored);assert.deepEqual(seen,{goodsRows:1,traceRows:0,statusNodes:[state],totalBooks:3});}
 const d=structuredClone(base);d.traceList=[{time:'2026-11-04 12:10:00',orderContext:'合成签收'},{time:'2026-11-04 12:00:00',orderContext:'合成派送'}];await page.setContent(html(d));assert.equal((await inspectOrder85Presentation(page,d,stored)).traceRows,2);
});
test('order85 rejects wrong book, rendered amount, timeline, independent sum and ascending actual traces',async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 for(const mode of ['book','total','timeline']){await page.setContent(html(base,mode));await assert.rejects(()=>inspectOrder85Presentation(page,base,stored),/断言失败/);}
 const wrong=structuredClone(base);wrong.orderAmount=999;await page.setContent(html(wrong));await assert.rejects(()=>inspectOrder85Presentation(page,wrong,stored),/总价不等于/);
 const asc=structuredClone(base);asc.traceList=[{time:'2026-11-04 12:00:00',orderContext:'旧'},{time:'2026-11-04 12:10:00',orderContext:'新'}];await page.setContent(html(asc));await assert.rejects(()=>inspectOrder85Presentation(page,asc,stored),/未按最新时间置顶/);
});
