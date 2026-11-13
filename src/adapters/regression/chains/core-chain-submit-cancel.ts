import type { Locator, Page, Response, Route } from 'playwright';
import { resolveDocumentField } from '../../documents/execution/workflow-facade.js';
import { loadDifyBookFixtures, type DifyBookFixture } from '../scenarios/books/book-search.js';
import { loadDifyCustomerFixtures } from '../config/test-fixtures.js';
import { isLoginPage } from '../../browser/login-handoff.js';
type Row = Record<string, any>;
export type JourneyPatch = { status: 'passed' | 'failed' | 'blocked'; detail: string };
type Receipt = {
    applyNo?: string;
    bookUsage: number;
    customerCode: string;
    customerName: string;
    recipient: string;
    phone: string;
    province: string;
    city: string;
    county: string;
    address: string;
    remark: string;
    goods: Array<{
        code: string;
        qty: number;
        price: number;
        weightGrams: number;
    }>;
};
/** Exactly one submit and one cancel may leave the browser in a run. Every
 * other mutation stays blocked, and the payload is checked before release. */
export type MutationGate = {
    submit: {
        armed: boolean;
        sent: number;
        expect?: Receipt;
        payload?: Row;
        rejectReason?: string;
    };
    cancel: {
        armed: boolean;
        sent: number;
        expect?: {
            applyNo: string;
            cancelType: number;
        };
        payload?: Row;
        rejectReason?: string;
    };
};
export type JourneyState = {
    marker: string;
    applyNo?: string;
    submitted?: Receipt;
};
export const submitCancelStepIds = ['login', 'form', 'detail-rows', 'submit', 'echo', 'cancel', 'list-sync'];
export const createMutationGate = (): MutationGate => ({ submit: { armed: false, sent: 0 }, cancel: { armed: false, sent: 0 } });
// 收件人字段最多 20 字，地址最多 20 字；标记同时写入收件人与备注，长度留足余量。
export const createJourney = (runId: string): JourneyState => ({ marker: 'TP' + runId.replaceAll('-', '').slice(0, 10) + '勿发货' });
const origin = 'https://cdn.yibentushu.com', page$ = '/test-sample-apply/index.html', api = 'https://testapi.yibentushu.com/supply-api/';
const region = ['湖南省', '长沙市', '芙蓉区'] as const, phone = '13800138000', address = '自动化链路验证勿发货';
const fail: (message: string) => never = message => { throw Error('断言失败：' + message); };
const block: (message: string) => never = message => { throw Error('Blocked: ' + message); };
const money = (n: number) => n.toFixed(2), weight = (grams: number, qty: number) => (grams * qty / 1000).toFixed(2);
const home = (page: Page) => page.locator('.pc-page-home').filter({ visible: true });
const rows = (page: Page) => page.locator('.pc-page-home .word-pc-sample-item tbody tr');
const submitButton = (page: Page) => page.locator('.pc-page-home .home-footer .button').filter({ hasText: /^\s*提交申请\s*$/ });
async function unique(locator: Locator, label: string) {
    if (await locator.count() !== 1)
        block(label + '没有唯一可见控件。');
    return locator;
}
async function choose(page: Page, control: Locator, label: string) {
    await (await unique(control, '下拉字段')).click();
    const option = page.getByRole('option', { name: label, exact: true }).filter({ visible: true });
    await option.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    await (await unique(option, '下拉选项')).click();
}
async function go(page: Page, hash: string) {
    await page.goto(origin + page$ + hash, { waitUntil: 'domcontentloaded', timeout: 20000 });
}
async function apiGet(page: Page, path: string) {
    const reply = await page.evaluate(async ({ api, path }) => {
        let token = localStorage.getItem('sample-apply-token');
        try {
            token = JSON.parse(token ?? 'null');
        }
        catch { /* raw */ }
        if (typeof token !== 'string' || !token)
            return { status: 0, body: { code: 0 } };
        const r = await fetch(api + path, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(12000) });
        return { status: r.status, body: await r.json() };
    }, { api, path });
    return reply;
}
async function submitState(page: Page) {
    const control = await unique(submitButton(page), '提交状态');
    return control.evaluate(el => ({ disabled: el.classList.contains('button-disabled') || el.getAttribute('aria-disabled') === 'true' || el instanceof HTMLButtonElement && el.disabled, visible: !!el.getClientRects().length }));
}
async function waitSubmit(page: Page, disabled: boolean) {
    const end = Date.now() + 5000;
    do {
        const state = await submitState(page);
        if (state.visible && state.disabled === disabled)
            return;
        await new Promise(resolve => setTimeout(resolve, 80));
    } while (Date.now() < end);
    fail(disabled ? '必填项未完成时提交控件仍可用。' : '全部必填项有效后提交控件仍不可用。');
}
async function waitResponse(page: Page, method: string, path: string, timeout = 15000) {
    return page.waitForResponse(r => {
        try {
            return r.request().method() === method && new URL(r.url()).pathname === '/supply-api' + path;
        }
        catch {
            return false;
        }
    }, { timeout }).catch(() => undefined);
}
const body = async (response?: Response) => response ? response.json().catch(() => undefined) : undefined;
async function openHome(page: Page) {
    await go(page, '#/home');
    await home(page).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByPlaceholder('请输入收件人姓名', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => { history.scrollRestoration = 'manual'; window.scrollTo(0, 0); });
}
type RowSnapshot = { cells: string[], inputs: string[] };
async function rowSnapshot(page: Page, index: number): Promise<RowSnapshot> {
    const row = rows(page).nth(index);
    return { cells: await row.locator('td').evaluateAll(cells => cells.map(cell => (cell.textContent ?? '').trim())), inputs: await row.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)) };
}
async function fillBook(page: Page, index: number, book: DifyBookFixture, qty: number) {
    const response = waitResponse(page, 'GET', '/dept/book/apply/bookCheck');
    const code = await resolveDocumentField(page, '自编码', index);
    await code.fill(book.code);
    await code.blur();
    const read = await response, data = await body(read);
    if (!read || read.status() !== 200 || data?.code !== 200 || data?.data?.productId !== book.code)
        block('本轮图书校验没有返回编码' + book.code + '的成功响应。');
    if (Number(data.data.hprice) !== book.price || Number(data.data.weight) !== book.weightGrams)
        block('本轮图书响应与本机独立基线不一致，未按页面数字判定计算。');
    await rows(page).nth(index).getByText(book.name, { exact: true }).waitFor({ state: 'visible', timeout: 10000 }).catch(() => fail('编码' + book.code + '未在样书明细中带出独立基线图书名称。'));
    const quantity = await resolveDocumentField(page, '数量（册）', index);
    await quantity.fill(String(qty));
    await quantity.blur();
    const snapshot = await rowSnapshot(page, index);
    if (Number(snapshot.cells[2]) === 0 && snapshot.cells[2] !== book.name)
        fail('样书明细第' + (index + 1) + '行图书名称与独立基线不一致。');
    if (Number(snapshot.cells[4]) !== book.price)
        fail('样书明细第' + (index + 1) + '行定价' + snapshot.cells[4] + '与独立基线' + book.price + '不一致。');
    if (snapshot.cells[6] !== money(book.price * qty))
        fail('样书明细第' + (index + 1) + '行小计' + snapshot.cells[6] + '不等于数量×定价' + money(book.price * qty) + '。');
    if (snapshot.cells[5] !== weight(book.weightGrams, qty))
        fail('样书明细第' + (index + 1) + '行预估总重' + snapshot.cells[5] + '不等于数量×单本重量' + weight(book.weightGrams, qty) + '。');
    return snapshot;
}
async function totals(page: Page) {
    const text = await page.locator('.pc-page-home .total-info').innerText(), parse = (re: RegExp) => Number(re.exec(text)?.[1] ?? NaN);
    return { money: parse(/总计：¥([\d.]+)/u), weight: parse(/预估总重：([\d.]+)公斤/u), text };
}
async function expectTotals(page: Page, goods: Array<{ price: number; qty: number; weightGrams: number }>) {
    const shown = await totals(page), wantMoney = money(goods.reduce((sum, item) => sum + item.price * item.qty, 0)), wantWeight = weight(goods.reduce((sum, item) => sum + item.weightGrams * item.qty, 0), 1);
    if (!Number.isFinite(shown.money) || shown.money.toFixed(2) !== wantMoney)
        fail('总计' + JSON.stringify(shown.text) + '不等于所有小计之和' + wantMoney + '。');
    if (!Number.isFinite(shown.weight) || shown.weight.toFixed(2) !== wantWeight)
        fail('预估总重' + JSON.stringify(shown.text) + '不等于∑(数量×单本重量)' + wantWeight + '公斤。');
    return shown;
}
async function baseline(dataRoot: string) {
    const books = await loadDifyBookFixtures(dataRoot), customers = await loadDifyCustomerFixtures(dataRoot);
    if (books.length < 2)
        block('缺本机图书独立基线（dify-web-modules/book-fixtures.json，至少两个图书编码）；不能输入未核实的编码，也不能据此核对金额。');
    const customer = customers.find(c => c.category === '1004.00');
    if (!customer)
        block('缺本机客户独立基线（dify-web-modules/readonly-fixtures.json 中 1004.00 类客户）。');
    return { books, customer };
}
async function chooseCustomer(page: Page, code: string) {
    const control = await unique(page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '费用划归客户' }) }).getByRole('combobox'), '客户搜索');
    const response = waitResponse(page, 'GET', '/dept/book/apply/clientSearch');
    await control.fill(code);
    const read = await response, data = await body(read);
    const matches = data?.data?.filter((item: Row) => item.agentId === code);
    if (!read || read.status() !== 200 || data?.code !== 200 || !Array.isArray(matches) || matches.length !== 1 || typeof matches[0].agentName !== 'string')
        block('客户' + code + '没有取得唯一的成功查询结果。');
    await choose(page, control, matches[0].agentName);
    const selected = await control.evaluate(el => el.closest('.el-select')?.querySelector('.el-select__placeholder')?.textContent?.trim());
    if (selected !== matches[0].agentName.trim())
        fail('客户查询结果没有回填到费用划归客户。');
    return String(matches[0].agentName);
}
/** Runs one submit→cancel journey step on the already leased test page. No
 * other business mutation is released; the caller keeps the default policy. */
