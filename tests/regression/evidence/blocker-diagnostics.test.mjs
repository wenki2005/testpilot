import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentBlockerDiagnostic} from '../../../dist/adapters/regression/evidence/blocker-diagnostics.js';
import {compareDepartmentList} from '../../../dist/adapters/database/regression-readback.js';

const evidence={blockerInventory:{states:[{own:true,status:0,lockStatus:0,usage:1,count:1,multiLine:0,orderReferences:0},{own:false,status:1,lockStatus:1,usage:1,count:60,multiLine:13,orderReferences:24}],links:{applications:61,orderReferences:24,matchedOrders:0,matchingTemplates:61,linkedFailures:0,linkedOutbox:0,linkedLogistics:0},notificationFlags:{lockFailure:0,restock:0},configurationKeys:0}};
test('diagnostics distinguish own fixture from global data and preserve the expected result',()=>{
 const c={source:'员工端-申请表单明细展示页',expected:'多行样书明细逐行展示小计，总计=∑小计、预估总重=∑(数量×单本重量)'};
 const before=structuredClone({c,evidence});
 const s=departmentBlockerDiagnostic(c,evidence);
 assert.match(s,/当前认证账号多行申请0条，全库多行申请13条/);
 assert.match(s,/unit_weight/);
 assert.deepEqual({c,evidence},before);
 assert.equal(departmentBlockerDiagnostic(c),undefined);
 assert.equal(departmentBlockerDiagnostic({...c,source:'其他系统'},evidence),undefined);
});
test('configuration existence and failed upstream evidence never imply business success',()=>{
 const template=departmentBlockerDiagnostic({source:'系统配置依赖',expected:'企微OA审批模板ID配置正确'},evidence);
 assert.match(template,/61条申请中61条命中有效模板/);assert.match(template,/不等于配置正确/);
 const upstream=departmentBlockerDiagnostic({source:'员工端-申请表单明细展示页',expected:'商品接口查询失败：对应字段降级提示，不阻塞整页加载'},evidence);
 assert.match(upstream,/关联0条/);assert.match(upstream,/未用整个详情接口失败冒充商品接口失败/);
});
test('20-row current page is compared completely; excess and duplicate keys are blocked',()=>{
 const api=Array.from({length:20},(_,i)=>({applyNo:'SYNTHETIC'+i,examineStatus:0}));
 const db=api.map(r=>({apply_no:r.applyNo,examine_status:0}));
 assert.equal(compareDepartmentList(api,db).status,'passed');
 assert.equal(compareDepartmentList([...api,{applyNo:'EXCESS',examineStatus:0}],db).status,'blocked');
 assert.equal(compareDepartmentList([...api.slice(0,19),api[0]],db).status,'blocked');
 assert.equal(compareDepartmentList(api,db.slice(0,19)).status,'failed');
});
