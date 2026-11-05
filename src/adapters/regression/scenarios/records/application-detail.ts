import type { Page, Request, ElementHandle } from 'playwright';
import { actionablePreconditions, type BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { readDepartmentApplications, readDepartmentGoods, readDepartmentAccountCount, readDepartmentApplicationSnapshot } from '../../../database/mysql-browser.js';
import { compareDepartmentList, compareDepartmentGoods } from '../../../database/regression-readback.js';
import { captureDifyPng } from '../../evidence/module-evidence.js';
type Row = Record<string, unknown>;
type Result = {
    status: string;
    detail: string;
    evidence?: string;
    evidenceNote?: string;
};
export type DifyRecordKind = 'application-card-fields' | 'application-detail-readonly' | 'application-detail-back' | 'application-pending-status' | 'application-multiline-totals';
export function difyRecordKind(check: Pick<BrowserCheck, 'source' | 'expected'>): DifyRecordKind | undefined {
    if (check.expected === '多行样书明细逐行展示小计，总计=∑小计、预估总重=∑(数量×单本重量)' && check.source.includes('员工端-申请表单明细展示页'))
        return 'application-multiline-totals';
    if (check.expected === '页面纯只读，无编辑/提交/删除入口' && check.source.includes('员工端-申请表单明细展示页'))
        return 'application-detail-readonly';
    if (check.expected === '从明细页返回后回到审批详情页，审批时间轴与状态不丢失' && check.source.includes('员工端-用书审批详情页'))
        return 'application-detail-back';
    if (check.expected === '待审核：状态按钮置灰' && check.source.includes('员工端-用书审批详情页') && check.source.includes('查看审批流程与状态'))
        return 'application-pending-status';
    if (check.expected === '展示申请编号、申请时间、申请用途、申请人、申请诉求(仅第一本书)及总本数、申请状态' && check.source.includes('员工端-历史申请记录页') && check.source.includes('按申请时间倒序展示申请记录卡片'))
        return 'application-card-fields';
}
export function reviewDifyRecord(check: BrowserCheck, evidence: string, targetUrl?: string) {
    const kind = difyRecordKind(check);
    if (!kind || actionablePreconditions(check).length)
        return;
    let u: URL, observed: {
        navigation?: string[];
    };
    try {
        u = new URL(targetUrl ?? '');
        observed = JSON.parse(evidence);
    }
    catch {
        return;
    }
    if (u.origin !== 'https://cdn.yibentushu.com' || !u.pathname.startsWith('/test-sample-apply/') || observed.navigation?.filter(t => t === '历史申请记录').length !== 1)
        return;
    return { kind, steps: [{ action: 'blurByLabel' as const, label: '收件人' }, { action: 'assertExactVisible' as const, text: '收货信息' }], detail: '只读审核：先确认申请页字段基线，再由完整核验场景重新打开当前账号无筛选列表、身份及对应数据库记录，逐项验证卡片字段或本人明细页无编辑入口；不依赖重复点击导航文字，入口子步骤通过不算完整通过。' };
}
const known = (u: URL) => u.origin === 'https://cdn.yibentushu.com' && u.pathname.startsWith('/test-sample-apply/');
const endpoint = (raw: string, path: string) => {
    try {
        const u = new URL(raw);
        return u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/' + path;
    }
    catch {
        return false;
    }
};
const database = { applications: readDepartmentApplications, goods: readDepartmentGoods, count: readDepartmentAccountCount, snapshot: readDepartmentApplicationSnapshot };
/** Identifiers and personal fields stay in memory. Only counts, field names,
 * and masked screenshots are persisted. No record is created or changed. */
export async function verifyDifyRecordResult(page: Page, check: BrowserCheck, result: Result, targetUrl: string, saveEvidence: (png: Buffer) => Promise<string>, db = database) {
    const kind = difyRecordKind(check);
    if (!kind || result.status !== 'passed')
        return;
    delete result.evidence;
    const original = page.url();
    let style: ElementHandle | undefined, stage = '读取本人列表与身份';
    const fresh = async (path: string, action: () => Promise<void>, predicate?: (url: URL) => boolean) => {
        const requests = new Set<Request>();
        const started = (r: Request) => {
            if (r.method() === 'GET' && endpoint(r.url(), path) && (!predicate || predicate(new URL(r.url()))))
                requests.add(r);
        };
        page.on('request', started);
        const pending = page.waitForResponse(r => requests.has(r.request()), { timeout: 10000 }).then(async (r) => {
            const b = await r.json();
            if (r.status() !== 200 || b.code !== 200)
                throw Error('Blocked: 本条只读查询没有成功。');
            return b;
        });
        try {
            await action();
            return await pending;
        }
        finally {
            page.off('request', started);
            void pending.catch(() => { });
        }
    };
    try {
        if (!known(new URL(targetUrl)) || !known(new URL(page.url())))
            throw Error('Blocked: 当前不是约定的申样测试页面。');
        await page.goto('about:blank');
        const url = new URL(targetUrl);
        url.hash = '/apply';
        let list: Row, identity: Row, dict: Row;
        const loaded = await Promise.all([
            fresh('dept/book/apply/myList', () => page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => { }), u => ['bookUsage', 'examineStatus', 'applyNo'].every(k => !u.searchParams.get(k))),
            fresh('getInfo', async () => { }),
            fresh('system/dict/data/type/dept_apply_use', async () => { }),
        ]);
        [list, identity, dict] = loaded;
        if (!Array.isArray(list.rows) || !Number.isInteger(Number(list.total)) || list.rows.length === 0 || list.rows.length > 20)
            throw Error('Blocked: 当前账号没有可核验的本人申请记录或列表结构不符合约定。');
        stage = '核对本人列表与数据库';
        const rows = list.rows as Row[], user = (identity.user ?? {}) as Row;
        if (!/^\d{1,20}$/.test(String(user.userId)))
            throw Error('Blocked: 没有取得当前账号身份字段。');
        if (await db.count(String(user.userId)) !== Number(list.total))
            throw Error('Blocked: 本人数据库申请数与无筛选列表总数不一致，未继续访问详情。');
        if (rows.some(r => typeof r.applyNo !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(r.applyNo)))
            throw Error('Blocked: 本人申请编号不符合约定结构。');
        const matched = compareDepartmentList(rows, await db.applications(rows.map(r => r.applyNo as string)));
        if (matched.status !== 'passed')
            throw Error((matched.status === 'failed' ? '断言失败：' : 'Blocked: ') + matched.detail);
        if (kind === 'application-multiline-totals') {
            stage = '寻找本人多行明细';
            let applyNo: string | undefined, goods: Row[] = [];
            for (const row of rows) {
                const candidate = String(row.applyNo), items = await db.goods(candidate);
                if (items.length < 2)
                    continue;
                if (!await db.snapshot(candidate, String(user.userId)))
                    throw Error('Blocked: 多行候选没有按本轮认证申请人匹配。');
                applyNo = candidate;
                goods = items;
                break;
            }
            if (!applyNo)
                throw Error('Blocked: 本轮本人列表当前页没有至少两行的申请，未用其他账号数据代替。');
            const detailUrl = new URL(targetUrl);
            detailUrl.hash = '/apply-form-detail/' + encodeURIComponent(applyNo);
            await page.goto('about:blank');
            const detail = await fresh('dept/book/apply/detail/' + applyNo, () => page.goto(detailUrl.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => { }));
            if (detail.data?.applyNo !== applyNo || !Array.isArray(detail.data.goodsList) || detail.data.goodsList.length < 2)
                throw Error('Blocked: 明细接口未返回同一本人多行申请。');
            const matchedGoods = compareDepartmentGoods(detail.data.goodsList, goods);
            if (matchedGoods.status !== 'passed')
                throw Error((matchedGoods.status === 'failed' ? '断言失败：' : 'Blocked: ') + matchedGoods.detail);
            stage = '逐行核对多行金额和克转公斤';
            const main = page.locator('.pc-page-apply-form-detail');
            await main.waitFor({ state: 'visible', timeout: 8000 });
            const table = main.locator('.pc-page-form-detail-sample-details'), tableRows = table.locator('tbody tr');
            await tableRows.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await tableRows.count() !== detail.data.goodsList.length)
                throw Error('断言失败：多行页面行数与本人明细响应不一致。');
            let cents = 0, grams = 0;
            const subtotals: number[] = [];
            const number = (s: string) => Number(s.replace(/[¥￥,\s]/g, ''));
            for (let i = 0; i < detail.data.goodsList.length; i++) {
                const g = detail.data.goodsList[i], qty = Number(g.qty), price = Number(g.price), weight = Number(g.weight);
                if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6 || !Number.isFinite(weight) || weight <= 0)
                    throw Error('Blocked: 本轮明细未提供有效数量、分位定价及克重，不能补零后假通过。');
                const cells = tableRows.nth(i).locator('td');
                if (await cells.count() !== 7)
                    throw Error('Blocked: 明细表格列结构已变化。');
                const values = await cells.allTextContents(), subtotal = Math.round(price * 100) * qty, rowWeight = qty * weight;
                if (values[0]?.trim() !== String(g.productId) || number(values[1]!) !== qty || number(values[4]!) !== price || number(values[6]!) !== subtotal / 100 || number(values[5]!) !== Number((rowWeight / 1000).toFixed(2)))
                    throw Error('断言失败：第' + (i + 1) + '行商品、数量、定价、小计或克转公斤重量与独立计算不一致。');
                cents += subtotal;
                grams += rowWeight;
                subtotals.push(subtotal / 100);
            }
            const total = table.locator('.go-on-item .total .price'), weight = table.locator('.go-on-item .total-weight');
            if (await total.count() !== 1 || await weight.count() !== 1)
                throw Error('Blocked: 明细总金额/总重量未唯一定位。');
            const kg = Number((grams / 1000).toFixed(2)), weightText = await weight.innerText();
            if (number(await total.innerText()) !== cents / 100 || Number(weightText.match(/([\d.]+)/)?.[1]) !== kg)
                throw Error('断言失败：多行总金额或总重量与明细独立求和不一致。');
            result.detail = '本轮从当前认证账号列表选取本人多行申请，数据库限定归属并核对商品数量/定价；真实打开同一申请明细，逐行核对' + subtotals.length + '行小计（' + subtotals.map(n => n.toFixed(2)).join('、') + '元），总金额' + (cents / 100).toFixed(2) + '元、总重量' + kg.toFixed(2) + '公斤与独立求和一致。未重新创建申请，复用用户授权通过真实提交生成的已有样本。';
        }
        else if (kind === 'application-card-fields') {
            if (!Array.isArray(dict.data) || !dict.data.length)
                throw Error('Blocked: 没有取得本条成功查询的用途字典。');
            stage = '核对申请卡片字段';
            const uses = dict.data as Row[], cards = page.locator('.pc-page-apply .apply-content > .apply-content-item');
            await cards.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await cards.count() !== rows.length)
                throw Error('断言失败：页面申请卡片数量与本轮响应不一致。');
            const statuses: Record<string, string> = { '0': '待审批', '1': '已通过', '2': '已驳回' };
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i]!, card = cards.nth(i), usage = uses.filter(d => String(d.dictValue) === String(r.bookUsage));
                if (['applyNo', 'createTime', 'firstBookName', 'applicantName'].some(k => typeof r[k] !== 'string' || !(r[k] as string).trim()) || !Number.isInteger(Number(r.totalBookNum)) || Number(r.totalBookNum) < 1 || usage.length !== 1 || typeof usage[0]!.dictLabel !== 'string' || !statuses[String(r.examineStatus)])
                    throw Error('Blocked: 本人记录缺少原预期所需字段或字典。');
                const exact = async (selector: string, expected: string, label: string) => {
                    const loc = card.locator(selector);
                    if (await loc.count() !== 1 || (await loc.innerText()).trim() !== expected)
                        throw Error('断言失败：申请卡片' + label + '与本轮数据不一致。');
                };
                await exact('.header .time', String(r.createTime), '申请时间');
                const number = card.locator('.header .or');
                if (await number.count() !== 1 || !((await number.innerText()).replace(/\s/g, '').startsWith('申请编号：' + String(r.applyNo))))
                    throw Error('断言失败：申请卡片申请编号不一致。');
                await exact('.header .or .tab', String(usage[0]!.dictLabel), '申请用途');
                await exact('.content > li:first-child .name', String(r.firstBookName) + '等' + String(r.totalBookNum) + '本样书', '第一本书及总本数');
                await exact('.content > li:nth-child(2) .name', '申请人：' + String(r.applicantName), '申请人');
                await exact('.content .status', statuses[String(r.examineStatus)]!, '申请状态');
                const goods = await db.goods(String(r.applyNo)), quantity = goods.reduce((n, g) => n + Number(g.qty), 0);
                if (!goods.length || !Number.isFinite(quantity) || quantity !== Number(r.totalBookNum))
                    throw Error('断言失败：卡片总本数与本人申请的数据库明细合计不一致。');
            }
            result.detail = '本轮' + rows.length + '张本人申请卡片逐项核对申请编号、时间、用途字典、申请人、第一本书及总本数、状态；总本数另与数据库明细数量合计一致。覆盖当前页，不声称已验证多页排序。';
        }
        else if (kind === 'application-pending-status') {
            stage = '核对本人待审核状态';
            const pending = rows.find(r => String(r.examineStatus) === '0');
            if (!pending)
                throw Error('Blocked: 本轮本人列表没有待审核申请，未借用他人记录。');
            const applyNo = String(pending.applyNo), url = new URL(targetUrl);
            url.hash = '/apply-detail/' + encodeURIComponent(applyNo);
            await page.goto('about:blank');
            const progress = await fresh('dept/book/apply/progress/' + applyNo, () => page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => { }));
            if (progress.data?.applyNo !== applyNo || String(progress.data.examineStatus) !== '0')
                throw Error('Blocked: 本轮详情不是同一本人待审核申请，可能已被并发审批。');
            const main = page.locator('.pc-page-apply-detail');
            await main.waitFor({ state: 'visible', timeout: 5000 });
            const status = main.locator('.audit-status').filter({ visible: true });
            if (await status.count() !== 1)
                throw Error('Blocked: 审批状态展示区未唯一定位。');
            if (!/申请待审批|待审核/.test((await status.innerText()).trim()))
                throw Error('断言失败：接口待审核，但页面状态文案不一致。');
            const appearance = await status.evaluate(el => { const rgb = (s: string) => s.match(/[\d.]+/g)?.map(Number) ?? [], neutral = (s: string, min: number, max: number) => { const a = rgb(s); return a.length >= 3 && Math.max(...a.slice(0, 3)) - Math.min(...a.slice(0, 3)) <= 12 && a[0]! >= min && a[0]! <= max && (a.length < 4 || a[3]! > 0); }; const icon = el.querySelector('.icon'), style = getComputedStyle(el); return { neutral: neutral(style.backgroundColor, 180, 255), iconGray: !!icon && neutral(getComputedStyle(icon).color, 80, 210), interactive: el.matches('button,input,a,[role="button"],[tabindex]') || !!el.querySelector('button,input,a,[role="button"],[tabindex]') }; });
            if (!appearance.neutral || !appearance.iconGray)
                throw Error('断言失败：待审核状态区没有同时呈现中性灰背景和灰色状态图标。');
            if (appearance.interactive)
                throw Error('Blocked: 状态区存在交互控件，需补其真实禁用状态核验。');
            result.status = 'passed';
            result.detail = '本轮本人待审核记录已由列表、数据库及详情新查询确认；页面显示“申请待审批”，实际计算样式为中性灰背景、灰色图标，且无可操作控件。原验收点为待审核置灰，未要求状态区必须可点击，不再添加必须是按钮元素的前提。';
        }
        else if (kind === 'application-detail-back') {
            stage = '读取本人审批详情';
            const applyNo = String(rows[0]!.applyNo), progressUrl = new URL(targetUrl);
            progressUrl.hash = '/apply-detail/' + encodeURIComponent(applyNo);
            await page.goto('about:blank');
            const before = await fresh('dept/book/apply/progress/' + applyNo, () => page.goto(progressUrl.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => { }));
            if (before.data?.applyNo !== applyNo || !Array.isArray(before.data?.timeline) || !before.data.timeline.length || before.data.examineStatus === undefined)
                throw Error('Blocked: 当前本人记录缺少可核对的审批时间轴和状态。');
            const main = page.locator('.pc-page-apply-detail');
            await main.waitFor({ state: 'visible', timeout: 5000 });
            const snapshot = async () => ({ status: (await main.locator('.audit-status').innerText()).trim(), timeline: await main.locator('.info-step > li').allTextContents() });
            const initial = await snapshot();
            if (!initial.status || initial.timeline.length !== before.data.timeline.length)
                throw Error('Blocked: 审批页面初始状态或时间轴尚未完整显示。');
            for (let i = 0; i < before.data.timeline.length; i++)
                if (typeof before.data.timeline[i].node !== 'string' || !initial.timeline[i]?.includes(before.data.timeline[i].node))
                    throw Error('断言失败：审批时间轴初始展示与本轮接口不一致。');
            const entry = main.locator('.word-pc-body-title > a.more').filter({ hasText: /^\s*申请明细\s*$/ });
            if (await entry.count() !== 1)
                throw Error('Blocked: 本人申请明细入口未唯一定位。');
            const detail = await fresh('dept/book/apply/detail/' + applyNo, () => entry.click({ timeout: 5000 }));
            if (new URL(page.url()).hash.split('?')[0] !== '#/apply-form-detail/' + applyNo || detail.data?.applyNo !== applyNo || !Array.isArray(detail.data?.goodsList))
                throw Error('断言失败：实际明细入口没有打开同一本人申请。');
            const compared = compareDepartmentGoods(detail.data.goodsList, await db.goods(applyNo));
            if (compared.status !== 'passed')
                throw Error((compared.status === 'failed' ? '断言失败：' : 'Blocked: ') + compared.detail);
            stage = '从明细返回审批详情';
            const back = page.locator('.pc-page-apply-form-detail > header .pc-word-back');
            if (await back.count() !== 1)
                throw Error('Blocked: 明细页面返回入口未唯一定位。');
            const returned = await fresh('dept/book/apply/progress/' + applyNo, () => back.click({ timeout: 5000 }));
            if (new URL(page.url()).hash.split('?')[0] !== '#/apply-detail/' + applyNo)
                throw Error('断言失败：明细返回没有回到原审批详情页。');
            if (JSON.stringify([before.data.examineStatus, before.data.lockStatus, before.data.timeline]) !== JSON.stringify([returned.data?.examineStatus, returned.data?.lockStatus, returned.data?.timeline]))
                throw Error('Blocked: 返回期间接口状态或审批事件发生变化，不能将并发更新当成页面数据丢失。');
            await main.waitFor({ state: 'visible', timeout: 5000 });
            const after = await snapshot();
            if (JSON.stringify(initial) !== JSON.stringify(after))
                throw Error('断言失败：后台状态和时间轴未变化，但明细返回后页面状态或时间轴丢失/改变。');
            result.detail = '从本轮本人申请实际进入审批详情→点击申请明细→点击页面返回；路由回到同一审批详情，返回触发的新查询成功，前后接口状态/时间轴未变且页面状态与' + initial.timeline.length + '项审批节点逐项保持。';
        }
        else {
            stage = '读取本人明细';
            const applyNo = String(rows[0]!.applyNo), detailUrl = new URL(targetUrl);
            detailUrl.hash = '/apply-form-detail/' + encodeURIComponent(applyNo);
            await page.goto('about:blank');
            const detail = await fresh('dept/book/apply/detail/' + applyNo, () => page.goto(detailUrl.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => { }));
            if (!detail.data || typeof detail.data !== 'object' || !Array.isArray(detail.data.goodsList) || detail.data.applyNo !== applyNo)
                throw Error('Blocked: 本轮详情没有返回同一条本人申请。');
            const compared = compareDepartmentGoods(detail.data.goodsList, await db.goods(applyNo));
            if (compared.status !== 'passed')
                throw Error((compared.status === 'failed' ? '断言失败：' : 'Blocked: ') + compared.detail);
            stage = '核对明细只读入口';
            const main = page.locator('.pc-page-apply-form-detail');
            await main.waitFor({ state: 'visible', timeout: 5000 });
            for (const text of ['基本信息', '样书明细', '收货信息'])
                if (!await main.getByText(text, { exact: true }).isVisible())
                    throw Error('断言失败：只读明细缺少主要内容区。');
            const state = await main.evaluate(el => { const visible = (n: Element) => !!n.getClientRects().length; const edits = [...el.querySelectorAll('input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"]')].filter(visible).length; const actions = [...el.querySelectorAll('button,a,[role="button"],[onclick],[class*="button"],[class*="btn"],.edit,.delete,.submit')].filter(visible).filter(n => /编辑|修改|提交|保存|删除|撤销|重置|edit|submit|save|delete/i.test(n.textContent ?? '')).length; return { edits, actions }; });
            if (state.edits || state.actions)
                throw Error('断言失败：申请明细存在编辑控件或提交/删除等操作入口。');
            result.detail = '实际打开本轮本人列表返回的申请明细，详情编号与列表一致、明细数量/单价与数据库一致，三个主要区块可见；可见编辑控件0个、编辑/提交/删除等操作入口0个。未操作任何业务写入。';
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '';
        result.status = message.startsWith('断言失败：') ? 'failed' : 'blocked';
        result.detail = /^(断言失败：|Blocked: )/.test(message) ? message.replace(/^Blocked: /, '') : '本人申请完整核验未完成（' + stage + '）。';
    }
    finally {
        try {
            if (known(new URL(page.url()))) {
                style = await page.addStyleTag({ content: '.pc-page-apply .apply-content-item,.pc-page-apply .apply-content-item *,.pc-page-apply-form-detail .value,.pc-page-apply-form-detail .value *,.pc-page-apply-form-detail td,.pc-page-apply-form-detail td *,.pc-page-apply-detail .value,.pc-page-apply-detail .application-info .info > div,.pc-page-apply-detail .info-step .hint1,.pc-page-apply-detail .info-step .hint2,.pc-page-apply-detail .audit-status .desc{color:transparent!important;text-shadow:none!important}' });
                result.evidence = await saveEvidence(await captureDifyPng(page));
                result.evidenceNote = '本条只读操作后的本轮截图；业务编号、申请人和收货资料已脱敏，原值仅在内存中参与断言。';
            }
        }
        catch {
            if (result.status === 'passed')
                result.status = 'blocked';
            result.detail += '；本轮脱敏截图未完成。';
        }
        await style?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        try {
            await page.goto('about:blank');
            await page.goto(original, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch {
            if (result.status === 'passed')
                result.status = 'blocked';
            result.detail += '；原页面恢复未完成。';
        }
    }
}
