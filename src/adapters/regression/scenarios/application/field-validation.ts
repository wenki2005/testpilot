import { createHash } from 'node:crypto';
import type { Page, Locator } from 'playwright';
import { actionablePreconditions, resolveDocumentField, type BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { loadDifyCustomerFixtures } from '../../config/test-fixtures.js';
import { loadDifyBookFixtures } from '../books/book-search.js';
export type FieldValidityKind = 'recipient-valid' | 'phone-valid' | 'address-valid' | 'quantity-invalid';
const recipient = '请输入收件人姓名', phone = '请输入手机号码', address = '请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等';
const placeholders = { 'recipient-valid': recipient, 'phone-valid': phone, 'address-valid': address, 'quantity-invalid': '' };
const values = { 'recipient-valid': 'ABCDEFGHIJKLMNOPQRST', 'phone-valid': '13800138000', 'address-valid': 'ABCDEFGHIJKLMNOPQRST', 'quantity-invalid': '1' };
const prepared = new WeakMap<Page, {
    caseId: string;
    kind: FieldValidityKind;
}>();
export function fieldValidityKind(check: Pick<BrowserCheck, 'expected' | 'source'>): FieldValidityKind | undefined {
    if (check.expected === '文本≤20字：通过' && check.source.includes('填写收件人'))
        return 'recipient-valid';
    if (check.expected === '11位数字：通过' && check.source.includes('填写手机号码'))
        return 'phone-valid';
    if (check.expected === '手动输入≤20字：通过' && check.source.includes('填写详细地址'))
        return 'address-valid';
    if (check.expected === '数量为空/0/负数/小数/字母：拦截，提交按钮不可点亮' && check.source.includes('输入图书数量'))
        return 'quantity-invalid';
}
const knownTarget = (target: string) => {
    try {
        const u = new URL(target);
        return u.origin === 'https://cdn.yibentushu.com' && u.pathname.startsWith('/test-sample-apply/');
    }
    catch {
        return false;
    }
};
export function reviewFieldValidity(check: BrowserCheck, evidence: string, targetUrl?: string) {
    const kind = fieldValidityKind(check);
    if (!kind || !knownTarget(targetUrl ?? '') || actionablePreconditions(check).length)
        return;
    let controls: Array<{
        placeholder?: string;
    }>;
    try {
        controls = JSON.parse(evidence).controls ?? [];
    }
    catch {
        return;
    }
    if ([recipient, phone, address].some(p => controls.filter(c => c.placeholder === p).length !== 1))
        return;
    if (kind === 'quantity-invalid') {
        const page = JSON.parse(evidence);
        if (!page.bookCodeAliasConfirmed || !['自编码', '物流编码'].includes(page.bookCodeLabel))
            return;
        return { kind, steps: [{ action: 'fillByLabel' as const, label: '数量（册）', value: '1' }, { action: 'blurByLabel' as const, label: '数量（册）' }, { action: 'assertValue' as const, label: '数量（册）', value: '1' }], detail: '只读审核：先准备其他必填项全部有效且可提交的完整表单；分别输入空值、0、负数、小数和字母，逐项检查不能点亮提交，再恢复1确认可提交。不点击提交、不创建申请。' };
    }
    const placeholder = placeholders[kind], value = values[kind];
    return { kind, steps: [{ action: 'fillByPlaceholder' as const, placeholder, value }, { action: 'blurByPlaceholder' as const, placeholder }, { action: 'assertValueByPlaceholder' as const, placeholder, value }], detail: '只读审核：先以已有独立客户/图书基线准备完整表单；保持其他字段不变，验证本字段有效时提交控件可用、无效时禁用、恢复有效后再次可用。仅核验客户端，不点击提交，不创建申请。' };
}
async function unique(locator: Locator, label: string) {
    if (await locator.count() !== 1)
        throw Error('Blocked: ' + label + '没有唯一可见控件。');
    return locator;
}
const submit = (page: Page) => page.locator('.pc-page-home .home-footer .button').filter({ hasText: /^\s*提交申请\s*$/ });
async function state(page: Page) { const control = await unique(submit(page), '提交状态'); return control.evaluate(el => ({ disabled: el.classList.contains('button-disabled') || el.getAttribute('aria-disabled') === 'true' || el instanceof HTMLButtonElement && el.disabled, visible: !!el.getClientRects().length })); }
async function waitState(page: Page, disabled: boolean) {
    const end = Date.now() + 3000;
    do {
        const s = await state(page);
        if (s.visible && s.disabled === disabled)
            return;
        await new Promise(r => setTimeout(r, 50));
    } while (Date.now() < end);
    throw Error('断言失败：' + (disabled ? '无效字段未使提交控件禁用。' : '有效字段没有使完整表单恢复可提交状态。'));
}
async function choose(page: Page, control: Locator, label: string) { await (await unique(control, '下拉字段')).click(); const option = page.getByRole('option', { name: label, exact: true }).filter({ visible: true }); await option.first().waitFor({ state: 'visible', timeout: 5000 }); await (await unique(option, '下拉选项')).click(); }
/** This runs in the existing case lease after its fresh-page reset. Every action
 * is a read/query, field fill or choice; the submit control is never clicked. */
export async function prepareCompleteDifyForm(page: Page, targetUrl: string, dataRoot: string) {
    if (!knownTarget(targetUrl) || !knownTarget(page.url()) || new URL(page.url()).hash.split('?')[0] !== '#/home')
        throw Error('Blocked: 正向字段校验没有停留在约定的申请页面。');
    await (await unique(page.locator('.pc-page-home').filter({ visible: true }), 'PC申请页面')).waitFor({ state: 'visible', timeout: 8000 });
    const customers = await loadDifyCustomerFixtures(dataRoot), books = await loadDifyBookFixtures(dataRoot);
    const customer = customers.find(c => c.category === '1004.00'), book = books[0];
    if (!customer || !book)
        throw Error('Blocked: 正向字段校验缺少仍有效的独立客户或图书基线。');
    const usage = page.locator('.home-form-item').filter({ has: page.locator('label').filter({ hasText: '样书用途' }) }).getByRole('combobox');
    await choose(page, usage, '营销用书');
    const customerInput = await unique(page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '费用划归客户' }) }).getByRole('combobox'), '客户搜索');
    const customerRead = page.waitForResponse(r => {
        try {
            const u = new URL(r.url());
            return r.request().method() === 'GET' && u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/dept/book/apply/clientSearch' && u.searchParams.get('keyword') === customer.code;
        }
        catch {
            return false;
        }
    }, { timeout: 10000 }).then(async (r) => ({ ok: r.status() === 200, body: await r.json() })).catch(() => undefined);
    await customerInput.fill(customer.code);
    const read = await customerRead;
    const matches = read?.body?.data?.filter((c: {
        agentId?: string;
    }) => c.agentId === customer.code);
    if (!read?.ok || read.body?.code !== 200 || !Array.isArray(matches) || matches.length !== 1 || typeof matches[0].agentName !== 'string')
        throw Error('Blocked: 没有取得本条基线客户的成功查询。');
    const customerOption = page.getByRole('option', { name: matches[0].agentName, exact: true }).filter({ visible: true });
    await customerOption.first().waitFor({ state: 'visible', timeout: 5000 });
    await (await unique(customerOption, '基线客户选项')).click();
    const selected = await customerInput.evaluate(el => el.closest('.el-select')?.querySelector('.el-select__placeholder')?.textContent?.trim());
    if (selected !== matches[0].agentName.trim())
        throw Error('Blocked: 客户查询结果未正确回填。');
    const code = await resolveDocumentField(page, '自编码');
    const bookRead = page.waitForResponse(r => {
        try {
            const u = new URL(r.url());
            return r.request().method() === 'GET' && u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/dept/book/apply/bookCheck' && u.searchParams.get('productId') === book.code;
        }
        catch {
            return false;
        }
    }, { timeout: 10000 }).then(async (r) => ({ ok: r.status() === 200, body: await r.json() })).catch(() => undefined);
    await code.fill(book.code);
    await code.blur();
    const bookResult = await bookRead;
    if (!bookResult?.ok || bookResult.body?.code !== 200 || bookResult.body?.data?.productId !== book.code || Number(bookResult.body.data.hprice) !== book.price || Number(bookResult.body.data.weight) !== book.weightGrams)
        throw Error('Blocked: 本轮图书响应与独立基线不一致。');
    await page.getByText(book.name, { exact: true }).first().waitFor({ state: 'visible', timeout: 5000 });
    const quantity = await resolveDocumentField(page, '数量（册）');
    await quantity.fill('1');
    await quantity.blur();
    await (await unique(page.getByPlaceholder(recipient, { exact: true }), '收件人')).fill('测试收件人');
    await (await unique(page.getByPlaceholder(phone, { exact: true }), '手机号')).fill('13800138000');
    const regions = page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '所在地区' }) }).getByRole('combobox');
    if (await regions.count() !== 3)
        throw Error('Blocked: 省市区没有三个唯一的顺序控件。');
    await choose(page, regions.nth(0), '湖南省');
    await choose(page, regions.nth(1), '长沙市');
    await choose(page, regions.nth(2), '芙蓉区');
    const addressInput = await unique(page.getByPlaceholder(address, { exact: true }), '详细地址');
    await addressInput.fill('测试地址一号');
    await addressInput.blur();
    await waitState(page, false);
    return book;
}
export async function prepareFieldValidityBaseline(page: Page, check: BrowserCheck, targetUrl: string, dataRoot: string) {
    const kind = fieldValidityKind(check);
    if (!kind)
        return;
    prepared.delete(page);
    await prepareCompleteDifyForm(page, targetUrl, dataRoot);
    prepared.set(page, { caseId: check.id, kind });
}
/** Direct, counterfactual validation: the same otherwise-valid form must switch
 * enabled -> disabled -> enabled when only this input changes. */
