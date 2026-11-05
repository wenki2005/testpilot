import { approvedChainKind, verifyApprovedChainEvidence } from '../evidence/approval-order-readback.js';
import type { DepartmentCreationBaseline } from './application/submission-receipts.js';
import { isAdminRecordKind, verifyAdminOrderRecords } from './orders/admin-order-records.js';
import { isOwnedOrderKind, verifyOwnedOrderEvidence } from './orders/my-orders.js';
import type { Page, Request } from 'playwright';
import { actionablePreconditions, type BrowserCheck } from '../../documents/execution/workflow-facade.js';
import { connectedEvidenceKind } from '../evidence/connected-evidence-contract.js';
import { readDepartmentApplicationSnapshot, readDepartmentAccountCount, readDepartmentGoods, readNonOwnerDepartmentApplication, readDepartmentRemarkEvidence, readDepartmentOaTemplateConfiguration, readDepartmentCustomerCategories, readDepartmentAllowedCustomers, readDepartmentConfigurationInventory, readDepartmentNotificationInventory } from '../../database/mysql-browser.js';
import { assertExpenseApplication, assertApprovalProgress, assertClientCategoryResponse } from '../evidence/integration-assertions.js';
import { verifyDepartmentOaTemplateConfiguration } from '../config/approval-templates.js';
import { compareDepartmentGoods } from '../../database/regression-readback.js';
import { captureDifyPng } from '../evidence/module-evidence.js';
import { isWelfareKind, verifyWelfareEvidence } from './orders/welfare-orders.js';
type Row = Record<string, any>;
type Result = {
    status: string;
    detail: string;
    evidence?: string;
    evidenceNote?: string;
};
const known = (raw: string) => {
    try {
        const u = new URL(raw);
        return u.origin === 'https://cdn.yibentushu.com' && u.pathname === '/test-sample-apply/index.html';
    }
    catch {
        return false;
    }
};
export function reviewConnectedEvidence(c: BrowserCheck, evidence: string, target?: string) {
    const kind = connectedEvidenceKind(c);
    if (!kind || !known(target ?? '') || actionablePreconditions(c).length)
        return;
    let observed: {
        navigation?: string[];
        controls?: Array<{
            placeholder?: string;
        }>;
    };
    try {
        observed = JSON.parse(evidence);
    }
    catch {
        return;
    }
    if (observed.controls?.filter(v => v.placeholder === '请输入收件人姓名').length !== 1)
        return;
    if (isWelfareKind(kind))
        return { kind, steps: [{ action: 'blurByLabel' as const, label: '收件人' }, { action: 'assertExactVisible' as const, text: '收货信息' }], detail: '福利订单专项：当前契约、真实完整分页/筛选及独立角色授权核对；保留迁移前快照缺口，不用页面缺失跳过数据核查。' };
    if (kind === 'oa-template-config')
        return { kind, steps: [{ action: 'assertExactVisible' as const, text: '收货信息' }], detail: '只读专项核验：按已确认测试库基线检查两条OA模板名称、企微ID、有效状态及全部申请用途引用；不再以缺模板对应关系阻塞。仅为xmind-128配置检查，不触发申请提交/审批，不替代xmind-119。' };
    const steps: BrowserCheck['steps'] = kind === 'publisher-unavailable' ? [{ action: 'assertExactVisible', text: '收货信息' }] : [{ action: 'blurByLabel', label: '收件人' }, { action: 'assertExactVisible', text: '收货信息' }];
    if (kind !== 'publisher-unavailable' && observed.navigation?.filter(v => v === '历史申请记录').length !== 1)
        return;
    return { kind, steps, detail: '已审核只读场景：用本轮认证身份、本人列表和数据库字段建立基线，再核对页面/接口；所有原始预期保留。缺下游字段、订单样本或证据时给出已查内容和剩余缺口，不以页面外壳计通过。' };
}
const db = { snapshot: readDepartmentApplicationSnapshot, count: readDepartmentAccountCount, goods: readDepartmentGoods, nonowner: readNonOwnerDepartmentApplication, remarks: readDepartmentRemarkEvidence, oaTemplates: readDepartmentOaTemplateConfiguration, categories: readDepartmentCustomerCategories, allowedCustomers: readDepartmentAllowedCustomers, configuration: readDepartmentConfigurationInventory, notifications: readDepartmentNotificationInventory };
const denied = (v: unknown) => /无权|权限不足|禁止|拒绝|没有权限|只能.{0,12}自己|仅.{0,12}本人|无.{0,12}权限|forbidden|denied/i.test(String(v ?? ''));
export async function verifyConnectedEvidence(page: Page, c: BrowserCheck, r: Result, target: string, save: (png: Buffer) => Promise<string>, database = db, creationReceipts?: () => Promise<Set<string>>, creationBaselines?: () => Promise<DepartmentCreationBaseline[]>) {
    const kind = connectedEvidenceKind(c);
    if (!kind || r.status !== 'passed')
        return;
    delete r.evidence;
    const original = page.url(), device = await page.evaluate(() => ({ ua: navigator.userAgent, platform: navigator.platform, width: innerWidth, height: innerHeight })), viewport = page.viewportSize() ?? { width: device.width, height: device.height };
    let client: import('playwright').CDPSession | undefined, mask: import('playwright').ElementHandle | undefined, stage = '读取本人列表和身份';
    const fresh = async (path: string, action: () => Promise<unknown>) => {
        const started = new Set<Request>(), listener = (q: Request) => {
            const u = new URL(q.url());
            if (q.method() === 'GET' && u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/' + path)
                started.add(q);
        };
        page.on('request', listener);
        const pending = page.waitForResponse(v => started.has(v.request()), { timeout: 12000 }).then(async (v) => ({ url: new URL(v.url()), status: v.status(), body: await v.json() }));
        try {
            await action();
            return await pending;
        }
        finally {
            page.off('request', listener);
            void pending.catch(() => { });
        }
    };
    const load = async (route: string) => { const u = new URL(target); u.hash = route; await page.goto('about:blank'); await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 }); };
    const success = (v: {
        status: number;
        body: Row;
    }) => {
        if (v.status !== 200 || v.body.code !== 200)
            throw Error('Blocked: 本条只读查询未成功，未将异常响应当业务结论。');
        return v.body;
    };
    try {
        if (!known(target) || !known(page.url()))
            throw Error('Blocked: 不是本场景约定的测试目标。');
        if (isAdminRecordKind(kind)) {
            stage = '核对真实审批前后订单门槛及展示字段契约';
            await verifyAdminOrderRecords(page, kind, r, undefined, await creationBaselines?.() ?? []);
            return;
        }
        if (approvedChainKind(c)) {
            stage = '复用已审批锁单订单核查后续事件';
            await verifyApprovedChainEvidence(page, approvedChainKind(c)!, r, target);
            return;
        }
        if (isOwnedOrderKind(kind)) {
            stage = '本人已生成订单的卡片与详情';
            await verifyOwnedOrderEvidence(page, kind, r, target);
            return;
        }
        if (isWelfareKind(kind)) {
            stage = '福利订单权限、完整分页及筛选证据';
            await verifyWelfareEvidence(page, kind, r);
            return;
        }
        if (kind === 'oa-template-config') {
            stage = '核验OA模板配置';
            Object.assign(r, verifyDepartmentOaTemplateConfiguration(await database.oaTemplates()));
            return;
        }
        if (kind === 'warehouse-config' || kind === 'shop-config') {
            stage = '按已知字段检索仓库/店铺配置';
            const inventory = await database.configuration();
            r.status = 'blocked';
            r.detail = kind === 'warehouse-config' ? `本轮已执行专用配置检查：sys_config相关配置键${inventory.keys.length}条；biz_carrier_warehouse中长沙/天津具名记录${inventory.warehouses.length}条，字段name/sid/type/status已读取。该表是承运商仓库，尚无字段把这组记录绑定为部门申样旺店通长沙/天津快递仓，不能把sid直接当本流程已确认ID。OA模板128已通过，与本条不同。` : `本轮已执行专用店铺检查：sys_config相关配置键${inventory.keys.length}条；部门申样、wdt及shop候选表中的店铺字段${inventory.shopColumns.length}项。未取得“样书出库店铺/部门用书店铺”的旺店通ID及本流程实际使用值；dou_shop等其他业务店铺不能代替。OA模板128已通过，不再重复要求模板基线。`;
            return;
        }
        if (kind === 'customer-category-contract') {
            stage = '核对真实客户接口分类契约';
            await load('/home');
            const input = page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '费用划归客户' }) }).getByRole('combobox');
            await input.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await input.count() !== 1)
                throw Error('Blocked: 客户查询控件未唯一定位。');
            const candidates = await database.allowedCustomers();
            if (!['1004.00', '1004.06'].every(k => candidates.filter(v => v.category === k).length === 1))
                throw Error('Blocked: 缺少两种允许分类各自唯一的独立数据库正样本。');
            let fields = true;
            for (const candidate of candidates) {
                const response = success(await fresh('dept/book/apply/clientSearch', () => input.fill(candidate.code))), data = response.data;
                if (!Array.isArray(data) || !data.length || data.length > 100)
                    throw Error('Blocked: 允许分类查询结果为空、结构异常或超出本轮核验上限。');
                const codes = data.map((v: Row) => String(v.agentId));
                if (new Set(codes).size !== codes.length)
                    throw Error('断言失败：客户查询返回重复客户编号。');
                const classifications = await database.categories(codes);
                fields = assertClientCategoryResponse(data, classifications, candidate) && fields;
            }
            r.status = fields ? 'passed' : 'blocked';
            r.detail = fields ? '两种允许客户分类的独立数据库正样本均由本轮页面查询返回；所有返回客户的agentType与数据库分类一致，且只属于1004.00/1004.06。' : '本轮已对1004.00、1004.06各实际查询一组独立数据库正样本，返回客户分类均在允许范围内；但实际clientSearch响应仅有agentId/agentName，没有agentType分类字段，与OpenAPI的DeptBookApplyClientVO一致。数据库分类不能冒充上游返回字段。原20仍有“是否返回分类字段/由前端还是后端过滤”的待澄清项，本121保留契约阻塞，已不再归为缺脚本或未连数据库。';
            return;
        }
        if (kind === 'employee-login-fields') {
            const identity = success(await fresh('getInfo', () => load('/home'))), user = identity.user ?? {};
            const root = page.locator('.pc-page-home');
            await root.waitFor({ state: 'visible', timeout: 8000 });
            const self = root.locator('.header-nav li').filter({ hasText: /^\s*(?:本人申领|本人申请|本人)\s*$/ });
            await self.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await self.count() !== 1 || !await self.evaluate(el => el.classList.contains('active')))
                throw Error('断言失败：已认证进入申请页，但未默认展示本人申请表单。');
            const name = typeof user.nickName === 'string' ? user.nickName.trim() : '';
            // The deployed user store reads top-level deptName before spreading user.
            const department = typeof user.deptName === 'string' ? user.deptName.trim() : typeof identity.deptName === 'string' ? identity.deptName.trim() : typeof user.dept?.deptName === 'string' ? user.dept.deptName.trim() : '';
            if (!/^\d{1,20}$/.test(String(user.userId)) || !name || !department)
                throw Error('Blocked: 本轮认证响应未提供完整姓名和部门，无法建立自动带出字段的对照基线。');
            const text = await root.innerText();
            if (!text.includes(name) || !text.includes(department))
                throw Error('断言失败：本轮认证成功、申请表单可见且身份接口含姓名和部门，但页面未自动带出对应值；不再以前置缺身份跳过。');
            r.status = 'blocked';
            r.detail = '已实际核对当前登录身份、申请页默认本人状态、姓名与部门自动带出；所属公司仍缺独立组织对照，且本轮沿用已有登录态，未重新验证企微首次授权过程，完整原预期尚未通过。';
            return;
        }
        if (kind === 'publisher-unavailable') {
            await load('/home');
            await page.locator('.pc-page-home').waitFor({ state: 'visible', timeout: 8000 });
            const usage = page.locator('.pc-page-home .home-form-item').filter({ has: page.locator('label').filter({ hasText: '样书用途' }) }).getByRole('combobox');
            await usage.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await usage.count() !== 1)
                throw Error('Blocked: 样书用途控件未唯一定位。');
            await usage.click();
            const options = page.getByRole('option').filter({ visible: true });
            await options.first().waitFor({ state: 'visible', timeout: 5000 });
            const labels = (await options.allTextContents()).map(v => v.trim());
            if (labels.some(v => /出版社用书/.test(v)))
                throw Error('断言失败：本期出版社用书仍作为可见可选用途展示。');
            if (!labels.includes('营销用书') || !labels.includes('产品用书'))
                throw Error('Blocked: 用途选项未完整加载，不能用空下拉证明出版社用书被隐藏。');
            r.detail = '实际展开样书用途，营销用书、产品用书均已加载；可见选项中无出版社用书，未出现可选择的出版社用书入口。原负向验收已执行，不再按“不做”关键词跳过。';
            return;
        }
        if (kind === 'marketing-remark' || kind === 'product-remark') {
            const v = await database.remarks(kind === 'marketing-remark' ? 1 : 2);
            r.status = 'blocked';
            r.detail = `数据库只读核验成功：对应用途申请${v.applications}条，含审批号${v.approvals}条，含订单引用${v.orderReferences}条，以biz_order.order_id关联命中${v.matchedOrders}条。申请表remark为用户原始备注，不能直接作为最终发送备注。当前尚未定位下游最终拼接备注的可核验字段/发送记录；原始备注、审批号不是缺失，剩余阻塞是最终读回通道，未将本地原始备注不含前缀误判为产品失败。`;
            return;
        }
        if (kind === 'copy-identifiers') {
            client = await page.context().newCDPSession(page);
            await client.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36', platform: 'Android' });
            await page.setViewportSize({ width: 390, height: 844 });
        }
        await page.goto('about:blank');
        const [listRead, identityRead] = await Promise.all([fresh('dept/book/apply/myList', () => load('/apply')), fresh('getInfo', async () => { })]);
        const list = success(listRead), identity = success(identityRead), user = identity.user ?? {}, rows = list.rows;
        if (!/^\d{1,20}$/.test(String(user.userId)) || !Array.isArray(rows) || !rows.length || rows.length > 20 || !Number.isInteger(Number(list.total)))
            throw Error('Blocked: 当前身份或本人申请列表没有满足本条核验的记录。');
        if (await database.count(String(user.userId)) !== Number(list.total))
            throw Error('Blocked: 本人数据库数量与本轮无筛选列表总数不一致。');
        if (['submit-notification', 'lock-notification', 'cancel-notification'].includes(kind)) {
            stage = '核对同一申请关联的通知事件';
            const n = await database.notifications(String(user.userId)), event = kind === 'submit-notification' ? '提交申请' : kind === 'lock-notification' ? '锁单失败' : '72小时取消';
            r.status = 'blocked';
            r.detail = `本轮已执行${event}通知专用核验：当前本人${n.applications}申请、含审批号${n.approvals}、含审批接收人${n.recipients}；锁单失败${n.lockFailures}、已取消${n.cancelled}。按本人申请号/审批号/订单号关联biz_sync_outbox共${n.events.length}条，biz_third_party_failure_log共${n.linkedFailures}条。` + (n.events.length ? '已读取外发事件destination/event_type/status及payload字段结构；published_at仅表示外发发布，不能单独证明企微投递成功。' : '现有可读记录未提供同一通知的发送原文及企微回执，不能据此断言通知未发送，也不再归为缺查询脚本。') + '原预期中的准确文案、接收对象和投递结果尚未完整核验。';
            return;
        }
        if (kind === 'approval-readback' || kind === 'available-state-detail-entry' || kind === 'approved-appearance' || kind === 'rejected-appearance') {
            stage = '通过实际下一页收齐审批状态样本';
            if (Number(list.total) > 100 || Number(list.total) < rows.length || new Set(rows.map((v: Row) => v.applyNo)).size !== rows.length)
                throw Error('Blocked: 本人审批列表总数越界或编号重复。');
            let currentPage = Number(listRead.url.searchParams.get('pageNum') ?? '1');
            while (rows.length < Number(list.total)) {
                const next = page.getByRole('button', { name: '下一页', exact: true }).filter({ visible: true });
                await next.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await next.count() !== 1 || !await next.isEnabled())
                    throw Error('Blocked: 本人审批列表未完整，实际下一页不可用。');
                const value = await fresh('dept/book/apply/myList', () => next.click()), body = success(value);
                if (value.url.searchParams.get('pageNum') !== String(currentPage + 1) || Number(body.total) !== Number(list.total) || !Array.isArray(body.rows) || !body.rows.length || body.rows.some((v: Row) => rows.some((r: Row) => r.applyNo === v.applyNo)) || new Set(body.rows.map((v: Row) => v.applyNo)).size !== body.rows.length)
                    throw Error('Blocked: 审批盘点分页重复、缺页或总数变化，未使用不完整基线。');
                rows.push(...body.rows);
                currentPage++;
                if (currentPage > 10 || rows.length > Number(list.total))
                    throw Error('Blocked: 审批盘点分页超过限定上限。');
            }
            stage = '逐状态比对审批详情';
            if (kind === 'approved-appearance' || kind === 'rejected-appearance') {
                const status = kind === 'approved-appearance' ? 1 : 2, receipts = await creationReceipts?.() ?? new Set<string>();
                const candidates = rows.filter((v: Row) => Number(v.examineStatus) === status), candidate = candidates.find((v: Row) => receipts.has(String(v.applyNo))) ?? candidates[0];
                if (!candidate)
                    throw Error('Blocked: 缺本人对应审批状态样本。');
                const key = String(candidate.applyNo), stored = await database.snapshot(key, String(user.userId));
                if (!stored)
                    throw Error('Blocked: 审批样本未按本人数据库匹配。');
                const progress = success(await fresh('dept/book/apply/progress/' + key, () => load('/apply-detail/' + encodeURIComponent(key)))).data;
                assertApprovalProgress(stored, progress);
                const main = page.locator('.pc-page-apply-detail');
                await main.waitFor({ state: 'visible', timeout: 7000 });
                const badge = main.locator('.audit-status');
                await badge.waitFor({ state: 'visible', timeout: 5000 });
                const appearance = await badge.evaluate(el => { const icon = el.querySelector('.icon'), style = getComputedStyle(el); return { background: style.backgroundColor, icon: icon ? getComputedStyle(icon).color : '', interactive: el.matches('button,input,a,[role="button"],[tabindex]') || !!el.querySelector('button,input,a,[role="button"],[tabindex]') }; });
                const rgb = (color: string) => color.match(/[\d.]+/g)?.map(Number) ?? [], color = rgb(appearance.icon), colored = color.length >= 3 && (status === 1 ? color[1]! > color[0]! + 15 && color[1]! > color[2]! : color[0]! > color[1]! + 30 && color[0]! > color[2]! + 30);
                if (!colored)
                    throw Error('断言失败：审批状态图标未呈现原预期的' + (status === 1 ? '绿色' : '红色') + '。');
                if (status === 2) {
                    if (!stored.reject_reason || !(await main.innerText()).includes(String(stored.reject_reason)))
                        throw Error('断言失败：已驳回记录未完整显示数据库实际驳回原因。');
                    const actions = main.locator('button,a,[role="button"],.button,[class*="btn"]').filter({ hasText: /重新申请|联系审批人/ }).filter({ visible: true });
                    if (!await actions.count())
                        throw Error('断言失败：实际驳回原因已回传且页面显示红色状态，但审批详情没有可见的“重新申请”或“联系审批人”操作入口。');
                }
                r.status = 'passed';
                r.detail = '已按本人数据库和本轮progress核实' + (status === 1 ? '通过/锁单' : '驳回及真实理由') + '状态，实际计算样式确认状态图标为' + (status === 1 ? '绿色' : '红色') + '。本条验收点为对应状态颜色，原文未要求状态区可点击，不再额外增加交互控件前提。' + (status === 2 ? '驳回理由及重新申请/联系入口也已核验。' : '');
                return;
            }
            if (kind === 'available-state-detail-entry') {
                const verified: string[] = [], missing: string[] = [];
                let ordered = false;
                for (const [status, label] of [[0, '待审批'], [1, '已通过'], [2, '已驳回'], [3, '已取消']] as const) {
                    const candidate = rows.find((v: Row) => Number(v.examineStatus) === status);
                    if (!candidate) {
                        missing.push(label);
                        continue;
                    }
                    const key = String(candidate.applyNo ?? '');
                    if (!/^[A-Za-z0-9_-]{1,100}$/.test(key))
                        throw Error('Blocked: 状态明细入口样本编号无效。');
                    const stored = await database.snapshot(key, String(user.userId));
                    if (!stored || Number(stored.examine_status) !== status)
                        throw Error('Blocked: 状态样本未按本人数据库及审批状态匹配。');
                    const progress = success(await fresh('dept/book/apply/progress/' + key, () => load('/apply-detail/' + encodeURIComponent(key)))).data;
                    assertApprovalProgress(stored, progress);
                    const main = page.locator('.pc-page-apply-detail');
                    await main.waitFor({ state: 'visible', timeout: 7000 });
                    const title = main.locator('.audit-status .title');
                    await title.waitFor({ state: 'visible', timeout: 5000 });
                    const expected = status === 0 ? /申请待审批/ : status === 1 ? /锁单成功|锁单失败|审批通过|已通过/ : status === 2 ? /驳回|拒绝|申请被拒/ : /申请已取消/;
                    if (!expected.test((await title.innerText()).trim()))
                        throw Error('断言失败：' + label + '记录页面状态与数据库不一致。');
                    const entry = main.locator('.word-pc-body-title > a.more').filter({ hasText: /^\s*(?:申请明细|查看明细\s*>?)\s*$/ });
                    if (await entry.count() !== 1 || !await entry.isVisible())
                        throw Error('断言失败：' + label + '状态没有唯一可见的申请明细入口。');
                    const detail = success(await fresh('dept/book/apply/detail/' + key, () => entry.click({ timeout: 5000 }))).data;
                    if (detail?.applyNo !== key || new URL(page.url()).hash.split('?')[0] !== '#/apply-form-detail/' + key)
                        throw Error('断言失败：' + label + '明细入口打开了其他申请。');
                    await page.locator('.pc-page-apply-form-detail').waitFor({ state: 'visible', timeout: 7000 });
                    const goods = compareDepartmentGoods(detail.goodsList, await database.goods(key));
                    if (goods.status !== 'passed')
                        throw Error((goods.status === 'failed' ? '断言失败：' : 'Blocked: ') + goods.detail);
                    verified.push(label);
                    if (status === 1 && Number(stored.lock_status) === 1 && stored.order_id) {
                        const order = success(await fresh('h5/dept/book/order/detail/' + encodeURIComponent(String(stored.order_id)), () => load('/logistics-detail/' + encodeURIComponent(String(stored.order_id))))).data;
                        if (order?.orderId !== stored.order_id || order?.applyNo !== key)
                            throw Error('断言失败：已下单状态未关联同一本人申请与订单。');
                        await page.locator('.pc-page-logistics-detail').waitFor({ state: 'visible', timeout: 7000 });
                        ordered = true;
                    }
                }
                if (ordered)
                    verified.push('已下单（同一已通过锁单申请，明细入口已实际点击并关联订单）');
                else
                    missing.push('已下单');
                r.status = 'blocked';
                r.detail = `本轮完整盘点本人${rows.length}条申请，${verified.join('、') || '无'}状态已按独立数据库核对，实际展示申请明细入口并点击进入同一申请，商品明细与数据库一致。` + (missing.length ? '当前缺' + missing.join('、') + '本人记录。' : '') + '仍未核验锁单失败、已发货、已签收三类状态入口；已有订单不再记作缺已下单样本，已做子检查不替代原八状态全部通过。';
                return;
            }
            const receipts = await creationReceipts?.() ?? new Set<string>(), verified: number[] = [], missing: number[] = [], receiptMissing: number[] = [];
            for (const status of [0, 1, 2]) {
                const candidates = rows.filter((v: Row) => Number(v.examineStatus) === status);
                if (!candidates.length) {
                    missing.push(status);
                    continue;
                }
                const row = candidates.find((v: Row) => receipts.has(String(v.applyNo))) ?? candidates[0], key = String(row.applyNo ?? '');
                if (!/^[A-Za-z0-9_-]{1,100}$/.test(key))
                    throw Error('Blocked: 本人审批记录编号结构无效。');
                const stored = await database.snapshot(key, String(user.userId));
                if (!stored)
                    throw Error('Blocked: 审批记录没有按本轮本人身份匹配数据库。');
                const progress = success(await fresh('dept/book/apply/progress/' + key, () => load('/apply-detail/' + encodeURIComponent(key)))).data;
                assertApprovalProgress(stored, progress);
                const main = page.locator('.pc-page-apply-detail');
                await main.waitFor({ state: 'visible', timeout: 6000 });
                const nodes = main.locator('.info-step > li');
                await nodes.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await nodes.count() !== progress.timeline.length)
                    throw Error('断言失败：审批详情页面时间轴节点数与实时进度接口不一致。');
                for (let i = 0; i < progress.timeline.length; i++) {
                    const n = progress.timeline[i];
                    if ((await nodes.nth(i).locator('.title').textContent())?.trim() !== n.node || !(await nodes.nth(i).innerText()).includes(String(n.desc || n.time || '')))
                        throw Error('断言失败：审批详情没有完整展示进度接口的节点名称及理由/时间。');
                }
                if (status === 2 && !(await main.innerText()).includes(String(stored.reject_reason)))
                    throw Error('断言失败：进度接口已有驳回理由，页面未展示。');
                verified.push(status);
                if (!receipts.has(key))
                    receiptMissing.push(status);
            }
            const pendingBaseline = receiptMissing.includes(0) && (await creationBaselines?.() ?? []).some(b => b.approvalStatus === 0 && b.lockStatus === 0 && b.orderPresent === false && Number.isFinite(Date.parse(b.verifiedAt)) && Date.parse(b.verifiedAt) <= Date.now() && receipts.has(b.applyNo) && rows.some((v: Row) => v.applyNo === b.applyNo && [1, 2].includes(Number(v.examineStatus))));
            if (pendingBaseline)
                receiptMissing.splice(receiptMissing.indexOf(0), 1);
            r.status = missing.length || receiptMissing.length ? 'blocked' : 'passed';
            r.detail = `已执行119专用脚本：对本人列表${rows.length}条做状态盘点，状态${verified.join('、') || '无'}已逐项比对申请归属、已确认用途模板、审批号、数据库状态、实时progress响应及页面时间轴。` + (pendingBaseline ? '指定六笔均已处理，待审批创建环节使用完整来源摘要核验的原提交断点：同一本人申请当时确为待审批/未锁单/无订单，本轮已推进为通过或驳回；当前其他待审批记录不冒充其创建凭证。' : '') + (missing.length ? `缺状态${missing.join('、')}（0待审批/1通过/2驳回）的本人记录，尚未验证对应结果/驳回理由回传。` : '') + (receiptMissing.length ? `状态${receiptMissing.join('、')}缺关联的真实提交成功记录，字段存在不单独作为企微建单成功。` : '') + (r.status === 'passed' ? '三类状态及关联创建记录均完成核对。' : '没有改审批状态或重提申请来补结果。');
            return;
        }
        const usage = kind === 'marketing-expense' ? 1 : kind === 'product-expense' ? 2 : undefined;
        if (usage && !rows.some((v: Row) => Number(v.bookUsage) === usage)) {
            if (Number(list.total) > 100 || new Set(rows.map((v: Row) => v.applyNo)).size !== rows.length)
                throw Error('Blocked: 费用用途样本分页超过范围或出现重复编号。');
            let currentPage = Number(listRead.url.searchParams.get('pageNum') ?? '1');
            while (rows.length < Number(list.total)) {
                const next = page.getByRole('button', { name: '下一页', exact: true }).filter({ visible: true });
                await next.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await next.count() !== 1 || !await next.isEnabled())
                    throw Error('Blocked: 费用用途样本下一页不可用。');
                const value = await fresh('dept/book/apply/myList', () => next.click()), body = success(value);
                if (value.url.searchParams.get('pageNum') !== String(currentPage + 1) || Number(body.total) !== Number(list.total) || !Array.isArray(body.rows) || !body.rows.length || new Set(body.rows.map((v: Row) => v.applyNo)).size !== body.rows.length || body.rows.some((v: Row) => rows.some((r: Row) => r.applyNo === v.applyNo)))
                    throw Error('Blocked: 费用用途分页重复、缺页或总数变化。');
                rows.push(...body.rows);
                currentPage++;
                if (currentPage > 10 || rows.length > Number(list.total))
                    throw Error('Blocked: 费用用途分页范围无效。');
            }
        }
        const selected = usage ? rows.find((v: Row) => Number(v.bookUsage) === usage) : rows[0];
        if (!selected)
            throw Error('Blocked: 本人没有该用途的已提交记录，无法核验费用划归客户典型场景。');
        const applyNo = String(selected.applyNo ?? '');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(applyNo))
            throw Error('Blocked: 本人记录编号结构无效。');
        stage = '核对数据库申请归属';
        const stored = await database.snapshot(applyNo, String(user.userId));
        if (!stored)
            throw Error('Blocked: 本轮本人记录没有在数据库按当前申请人匹配。');
        if (usage) {
            stage = '核验用途与费用归属';
            const classes = await database.categories([String(stored.cost_client_id)]);
            if (classes.length !== 1)
                throw Error('Blocked: 本人申请的费用客户未在客户主数据唯一匹配分类。');
            const detail = success(await fresh('dept/book/apply/detail/' + applyNo, () => load('/apply-form-detail/' + encodeURIComponent(applyNo)))).data;
            assertExpenseApplication(usage, stored, detail, classes[0]!.category);
            const main = page.locator('.pc-page-apply-form-detail');
            await main.waitFor({ state: 'visible', timeout: 6000 });
            for (const [label, value] of Object.entries({ '样书用途：': usage === 1 ? '营销用书' : '产品用书', '费用划归客户：': String(stored.cost_client_name) })) {
                const field = main.locator('.word-pc-from-item-preview').filter({ has: page.locator('.label').filter({ hasText: new RegExp('^' + label + '$') }) });
                if (await field.count() !== 1 || (await field.locator('.value').textContent()) !== value)
                    throw Error('断言失败：已提交申请页面的用途或费用客户与独立数据库基线不一致。');
            }
            r.detail = `本人实际提交的${usage === 1 ? '营销' : '产品'}用书申请，费用客户在biz_agent_info.agent_type中独立确认为${classes[0]!.category}；申请表、实时detail接口的用途/客户编号/名称、页面用途及客户回显均一致。覆盖原预期“通常”的一条实际典型路径，不将该分类当成禁止其他分类的硬限制；未重新提交。`;
            return;
        }
        if (kind === 'nonowner-detail' || kind === 'owner-detail-access') {
            if (kind === 'owner-detail-access') {
                stage = '核对本人审批页的实际明细入口';
                const progress = success(await fresh('dept/book/apply/progress/' + applyNo, () => load('/apply-detail/' + encodeURIComponent(applyNo))));
                if (progress.data?.applyNo !== applyNo)
                    throw Error('Blocked: 审批详情未返回同一本人申请。');
                const main = page.locator('.pc-page-apply-detail');
                await main.waitFor({ state: 'visible', timeout: 8000 });
                const entry = main.locator('.word-pc-body-title > a.more').filter({ hasText: /^\s*(?:申请明细|查看明细\s*>?)\s*$/ });
                await entry.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await entry.count() !== 1)
                    throw Error('断言失败：数据库确认的本人申请没有唯一可见的明细入口。');
                const detail = success(await fresh('dept/book/apply/detail/' + applyNo, () => entry.click({ timeout: 5000 })));
                if (detail.data?.applyNo !== applyNo || new URL(page.url()).hash.split('?')[0] !== '#/apply-form-detail/' + applyNo)
                    throw Error('断言失败：本人明细入口没有打开同一申请。');
                await page.locator('.pc-page-apply-form-detail').waitFor({ state: 'visible', timeout: 8000 });
                const compared = compareDepartmentGoods(detail.data.goodsList, await database.goods(applyNo));
                if (compared.status !== 'passed')
                    throw Error((compared.status === 'failed' ? '断言失败：' : 'Blocked: ') + compared.detail);
            }
            const other = await database.nonowner(String(user.userId));
            if (!other)
                throw Error('Blocked: 测试库没有另一申请人的可核验记录。');
            if (rows.some((v: Row) => v.applyNo === other))
                throw Error('Blocked: 非本人基线与本人列表冲突。');
            if (kind === 'owner-detail-access') {
                const p = await fresh('dept/book/apply/progress/' + other, () => load('/apply-detail/' + encodeURIComponent(other)));
                if (p.body.data && typeof p.body.data === 'object' && (p.body.data.applyNo === other || p.body.data.receiverName || p.body.data.timeline))
                    throw Error('断言失败：当前账号取得非本人审批资料。');
                if (!denied(p.body.msg ?? p.body.message))
                    throw Error('Blocked: 非本人审批页未明确拒绝权限，不能证明入口仅对本人开放。');
                await page.waitForFunction(() => location.hash.startsWith('#/error'), undefined, { timeout: 5000 });
                if (await page.locator('.pc-page-apply-detail .word-pc-body-title > a.more').filter({ visible: true }).count())
                    throw Error('断言失败：非本人审批拒绝后仍显示申请明细入口。');
            }
            const response = await fresh('dept/book/apply/detail/' + other, () => load('/apply-form-detail/' + encodeURIComponent(other)));
            const b = response.body;
            if (b.data && typeof b.data === 'object' && (b.data.applyNo === other || b.data.receiverName || b.data.receiverPhone || b.data.goodsList))
                throw Error('断言失败：当前账号取得了数据库确认属于其他申请人的明细资料。');
            if (!denied(b.msg ?? b.message))
                throw Error('Blocked: 未返回他人资料，但响应未明确说明权限拒绝；不能把任意500或不存在提示当权限通过。');
            await page.waitForFunction(() => /无权|权限不足|没有权限|只能.{0,12}自己|仅.{0,12}本人|无.{0,12}权限/.test(document.body.innerText), undefined, { timeout: 5000 });
            if (!new URL(page.url()).hash.startsWith('#/error') || await page.locator('.pc-page-apply-form-detail').count())
                throw Error('断言失败：接口拒绝后，前端仍保留申请明细页面或未进入错误页。');
            r.detail = kind === 'owner-detail-access' ? '本轮本人列表与数据库申请归属一致；实际打开本人审批页，点击可见的明细入口并核对同一申请及数据库商品。另取数据库确认的非本人已有申请，审批页与明细页均明确拒绝，拒绝后无明细入口或他人资料。覆盖当前身份与一条非本人反例，不代表已穷举全部角色。' : '数据库限定一条非本人已有申请，当前本人列表不含它；真实直接访问详情后，接口明确权限拒绝且无他人明细，前端进入权限错误页、无明细区。HTTP状态与业务码分别读取，不把任意错误当权限拒绝。';
            return;
        }
        if (kind === 'copy-identifiers') {
            const cards = page.locator('.page-apply-item');
            await cards.first().waitFor({ state: 'visible', timeout: 5000 });
            const card = cards.filter({ hasText: applyNo });
            const icon = card.locator('header.head .or .copy');
            if (await card.count() !== 1 || await icon.count() !== 1)
                throw Error('Blocked: 当前本人申请的SVG复制图标未唯一定位。');
            const state = await page.evaluateHandle(() => ({ descriptor: Object.getOwnPropertyDescriptor(navigator, 'clipboard'), calls: [] as string[] }));
            try {
                await state.evaluate(v => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { v.calls.push(value); } } }));
                const before = page.url();
                await icon.click();
                await page.waitForTimeout(150);
                const copied = await state.evaluate((v, expected) => v.calls.length === 1 && v.calls[0] === expected, applyNo);
                if (!copied || page.url() !== before)
                    throw Error('断言失败：复制图标未向浏览器复制API传入本条申请编号，或意外打开了详情。');
            }
            finally {
                await state.evaluate(v => {
                    if (v.descriptor)
                        Object.defineProperty(navigator, 'clipboard', v.descriptor);
                    else
                        delete (navigator as unknown as Record<string, unknown>).clipboard;
                });
                await state.dispose();
            }
            const orderRead = success(await fresh('h5/dept/book/order/myList', () => load('/logistics')));
            if (Number(orderRead.total) === 0) {
                r.status = 'blocked';
                r.detail = '申请编号复制子断言通过：真实点击本条SVG图标，浏览器复制API收到精确编号且未打开详情；采用局部复制API观察器，不改系统剪贴板。当前本人订单新查询为0条，订单号复制半边缺样本，完整原用例仍为阻塞。';
                return;
            }
            if (!Array.isArray(orderRead.rows) || !orderRead.rows.length || orderRead.rows.length > 20)
                throw Error('Blocked: 本人订单列表总数与当前页结构不满足复制核验。');
            const orderId = String(orderRead.rows[0].orderId ?? '');
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(orderId))
                throw Error('Blocked: 本轮本人订单缺少约定的orderId。');
            const orderCard = page.locator('.page-logistics-item').filter({ hasText: orderId }), orderIcon = orderCard.locator('header.head .or .copy');
            await orderIcon.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await orderCard.count() !== 1 || await orderIcon.count() !== 1)
                throw Error('Blocked: 当前本人订单的SVG复制图标未唯一定位。');
            const orderState = await page.evaluateHandle(() => ({ descriptor: Object.getOwnPropertyDescriptor(navigator, 'clipboard'), calls: [] as string[] }));
            try {
                await orderState.evaluate(v => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { v.calls.push(String(value)); } } }));
                const before = page.url();
                await orderIcon.click();
                await page.waitForTimeout(150);
                if (!await orderState.evaluate((v, expected) => v.calls.length === 1 && v.calls[0] === expected, orderId) || page.url() !== before)
                    throw Error('断言失败：订单复制图标未向浏览器复制API传入本条订单号，或意外打开了详情。');
            }
            finally {
                await orderState.evaluate(v => {
                    if (v.descriptor)
                        Object.defineProperty(navigator, 'clipboard', v.descriptor);
                    else
                        delete (navigator as unknown as Record<string, unknown>).clipboard;
                });
                await orderState.dispose();
            }
            r.detail = '本人申请与订单均有样本：分别点击对应SVG图标，浏览器复制API收到精确的本条编号且页面未跳转；局部观察器已恢复，不写系统剪贴板。覆盖本轮各一条真实本人记录的复制行为。';
            return;
        }
        stage = '读取本人明细';
        await page.goto('about:blank');
        const body = success(await fresh('dept/book/apply/detail/' + applyNo, () => load('/apply-form-detail/' + encodeURIComponent(applyNo))));
        const data = body.data;
        if (!data || data.applyNo !== applyNo || !Array.isArray(data.goodsList))
            throw Error('Blocked: 本条明细没有返回同一本人申请。');
        stage = '等待本人明细渲染';
        const main = page.locator('.pc-page-apply-form-detail');
        await main.waitFor({ state: 'visible', timeout: 8000 });
        await main.locator(':scope > .el-loading-mask').waitFor({ state: 'hidden', timeout: 8000 });
        stage = '核对本人明细字段';
        const comparisons = compareDepartmentGoods(data.goodsList, await database.goods(applyNo));
        if (comparisons.status !== 'passed')
            throw Error((comparisons.status === 'failed' ? '断言失败：' : 'Blocked: ') + comparisons.detail);
        const pairs: Record<string, string> = { receiverName: 'receiver_name', receiverPhone: 'receiver_phone', province: 'province', city: 'city', county: 'county', detailAddress: 'detail_address', remark: 'remark' };
        if (kind === 'stored-application-fields')
            Object.assign(pairs, { bookUsage: 'book_usage', applyType: 'apply_type', costClientName: 'cost_client_name' });
        for (const [api, column] of Object.entries(pairs)) {
            const saved = api === 'remark' ? stored[column] ?? '' : stored[column], actual = api === 'remark' ? data[api] ?? '' : data[api];
            if (saved == null)
                throw Error('Blocked: 本人存储记录缺少本条需要的字段' + api + '。');
            if (actual == null || String(actual) !== String(saved))
                throw Error('断言失败：明细接口字段' + api + '与本人申请数据库存储值不一致。');
        }
        const previews = main.locator('.word-pc-from-item-preview');
        const expected: Record<string, string> = { '收件人：': String(stored.receiver_name), '手机号码：': String(stored.receiver_phone), '所在地区：': [stored.province, stored.city, stored.county].join('/'), '详细地址：': String(stored.detail_address) };
        for (const [label, value] of Object.entries(expected)) {
            const field = previews.filter({ has: page.locator('.label').filter({ hasText: new RegExp('^' + label + '$') }) });
            if (await field.count() !== 1 || (await field.locator('.value').textContent()) !== value)
                throw Error('断言失败：页面' + label + '没有原样回显数据库存储值。');
        }
        const remark = main.locator('.detailed-info li').filter({ has: page.locator('.label').filter({ hasText: /^备注：$/ }) });
        if (await remark.count() !== 1 || (await remark.locator('.value').textContent()) !== String(stored.remark ?? ''))
            throw Error('断言失败：页面备注没有原样回显数据库存储值。');
        if (kind === 'stored-application-fields') {
            const applicant = previews.filter({ has: page.locator('.label').filter({ hasText: /^申请人：$/ }) });
            if (!stored.applicant_name || await applicant.count() !== 1 || (await applicant.locator('.value').textContent()) !== String(stored.applicant_name))
                throw Error('断言失败：收件信息/备注的数据库、接口、页面对照完成，但申请人展示为类型标签或缺失，未原样展示数据库保存的申请人姓名。');
            if (!stored.book_usage_label)
                throw Error('Blocked: 用途字典没有提供唯一的数据库展示基线。');
            for (const [label, value] of Object.entries({ '样书用途：': stored.book_usage_label, '费用划归客户：': stored.cost_client_name })) {
                const field = previews.filter({ has: page.locator('.label').filter({ hasText: new RegExp('^' + label + '$') }) });
                if (await field.count() !== 1 || (await field.locator('.value').textContent()) !== String(value))
                    throw Error('断言失败：页面' + label + '与数据库记录/用途字典不一致。');
            }
            const tableRows = main.locator('.pc-page-form-detail-sample-details tbody tr');
            if (await tableRows.count() !== data.goodsList.length)
                throw Error('断言失败：页面样书行数不一致。');
            for (let i = 0; i < data.goodsList.length; i++) {
                const cells = tableRows.nth(i).locator('td'), g = data.goodsList[i];
                if ((await cells.nth(0).innerText()).trim() !== String(g.productId) || Number(await cells.nth(1).innerText()) !== Number(g.qty))
                    throw Error('断言失败：页面商品或数量与数据库对照明细不一致。');
            }
        }
        r.detail = '本轮当前账号、本人列表和数据库申请人匹配；收件人、手机号、省市区、地址、备注逐字段核对明细新GET与数据库，再精确比较页面文本（不裁剪业务值）。已存申请字段作为回显基线；本条不重复证明最初提交写入或下游备注拼接。';
    }
    catch (error) {
        const m = error instanceof Error ? error.message : '';
        r.status = m.startsWith('断言失败：') ? 'failed' : 'blocked';
        r.detail = /^(断言失败：|Blocked: )/.test(m) ? m.replace(/^Blocked: /, '') : '本条数据库/页面完整对照未完成（' + stage + '）；未以子步骤通过代替原始预期。';
    }
    finally {
        try {
            if (known(page.url())) {
                mask = await page.addStyleTag({ content: '.el-select-dropdown__item,.pc-page-home input,.pc-page-home .person-info,.pc-page-home .user-info,.pc-page-apply .apply-content-item,.pc-page-apply .apply-content-item *,.page-apply-item,.page-apply-item *,.pc-page-apply-form-detail .value,.pc-page-apply-form-detail td,.pc-page-apply-detail .value,.pc-page-apply-detail .info-step .hint1,.pc-page-apply-detail .info-step .hint2,.page-logistics-item,.page-logistics-item *,.pc-page-logistics .logistics-content-item,.pc-page-logistics .logistics-content-item *,.pc-page-logistics-detail .value,.pc-page-logistics-detail .value *{color:transparent!important;text-shadow:none!important}' });
                r.evidence = await save(await captureDifyPng(page));
                r.evidenceNote = '本条实际查询/操作后的本轮截图；编号与个人字段已遮蔽，原值只在内存比较。';
            }
        }
        catch {
            if (r.status === 'passed')
                r.status = 'blocked';
            r.detail += '；本轮脱敏截图未完成。';
        }
        if (isWelfareKind(kind) && r.evidence)
            r.evidenceNote = '本轮会话脱敏H5现场，仅定位会话；福利订单结论来自真实查询和独立角色数据库，未执行管理后台UI。';
        await mask?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        if (client) {
            await client.send('Network.setUserAgentOverride', { userAgent: device.ua, platform: device.platform }).catch(() => { });
            await client.detach().catch(() => { });
        }
        await page.setViewportSize(viewport);
        try {
            await page.goto('about:blank');
            await page.goto(original, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch {
            if (r.status === 'passed')
                r.status = 'blocked';
            r.detail += '；原页面恢复未完成。';
        }
    }
}
