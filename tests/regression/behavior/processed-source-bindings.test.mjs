import test from 'node:test';import assert from 'node:assert/strict';import{connectedEvidenceKind}from'../../../dist/adapters/regression/evidence/connected-evidence-contract.js';
import{difyCoverageGap}from'../../../dist/adapters/regression/authoring/case-quality.js';
import{allowBrowserRequest}from'../../../dist/adapters/browser/login-handoff.js';
test('new approval and owned order checks require unchanged exact source and expectations',()=>{
 const cases=[['员工端-用书审批详情页','审核通过：状态按钮绿色','approved-appearance'],['员工端-用书审批详情页','审核驳回：状态按钮红色，展示驳回原因文案，支持重新申请或联系审批人','rejected-appearance'],['员工端-订单列表页 > 点击订单卡片','展示对应订单详情','owned-order-detail-navigation'],['员工端-订单列表页','展示订单号、状态、价格、收货信息、第一种书名称及总本数，分页每次加载20条','owned-order-list-fields']];
 for(const[source,expected,kind]of cases){assert.equal(connectedEvidenceKind({source,expected}),kind);assert.equal(connectedEvidenceKind({source:'unrelated',expected}),undefined);assert.equal(connectedEvidenceKind({source,expected:expected+' changed'}),undefined);}
});
test('color gate only delegates exact reviewed approval checks; order detail remains read-only',()=>{
 const check={title:'审核通过',source:'员工端-用书审批详情页',expected:'审核通过：状态按钮绿色',steps:[{action:'assertExactVisible',text:'收货信息'}]};assert.match(difyCoverageGap(check),/颜色/);assert.equal(difyCoverageGap(check,'approved-appearance'),undefined);assert.match(difyCoverageGap({...check,source:'unrelated'},'approved-appearance'),/颜色/);
 const url='https://testapi.yibentushu.com/supply-api/h5/dept/book/order/detail/0005BM202611040066',context={targetOrigin:'https://cdn.yibentushu.com',resourceType:'fetch',authenticationPage:false,isNavigationRequest:false,isMainFrameNavigation:false};assert.equal(allowBrowserRequest('GET',url,'profile',context),true);assert.equal(allowBrowserRequest('POST',url,'profile',context),false);assert.equal(allowBrowserRequest('GET',url,'profile',{...context,targetOrigin:'https://unrelated.example'}),false);assert.equal(allowBrowserRequest('GET',url.replace('/detail/','/cancel/'),'profile',context),false);
});
