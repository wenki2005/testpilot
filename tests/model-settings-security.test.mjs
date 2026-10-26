import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl } from '../src/adapters/model-settings.ts';

test('model API bearer keys require TLS for remote endpoints while local development remains usable', () => {
  assert.equal(validateBaseUrl('https://relay.example/v1/'), 'https://relay.example/v1');
  assert.equal(validateBaseUrl('http://127.0.0.1:4317/v1'), 'http://127.0.0.1:4317/v1');
  assert.equal(validateBaseUrl('http://localhost:4317/v1'), 'http://localhost:4317/v1');
  assert.throws(
    () => validateBaseUrl('http://relay.example/v1'),
    /远程模型服务必须使用 HTTPS/u,
  );
});

test('model API URL still rejects embedded credentials and query strings', () => {
  assert.throws(() => validateBaseUrl('https://user:secret@relay.example/v1'), /不能包含账号、密码/u);
  assert.throws(() => validateBaseUrl('https://relay.example/v1?token=secret'), /不能包含账号、密码/u);
});
