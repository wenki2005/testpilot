import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWelfareEvidence,welfareKeys,welfareSummary} from '../dist/adapters/dify-welfare-order-scenarios.js';
import {connectedEvidenceKind} from '../dist/adapters/dify-connected-contract.js';
import {browserRequestAllowed,browserRequestPolicySource} from '../dist/adapters/login-handoff.js';
const rows=[{id:'1900000000000000001',orderId:'A',orderAmount:1.01,orderStatus:'2',userName:'Test',orderGoodsVos:[]},{id:'1900000000000000002',orderId:'B',orderAmount:2.02,orderStatus:'3',userName:'Test2',orderGoodsVos:[]}];
const response=body=>({http:200,body});
const pageFor=({leak=true,ignoreFilter=false,truncate=false}={})=>({evaluate:async(fn,args)=>{
 const p=args.path,b=args.body;
 if(p==='v3/api-docs')return response({paths:{'/dept/book/manage/welfareBookOrder':{post:{}}},components:{schemas:{WelfareBookOrderDTO:{properties:{orderStatus:{},orderIdList:{},userName:{}}}}}});
 if(p==='getInfo')return response({code:200,user:{userId:1},roles:['common']});
 if(p==='getRouters')return response({code:200,data:[]});
 if(p.startsWith('agent/'))return response({code:403});
 if(b.pageSize===1)return response({code:leak?200:403,total:leak?2:0,rows:leak?rows.slice(0,1):[]});
 let actual=rows.filter(r=>ignoreFilter||(!b.orderStatus||r.orderStatus===b.orderStatus)&&(!b.orderIdList||b.orderIdList.includes(r.orderId))&&(!b.userName||r.userName.includes(b.userName)));
 return response({code:200,total:actual.length+(truncate?1:0),rows:truncate&&b.pageNum>1?[]:actual});
}});
const db=async()=>({roles:['common'],currentInternalMenus:0,authorizedRoleMenuGrants:2,applications:[]});
test('welfare permission requires independent ordinary role and refused control',async()=>{
 const r={status:'passed',detail:''};await verifyWelfareEvidence(pageFor(),'welfare-permission',r,db);assert.equal(r.status,'failed');assert.match(r.detail,/高置信度/);
 await assert.rejects(()=>verifyWelfareEvidence(pageFor(),'welfare-permission',r,async()=>({...await db(),roles:['admin']})),/Blocked/);
 const denied={status:'passed',detail:''};await verifyWelfareEvidence(pageFor({leak:false}),'welfare-permission',denied,db);assert.equal(denied.status,'blocked');
});
test('filters compare complete independent requests; good API alone cannot pass migration',async()=>{
 const r={status:'passed',detail:''};await verifyWelfareEvidence(pageFor(),'welfare-filter',r);assert.equal(r.status,'blocked');assert.match(r.detail,/0项不符/);
 const bad={status:'passed',detail:''};await verifyWelfareEvidence(pageFor({ignoreFilter:true}),'welfare-filter',bad);assert.equal(bad.status,'failed');
 await assert.rejects(()=>verifyWelfareEvidence(pageFor({truncate:true}),'welfare-filter',r),/缺页/);
});
test('snapshot distinguishes cents, exact large string IDs, duplicates and missing fields',async()=>{
 assert.equal(welfareSummary(rows).amountCents,303);assert.equal(welfareKeys(rows).length,2);
 assert.throws(()=>welfareKeys([...rows,rows[0]]),/重复/);assert.throws(()=>welfareKeys([{...rows[0],id:1900000000000000001}]),/字符串/);
 const r={status:'passed',detail:''};await verifyWelfareEvidence(pageFor(),'welfare-migration-totals',r);assert.equal(r.status,'blocked');assert.match(r.detail,/迁移前/);
 assert.equal(connectedEvidenceKind({expected:'迁移后按原有筛选项（订单号/客户/状态等）查询结果正确',source:'管理端后台（经销商系统服务端） > 员工福利订单'}),'welfare-filter');
});
test('only exact documented welfare query is allowed, including serialized runner policy',()=>{
 const ctx={targetOrigin:'https://cdn.yibentushu.com',resourceType:'fetch'},url='https://testapi.yibentushu.com/supply-api/dept/book/manage/welfareBookOrder';
 for(const policy of[browserRequestAllowed,Function('return '+browserRequestPolicySource())()]){
  assert.equal(policy('POST',url,ctx),true);assert.equal(policy('OPTIONS',url,ctx),true);
  for(const method of['PUT','DELETE','PATCH'])assert.equal(policy(method,url,ctx),false);
  for(const other of[url+'/delete',url.replace('welfareBookOrder','exportWelfareBookOrder'),url.replace('testapi.yibentushu.com','unrelated.example')])assert.equal(policy('POST',other,ctx),false);
 }
});
