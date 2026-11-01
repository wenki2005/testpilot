import {test,expect} from '@playwright/test';
import {browserRequestAllowed,isAuthenticationRoute} from '../../src/adapters/login-handoff.js';

test('login QR bootstrap and same-site code exchange load under the actual route policy while submit stays blocked',async({page})=>{
 const target='https://cdn.yibentushu.com/test-sample-apply/index.html#/login?redirect=%252Fhome';const targetOrigin=new URL(target).origin;const allowed:string[]=[];const denied:string[]=[];
 await page.route('**/*',async route=>{const r=route.request();const url=new URL(r.url());const permit=browserRequestAllowed(r.method(),r.url(),{targetOrigin,authenticationPage:isAuthenticationRoute(page.url()),resourceType:r.resourceType(),isNavigationRequest:r.isNavigationRequest(),isMainFrameNavigation:r.isNavigationRequest()&&r.frame()===page.mainFrame(),loginHandoffActive:false,authOrigins:[]});
  if(!permit){denied.push(url.pathname);await route.abort('blockedbyclient');return;}
  allowed.push(url.pathname);
  if(url.origin===targetOrigin)await route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>部门申样书</h1><iframe title="企微登录" src="https://login.work.weixin.qq.com/wwlogin/sso/login"></iframe>'});
  else if(url.origin==='https://login.work.weixin.qq.com')await route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>企业微信扫码登录测试页</h1><iframe title="登录存储" src="https://open.work.weixin.qq.com/wwopen/loginStorage"></iframe>'});
  else if(url.origin==='https://open.work.weixin.qq.com')await route.fulfill({contentType:'text/html; charset=utf-8',body:'登录存储测试页'});
  else await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':targetOrigin},body:'{"code":200}'});
 });
 await page.goto(target);expect(denied,JSON.stringify({allowed,denied,page:page.url()})).toEqual([]);await expect(page.frameLocator('iframe[title="企微登录"]').getByText('企业微信扫码登录测试页')).toBeVisible();await expect(page.frameLocator('iframe[title="企微登录"]').frameLocator('iframe').getByText('登录存储测试页')).toBeVisible();
 const response=await page.evaluate(async()=>{const r=await fetch('https://testapi.yibentushu.com/supply-api/logWeChat/dept-book?code=TEST_ONLY');return r.status;});expect(response).toBe(200);
 await page.evaluate(async()=>{await fetch('https://testapi.yibentushu.com/application/submit',{method:'POST'}).catch(()=>{});});expect(allowed).toContain('/wwlogin/sso/login');expect(allowed).toContain('/wwopen/loginStorage');expect(allowed).toContain('/supply-api/logWeChat/dept-book');expect(denied).toContain('/application/submit');
});
