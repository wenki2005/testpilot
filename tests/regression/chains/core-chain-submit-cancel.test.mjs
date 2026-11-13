import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createJourney, createMutationGate, releaseChainMutation, submitCancelStepIds } from '../../../dist/adapters/regression/chains/core-chain-submit-cancel.js';

const api = 'https://testapi.yibentushu.com/supply-api';
function route(method, path, payload) {
    const calls = { continued: 0, aborted: '', reason: '' };
    return {
        calls,
        value: {
            request: () => ({ method: () => method, url: () => api + path, postDataJSON: () => { if (payload === undefined) throw Error('not json'); return payload; } }),
            continue: async () => { calls.continued++; },
            abort: async reason => { calls.aborted = 'blockedbyclient'; calls.reason = reason ?? ''; },
        },
    };
}
const receipt = {
    bookUsage: 1,
    customerCode: '01-01056',
    customerName: '信息与数据中心*开心文化-部门费用',
    recipient: 'TP1234567890勿发货',
    phone: '13800138000',
    province: '湖南省',
    city: '长沙市',
    county: '芙蓉区',
    address: '自动化链路验证勿发货',
    remark: 'TP1234567890勿发货',
    goods: [{ code: '2012600876', qty: 2, price: 22.8, weightGrams: 267 }],
};
const submitPayload = { applyType: '1', bookUsage: '1', costClientId: receipt.customerCode, costClientName: receipt.customerName, remark: receipt.remark, receiverName: receipt.recipient, receiverPhone: receipt.phone, province: receipt.province, city: receipt.city, county: receipt.county, detailAddress: receipt.address, goodsList: [{ productId: '2012600876', qty: 2 }] };
const signal = new AbortController().signal;

test('journey marker stays inside the receiver limit and is unique per run', () => {
    const a = createJourney(randomUUID()), b = createJourney(randomUUID());
    assert.ok(a.marker.endsWith('勿发货'));
    assert.ok(a.marker.length <= 20);
    assert.notEqual(a.marker, b.marker);
    assert.deepEqual(submitCancelStepIds, ['login', 'form', 'detail-rows', 'submit', 'echo', 'cancel', 'list-sync']);
});

test('only the expected submit payload is released, exactly once', async () => {
    const gate = createMutationGate();
    gate.submit.expect = receipt;
    const before = route('POST', '/dept/book/apply/submit', submitPayload);
    assert.equal(await releaseChainMutation(before.value, gate, signal), true);
    assert.equal(before.calls.aborted, 'blockedbyclient');
    assert.match(gate.submit.rejectReason, /在未授权时段发出/);
    gate.submit.armed = true;
    const ok = route('POST', '/dept/book/apply/submit', submitPayload);
    await releaseChainMutation(ok.value, gate, signal);
    assert.equal(ok.calls.continued, 1);
    assert.equal(gate.submit.sent, 1);
    assert.deepEqual(gate.submit.payload, submitPayload);
    const again = route('POST', '/dept/book/apply/submit', submitPayload);
    await releaseChainMutation(again.value, gate, signal);
    assert.equal(again.calls.continued, 0);
    // The first refusal is kept for diagnosis; the second request is still not released.
    assert.match(gate.submit.rejectReason, /未授权时段|重复发送/);
});

test('a payload that differs from what the run filled is refused and names the field', async () => {
    const gate = createMutationGate();
    gate.submit.expect = receipt;
    gate.submit.armed = true;
    const wrong = route('POST', '/dept/book/apply/submit', { ...submitPayload, receiverName: 'TP1234', goodsList: [{ productId: '2012600876', qty: 3 }] });
    await releaseChainMutation(wrong.value, gate, signal);
    assert.equal(wrong.calls.continued, 0);
    assert.equal(gate.submit.sent, 0);
    assert.match(gate.submit.rejectReason, /receiverName/);
    assert.match(gate.submit.rejectReason, /goodsList/);
    const broken = route('POST', '/dept/book/apply/submit', undefined);
    await releaseChainMutation(broken.value, gate, signal);
    assert.equal(broken.calls.continued, 0);
});

test('cancel is bound to the submitted application and type', async () => {
    const gate = createMutationGate();
    gate.cancel.expect = { applyNo: '202611130113', cancelType: 1 };
    gate.cancel.armed = true;
    const wrong = route('POST', '/dept/book/apply/cancel', { applyNo: '202611130113', cancelType: 2 });
    await releaseChainMutation(wrong.value, gate, signal);
    assert.equal(wrong.calls.continued, 0);
    assert.match(gate.cancel.rejectReason, /撤销目标或类型/);
    const ok = route('POST', '/dept/book/apply/cancel', { applyNo: '202611130113', cancelType: 1 });
    await releaseChainMutation(ok.value, gate, signal);
    assert.equal(ok.calls.continued, 1);
    assert.equal(gate.cancel.sent, 1);
});

test('other business mutations and reads are handled by the caller policy', async () => {
    const gate = createMutationGate();
    gate.submit.expect = receipt;
    gate.submit.armed = true;
    const read = route('GET', '/dept/book/apply/detail/202611130113', undefined);
    assert.equal(await releaseChainMutation(read.value, gate, signal), false);
    assert.equal(read.calls.continued, 0);
    const other = route('POST', '/dept/book/apply/relock/202611130113', {});
    assert.equal(await releaseChainMutation(other.value, gate, signal), true);
    assert.equal(other.calls.continued, 0);
    assert.equal(other.calls.aborted, 'blockedbyclient');
});
