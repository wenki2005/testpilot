import type { Page } from 'playwright';
import { readDepartmentAdminAccessEvidence } from '../../../database/mysql-browser.js';
type Row = Record<string, any>;
type Response = {
    http: number;
    body: Row;
};
type Result = {
    status: string;
    detail: string;
};
import type { WelfareKind } from '../../../../domain/regression/connected-evidence-contract.js';
export const isWelfareKind = (v: string): v is WelfareKind => ['welfare-permission', 'welfare-migration-totals', 'welfare-filter', 'welfare-history-fields'].includes(v);
export function welfareKeys(rows: Row[]) {
    const keys = rows.map(r => {
        if (typeof r.id !== 'string' || !r.id || typeof r.orderId !== 'string' || !r.orderId)
            throw Error('Blocked: 福利订单缺少可精确比较的字符串编号。');
        return r.id + '|' + r.orderId;
    });
    if (new Set(keys).size !== keys.length)
        throw Error('Blocked: 福利订单分页出现重复记录，不能以截断结果作比较。');
    return keys.sort();
}
export function welfareSummary(rows: Row[]) {
    welfareKeys(rows);
    let cents = 0;
    const states: Record<string, number> = {};
    let goods = 0, missingGoods = 0;
    for (const r of rows) {
        const amount = Number(r.orderAmount);
        if (!Number.isFinite(amount) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001)
            throw Error('Blocked: 福利订单金额不是可核对的分值。');
        cents += Math.round(amount * 100);
        states[String(r.orderStatus)] = (states[String(r.orderStatus)] ?? 0) + 1;
        if (Array.isArray(r.orderGoodsVos))
            goods += r.orderGoodsVos.length;
        else
            missingGoods++;
    }
    return { orders: rows.length, amountCents: cents, states, goods, missingGoods };
}
/** The documented POST is a query. No export, submission, mutation or internal
 * signature is synthesized. API correctness never proves missing migration UI. */
