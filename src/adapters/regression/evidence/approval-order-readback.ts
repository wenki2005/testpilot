import type { Page } from 'playwright';
import { readDepartmentApplicationSnapshot, readDepartmentGoods } from '../../database/mysql-browser.js';
import { approvedChainGap, type ApprovedChainKind } from '../../../domain/regression/approval-order-contract.js';
export { approvedChainKind, approvedChainGap, type ApprovedChainKind } from '../../../domain/regression/approval-order-contract.js';
type Row = Record<string, any>;
/** Bounded GET/SELECT only. No approval, retry lock, cancellation or dispatch. */
export async function verifyApprovedChainEvidence(page: Page, kind: ApprovedChainKind, result: {
    status: string;
    detail: string;
}, target: string, database = { snapshot: readDepartmentApplicationSnapshot, goods: readDepartmentGoods }) {
    const base = 'https://testapi.yibentushu.com/supply-api/';
    const get = async (path: string): Promise<Row> => page.evaluate(async ({ base, path }) => {
        let token = localStorage.getItem('sample-apply-token');
        try {
            token = JSON.parse(token ?? 'null');
        }
        catch { }
        if (typeof token !== 'string')
            throw Error('Blocked: 当前身份凭证不可用。');
        const response = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } }), body = await response.json();
        if (response.status !== 200 || body.code !== 200)
            throw Error('Blocked: 本条只读查询未成功。');
        return body;
    }, { base, path });
    const uid = String((await get('getInfo')).user?.userId ?? '');
    if (!/^\d+$/.test(uid))
        throw Error('Blocked: 本人身份缺失。');
    const listed = await get('h5/dept/book/order/myList?pageNum=1&pageSize=20');
    if (!Array.isArray(listed.rows) || !listed.rows.length || Number(listed.total) > 100)
        throw Error('Blocked: 本人订单读回为空或超出核验范围。');
    let count = 0, tracking = 0, trace = 0, youngestHours = Infinity;
    // Use the existing approved stock scenario, never submit/re-lock to obtain evidence.
    const preferred = kind === 'approved-tianjin' ? /202611040065$/ : ['approved-shortage', 'approved-retry', 'approved-retry-shortage'].includes(kind) ? /2026110400(?:69|70)$/ : kind === 'approved-marketing-route' ? /2026110400(?:65|69|70)$/ : /20261104006[67]$/;
    const candidates = listed.rows.filter((r: Row) => preferred.test(String(r.orderId)));
    if (!candidates.length)
        throw Error('Blocked: 本条对应已审批的既有场景订单尚未读回。');
    const rows = candidates.slice(0, kind === 'approved-marketing-route' ? 3 : 2);
    for (const row of rows) {
        const orderId = String(row.orderId ?? '');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(orderId))
            throw Error('Blocked: 订单标识结构无效。');
        const order = (await get('h5/dept/book/order/detail/' + encodeURIComponent(orderId))).data;
        const no = String(order?.applyNo ?? '');
        if (!/^\d{12}$/.test(no) || order.orderId !== orderId)
            throw Error('断言失败：本人订单详情编号未对应列表。');
        const stored = await database.snapshot(no, uid);
        if (!stored || stored.order_id !== orderId || Number(stored.examine_status) !== 1 || Number(stored.lock_status) !== 1)
            throw Error('Blocked: 订单未关联本人审批通过且锁单的申请。');
        const progress = (await get('dept/book/apply/progress/' + no)).data, detail = (await get('dept/book/apply/detail/' + no)).data;
        if (progress?.applyNo !== no || Number(progress.examineStatus) !== 1 || Number(progress.lockStatus) !== 1 || detail?.applyNo !== no)
            throw Error('断言失败：申请进度与本人数据库/订单不一致。');
        const goods = await database.goods(no);
        if (!goods.length || !Array.isArray(order.goodsList) || goods.length !== order.goodsList.length)
            throw Error('断言失败：订单商品行与数据库不一致。');
        for (const g of goods) {
            const match = order.goodsList.filter((v: Row) => String(v.goodsSn) === String(g.product_id));
            if (match.length !== 1 || Number(match[0].buyNum) !== Number(g.qty) || Number(match[0].unitPrice) !== Number(g.price))
                throw Error('断言失败：订单商品数量/价格与数据库不一致。');
        }
        const url = new URL(target);
        url.hash = '/logistics-detail/' + encodeURIComponent(orderId);
        await page.goto('about:blank');
        const pageRead = page.waitForResponse(r => r.request().method() === 'GET' && r.url() === base + 'h5/dept/book/order/detail/' + encodeURIComponent(orderId), { timeout: 12000 }).then(async (r) => ({ http: r.status(), body: await r.json() }));
        let rendered: Row;
        try {
            await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const read = await pageRead;
            if (read.http !== 200 || read.body.code !== 200)
                throw Error('Blocked: 订单页面本轮读取未成功。');
            rendered = read.body.data;
        }
        finally {
            void pageRead.catch(() => { });
        }
        if (rendered?.orderId !== orderId || rendered?.applyNo !== no)
            throw Error('断言失败：页面触发的订单详情响应不属于同一申请。');
        const main = page.locator('.pc-page-logistics-detail');
        await main.waitFor({ state: 'visible', timeout: 7000 });
        await page.waitForFunction(id => document.querySelector('.pc-page-logistics-detail')?.textContent?.includes(id), orderId, { timeout: 7000 });
        const track = order.logisticsNo ?? order.expressNo ?? order.trackingNo ?? order.logistics?.logisticsNo;
        if (typeof track === 'string' && track.trim())
            tracking++;
        const events = order.traceList ?? order.logisticsList ?? order.logistics?.tracks ?? order.traces ?? order.logisticsInfo?.details;
        if (Array.isArray(events) && events.length)
            trace++;
        const created = Date.parse(String(order.createTime).replace(' ', 'T') + (String(order.createTime).includes('Z') ? '' : '+08:00'));
        if (Number.isFinite(created))
            youngestHours = Math.min(youngestHours, Math.max(0, (Date.now() - created) / 3600000));
        count++;
    }
    if (!Number.isFinite(youngestHours))
        throw Error('Blocked: 缺少可核验的创建时间。');
    result.status = 'blocked';
    result.detail = approvedChainGap(kind, { count, tracking, trace, youngestHours });
}
