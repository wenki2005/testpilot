import test from'node:test';import assert from'node:assert/strict';import{verifyAdminOrderRecords}from'../dist/adapters/dify-admin-order-records.js';
const row={applyNo:'A',orderId:'O1',spId:'SP1',bookUsage:1,costClientId:'C1',costClientName:'合成客户',orderAmount:10,tradeTime:'2026-11-01 10:00:00',deliveryWay:1,logisticsNo:null,remark:null};
const stored={applications:[{applyNo:'A',orderId:'O1',approvalId:'SP1',usage:1,customerId:'C1',customerName:'合成客户',amount:10,examineStatus:1,lockStatus:1}]};
const pageFor=(change=false)=>{let n=0;return{evaluate:async(fn,p)=>{if(p==='getInfo')return{http:200,body:{code:200,user:{userId:1}}};if(p==='v3/api-docs')return{http:200,body:{components:{schemas:{DeptBookManageOrderVO:{properties:{costClientName:{title:'划归客户'}}}}}}};n++;return{http:200,body:{code:200,total:1,rows:[change&&n>1?{...row,orderAmount:11}:row]}};}};};
test('historical approved/locked order is only partial creation evidence; later cancellation is not false failure',async()=>{
 const r={status:'passed',detail:''};await verifyAdminOrderRecords(pageFor(),'admin-order-gating',r,async()=>stored);assert.equal(r.status,'blocked');assert.match(r.detail,/1条当前审批通过且锁单成功/);assert.match(r.detail,/不拿申请create_time/);
 await verifyAdminOrderRecords(pageFor(),'admin-order-gating',r,async()=>({...stored,applications:[{...stored.applications[0],examineStatus:3}]}));assert.equal(r.status,'blocked');assert.match(r.detail,/创建后的合法状态变化/);
});
test('column contract absence remains a specific suspicion; changing baseline remains blocked',async()=>{
 const r={status:'passed',detail:''};await verifyAdminOrderRecords(pageFor(),'admin-order-columns',r,async()=>stored);assert.equal(r.status,'blocked');assert.match(r.detail,/候选字段0项/);assert.match(r.detail,/未仅凭VO缺字段判定页面失败/);
 await assert.rejects(()=>verifyAdminOrderRecords(pageFor(true),'admin-order-gating',r,async()=>stored),/基线变化/);
});
