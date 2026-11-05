import type { Page } from 'playwright';
import { actionablePreconditions, type BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { isLoginPage } from '../../../browser/login-handoff.js';
import { maskDifyProfileEvidence, captureDifyPng } from '../../evidence/module-evidence.js';
export type DifyDeviceKind = 'profile-display' | 'cross-device-layout';
export function difyDeviceKind(check: Pick<BrowserCheck, 'expected' | 'source'>): DifyDeviceKind | undefined {
    if (check.expected === '关联企微认证信息正确展示' && check.source.includes('员工端-我的页面') && check.source.includes('展示头像、用户名、手机号'))
        return 'profile-display';
    if (check.expected === 'PC与H5共用代码，通过响应式布局区分展示（识别PC/移动端切换布局），内容与交互与移动端一致' && check.source.includes('PC端适配') && check.source.includes('样书申请页/历史记录页/订单物流页'))
        return 'cross-device-layout';
}
export function reviewDifyDevice(check: BrowserCheck, evidence: string, targetUrl?: string) {
    const kind = difyDeviceKind(check);
    if (!kind || actionablePreconditions(check).length)
        return;
    let url: URL;
    try {
        url = new URL(targetUrl ?? '');
    }
    catch {
        return;
    }
    if (url.origin !== 'https://cdn.yibentushu.com' || !url.pathname.startsWith('/test-sample-apply/'))
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
    if (controls.filter(c => c.placeholder === '请输入收件人姓名').length !== 1)
        return;
    const steps: BrowserCheck['steps'] = [...(kind === 'cross-device-layout' ? [{ action: 'setViewport' as const, width: 1280, height: 800 }, { action: 'assertNoHorizontalOverflow' as const }] : []), { action: 'assertText', text: '费用划归客户' }, { action: 'assertText', text: '收件人' }];
    return { kind, steps, detail: kind === 'profile-display' ? '只读审核：同一账号切到移动布局的“我的”，对照本轮 getInfo 的姓名、手机号和头像；缺字段不以空白通过，证据遮蔽个人信息，完成后恢复原设备。' : '只读审核：同一账号实际加载 PC/H5 布局，核对共同应用入口、申请字段输入、两端本人申请/订单列表内容（有记录逐条对照编号与状态，零记录单独保留空态）、订单搜索及查询参数/结果、横向溢出；不把缩小桌面窗口冒充 H5，完成后恢复原设备。' };
}
/** Wait for the target's async PC application shell before the preserved base
 * assertions run. This is limited to the known read-only cross-device case. */
export async function waitForDifyDeviceBaseline(page: Page, check: BrowserCheck, targetUrl: string, timeoutMs = 15000) {
    if (difyDeviceKind(check) !== 'cross-device-layout')
        return;
    let target: URL;
    try {
        target = new URL(targetUrl);
    }
    catch {
        return;
    }
    if (target.origin !== 'https://cdn.yibentushu.com' || !target.pathname.startsWith('/test-sample-apply/'))
        return;
    const current = new URL(page.url());
    if (current.origin !== target.origin || !current.pathname.startsWith('/test-sample-apply/'))
        throw new Error('Blocked: Dify 跨端用例没有停留在部门申样目标页面；原始断言未执行。');
    try {
        await page.waitForFunction(() => {
            const shell = document.querySelector('.pc-page-home');
            if (!shell || !shell.getClientRects().length)
                return false;
            const text = shell.textContent ?? '';
            return text.includes('费用划归客户') && text.includes('收件人');
        }, undefined, { timeout: timeoutMs });
    }
    catch {
        throw new Error(`Blocked: 部门申样 PC 页面 ${Math.round(timeoutMs / 1000)} 秒内未完成字段渲染（费用划归客户、收件人）；原始断言保留，未判通过。`);
    }
}
type Result = {
    status: string;
    detail: string;
    evidence?: string;
    evidenceNote?: string;
};
const endpoint = (url: string, suffix: string) => {
    try {
        const u = new URL(url);
        return u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/' + suffix;
    }
    catch {
        return false;
    }
};
const number = (v: unknown) => typeof v === 'number' || typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
const isVisible = async (page: Page, text: string) => page.getByText(text, { exact: true }).filter({ visible: true }).count().then(n => n > 0);
const asRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : [];
type ApplyRecord = {
    applyNo: string;
    examineStatus: unknown;
    bookUsage: unknown;
};
type ApplySnapshot = {
    total: number;
    rows: ApplyRecord[];
    empty: boolean;
};
type OrderSnapshot = {
    total: number;
    orderNos: string[];
    empty: boolean;
    keyword?: {
        query: string;
        matched: string[];
    };
};
/** Kept inside Dify's existing case lease. No new account, shared runner action or login bypass. */
export async function verifyDifyDeviceResult(page: Page, check: BrowserCheck, result: Result, targetUrl: string, saveEvidence?: (png: Buffer) => Promise<string>) {
    const kind = difyDeviceKind(check);
    if (!kind || result.status !== 'passed')
        return;
    const original = await page.evaluate(() => ({ ua: navigator.userAgent, width: innerWidth, height: innerHeight, url: location.href }));
    const client = await page.context().newCDPSession(page);
    const stages: string[] = [];
    let hasAuthenticatedAvatar = false;
    const capture = async (redact = false) => {
        delete result.evidence;
        let style: import('playwright').ElementHandle | undefined, timer: ReturnType<typeof setTimeout> | undefined;
        try {
            if (!saveEvidence)
                throw Error('缺少截图保存通道');
            const current = new URL(page.url()), target = new URL(targetUrl);
            if (current.origin !== target.origin || !current.pathname.startsWith('/test-sample-apply/') || await isLoginPage(page))
                throw Error('当前不是已认证的目标业务页');
            await page.bringToFront();
            if (redact || current.hash.startsWith('#/my')) {
                style = await maskDifyProfileEvidence(page, hasAuthenticatedAvatar);
                result.evidenceNote = '本轮“我的”页现场。仅已返回的姓名、组织、手机号等个人字段已脱敏；默认头像、空字段和页面结构保留实际状态。';
            }
            result.evidence = await saveEvidence(await captureDifyPng(page, client));
        }
        catch {
            if (result.status === 'passed')
                result.status = 'blocked';
            result.detail += '；设备切换后的本轮截图未采集成功，未算完整通过。';
        }
        finally {
            if (timer)
                clearTimeout(timer);
            await style?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        }
    };
    const setDevice = async (mobile: boolean) => { await client.send('Network.setUserAgentOverride', { userAgent: mobile ? original.ua.replace(/ Mobile/g, '') + ' Mobile' : original.ua.replace(/ Mobile/g, '') }); await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }); };
    const load = async (route: string) => {
        await page.goto('about:blank');
        const url = new URL(targetUrl);
        url.hash = route;
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (await isLoginPage(page))
            throw Error('Blocked: 切换布局后登录未保持，未读取其他账号或绕过认证。');
    };
    const response = async (suffix: string, act: () => Promise<void>, query?: string, predicate?: (u: URL) => boolean) => {
        const requests = new Set<import('playwright').Request>();
        const onRequest = (request: import('playwright').Request) => {
            if (endpoint(request.url(), suffix) && request.method() === 'GET' && (!predicate || predicate(new URL(request.url()))))
                requests.add(request);
        };
        page.on('request', onRequest);
        const pending = page.waitForResponse(r => requests.has(r.request()) && (query === undefined || new URL(r.url()).searchParams.get('keyword') === query), { timeout: 10000 }).then(async (r) => ({ url: new URL(r.url()), ok: r.status() === 200, body: await r.json() })).catch(() => undefined);
        try {
            await act();
            return await pending;
        }
        finally {
            page.off('request', onRequest);
        }
    };
    const overflow = async (label: string) => {
        if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
            throw Error('断言失败：' + label + '出现横向溢出。');
    };
    try {
        if (kind === 'profile-display') {
            await setDevice(true);
            const read = await response('getInfo', () => load('/my'));
            await page.locator('.page-my').waitFor({ state: 'visible', timeout: 5000 });
            if (!read?.ok || read.body?.code !== 200 || !read.body.user) {
                result.status = 'blocked';
                result.detail = '未取得本轮成功的认证信息响应，不能只凭“我的”页面通过。';
                await capture(true);
                return;
            }
            const user = read.body.user;
            hasAuthenticatedAvatar = !!user.avatar;
            const visibleName = page.locator('.page-my .user-info .name');
            if (user.nickName && (await visibleName.count() !== 1 || (await visibleName.innerText()).trim() !== String(user.nickName).trim())) {
                result.status = 'failed';
                result.detail = '断言失败：登录认证已成功，但“我的”页用户名与本轮认证接口不一致；个人字段未持久化。';
                await capture(true);
                return;
            }
            const missing = [!user.nickName ? '用户名' : null, !user.phonenumber ? '手机号' : null, !user.avatar ? '认证头像' : null].filter(Boolean);
            if (missing.length) {
                result.status = 'blocked';
                result.detail = '本轮认证接口成功，已登录且页面用户名已对照；接口未返回' + missing.join('、') + '，无法验证原预期要求的完整企微认证资料。应排查被测系统的企微资料同步、权限或字段映射，不能据此认定你没有登录或企微资料未填写；空手机号和头像占位图未算通过。';
                await capture(true);
                return;
            }
            const name = page.locator('.page-my .user-info .name'), phone = page.locator('.page-my .user-info .phone'), image = page.locator('.page-my .user-info .avatar img');
            const matched = await name.count() === 1 && await phone.count() === 1 && await image.count() === 1 && (await name.innerText()).trim() === String(user.nickName).trim() && (await phone.innerText()).trim() === String(user.phonenumber).trim() && await image.evaluate((el, expected) => { const img = el as HTMLImageElement; return img.complete && img.naturalWidth > 0 && new URL(img.src, location.href).href === new URL(expected, location.href).href; }, String(user.avatar));
            result.status = matched ? 'passed' : 'failed';
            result.detail = matched ? '本轮认证接口与“我的”页面用户名、手机号、头像逐项一致；证据中的个人信息已遮蔽。' : '断言失败：认证接口与“我的”页面用户名、手机号或头像显示不一致；未持久化具体个人字段。';
            await capture(true);
            return;
        }
        let entry: string[] | undefined;
        let accountId: string | undefined;
        const snapshots: {
            label: string;
            apply: ApplySnapshot;
            orders: OrderSnapshot;
        }[] = [];
        for (const mobile of [false, true]) {
            const label = mobile ? 'H5' : 'PC';
            await setDevice(mobile);
            const identity = await response('getInfo', () => load('/home'));
            if (!identity?.ok || identity.body?.code !== 200 || !identity.body.user?.userId)
                throw Error('Blocked: ' + label + ' 缺少当前账号认证响应。');
            const current = String(identity.body.user.userId);
            if (accountId && accountId !== current)
                throw Error('Blocked: 两种布局的账号身份不一致。');
            accountId = current;
            const layout = page.locator(mobile ? '.page-home' : '.pc-page-home');
            await layout.waitFor({ state: 'visible', timeout: 6000 });
            await overflow(label + '申请页');
            const scripts = await page.locator('script[type="module"][src]').evaluateAll(elements => elements.map(el => new URL((el as HTMLScriptElement).src).pathname).sort());
            if (!scripts.length || entry && JSON.stringify(entry) !== JSON.stringify(scripts))
                throw Error('断言失败：PC/H5 没有使用同一个应用入口。');
            entry = scripts;
            for (const field of ['费用划归客户', '发货方式', '备注', '收件人', '手机号码', '所在地区', '详细地址'])
                if (!(await page.locator('body').innerText()).includes(field))
                    throw Error('断言失败：' + label + ' 申请页缺少共同字段 ' + field + '。');
            const remark = page.getByPlaceholder('如有特殊要求请填写备注信息', { exact: true });
            await remark.fill('TP跨端只读');
            await remark.blur();
            if (await remark.inputValue() !== 'TP跨端只读')
                throw Error('断言失败：' + label + ' 备注输入回显错误。');
            const recipient = page.getByPlaceholder(mobile ? '请输入收件人' : '请输入收件人姓名', { exact: true });
            await recipient.fill('跨端测试');
            await recipient.blur();
            if (await recipient.inputValue() !== '跨端测试')
                throw Error('断言失败：' + label + ' 收件人输入回显错误。');
            stages.push(label + '：识别到实际独立布局，共同字段与两类输入回显正确');
            const list = await response('dept/book/apply/myList', () => load('/apply'));
            if (!list?.ok || list.body?.code !== 200 || !Array.isArray(list.body.rows) || !Number.isFinite(number(list.body.total)))
                throw Error('Blocked: ' + label + ' 未取得本轮成功的本人申请列表查询，无法对照两端内容。');
            const applyRows = asRows(list.body.rows), applyTotal = number(list.body.total);
            let apply: ApplySnapshot;
            if (applyRows.length)
                try {
                    await page.waitForFunction(keys => keys.every(key => document.body.innerText.includes(key)), applyRows.map(r => String(r.applyNo ?? '')), { timeout: 5000 });
                }
                catch {
                    throw Error('断言失败：' + label + '申请列表接口成功，但本页编号未完整显示。');
                }
            if (applyTotal > applyRows.length) {
                if (applyTotal > 100)
                    throw Error('Blocked: 跨端本人申请超过本轮100条核验上限。');
                let pageNum = Number(list.url.searchParams.get('pageNum') ?? '1');
                while (applyRows.length < applyTotal) {
                    let act: () => Promise<void>;
                    if (mobile)
                        act = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                    else {
                        const next = page.getByRole('button', { name: '下一页', exact: true }).filter({ visible: true });
                        if (await next.count() !== 1 || !await next.isEnabled())
                            throw Error('Blocked: PC列表未找到唯一的下一页操作，不能比较不同页长的第一页全集。');
                        act = () => next.click();
                    }
                    const next = await response('dept/book/apply/myList', act, undefined, u => u.searchParams.get('pageNum') === String(pageNum + 1));
                    if (!next?.ok || next.body?.code !== 200 || number(next.body.total) !== applyTotal || !Array.isArray(next.body.rows) || !next.body.rows.length)
                        throw Error('Blocked: 跨端分页未取得总数稳定的成功响应。');
                    const more = asRows(next.body.rows);
                    if (more.some(r => applyRows.some(v => v.applyNo === r.applyNo)))
                        throw Error('断言失败：跨端本人申请分页存在重复编号。');
                    try {
                        await page.waitForFunction(keys => keys.every(key => document.body.innerText.includes(key)), more.map(r => String(r.applyNo ?? '')), { timeout: 5000 });
                    }
                    catch {
                        throw Error('断言失败：分页接口返回的申请编号未在页面展示。');
                    }
                    applyRows.push(...more);
                    pageNum++;
                    if (pageNum > 10)
                        throw Error('Blocked: 跨端分页超过限定页数。');
                }
                if (applyRows.length !== applyTotal)
                    throw Error('Blocked: 跨端分页汇总数量不一致。');
                stages.push(label + '：已实际翻页读取全部' + applyRows.length + '条本人申请');
            }
            if (applyTotal === 0 && applyRows.length === 0) {
                if (!await isVisible(page, '暂无申请记录'))
                    throw Error('断言失败：' + label + ' 本人列表的成功零条查询未展示空态。');
                apply = { total: 0, rows: [], empty: true };
            }
            else {
                if (!applyRows.length)
                    throw Error('Blocked: ' + label + ' 本人申请列表总数非零但当前页没有记录行，未猜测分页。');
                const keys = applyRows.map(row => String(row.applyNo ?? ''));
                if (keys.some(key => !key))
                    throw Error('Blocked: ' + label + ' 本人申请列表存在缺少申请编号的记录，无法逐条对照。');
                apply = { total: applyTotal, rows: applyRows.map(row => ({ applyNo: String(row.applyNo ?? ''), examineStatus: row.examineStatus, bookUsage: row.bookUsage })), empty: false };
                stages.push(label + '：本人申请记录 ' + applyTotal + ' 条，本轮 ' + keys.length + ' 个申请编号与实际页面逐页核对');
            }
            await overflow(label + '申请列表');
            const orders = await response('h5/dept/book/order/myList', () => load('/logistics'));
            if (!orders?.ok || orders.body?.code !== 200 || !Array.isArray(orders.body.rows) || !Number.isFinite(number(orders.body.total)))
                throw Error('Blocked: ' + label + ' 未取得本轮成功的本人订单查询，无法对照两端内容。');
            const orderRows = asRows(orders.body.rows), orderTotal = number(orders.body.total);
            const orderNos = orderRows.map(row => String(row.orderId ?? ''));
            const search = page.getByPlaceholder('搜索订单号/书籍', { exact: true });
            let order: OrderSnapshot;
            if (orderTotal === 0 && orderRows.length === 0) {
                if (!await isVisible(page, mobile ? '暂无订单记录' : '暂无订单物流记录'))
                    throw Error('断言失败：' + label + ' 订单成功零条查询未展示空态。');
                const query = 'TP_CROSS_DEVICE_NO_MATCH';
                const searched = await response('h5/dept/book/order/myList', async () => { await search.fill(query); await search.press('Enter'); await search.blur(); }, query);
                if (!searched?.ok || searched.body?.code !== 200 || !Array.isArray(searched.body.rows) || searched.body.rows.length !== 0 || number(searched.body.total) !== 0)
                    throw Error('Blocked: ' + label + ' 未取得本轮同关键词的成功订单搜索。');
                if (!await isVisible(page, mobile ? '暂无订单记录' : '暂无订单物流记录'))
                    throw Error('断言失败：' + label + ' 无匹配订单搜索未正确回显空态。');
                order = { total: 0, orderNos: [], empty: true };
                stages.push(label + '：申请/订单列表与关键词搜索的本轮零条响应及空态一致');
            }
            else {
                if (!orderRows.length)
                    throw Error('Blocked: ' + label + ' 本人订单总数非零但当前页没有记录行，未猜测分页。');
                if (orderNos.some(no => no.length < 4))
                    throw Error('Blocked: ' + label + ' 本人订单存在缺少可核对订单编号的记录，无法逐条对照。');
                const text = await page.locator('body').innerText();
                for (const no of orderNos)
                    if (!text.includes(no))
                        throw Error('断言失败：' + label + ' 订单列表页面没有展示本条返回的订单编号，接口与页面不一致。');
                const query = orderNos[0]!.slice(0, -2);
                const searched = await response('h5/dept/book/order/myList', async () => { await search.fill(query); await search.press('Enter'); await search.blur(); }, query);
                if (!searched?.ok || searched.body?.code !== 200 || !Array.isArray(searched.body.rows))
                    throw Error('Blocked: ' + label + ' 未取得本人订单编号上的关键词搜索结果。');
                const matched = asRows(searched.body.rows).map(row => String(row.orderId ?? ''));
                if (!matched.includes(orderNos[0]!))
                    throw Error('断言失败：' + label + ' 部分订单编号搜索没有返回原订单。');
                order = { total: orderTotal, orderNos, empty: false, keyword: { query, matched } };
                stages.push(label + '：本人订单记录 ' + orderTotal + ' 条，第一页 ' + orderNos.length + ' 个订单编号在页面可见，部分编号搜索命中原订单');
            }
            await overflow(label + '订单搜索');
            snapshots.push({ label, apply, orders: order });
        }
        const pc = snapshots.find(snapshot => snapshot.label === 'PC'), h5 = snapshots.find(snapshot => snapshot.label === 'H5');
        if (!pc || !h5)
            throw Error('Blocked: 未取得两种布局的完整本轮数据，不能判定跨端一致。');
        if (pc.apply.empty !== h5.apply.empty || pc.apply.total !== h5.apply.total)
            throw Error('断言失败：同一账号 PC/H5 本人申请列表总数或空态不一致（PC ' + pc.apply.total + ' 条 / H5 ' + h5.apply.total + ' 条）。');
        if (pc.orders.empty !== h5.orders.empty || pc.orders.total !== h5.orders.total)
            throw Error('断言失败：同一账号 PC/H5 本人订单列表总数或空态不一致（PC ' + pc.orders.total + ' 条 / H5 ' + h5.orders.total + ' 条）。');
        if (!pc.apply.empty) {
            const pcRows = pc.apply.rows.slice().sort((a, b) => a.applyNo.localeCompare(b.applyNo)), h5Rows = h5.apply.rows.slice().sort((a, b) => a.applyNo.localeCompare(b.applyNo));
            if (JSON.stringify(pcRows.map(row => row.applyNo)) !== JSON.stringify(h5Rows.map(row => row.applyNo)))
                throw Error('断言失败：同一账号 PC/H5 申请列表逐页读取后的申请编号集合不一致。');
            for (let index = 0; index < pcRows.length; index++)
                if (String(pcRows[index]!.examineStatus) !== String(h5Rows[index]!.examineStatus) || String(pcRows[index]!.bookUsage) !== String(h5Rows[index]!.bookUsage))
                    throw Error('断言失败：同一申请在 PC/H5 的审批状态或用书类型字段不一致。');
        }
        if (!pc.orders.empty) {
            if (JSON.stringify(pc.orders.orderNos.slice().sort()) !== JSON.stringify(h5.orders.orderNos.slice().sort()))
                throw Error('断言失败：同一账号 PC/H5 订单列表第一页的订单编号集合不一致。');
            if (JSON.stringify(pc.orders.keyword?.matched.slice().sort()) !== JSON.stringify(h5.orders.keyword?.matched.slice().sort()))
                throw Error('断言失败：同一订单编号部分关键词在 PC/H5 命中的结果集合不一致。');
        }
        if (pc.apply.empty && pc.orders.empty)
            result.detail = '本轮 PC 1280×800 与 H5 390×844 使用同一账号和应用入口；' + stages.join('；') + '。仅覆盖当前零记录状态，不宣称有记录详情/分页已验收。';
        else
            result.detail = '本轮 PC 1280×800 与 H5 390×844 使用同一账号和应用入口；' + stages.join('；') + '。两端本人申请在限定100条内实际逐页读取、编号集合及状态/用途一致；订单核验当前页及部分编号搜索，不宣称订单详情与全部分页已验收。';
        await capture();
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        result.status = detail.startsWith('断言失败：') ? 'failed' : 'blocked';
        result.detail = detail.replace(/^Blocked: /, '') + (stages.length ? ' 已完成：' + stages.join('；') : '');
        await capture(kind === 'profile-display').catch(() => { delete result.evidence; });
    }
    finally {
        try {
            await client.send('Network.setUserAgentOverride', { userAgent: original.ua });
            await page.setViewportSize({ width: original.width, height: original.height });
            await page.goto('about:blank');
            await page.goto(original.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch {
            result.status = 'blocked';
            result.detail += '；原设备/页面恢复未完成，需先恢复账号窗口。';
        }
        await client.detach().catch(() => { });
    }
}