export async function verifyWelfareEvidence(page: Page, kind: WelfareKind, result: Result, database = readDepartmentAdminAccessEvidence) {
    const read = async (path: string, body?: Row): Promise<Response> => page.evaluate(async (args) => {
        let token = localStorage.getItem('sample-apply-token');
        try {
            token = JSON.parse(token ?? 'null');
        }
        catch { }
        if (typeof token !== 'string' || !token)
            throw Error('Missing authentication');
        const r = await fetch('https://testapi.yibentushu.com/supply-api/' + args.path, { method: args.body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(args.body ? { 'Content-Type': 'application/json' } : {}) }, ...(args.body ? { body: JSON.stringify(args.body) } : {}), signal: AbortSignal.timeout(12000) });
        return { http: r.status, body: await r.json() };
    }, { path, body }).catch(() => { throw Error('Blocked: 福利订单实际查询未完成，未将网络异常作为权限拒绝。'); });
    const ok = (r: Response) => {
        if (r.http !== 200 || r.body.code !== 200)
            throw Error('Blocked: 福利订单只读查询未成功。');
        return r.body;
    };
    const query = async (filter: Row = {}) => ok(await read('dept/book/manage/welfareBookOrder', { pageNum: 1, pageSize: 100, ...filter }));
    const doc = await read('v3/api-docs');
    if (doc.http !== 200 || !doc.body.paths?.['/dept/book/manage/welfareBookOrder']?.post)
        throw Error('Blocked: OpenAPI未确认福利订单POST是查询入口。');
    if (kind === 'welfare-permission') {
        const who = ok(await read('getInfo')), uid = String(who.user?.userId ?? '');
        if (!/^\d{1,20}$/.test(uid) || !Array.isArray(who.roles) || !who.roles.length)
            throw Error('Blocked: 当前身份不完整。');
        const stored = await database(uid, []), roles = who.roles.map(String).sort();
        if (JSON.stringify(roles) !== JSON.stringify([...stored.roles].sort()) || roles.some((v: string) => ['admin', 'Manager', 'bookOrderAdminInner'].includes(v)) || stored.currentInternalMenus !== 0 || stored.authorizedRoleMenuGrants < 2)
            throw Error('Blocked: 尚未建立数据库独立确认的普通角色与允许角色配置对照。');
        const routes = ok(await read('getRouters'));
        if (!Array.isArray(routes.data))
            throw Error('Blocked: 菜单响应不完整。');
        let menu = false;
        const walk = (rs: Row[]) => {
            for (const r of rs) {
                if (/员工福利订单/.test(String(r.meta?.title ?? '')))
                    menu = true;
                if (Array.isArray(r.children))
                    walk(r.children);
            }
        };
        walk(routes.data);
        const control = await read('agent/info/list?isValid=1&pageNum=1&pageSize=1');
        if (control.http !== 403 && Number(control.body.code) !== 403)
            throw Error('Blocked: 同身份普通管理接口403拒绝对照未满足。');
        const actual = await read('dept/book/manage/welfareBookOrder', { pageNum: 1, pageSize: 1 });
        const disclosed = actual.http === 200 && actual.body.code === 200 && Array.isArray(actual.body.rows) && actual.body.rows.length > 0;
        result.status = menu || disclosed ? 'failed' : 'blocked';
        result.detail = `数据库及getInfo角色一致为${roles.join('、')}，内部订单菜单授权0项，两个允许角色的授权配置存在；当前菜单${menu ? '包含' : '不含'}员工福利订单，同身份普通管理接口明确403。福利订单查询实际HTTP${actual.http}/业务码${actual.body.code}，` + (disclosed ? `却返回非空数据（总数${actual.body.total}），其他角色可直接读取管理数据，违反角色访问限制，判定被测后端权限问题（高置信度）。` : '未取得福利订单数据，仍缺允许角色正向实际访问与菜单交互证据，不能计全条通过。') + '没有用H5截图冒充后台页面。';
        return;
    }
    const collect = async () => {
        const first = await query(), total = Number(first.total);
        if (!Number.isInteger(total) || total < 1 || total > 5000 || !Array.isArray(first.rows))
            throw Error('Blocked: 福利订单完整读取范围无效或超过5000条上限。');
        const rows: Row[] = [...first.rows];
        if (rows.length > 100)
            throw Error('Blocked: 福利订单页大小异常。');
        for (let pageNum = 2; rows.length < total; pageNum++) {
            const next = await query({ pageNum });
            if (Number(next.total) !== total || !Array.isArray(next.rows) || !next.rows.length || next.rows.length > 100)
                throw Error('Blocked: 福利订单分页总数变化或中途缺页。');
            rows.push(...next.rows);
        }
        if (rows.length !== total)
            throw Error('Blocked: 福利订单分页总数不一致。');
        welfareKeys(rows);
        return rows;
    };
    const rows = await collect(), summary = welfareSummary(rows), checks: Array<{
        field: string;
        matches: boolean;
        expected: number;
        actual: number;
    }> = [];
    if (kind === 'welfare-filter') {
        const props = doc.body.components?.schemas?.WelfareBookOrderDTO?.properties;
        if (!props?.orderIdList || !props?.orderStatus || !props?.userName)
            throw Error('Blocked: 查询字段未由当前契约确认。');
        const compare = async (field: string, filter: Row, expected: Row[]) => {
            const b = await query(filter);
            if (!Array.isArray(b.rows) || !Number.isInteger(Number(b.total)))
                throw Error('Blocked: 福利筛选返回结构异常。');
            const actual = Number(b.total);
            const keysMatch = expected.length <= 100 && b.rows.length === actual ? JSON.stringify(welfareKeys(b.rows)) === JSON.stringify(welfareKeys(expected)) : undefined;
            checks.push({ field, matches: actual === expected.length && (keysMatch ?? b.rows.every((r: Row) => expected.some(e => e.id === r.id && e.orderId === r.orderId))), expected: expected.length, actual });
        };
        for (const state of [...new Set(rows.map(r => String(r.orderStatus)))].sort())
            await compare('orderStatus/' + state, { orderStatus: state }, rows.filter(r => String(r.orderStatus) === state));
        for (const r of [rows[0]!, rows[Math.floor(rows.length / 2)]!])
            await compare('orderIdList/exact', { orderIdList: [r.orderId] }, rows.filter(v => v.orderId === r.orderId));
        await compare('orderIdList/none', { orderIdList: ['TP-NO-MATCH-WELFARE-20261104'] }, []);
        const named = rows.find(r => typeof r.userName === 'string' && r.userName.trim());
        if (named)
            await compare('userName/full', { userName: named.userName }, rows.filter(r => String(r.userName ?? '').includes(named.userName)));
        const end = await collect();
        if (JSON.stringify(welfareKeys(end)) !== JSON.stringify(welfareKeys(rows)) || JSON.stringify(welfareSummary(end)) !== JSON.stringify(summary))
            throw Error('Blocked: 核验过程中福利订单基线变化，未判筛选缺陷。');
        const failures = checks.filter(c => !c.matches);
        result.status = failures.length ? 'failed' : 'blocked';
        result.detail = `本轮按当前OpenAPI收齐${rows.length}条福利订单，无重复/缺页；前后编号、金额、状态汇总稳定。${checks.length}项状态/订单号/员工查询中${checks.length - failures.length}项符合、${failures.length}项不符。` + (failures.length ? '不符：' + failures.map(c => `${c.field}应${c.expected}条实际${c.actual}条`).join('；') + '。当前查询子断言失败，属被测接口行为。' : '当前接口筛选已核查；原用例还要求迁移后与原系统筛选一致，尚缺旧系统同口径结果和迁移页面实际控件证据。') + '不再因没有管理页面而跳过接口数据检查。';
        return;
    }
    result.status = 'blocked';
    if (kind === 'welfare-migration-totals')
        result.detail = `本轮真实分页收齐${summary.orders}条福利订单，无重复编号、无缺页；金额按分汇总${summary.amountCents}分，状态分布${JSON.stringify(summary.states)}，商品明细共${summary.goods}条，缺商品数组${summary.missingGoods}条。已完成当前目标数据盘点；缺迁移前同一时点的订单号/金额/状态快照及这组接口的实际存储映射，不能用迁移后自身对照证明迁移完整，也不能说数据库没有数据。`;
    else {
        const fields = ['orderId', 'tradeTime', 'orderAmount', 'orderStatus', 'orderGoodsVos'];
        const missing = Object.fromEntries(fields.map(k => [k, rows.filter(r => r[k] === undefined || r[k] === null).length]));
        const shipped = rows.filter(r => ['3', '4'].includes(String(r.orderStatus)));
        const logistics = shipped.filter(r => r.logisticsNo || r.orderGoodsVos?.some((g: Row) => g.logisticsNo)).length;
        result.detail = `本轮收齐${rows.length}条历史福利订单；核心字段缺值统计${JSON.stringify(missing)}；已发货/完成${shipped.length}条，其中订单或商品含物流号${logistics}条。当前VO没有备注字段，不能据此断言旧备注丢失；尚缺旧订单/物流/备注独立基线及真实详情读回。已核查现有数据，不把缺管理页面等同于无法查历史记录。`;
    }
}
