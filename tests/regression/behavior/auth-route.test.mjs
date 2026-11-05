import test from 'node:test';
import assert from 'node:assert/strict';
import {isAuthenticationRoute,isLoginPage} from '../../../dist/adapters/browser/login-handoff.js';

test('SPA login with a redirect parameter is an auth gate; callbacks and business pages are not',async()=>{
 for(const url of ['https://example.com/app#/login?redirect=%252Fhome','https://example.com/login?redirect=/home','https://example.com/index.html?lang=zh#/login?redirect=/home'])assert.equal(isAuthenticationRoute(url),true,url);
 for(const url of ['https://example.com/home?redirect=/login','https://example.com/auth/callback','https://example.com/token','https://example.com/app#/home'])assert.equal(isAuthenticationRoute(url),false,url);
 const page={isClosed:()=>false,frames:()=>[{url:()=> 'https://example.com/app#/login?redirect=%252Fhome'}]};assert.equal(await isLoginPage(page),true);
});