export async function checkSubmitCancelStep(id: string, context: {
    page: Page;
    dataRoot: string;
    gate: MutationGate;
    journey: JourneyState;
    signal: AbortSignal;
}): Promise<JourneyPatch | undefined> {
    const { page, gate, journey, signal } = context;
    if (id === 'login') {
        if (await isLoginPage(page))
            fail('测试窗口停在登录页，本轮没有可复用的企微授权会话。');
        const identity = await apiGet(page, 'getInfo'), user = identity.body?.user;
        if (identity.status !== 200 || identity.body?.code !== 200 || !/^\d{1,20}$/.test(String(user?.userId ?? '')) || typeof user?.nickName !== 'string' || !user.nickName.trim())
            fail('已保存的会话没有返回有效的本人身份（userId/姓名）。');
        if (!user.deptId && !user.dept)
            fail('身份信息缺少所属部门，无法确认本人属于本部门。');
        await openHome(page);
        const form = await home(page).innerText();
        if (!/收货信息/.test(form) || !/基本信息/.test(form) || !/样书明细/.test(form))
            fail('企微授权后没有进入包含基本信息、样书明细与收货信息的申请表单页。');
        return { status: 'passed', detail: '已有企微授权会话直接进入申请表单页，没有再次扫码或输入账号；本轮 getInfo 返回本人 userId 与姓名，身份信息带部门（PC 表单按 V1.1 不再展示申请人字段，故姓名/公司/部门不在此页核对）。表单包含基本信息、样书明细、收货信息三块。' };
    }
    if (id === 'form') {
        await openHome(page);
        const text = await home(page).innerText();
        for (const absent of ['申请人', '代人申请', '本人申请'])
            if (text.includes(absent))
                fail('PC 申请表单仍展示“' + absent + '”。');
        for (const label of ['样书用途', '费用划归客户', '收件人', '手机号码', '所在地区', '详细地址'])
            if (!text.includes(label))
                fail('PC 申请表单缺少必填项' + label + '。');
        for (const placeholder of ['请输入收件人姓名', '请输入手机号码', '如有特殊要求请填写备注信息'])
            if (await page.getByPlaceholder(placeholder, { exact: true }).count() !== 1)
                fail('PC 申请表单的' + placeholder + '不是唯一可见输入框。');
        return { status: 'passed', detail: 'PC 申请表单实际展示基本信息、样书明细、发货方式、备注与收货信息，六个必填项齐全；页面文本不含申请人、本人申请、代人申请。' };
    }
    if (id === 'detail-rows') {
        const { books } = await baseline(context.dataRoot);
        await openHome(page);
        if (await rows(page).count() !== 1)
            block('样书明细初始不是恰好一行，缺添加/删除的独立基线。');
        const first = await fillBook(page, 0, books[0]!, 2);
        await expectTotals(page, [{ price: books[0]!.price, qty: 2, weightGrams: books[0]!.weightGrams }]);
        const add = await unique(page.locator('.pc-page-home').getByText('继续添加样书', { exact: true }).filter({ visible: true }), '继续添加样书');
        await add.click({ timeout: 5000 });
        await page.waitForFunction(() => document.querySelectorAll('.pc-page-home .word-pc-sample-item tbody tr').length === 2, undefined, { timeout: 5000 }).catch(() => fail('点击继续添加样书后没有出现第二行。'));
        const second = await fillBook(page, 1, books[1]!, 1);
        await expectTotals(page, [{ price: books[0]!.price, qty: 2, weightGrams: books[0]!.weightGrams }, { price: books[1]!.price, qty: 1, weightGrams: books[1]!.weightGrams }]);
        const remove = rows(page).nth(1).getByText('删除', { exact: true }).filter({ visible: true });
        await (await unique(remove, '新增行删除入口')).click({ timeout: 5000 });
        await page.waitForFunction(() => document.querySelectorAll('.pc-page-home .word-pc-sample-item tbody tr').length === 1, undefined, { timeout: 5000 }).catch(() => fail('删除新增样书行后行数没有从 2 减少到 1。'));
        const kept = await rowSnapshot(page, 0), shown = await expectTotals(page, [{ price: books[0]!.price, qty: 2, weightGrams: books[0]!.weightGrams }]);
        if (JSON.stringify(kept) !== JSON.stringify(first))
            fail('删除新增行后原有明细行的编码、数量或图书信息发生变化。');
        return { status: 'passed', detail: '两本独立基线图书分别输入编码' + books[0]!.code + '、' + books[1]!.code + '后，实际带出图书名称/出版社/定价/单本重量；数量2与1时逐行小计=' + money(books[0]!.price * 2) + '、' + money(books[1]!.price) + '，页脚' + JSON.stringify(shown.text.replace(/\n/gu, ' ')) + '等于所有小计之和与∑(数量×单本重量)。行数实际1→2→1，删除新增行后原有行输入与书目内容逐项不变（保留编码' + first.inputs[0] + '×2，未提交）。' };
    }
    if (id === 'submit') {
        const { books, customer } = await baseline(context.dataRoot);
        await openHome(page);
        const recipient = await unique(page.getByPlaceholder('请输入收件人姓名', { exact: true }), '收件人');
        await recipient.fill('');
        await recipient.blur();
        await waitSubmit(page, true);
        if (await rows(page).count() !== 1 || (await rowSnapshot(page, 0)).inputs[0] !== books[0]!.code) {
            const first = await fillBook(page, 0, books[0]!, 2);
            if (!first.inputs[0])
                fail('样书明细未保留编码，无法继续填写提交。');
        }
        const usage = await unique(page.locator('.home-form-item').filter({ has: page.locator('label').filter({ hasText: '样书用途' }) }).getByRole('combobox'), '样书用途');
        await choose(page, usage, '营销用书');
        const customerName = await chooseCustomer(page, customer.code);
        const remark = await unique(page.getByPlaceholder('如有特殊要求请填写备注信息', { exact: true }), '备注');
        await remark.fill(journey.marker);
        await recipient.fill(journey.marker);
        await recipient.blur();
        await (await unique(page.getByPlaceholder('请输入手机号码', { exact: true }), '手机号码')).fill(phone);
        const regions = page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '所在地区' }) }).getByRole('combobox');
        if (await regions.count() !== 3)
            block('省市区不是三个按顺序排列的唯一控件。');
        for (const [index, label] of [[0, region[0]], [1, region[1]], [2, region[2]]] as const)
            await choose(page, regions.nth(index), label);
        const addressInput = await unique(page.getByPlaceholder('请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等', { exact: true }), '详细地址');
        await addressInput.fill(address);
        await addressInput.blur();
        for (const [label, control, want] of [['收件人', recipient, journey.marker], ['备注', remark, journey.marker], ['详细地址', addressInput, address]] as const) {
            const actual = await control.inputValue();
            if (actual !== want)
                fail(label + '实际保留' + JSON.stringify(actual) + '，与本轮要提交的' + JSON.stringify(want) + '不一致（可能被长度限制截断）。');
        }
        await waitSubmit(page, false);
        const receipt: Receipt = { bookUsage: 1, customerCode: customer.code, customerName, recipient: journey.marker, phone, province: region[0], city: region[1], county: region[2], address, remark: journey.marker, goods: [{ code: books[0]!.code, qty: 2, price: books[0]!.price, weightGrams: books[0]!.weightGrams }] };
        signal.throwIfAborted();
        gate.submit.expect = receipt;
        gate.submit.armed = true;
        const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === api + 'dept/book/apply/submit', { timeout: 20000 }).catch(() => undefined);
        await submitButton(page).click({ timeout: 8000 });
        const reply = await response;
        gate.submit.armed = false;
        if (gate.submit.rejectReason)
            fail('本轮提交请求' + gate.submit.rejectReason + '，已被本地核对拦截；未创建申请。');
        if (gate.submit.sent !== 1)
            fail('提交按钮没有发出恰好一次提交请求。');
        const data = await body(reply), applyNo = String(data?.data?.applyNo ?? '');
        if (!reply || reply.status() !== 200 || data?.code !== 200)
            block('实际提交没有取得成功业务响应；按当前标记' + journey.marker + '需人工核对是否落库，未自动重放。');
        if (!/^[A-Za-z0-9_-]{6,30}$/u.test(applyNo))
            fail('提交成功响应没有返回可用的申请编号。');
        journey.applyNo = applyNo;
        journey.submitted = { ...receipt, applyNo };
        await page.waitForFunction(no => location.hash === '#/apply-detail/' + no, applyNo, { timeout: 10000 }).catch(() => fail('提交成功后没有跳转到该申请编号的审批详情页。'));
        const detail = page.locator('.pc-page-apply-detail');
        await detail.waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForFunction(no => (document.querySelector('.pc-page-apply-detail')?.textContent ?? '').includes(no), applyNo, { timeout: 10000 }).catch(() => fail('跳转后的详情页没有显示本轮申请编号' + applyNo + '。'));
        const status = await detail.locator('.audit-status').innerText().catch(() => '');
        if (!/申请待审批/.test(status))
            fail('提交后的详情页状态不是申请待审批，实际为' + JSON.stringify(status.trim()) + '。');
        return { status: 'passed', detail: '必填项未完成（收件人为空）时提交控件禁用；补齐用途、费用划归客户、编码' + books[0]!.code + '×2、收件人/手机/省市区/详细地址与30字内备注后控件恢复可用。实际点击提交只发出一次 POST /dept/book/apply/submit，请求体与本轮填写值逐项一致且无多余字段；响应 code=200 返回申请编号' + applyNo + '，页面自动跳转到该编号的审批详情并显示“申请待审批”。测试标记' + journey.marker + '写入收件人与备注，便于人工复核与清理。' };
    }
    if (id === 'echo') {
        const receipt = journey.submitted, applyNo = journey.applyNo;
        if (!receipt || !applyNo)
            block('本轮没有取得已经真实提交的申请编号，无法核对详情回显。');
        const response = waitResponse(page, 'GET', '/dept/book/apply/detail/' + encodeURIComponent(applyNo), 15000);
        await go(page, '#/apply-form-detail/' + encodeURIComponent(applyNo));
        const read = await response, data = await body(read);
        if (!read || read.status() !== 200 || data?.code !== 200 || data?.data?.applyNo !== applyNo)
            block('详情回显没有取得该申请编号的成功详情响应。');
        const root = page.locator('.pc-page-apply-form-detail');
        await root.waitFor({ state: 'visible', timeout: 15000 });
        const fields = await root.locator('.word-pc-from-item-preview').evaluateAll(items => items.map(item => ({ label: (item.querySelector('.label')?.textContent ?? '').trim(), value: (item.querySelector('.value')?.textContent ?? '').trim() })));
        const expect: Record<string, string> = { '样书用途：': '营销用书', '费用划归客户：': receipt.customerName, '收件人：': receipt.recipient, '手机号码：': receipt.phone, '所在地区：': region.join('/'), '详细地址：': receipt.address };
        for (const [label, value] of Object.entries(expect)) {
            const matched = fields.filter(field => field.label === label);
            if (matched.length !== 1)
                fail('详情页' + label + '不是唯一回显字段。');
            if (matched[0]!.value !== value)
                fail('详情页' + label + '回显' + JSON.stringify(matched[0]!.value) + '与本轮提交值' + JSON.stringify(value) + '不一致。');
        }
        const remark = await root.locator('.detailed-info li').filter({ has: page.locator('.label').filter({ hasText: '备注：' }) }).evaluateAll(items => items.map(item => (item.querySelector('.value')?.textContent ?? '').trim()));
        if (remark.length !== 1 || remark[0] !== receipt.remark)
            fail('详情页备注回显' + JSON.stringify(remark) + '与本轮提交值' + JSON.stringify(receipt.remark) + '不一致。');
        const goods = await root.locator('table tbody tr').evaluateAll(items => items.map(item => [...item.querySelectorAll('td')].map(cell => ((cell as HTMLElement).innerText ?? '').trim())));
        const expected = receipt.goods[0]!;
        if (goods.length !== receipt.goods.length || goods[0]?.[0] !== expected.code || goods[0]?.[1] !== String(expected.qty) || goods[0]?.[4] !== String(expected.price) || goods[0]?.[6] !== '¥' + money(expected.price * expected.qty))
            fail('详情页样书明细回显与本轮提交的编码/数量/定价/小计不一致：' + JSON.stringify(goods) + '。');
        const editable = await root.locator('input,textarea,select').count();
        if (editable !== 0)
            fail('审批详情的申请内容出现' + editable + '个可编辑控件，不是只读回显。');
        return { status: 'passed', detail: '实际打开申请编号' + applyNo + '的申请明细，本轮提交的样书用途、费用划归客户、收件人、手机号码、所在地区、详细地址、备注与图书编码/数量/定价/小计逐项回显一致；明细页可编辑控件数为0，内容为只读回显。' };
    }
    if (id === 'cancel') {
        const applyNo = journey.applyNo;
        if (!applyNo)
            block('本轮没有真实提交的申请编号，不能执行撤销。');
        const response = waitResponse(page, 'GET', '/dept/book/apply/progress/' + encodeURIComponent(applyNo), 15000);
        await go(page, '#/apply-detail/' + encodeURIComponent(applyNo));
        await response.catch(() => undefined);
        const detail = page.locator('.pc-page-apply-detail');
        await detail.waitFor({ state: 'visible', timeout: 15000 });
        const before = (await detail.innerText()).replace(/\s+/gu, ' ');
        if (!/申请待审批/.test(before))
            block('该申请当前不是待审批，撤销路径未验证。');
        const revoke = await unique(detail.getByText('撤回用书申请', { exact: true }).filter({ visible: true }), '撤回用书申请入口');
        const dialog = page.locator('.el-message-box').filter({ visible: true });
        const openDialog = async () => {
            await revoke.click({ timeout: 8000 });
            await dialog.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => fail('点击撤回用书申请后没有出现二次确认弹窗。'));
            if (await dialog.count() !== 1)
                fail('二次确认弹窗不是恰合一个。');
            const text = await dialog.first().innerText();
            if (!text.includes('您是否确认撤回该用书申请？'))
                fail('二次确认弹窗文案不符合预期：' + JSON.stringify(text.replace(/\s+/gu, ' ').slice(0, 120)) + '。');
            const dismiss = dialog.first().getByText('暂不取消', { exact: true }), confirm = dialog.first().getByText('确定取消', { exact: true });
            if (await dismiss.count() !== 1 || await confirm.count() !== 1)
                fail('二次确认弹窗按钮不是“暂不取消”和“确定取消”。');
            return { dismiss, confirm };
        };
        const first = await openDialog();
        await first.dismiss.click();
        await dialog.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => fail('点击暂不取消后弹窗没有关闭。'));
        const afterDismiss = (await detail.innerText()).replace(/\s+/gu, ' ');
        if (afterDismiss !== before || await revoke.count() !== 1)
            fail('点击暂不取消后详情状态或撤回入口发生变化。');
        const second = await openDialog();
        signal.throwIfAborted();
        gate.cancel.expect = { applyNo, cancelType: 1 };
        gate.cancel.armed = true;
        const cancelResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === api + 'dept/book/apply/cancel', { timeout: 20000 }).catch(() => undefined);
        await second.confirm.click({ timeout: 8000 });
        const reply = await cancelResponse;
        gate.cancel.armed = false;
        if (gate.cancel.rejectReason)
            fail('本轮撤销请求' + gate.cancel.rejectReason + '，已被本地核对拦截。');
        if (gate.cancel.sent !== 1)
            fail('确定取消没有发出恰好一次撤销请求。');
        const data = await body(reply);
        if (!reply || reply.status() !== 200 || data?.code !== 200)
            fail('撤销请求没有取得成功业务响应：' + JSON.stringify(data ?? null).slice(0, 160) + '。');
        await page.waitForFunction(() => /audit-status3|申请已取消/u.test(document.querySelector('.pc-page-apply-detail')?.innerHTML ?? ''), undefined, { timeout: 15000 }).catch(() => fail('撤销确认后详情页没有刷新为申请已取消。'));
        const after = (await detail.innerText()).replace(/\s+/gu, ' ');
        if (!/申请已取消/.test(after))
            fail('撤销后详情页状态文案不是申请已取消。');
        if (after === before)
            fail('撤销后详情页内容没有新增已取消时间轴节点。');
        const stamp = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u.exec(after)?.[0];
        if (!stamp || !after.includes('已取消 ' + stamp) && !after.includes('已取消'))
            fail('撤销后详情页没有可读的已取消时间。');
        return { status: 'passed', detail: '在申请编号' + applyNo + '的审批详情实际点击“撤回用书申请”，二次确认弹窗文案为“您是否确认撤回该用书申请？”，两个按钮为“暂不取消”“确定取消”；先点击暂不取消，弹窗关闭且页面状态与撤回入口未变。再次打开并点击确定取消，只发出一次 POST /dept/book/apply/cancel（applyNo=' + applyNo + '，cancelType=1），响应 code=200；详情页自动刷新为“申请已取消”并新增已取消时间轴节点（' + (stamp ?? '时间未取到') + '）。' };
    }
    if (id === 'list-sync') {
        const applyNo = journey.applyNo;
        if (!applyNo)
            block('本轮没有真实提交的申请编号，无法核对列表同步。');
        const response = waitResponse(page, 'GET', '/dept/book/apply/myList', 15000);
        await go(page, '#/apply');
        const read = await response, data = await body(read);
        await page.locator('.pc-page-apply, .apply-seek-form').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 });
        const listed = Array.isArray(data?.rows) ? data.rows.find((row: Row) => String(row.applyNo) === applyNo) : undefined;
        if (!read || read.status() !== 200 || data?.code !== 200 || !listed)
            block('我的申请列表没有返回本轮申请编号' + applyNo + '的记录。');
        if (Number(listed.examineStatus) !== 3)
            fail('我的申请列表返回的该申请状态不是已取消（examineStatus=' + String(listed.examineStatus) + '）。');
        const binding = await page.evaluate(no => {
            const nodes = [...document.querySelectorAll('*')].filter(node => (node.textContent ?? '').includes(no) && node.children.length <= 6).sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
            for (const node of nodes.slice(0, 5)) {
                let current: Element | null = node;
                for (let depth = 0; depth < 6 && current; depth++, current = current.parentElement)
                    if ((current.textContent ?? '').includes('已取消'))
                        return { depth, text: (current.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 200) };
            }
            return null;
        }, applyNo);
        if (!binding)
            fail('列表页没有把申请编号' + applyNo + '与已取消状态展示在同一条记录里。');
        return { status: 'passed', detail: '实际打开历史申请记录，列表响应包含本轮申请编号' + applyNo + '且 examineStatus=3（已取消）；该编号在页面上与“已取消”标签处于同一条记录：' + JSON.stringify(binding.text) + '。' };
    }
    return undefined;
}

