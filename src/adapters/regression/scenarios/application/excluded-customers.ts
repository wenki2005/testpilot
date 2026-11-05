import type { Page, Request } from 'playwright';
import { actionablePreconditions, type BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { readDepartmentExcludedCustomers } from '../../../database/mysql-browser.js';
export const isExcludedCustomer = (c: Pick<BrowserCheck, 'source' | 'expected'>) => c.source.includes('客户列表数据范围') && c.expected === '其他分类（信用客户1004.01/呆账客户1004.02/内部结算客户1004.03/内部客户其他1004.04/控价不发货1004.05）：不展示';
export function reviewExcludedCustomer(check: BrowserCheck, evidence: string, targetUrl?: string) {
    if (!isExcludedCustomer(check) || actionablePreconditions(check).length)
        return;
    let u: URL, p: {
        customerSearchIndex?: number;
    };
    try {
        u = new URL(targetUrl ?? '');
        p = JSON.parse(evidence);
    }
    catch {
        return;
    }
    if (u.origin !== 'https://cdn.yibentushu.com' || !u.pathname.startsWith('/test-sample-apply/') || !Number.isInteger(p.customerSearchIndex) || p.customerSearchIndex! < 0 || p.customerSearchIndex! > 9)
        return;
    return { kind: 'excluded-customer' as const, steps: [{ action: 'assertText' as const, text: '费用划归客户' }, { action: 'fillByRoleIndex' as const, role: 'combobox' as const, index: p.customerSearchIndex!, value: 'TP_SCOPE_PREPARE' }, { action: 'assertText' as const, text: '费用划归客户' }], detail: '只读审核：读取五种排除分类的未删除客户，并配对有效/审核标志相同的允许分类客户。先实际查询正向对照确认可返回，再检查排除分类不返回；不额外假定必须有效且已审核。缺对照或查询失败仍阻塞。' };
}
export async function verifyExcludedCustomer(page: Page, check: BrowserCheck, result: {
    status: string;
    detail: string;
    evidence?: string;
}, read = readDepartmentExcludedCustomers) {
    if (!isExcludedCustomer(check) || result.status !== 'passed')
        return;
    delete result.evidence;
    try {
        const u = new URL(page.url());
        if (u.origin !== 'https://cdn.yibentushu.com' || !u.pathname.startsWith('/test-sample-apply/') || u.hash.split('?')[0] !== '#/home')
            throw Error('Blocked: 当前不是约定的申请表单。');
        const candidates = await read(), categories = ['1004.01', '1004.02', '1004.03', '1004.04', '1004.05'];
        const missing = categories.filter(k => candidates.filter(c => c.category === k && /^[A-Za-z0-9_-]{1,60}$/.test(c.code)).length !== 1);
        const available = categories.flatMap(k => { const matches = candidates.filter(c => c.category === k && /^[A-Za-z0-9_-]{1,60}$/.test(c.code)); return matches.length === 1 ? matches : []; });
        if (!available.length)
            throw Error('Blocked: 测试库没有五种排除分类的未删除客户基线。');
        const input = page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '费用划归客户' }) }).getByRole('combobox');
        if (await input.count() !== 1)
            throw Error('Blocked: 客户字段未唯一定位。');
        const checked: string[] = [];
        const search = async (code: string) => {
            const requests = new Set<Request>();
            const start = (r: Request) => {
                try {
                    const u = new URL(r.url());
                    if (r.method() === 'GET' && u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/dept/book/apply/clientSearch' && u.searchParams.get('keyword') === code)
                        requests.add(r);
                }
                catch { }
            };
            page.on('request', start);
            const pending = page.waitForResponse(r => requests.has(r.request()), { timeout: 10000 }).then(async (r) => ({ ok: r.status() === 200, body: await r.json() })).catch(() => undefined);
            let response;
            try {
                await input.fill(code);
                response = await pending;
            }
            finally {
                page.off('request', start);
            }
            if (!response?.ok || response.body?.code !== 200 || !Array.isArray(response.body.data))
                throw Error('Blocked: 本轮客户分类或正向对照查询未成功。');
            return response.body.data as Array<{
                agentId?: unknown;
            }>;
        };
        for (const candidate of available) {
            const control = candidate.control;
            if (!control || control.category !== '1004.00' || !/^[A-Za-z0-9_-]{1,60}$/.test(control.code) || control.code === candidate.code)
                throw Error('Blocked: 分类 ' + candidate.category + ' 缺少有效/审核标志相同的允许分类正向对照，不能用空查询证明分类排除。');
            const positive = await search(control.code);
            if (!positive.some(r => r.agentId === control.code))
                throw Error('Blocked: 分类 ' + candidate.category + ' 对应的允许分类正向对照未返回；无法排除其他筛选条件导致的空结果。');
            const rows = await search(candidate.code);
            if (rows.some(r => r.agentId === candidate.code))
                throw Error('断言失败：排除分类 ' + candidate.category + ' 的客户仍由下拉查询接口返回。');
            // A full-code negative query must be empty. Other matches prevent a reliable
            // visual correspondence rather than being mistaken for this customer's name.
            if (rows.length)
                throw Error('Blocked: 分类 ' + candidate.category + ' 的完整编码查询还有其他匹配，无法可靠核对下拉排除。');
            await page.getByText('无数据', { exact: true }).filter({ visible: true }).waitFor({ state: 'visible', timeout: 5000 });
            if (await page.getByRole('option').filter({ visible: true }).count())
                throw Error('断言失败：分类 ' + candidate.category + ' 查询为空，但下拉仍展示可选客户。');
            checked.push(candidate.category);
        }
        if (missing.length)
            throw Error('Blocked: 已实测分类 ' + checked.join('、') + '，配对正向对照可返回，排除分类查询均0条且下拉无可选项；仍缺 ' + missing.join('、') + ' 的独立数据库基线，完整五分类预期保留阻塞。');
        result.detail = '五种排除分类 ' + checked.join('、') + ' 均有未删除的数据库样本；每类先查询有效/审核标志相同的允许分类对照，确认真实接口可返回，再查询排除分类。5组正向对照命中，5组排除查询成功且均0条、下拉无可选项。不再额外限定“有效且已审核”造成假性缺样本；仅覆盖5个分类样本。';
    }
    catch (error) {
        const m = error instanceof Error ? error.message : '';
        result.status = m.startsWith('断言失败：') ? 'failed' : 'blocked';
        result.detail = /^(断言失败：|Blocked: )/.test(m) ? m.replace(/^Blocked: /, '') : '排除客户分类未取得完整的独立基线、新查询及页面证据。';
    }
}
