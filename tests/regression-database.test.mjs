import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDepartmentList,compareDepartmentGoods} from '../dist/adapters/regression-database.js';
import {supportsDepartmentDatabase} from '../dist/domain/regression-database-contract.js';
import {browserRequestAllowed} from '../dist/adapters/login-handoff.js';

test('database scope is limited to the supplied test deployment; exact read APIs work without permitting submissions',()=>{
 assert.equal(supportsDepartmentDatabase('https://cdn.yibentushu.com/test-sample-apply/index.html#/home'),true);
 for(const url of ['https://cdn.yibentushu.com/sample-apply/index.html','https://example.com/test-sample-apply/index.html','https://cdn.yibentushu.com.evil.example/test-sample-apply/'])assert.equal(supportsDepartmentDatabase(url),false);
 const context={targetOrigin:'https://cdn.yibentushu.com',resourceType:'xhr',authenticationPage:false};
 for(const p of ['myList','detail/TEST-1','progress/TEST-1'])for(const method of ['GET','OPTIONS'])assert.equal(browserRequestAllowed(method,'https://testapi.yibentushu.com/supply-api/dept/book/apply/'+p,context),true);
 for(const p of ['submit','relock/TEST-1','detail/TEST-1/delete'])for(const method of ['GET','POST'])assert.equal(browserRequestAllowed(method,'https://testapi.yibentushu.com/supply-api/dept/book/apply/'+p,context),false);
 assert.equal(browserRequestAllowed('POST','https://testapi.yibentushu.com/supply-api/dept/book/apply/myList',context),false);
 assert.equal(browserRequestAllowed('GET','https://attacker.example/supply-api/dept/book/apply/myList',context),false);
});

test('current-account rows require a unique database match and observable statuses; no records remain blocked',()=>{
 const api=[{applyNo:'PRIVATE_RECORD_SENTINEL',examineStatus:1,lockStatus:2}];const db=[{apply_no:'PRIVATE_RECORD_SENTINEL',examine_status:'1',lock_status:'2'}];
 assert.equal(compareDepartmentList(api,db).status,'passed');assert.equal(compareDepartmentList(api,[]).status,'failed');assert.equal(compareDepartmentList(api,[{...db[0],lock_status:0}]).status,'failed');assert.equal(compareDepartmentList([],[]).status,'blocked');assert.equal(compareDepartmentList([{applyNo:'PRIVATE_RECORD_SENTINEL'}],db).status,'blocked');assert.ok(!JSON.stringify(compareDepartmentList(api,db)).includes('PRIVATE_RECORD_SENTINEL'));
});

test('detail comparison detects missing/mismatched quantities and prices; incomplete or ambiguous records never pass',()=>{
 const api=[{productId:'P1',qty:2,price:'12.50'}];const db=[{product_id:'P1',qty:2,price:'12.5000'}];assert.equal(compareDepartmentGoods(api,db).status,'passed');assert.equal(compareDepartmentGoods([{...api[0],qty:3}],db).status,'failed');assert.equal(compareDepartmentGoods([{productId:'P1',qty:2}],db).status,'blocked');assert.equal(compareDepartmentGoods([],[]).status,'blocked');assert.equal(compareDepartmentGoods([...api,...api],db).status,'blocked');
});