/** The only two business mutations a chain run may perform. Anything else on
 * the business API stays blocked, and the payload is checked before release. */
export async function releaseChainMutation(route: Route, gate: MutationGate, signal: AbortSignal): Promise<boolean> {
    const request = route.request(), method = request.method(), url = new URL(request.url());
    if (['GET', 'HEAD', 'OPTIONS'].includes(method))
        return false;
    if (url.origin !== 'https://testapi.yibentushu.com' || method !== 'POST')
        return false;
    const permit: MutationGate['submit'] | MutationGate['cancel'] | undefined = url.pathname === '/supply-api/dept/book/apply/submit' ? gate.submit : url.pathname === '/supply-api/dept/book/apply/cancel' ? gate.cancel : undefined;
    if (!permit) {
        await route.abort('blockedbyclient').catch(() => undefined);
        return true;
    }
    const refuse = async (reason: string) => {
        permit.rejectReason ??= reason;
        await route.abort('blockedbyclient').catch(() => undefined);
        return true;
    };
    if (!permit.armed || signal.aborted)
        return refuse('在未授权时段发出');
    if (!permit.expect)
        return refuse('缺少本地核对目标');
    if (permit.sent !== 0)
        return refuse('重复发送');
    let payload: Row;
    try {
        payload = request.postDataJSON();
    }
    catch {
        return refuse('请求体不是 JSON');
    }
    if (url.pathname === '/supply-api/dept/book/apply/submit') {
        const expect = gate.submit.expect!;
        const goods = Array.isArray(payload.goodsList) ? payload.goodsList : [], want = expect.goods;
        const differs: string[] = [];
        const check = (name: string, ok: boolean) => { if (!ok) differs.push(name); };
        check('applyType', Number(payload.applyType) === 1);
        check('bookUsage', Number(payload.bookUsage) === expect.bookUsage);
        check('costClientId', payload.costClientId === expect.customerCode);
        check('costClientName', payload.costClientName === expect.customerName);
        check('remark', payload.remark === expect.remark);
        check('receiverName', payload.receiverName === expect.recipient);
        check('receiverPhone', payload.receiverPhone === expect.phone);
        check('province', payload.province === expect.province);
        check('city', payload.city === expect.city);
        check('county', payload.county === expect.county);
        check('detailAddress', payload.detailAddress === expect.address);
        check('goodsList', goods.length === want.length && want.every(item => goods.filter((line: Row) => line.productId === item.code && Number(line.qty) === item.qty).length === 1));
        if (differs.length)
            return refuse('请求内容与本轮填写值不一致（' + differs.join('、') + '）');
    }
    else {
        const expect = gate.cancel.expect!;
        if (payload.applyNo !== expect.applyNo || Number(payload.cancelType) !== expect.cancelType)
            return refuse('撤销目标或类型与本地核对不一致');
    }
    permit.sent++;
    permit.payload = payload;
    await route.continue().catch(() => undefined);
    return true;
}
