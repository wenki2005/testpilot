import test from 'node:test';
import assert from 'node:assert/strict';
import {browserRequestAllowed,browserRequestPolicySource} from '../../dist/adapters/browser/login-handoff.js';

const targetOrigin='https://cdn.yibentushu.com';
const qr='https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp';
const frame={targetOrigin,resourceType:'document',isNavigationRequest:true,isMainFrameNavigation:false,authenticationPage:true,loginHandoffActive:false,authOrigins:[]};
const call=(method,url,context=frame)=>browserRequestAllowed(method,url,context);

test('department customer lookup permits only the exact read endpoint in both live and exported policy',()=>{
 const exported=Function('return '+browserRequestPolicySource())();
 const url='https://testapi.yibentushu.com/supply-api/dept/book/apply/clientSearch?keyword=TEST_SENTINEL';
 const context={targetOrigin,resourceType:'xhr'};
 for(const policy of [browserRequestAllowed,exported]){
  for(const resourceType of ['xhr','fetch'])for(const method of ['GET','HEAD','OPTIONS'])assert.equal(policy(method,url,{...context,resourceType}),true);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(policy(method,url,context),false);
  for(const other of [url.replace('testapi.yibentushu.com','api.yibentushu.com'),url.replace('testapi.yibentushu.com','attacker.example'),url.replace('https:','http:'),url.replace('clientSearch','clientSearch/delete'),url.replace('clientSearch','submit')])assert.equal(policy('GET',other,context),false);
  assert.equal(policy('GET',url,{...context,targetOrigin:'https://other.yibentushu.com'}),false);
  assert.equal(policy('GET',url,{...context,resourceType:'document',isNavigationRequest:true}),false);
 }
});

test('book lookup is the same exact read exception, not permission to submit or query other hosts',()=>{
 const url='https://testapi.yibentushu.com/supply-api/dept/book/apply/bookCheck?productId=1508201059';const context={targetOrigin,resourceType:'xhr'};
 for(const policy of [browserRequestAllowed,Function('return '+browserRequestPolicySource())()]){
  for(const method of ['GET','HEAD','OPTIONS'])assert.equal(policy(method,url,context),true);
  for(const method of ['POST','PUT','DELETE'])assert.equal(policy(method,url,context),false);
  for(const denied of [url.replace('testapi.yibentushu.com','api.yibentushu.com'),url.replace('bookCheck','bookCheck/remove'),url.replace('bookCheck','applySubmit'),url.replace('bookCheck','approval'),url.replace('https:','http:')])assert.equal(policy('GET',denied,context),false);
  assert.equal(policy('GET',url,{...context,targetOrigin:'https://other.yibentushu.com'}),false);
 }
});

test('first WeCom QR iframe loads before login handoff can discover the provider frame',()=>{
 assert.equal(call('GET',qr),true);
 assert.equal(call('GET',qr,{...frame,authenticationPage:false,loginHandoffActive:true}),true);
 assert.equal(call('GET',qr,{...frame,authenticationPage:false}),false);
 assert.equal(call('GET','https://login.work.weixin.qq.com.evil.example/wwlogin/sso/login'),false);
 assert.equal(call('GET','https://login.work.weixin.qq.com/business/list'),false);
 assert.equal(call('GET','https://unrelated.example/login'),false);
 assert.equal(call('GET','https://open.work.weixin.qq.com/wwopen/loginStorage'),true);
 assert.equal(call('GET','https://open.work.weixin.qq.com/wwopen/other'),false);
 assert.equal(call('GET',qr.replace('https:','http:')),false);
});

test('WeCom QR polling is scoped to SSO and only manual login can send authentication POSTs',()=>{
 const context={...frame,resourceType:'xhr',isNavigationRequest:false};
 assert.equal(call('GET','https://login.work.weixin.qq.com/wwlogin/sso/poll',context),true);
 assert.equal(call('POST','https://login.work.weixin.qq.com/wwlogin/sso/login',context),false);
 assert.equal(call('POST','https://login.work.weixin.qq.com/wwlogin/sso/login',{...context,loginHandoffActive:true}),true);
 assert.equal(call('DELETE',qr,{...context,loginHandoffActive:true}),false);
 assert.equal(call('GET','https://login.work.weixin.qq.com/wwlogin/sso/delete',{...context,loginHandoffActive:true}),false);
});

test('current WeCom QR widget can poll the monoApi SSO status path only during login',()=>{
 const status='https://login.work.weixin.qq.com/wwlogin/monoApi/sso/login/getWebQrCodeStatus?lang=zh_CN&ajax=1&f=json';
 const context={...frame,resourceType:'xhr',isNavigationRequest:false};
 assert.equal(call('POST',status,{...context,loginHandoffActive:true}),true);
 assert.equal(call('GET',status,context),true);
 assert.equal(call('POST',status,context),false);
 assert.equal(call('POST','https://login.work.weixin.qq.com/wwlogin/monoApi/sso/login/delete',{...context,loginHandoffActive:true}),false);
 assert.equal(call('GET','https://login.work.weixin.qq.com/wwlogin/monoApi/other',context),false);
});

test('the same-site QR code exchange is allowed only during login; business mutations remain blocked',()=>{
 const context={...frame,resourceType:'xhr',isNavigationRequest:false};
 const exchange='https://testapi.yibentushu.com/logWeChat/dept-book?code=TEST_SENTINEL';
 assert.equal(call('GET',exchange,context),true);
 assert.equal(call('GET',exchange,{...context,authenticationPage:false}),false);
 assert.equal(call('GET',exchange.replace('testapi.yibentushu.com','attacker.example'),context),false);
 for(const url of ['https://testapi.yibentushu.com/application/submit','https://testapi.yibentushu.com/order/create','https://cdn.yibentushu.com/api/approval/update'])for(const method of ['GET','POST'])assert.equal(call(method,url,{...context,loginHandoffActive:true}),false);
});

test('standalone serialized policy retains the same QR bootstrap checks',()=>{
 const exported=Function('return '+browserRequestPolicySource())();
 assert.equal(exported('GET',qr,frame),true);
 assert.equal(exported('GET','https://unrelated.example/login',frame),false);
});

test('WeCom SDK prefetches classified as other load only as static files during login',()=>{
 const context={...frame,resourceType:'other',isNavigationRequest:false};
 assert.equal(call('GET','https://wwcdn.weixin.qq.com/node/wwlogin/wwlogin/mono/chunk.js',context),true);
 assert.equal(call('GET','https://wwcdn.weixin.qq.com/node/wwopen/wwopenmng/chunk.css',context),true);
 assert.equal(call('GET','https://wwcdn.weixin.qq.com/node/wwlogin/api/getData',context),false);
 assert.equal(call('POST','https://wwcdn.weixin.qq.com/node/wwlogin/chunk.js',context),false);
 assert.equal(call('GET','https://unrelated.example/chunk.js',context),false);
 assert.equal(call('GET','https://wwcdn.weixin.qq.com/node/wwlogin/chunk.js',{...context,authenticationPage:false}),false);
});
