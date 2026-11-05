import test from 'node:test';import assert from 'node:assert/strict';
import {assertExpenseApplication,assertApprovalProgress,assertClientCategoryResponse} from '../../../dist/adapters/regression/evidence/integration-assertions.js';
import {departmentOaTemplateBaseline as baseline} from '../../../dist/adapters/regression/config/approval-templates.js';
import {connectedEvidenceKind} from '../../../dist/adapters/regression/evidence/connected-evidence-contract.js';

test('expense assertions preserve typical-case wording and reject wrong UI/API data',()=>{
 for(const usage of [1,2]){const stored={apply_no:'OWN',book_usage:usage,cost_client_id:'CLIENT',cost_client_name:'合成客户'},data={applyNo:'OWN',bookUsage:usage,costClientId:'CLIENT',costClientName:'合成客户'},category=usage===1?'1004.00':'1004.06';assert.doesNotThrow(()=>assertExpenseApplication(usage,stored,data,category));assert.throws(()=>assertExpenseApplication(usage,stored,{...data,costClientId:'OTHER'},category),/断言失败/);assert.throws(()=>assertExpenseApplication(usage,stored,data,'1004.01'),/通常/);}
});
test('approval readback checks template, status, timeline and rejection without inventing missing callbacks',()=>{
 const stored={apply_no:'OWN',book_usage:1,sp_id:'SYNTHETIC_APPROVAL',template_id:baseline[0].templateId,examine_status:0,lock_status:0},data={applyNo:'OWN',examineStatus:0,lockStatus:0,timeline:[{node:'已提交'}]};
 assert.equal(assertApprovalProgress(stored,data),0);assert.throws(()=>assertApprovalProgress(stored,{...data,examineStatus:1}),/断言失败/);assert.throws(()=>assertApprovalProgress(stored,{...data,timeline:[]}),/断言失败/);
 const rejected={...stored,examine_status:2,reject_reason:'合成驳回理由'},read={...data,examineStatus:2,timeline:[{node:'已驳回',desc:'合成驳回理由'}]};assert.equal(assertApprovalProgress(rejected,read),2);assert.throws(()=>assertApprovalProgress(rejected,{...read,timeline:[{node:'已驳回'}]}),/驳回理由/);
});
test('database classification cannot manufacture missing upstream classification fields',()=>{
 const requested={code:'CLIENT',category:'1004.00'},classes=[requested],rows=[{agentId:'CLIENT',agentName:'合成客户'}];assert.equal(assertClientCategoryResponse(rows,classes,requested),false);assert.equal(assertClientCategoryResponse([{...rows[0],agentType:'1004.00'}],classes,requested),true);assert.throws(()=>assertClientCategoryResponse([{...rows[0],agentType:'1004.06'}],classes,requested),/断言失败/);assert.throws(()=>assertClientCategoryResponse(rows,[{...requested,category:'1004.01'}],requested),/允许范围/);assert.throws(()=>assertClientCategoryResponse([],classes,requested),/正样本/);
});
test('new scenario bindings require exact original expectations and their business source',()=>{
 const cases=[['选择营销用书','费用划归客户通常为外部客户（合作客户）','marketing-expense'],['选择产品用书','费用划归客户通常为内部部门（部门费用）','product-expense'],['数据接口层 › 企微审批接口','通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页','approval-readback'],['数据接口层 › 易诚通接口','客户接口按客户分类返回（1004.00/1004.06）供H5过滤','customer-category-contract'],['系统配置依赖','快递仓仓库ID配置正确（长沙仓/天津仓）','warehouse-config'],['系统配置依赖','旺店通两个店铺ID配置正确（样书出库店铺/部门用书店铺）','shop-config']];
 for(const [source,expected,kind]of cases){assert.equal(connectedEvidenceKind({source,expected}),kind);assert.equal(connectedEvidenceKind({source:'无关业务',expected}),undefined);assert.equal(connectedEvidenceKind({source,expected:expected+'改动'}),undefined);}
});