export async function verifyFieldTransitions(page: Page, placeholder: string, validValues: string[], invalidValue: string) {
    const input = await unique(page.getByPlaceholder(placeholder, { exact: true }), '待校验字段');
    const otherFields = async () => createHash('sha256').update(JSON.stringify(await page.locator('.pc-page-home input,.pc-page-home textarea,.pc-page-home select').evaluateAll((els, p) => els.filter(el => el.getAttribute('placeholder') !== p).map(el => ({ tag: el.tagName, placeholder: el.getAttribute('placeholder'), value: (el as HTMLInputElement).value })), placeholder))).digest('hex');
    const baseline = await otherFields();
    try {
        for (const value of validValues) {
            await input.fill(value);
            await input.blur();
            if (await input.inputValue() !== value)
                throw Error('断言失败：合法边界输入被截断或改变。');
            await waitState(page, false);
        }
        await input.fill(invalidValue);
        await input.blur();
        await waitState(page, true);
        if (await otherFields() !== baseline)
            throw Error('Blocked: 其他表单字段发生变化，不能把禁用归因于本字段。');
        await input.fill(validValues.at(-1)!);
        await input.blur();
        await waitState(page, false);
        if (await otherFields() !== baseline)
            throw Error('Blocked: 恢复后的其他字段与基线不同。');
    }
    finally {
        await input.fill(validValues.at(-1)!).catch(() => { });
        await input.blur().catch(() => { });
    }
}
export async function verifyQuantityInvalidTransitions(page: Page) {
    const input = await resolveDocumentField(page, '数量（册）');
    const otherFields = async () => createHash('sha256').update(JSON.stringify(await input.evaluate(target => [...document.querySelectorAll('.pc-page-home input,.pc-page-home textarea,.pc-page-home select')].filter(el => el !== target).map(el => ({ tag: el.tagName, placeholder: el.getAttribute('placeholder'), value: (el as HTMLInputElement).value }))))).digest('hex');
    await input.fill('1');
    await input.blur();
    await waitState(page, false);
    const baseline = await otherFields(), observed: string[] = [], problems: string[] = [];
    try {
        for (const raw of ['', '0', '-1', '1.5', 'abc']) {
            await input.fill(raw);
            await input.blur();
            const actual = await input.inputValue();
            try {
                await waitState(page, true);
                observed.push(JSON.stringify(raw) + '→' + JSON.stringify(actual) + ' 禁用');
            }
            catch {
                observed.push(JSON.stringify(raw) + '→' + JSON.stringify(actual) + ' 可提交');
                problems.push(JSON.stringify(raw) + '被处理为' + JSON.stringify(actual) + '后提交仍可用');
            }
            if (await otherFields() !== baseline)
                throw Error('Blocked: 数量测试期间其他必填项发生变化。');
            await input.fill('1');
            await input.blur();
            await waitState(page, false);
        }
    }
    finally {
        await input.fill('1').catch(() => { });
        await input.blur().catch(() => { });
    }
    if (problems.length)
        throw Error('断言失败：' + problems.join('；') + '。逐项观察：' + observed.join('；'));
    return observed.join('；');
}
export async function verifyFieldValidityResult(page: Page, check: BrowserCheck, result: {
    status: string;
    detail: string;
    evidence?: string;
}) {
    const kind = fieldValidityKind(check);
    if (!kind || result.status !== 'passed')
        return;
    const baseline = prepared.get(page);
    prepared.delete(page);
    if (!baseline || baseline.caseId !== check.id || baseline.kind !== kind) {
        result.status = 'blocked';
        result.detail = '未取得本条完整表单的独立准备与可提交基线，输入回显不算校验通过。';
        return;
    }
    try {
        if (kind === 'quantity-invalid') {
            result.detail += '；其他必填项固定有效，数量逐项验证：' + await verifyQuantityInvalidTransitions(page) + '；每项均恢复1并确认提交可用，未点击提交、未创建申请。';
            delete result.evidence;
            return;
        }
        await verifyFieldTransitions(page, placeholders[kind], kind === 'phone-valid' ? [values[kind]] : ['A', values[kind]], kind === 'phone-valid' ? '123' : '');
        result.detail += '；在其他必填项固定有效时，本字段' + (kind === 'phone-valid' ? '11位有效号码' : '1字与20字边界') + '使提交控件可用，改为' + (kind === 'phone-valid' ? '短号码' : '空值') + '后禁用，恢复合法值后再次可用；未点击提交、未创建记录。';
        delete result.evidence;
    }
    catch (error) {
        result.status = error instanceof Error && error.message.startsWith('Blocked:') ? 'blocked' : 'failed';
        result.detail = error instanceof Error ? error.message : '字段正向校验未完成。';
        delete result.evidence;
    }
}
