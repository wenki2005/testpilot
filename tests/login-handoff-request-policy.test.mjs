import test from 'node:test';
import assert from 'node:assert/strict';

const { allowBrowserRequest, clearLoginHandoff, isLoginHandoffActive, waitForUserLogin } = await import('../dist/adapters/login-handoff.js');

test('browser request policy blocks application writes except during the explicit login handoff', async t => {
  const projectId = `request-policy-${Date.now()}`;

  assert.equal(allowBrowserRequest('GET', 'https://app.example.test/catalog', projectId), true);
  assert.equal(allowBrowserRequest('HEAD', 'https://app.example.test/catalog', projectId), true);
  assert.equal(allowBrowserRequest('GET', 'https://app.example.test/legacy-delete?id=1', projectId), false, 'legacy GET mutation routes stay blocked');
  assert.equal(allowBrowserRequest('GET', 'https://app.example.test/autosave?value=x', projectId), false, 'autosave routes stay blocked');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/supply-api/getInfo', projectId), true, 'H5 bootstrap reads may use POST');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/wecom/getUserInfo', projectId), true, 'explicit employee identity bootstrap reads may use POST');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/wecom/getDepartmentList', projectId), true, 'explicit department list reads may use POST');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/api/queryOrders', projectId), true, 'explicit read-only query verbs may use POST');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/api/orders', projectId), false);
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/api/createOrder', projectId), false, 'mutation verbs remain blocked');
  assert.equal(allowBrowserRequest('DELETE', 'https://app.example.test/api/orders/1', projectId), false);
  assert.equal(allowBrowserRequest('POST', 'https://sso.example.test/oauth/token', projectId), false);
  const target = 'https://app.example.test';
  const request = (method, url, resourceType, extra = {}) => allowBrowserRequest(method, url, projectId, { targetOrigin: target, resourceType, ...extra });
  assert.equal(request('GET', `${target}/api/getInfo`, 'fetch'), true, 'same-origin read fetch remains available');
  assert.equal(request('POST', `${target}/api/getInfo`, 'xhr'), true, 'legacy same-origin read-shaped POST remains available');
  assert.equal(request('POST', 'https://testapi.example.test/supply-api/getInfo', 'xhr'), true, 'a sibling first-party API may serve read-only bootstrap requests');
  assert.equal(request('GET', 'https://api.example.test/api/queryOrders', 'fetch'), true, 'sibling first-party query endpoints may support UI reads');
  assert.equal(request('GET', 'https://testapi.example.test/supply-api/system/dict/data/type/dept_apply_use', 'xhr'), true, 'first-party read-only dictionary routes may serve H5 options');
  assert.equal(request('GET', 'https://testapi.example.test/supply-api/system/area/tree', 'xhr'), true, 'first-party region-tree routes may serve H5 address choices');
  assert.equal(request('POST', 'https://api.example.test/api/createOrder', 'xhr'), false, 'sibling API mutations remain blocked');
  assert.equal(request('POST', 'https://api.example.test/api/getInfo', 'document'), false, 'API read exceptions are limited to fetch/XHR');
  assert.equal(request('POST', 'https://api.other.test/api/getInfo', 'xhr'), false, 'an unrelated site cannot use the sibling API exception');
  assert.equal(request('GET', 'https://evil.example/api/getInfo', 'fetch'), false, 'cross-origin read-shaped fetch is denied');
  assert.equal(request('POST', 'https://evil.example/queryOrders', 'xhr'), false, 'cross-origin read-shaped POST is denied');
  assert.equal(request('GET', 'https://cdn.example/app.js', 'script'), true, 'HTTPS passive third-party scripts remain available');
  assert.equal(request('GET', 'http://cdn.example/app.js', 'script'), false, 'HTTP third-party assets are denied');
  assert.equal(request('POST', 'https://cdn.example/app.js', 'script'), false, 'third-party assets cannot receive writes');
  assert.equal(request('GET', 'https://cdn.example/api/read', 'fetch'), false, 'passive asset policy does not allow API reads');
  assert.equal(request('GET', 'https://sso.example.test/login', 'document', { isNavigationRequest: true }), false, 'SSO navigation requires active handoff');

  const fakePage = {
    bringToFront: async () => {},
    title: async () => '',
    url: () => 'https://sso.example.test/login',
    frames: () => [{ url: () => 'https://sso.example.test/login' }],
  };
  const fakeBrowser = {};
  const waiting = waitForUserLogin(projectId, 'run-fixture', 'https://app.example.test/', fakeBrowser, fakePage).catch(error => error);
  t.after(async () => {
    clearLoginHandoff(projectId);
    await waiting;
  });

  for (let attempt = 0; attempt < 50 && !isLoginHandoffActive(projectId); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(isLoginHandoffActive(projectId), true, 'the handoff must be active before an SSO write is permitted');
  assert.equal(allowBrowserRequest('POST', 'https://app.example.test/api/orders', projectId), false);
  assert.equal(request('POST', 'https://sso.example.test/oauth/token', 'xhr'), true);
  assert.equal(request('OPTIONS', 'https://sso.example.test/session', 'fetch'), true);
  assert.equal(request('POST', 'https://evil.example/oauth/token', 'xhr'), false, 'a login-shaped path on an unobserved origin is denied');
  assert.equal(request('OPTIONS', 'https://evil.example/session', 'fetch'), false, 'handoff does not trust an arbitrary cross-origin preflight');
  assert.equal(request('POST', 'https://sso.example.test/oauth/token', 'document'), false, 'auth writes are limited to fetch/XHR');
  assert.equal(request('GET', 'https://sso.example.test/login', 'document', { isNavigationRequest: true, isMainFrameNavigation: true }), true);
  assert.equal(request('POST', 'https://evil.example/getInfo', 'fetch'), false, 'active handoff does not grant arbitrary cross-origin writes');
  assert.equal(allowBrowserRequest('POST', 'https://sso.example.test/oauth/token', `${projectId}-other`, { targetOrigin: target, resourceType: 'xhr' }), false, 'login permission is scoped to the project handoff');

  clearLoginHandoff(projectId);
  await waiting;
  assert.equal(request('POST', 'https://sso.example.test/oauth/token', 'xhr'), false, 'SSO write permission ends when the handoff is cleared');
});
