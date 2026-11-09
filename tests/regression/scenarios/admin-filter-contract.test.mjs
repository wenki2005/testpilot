import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAdminFilters} from '../../../dist/adapters/regression/scenarios/orders/admin-filter-contract.js';
const rows=[{orderId:'one',bookUsage:1,costClientId:'c1',deliveryWay:1,spId:'A1',logisticsNo:'L1'},{orderId:'two',bookUsage:2,costClientId:'c2',deliveryWay:2,spId:'A2',logisticsNo:'L2'}],parameters=['bookUsage','costClientId','deliveryWay','spId','logisticsNo'];
test('admin filter subchecks read each documented option and compare complete order sets',async()=>{
 for(const kind of ['admin-filter-usage','admin-filter-customer','admin-filter-delivery','admin-filter-identifiers']){
  const calls=[],result=await auditAdminFilters(kind,rows,parameters,async query=>{calls.push(query);const field=parameters.find(k=>query.has(k)),filtered=rows.filter(r=>String(r[field])===query.get(field));return{rows:filtered,total:filtered.length};});assert.equal(result.mismatches.length,0);assert.equal(result.queries,calls.length);assert.ok(result.queries>=2);
 }
});
test('missing contracts or truncated evidence block; ignored filters are retained as mismatches until baseline recheck',async()=>{
 await assert.rejects(()=>auditAdminFilters('admin-filter-usage',rows,[],async()=>({})),/OpenAPI/);
 await assert.rejects(()=>auditAdminFilters('admin-filter-usage',rows,parameters,async()=>({rows:[],total:10})),/完整分页/);
 const mismatch=await auditAdminFilters('admin-filter-usage',rows,parameters,async()=>({rows,total:2}));assert.equal(mismatch.mismatches.length,2);
});
