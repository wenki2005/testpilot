import type { Page, Request } from 'playwright';
import type { BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { actionablePreconditions } from '../../../documents/execution/workflow-facade.js';
import { applicationFilter } from './application-list.js';
import { readDepartmentApplicationSnapshot } from '../../../database/mysql-browser.js';
import { captureDifyPng } from '../../evidence/module-evidence.js';

/** Exact source expectations, not a fuzzy match or a replacement business oracle. */
const kinds = {
    '表单不再展示「申请人」字段，也不出现「选择申请人」下拉入口': 'home-applicant',
    '页面不再出现「本人申请/代人申请」切换控件': 'home-type',
    '页面无空白的申请人占位区域或残留标签': 'home-placeholder',
    'PC端同样不展示申请人字段，无「本人申请/代人申请」切换': 'home-pc',
    'PC历史申请记录不再展示申请类型文案': 'history-pc',
    '筛选项顺序为：全部、待审批、已通过、已驳回、已取消': 'filter-order',
    '不出现「已撤销」「通过后撤销」等OA侧状态文案': 'filter-wording',
    '仅返回本人已取消申请（examine_status=3）': 'cancelled-owner',
    '卡片状态标签显示「已取消」': 'cancelled-label',
    '其他员工的已取消申请不出现在列表': 'cancelled-isolation',
    '历史代人申请卡片不展示「本人申请/代人申请」文案': 'history-type',
    '展示「撤销用书申请」按钮': 'pending-button',
    '弹窗文案「您是否确认撤销该用书申请」': 'pending-modal',
    '弹窗按钮为「暂不取消」与「确定取消」': 'pending-modal-buttons',
    '点击「暂不取消」关闭弹窗，申请状态与按钮均不变': 'pending-modal-dismiss',
    '申请已取消后库存不足提示与重试入口均不再展示': 'cancelled-no-retry',
} as const;
export function employeeApplicationReadOnlyKind(c: Pick<BrowserCheck, 'expected' | 'source'>) {
    return c.source.includes('部门用书系统V1.1.0') ? kinds[c.expected as keyof typeof kinds] : undefined;
}
export function reviewEmployeeApplicationReadOnly(c: BrowserCheck, evidence: string, target?: string) {
    const kind = employeeApplicationReadOnlyKind(c);
    if (!kind || actionablePreconditions(c).length) return;
    try {
        const u = new URL(target ?? ''), p = JSON.parse(evidence);
        if (u.origin !== 'https://cdn.yibentushu.com' || u.pathname !== '/test-sample-apply/index.html' || !p.controls?.some((v: { placeholder?: string }) => v.placeholder === '请输入收件人姓名')) return;
    } catch { return; }
    return { kind: 'employee-application-readonly' as const, steps: [{ action: 'assertExactVisible' as const, text: '收货信息' }], detail: 'V1.1只读专项脚本：入口步骤后执行同条原始预期的DOM、筛选顺序或同账号记录完整核验，并保存本轮证据。弹窗仅点暂不取消；不申请、不提交、不取消。' };
}
type Row = Record<string, any>;
type Result = { status: string; detail: string; evidence?: string; evidenceNote?: string };
const fail = (s: string): never => { throw Error('断言失败：' + s); };
const blocked = (s: string): never => { throw Error('Blocked: ' + s); };
const statusGroup = '.pc-page-apply .apply-seek-form .seek-states > ul, .page-apply > .apply-header > .nav:nth-of-type(2)';
/** No mutation endpoint is called. Raw identities and record values remain in memory. */
export async function verifyEmployeeApplicationReadOnly(page: Page, c: BrowserCheck, r: Result, target: string, save: (png: Buffer) => Promise<string>) {
    const kind = employeeApplicationReadOnlyKind(c);
    if (!kind || r.status !== 'passed') return;
    delete r.evidence;
    const viewport = page.viewportSize();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    let client: import('playwright').CDPSession | undefined;
    let mask: Awaited<ReturnType<Page['addStyleTag']>> | undefined;
    const fresh = async (suffix: string, action: () => Promise<unknown>) => {
        const requests = new Set<Request>();
        const listener = (q: Request) => {
            const u = new URL(q.url());
            if (q.method() === 'GET' && u.origin === 'https://testapi.yibentushu.com' && u.pathname === '/supply-api/' + suffix) requests.add(q);
        };
        page.on('request', listener);
        const pending = page.waitForResponse(reply => requests.has(reply.request()), { timeout: 12000 }).then(async reply => {
            const body = await reply.json();
            if (reply.status() !== 200 || body.code !== 200) blocked('本条新查询未成功，未将空白或错误响应当通过。');
            return body as Row;
        });
        void pending.catch(() => { });
        try { await action(); return await pending; }
        finally { page.off('request', listener); void pending.catch(() => { }); }
    };
    const load = async (route: string) => {
        const u = new URL(target); u.hash = route;
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Hash reuse alone need not refetch the SPA's route data.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    };
    try {
        const u = new URL(target);
        if (u.origin !== 'https://cdn.yibentushu.com' || u.pathname !== '/test-sample-apply/index.html') blocked('不是约定的申样测试环境。');
        if (kind.startsWith('home-')) {
            const widths = kind === 'home-pc' ? [1280] : [390, 1280];
            client = await page.context().newCDPSession(page);
            for (const width of widths) {
                await client.send('Network.setUserAgentOverride', { userAgent: width < 600 ? userAgent.replace(/ Mobile/g, '') + ' Mobile' : userAgent.replace(/ Mobile/g, '') });
                await page.setViewportSize({ width, height: 900 });
                await load('/home');
                const root = page.locator('.pc-page-home, .page-home').filter({ visible: true });
                await root.getByPlaceholder('请输入收件人姓名', { exact: true }).waitFor({ state: 'visible', timeout: 7000 });
                if (await root.count() !== 1) blocked('未唯一定位完整申请表单。');
                const controls = root.locator('input,select,textarea,[role="combobox"],button,[role="tab"],.header-nav li').filter({ visible: true });
                const bad = await controls.evaluateAll(nodes => nodes.some(node => /申请人/.test([node.getAttribute('aria-label'), node.getAttribute('placeholder'), node.getAttribute('name'), node.closest('.home-form-item')?.querySelector('label')?.textContent].join(' ')) || /^(?:本人申请|代人申请|本人申领|代人申领)$/.test((node.textContent ?? '').trim())));
                if (bad || await root.getByText(/^(?:申请人[：:]?|选择申请人|本人申请|代人申请)$/).filter({ visible: true }).count()) fail('表单仍有申请人字段、选择入口、残留标签或申请类型切换控件。');
                const reserved = await root.locator('[class*="applicant"],[class*="apply-type"]').filter({ visible: true }).count();
                if (kind === 'home-placeholder' && reserved) blocked('存在申请人相关布局容器，需确认是否形成空白占位，未仅以无文字判通过。');
            }
            r.detail = '本轮在' + widths.join('、') + '像素视口加载完整表单，检查可见输入框、下拉框、关联标签、切换控件及申请人残留文字，未见已移除入口；未点击提交。';
        } else {
            await page.setViewportSize({ width: kind === 'history-pc' ? 1280 : 1280, height: 900 });
            const list = await fresh('dept/book/apply/myList', () => load('/apply'));
            const main = page.locator('.pc-page-apply');
            await main.waitFor({ state: 'visible', timeout: 7000 });
            if (!Array.isArray(list.rows) || !Number.isSafeInteger(Number(list.total))) blocked('本人列表响应结构不完整。');
            if (kind === 'filter-order' || kind === 'filter-wording') {
                const group = page.locator(statusGroup).filter({ visible: true });
                if (await group.count() !== 1) blocked('状态筛选组未唯一定位。');
                const labels = (await group.locator('li').allTextContents()).map(s => s.trim());
                if (kind === 'filter-order' && JSON.stringify(labels) !== JSON.stringify(['全部', '待审批', '已通过', '已驳回', '已取消'])) fail('状态筛选的实际DOM顺序或完整选项集合不符合预期。');
                if (labels.some(s => /已撤销|通过后撤销/.test(s))) fail('员工端状态筛选仍使用OA状态文案。');
                r.detail = '本轮完整状态筛选DOM集合：' + labels.join(' → ') + '；逐项核对顺序和员工端文案。';
            } else if (kind.startsWith('history-')) {
                const cards = main.locator('.apply-content-item');
                if (!list.rows.length) blocked('本人列表为空，没有历史卡片样本。');
                await cards.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await cards.count() !== list.rows.length) fail('历史卡片数与新响应不一致。');
                if (await cards.getByText(/本人申请|代人申请|申请类型/).count()) fail('历史卡片仍展示已移除的申请类型文案。');
                if (kind === 'history-type' && !list.rows.some((row: Row) => String(row.applyType) === '2')) blocked('当前页卡片无申请类型文案，但缺历史代人申请样本，不能完整验证兼容性。');
                r.detail = '本轮' + list.rows.length + '张历史卡片均未展示本人申请/代人申请或申请类型文案，卡片数与实际查询一致。';
            } else if (kind.startsWith('cancelled-') && kind !== 'cancelled-no-retry') {
                const control = await applicationFilter(page, false, '已取消');
                const cancelled = await fresh('dept/book/apply/myList', () => control.click());
                if (!Array.isArray(cancelled.rows)) blocked('已取消筛选未返回结构完整的列表。');
                if (!cancelled.rows.length) blocked('已取消筛选已实际执行，但当前账号没有已取消申请，缺正向样本。');
                if (Number(cancelled.total) > cancelled.rows.length) blocked('已取消结果还有后续分页，当前专项脚本尚未核验完整集合。');
                if (cancelled.rows.some((row: Row) => Number(row.examineStatus) !== 3)) fail('已取消筛选返回非已取消申请。');
                const cards = main.locator('.apply-content-item');
                await cards.first().waitFor({ state: 'visible', timeout: 5000 });
                if (await cards.count() !== cancelled.rows.length) fail('取消列表卡片数量与响应不一致。');
                if (kind === 'cancelled-label') {
                    for (let i = 0; i < cancelled.rows.length; i++) if ((await cards.nth(i).locator('.content .status').innerText()).trim() !== '已取消') fail('取消卡片状态标签不一致。');
                } else {
                    const identity = await page.evaluate(async () => {
                        let token = localStorage.getItem('sample-apply-token'); try { token = JSON.parse(token ?? 'null'); } catch { }
                        if (typeof token !== 'string') return undefined;
                        return fetch('https://testapi.yibentushu.com/supply-api/getInfo', { headers: { Authorization: 'Bearer ' + token } }).then(reply => reply.json());
                    });
                    const uid = String(identity?.user?.userId ?? '');
                    if (identity?.code !== 200 || !/^\d{1,20}$/.test(uid)) blocked('缺本轮本人身份，未猜测数据归属。');
                    for (const row of cancelled.rows) {
                        const stored = await readDepartmentApplicationSnapshot(String(row.applyNo), uid);
                        if (!stored || Number(stored.examine_status) !== 3) fail('已取消列表记录与本人数据库范围或状态不一致。');
                    }
                }
                r.detail = '已实际点击已取消筛选，本轮完整结果' + cancelled.rows.length + '条，逐项核对' + (kind === 'cancelled-label' ? '状态标签' : '本人身份、数据库归属及examine_status=3') + '。';
            } else {
                const wantCancelled = kind === 'cancelled-no-retry';
                const candidate = list.rows.find((row: Row) => Number(row.examineStatus) === (wantCancelled ? 3 : 0));
                if (!candidate) blocked('当前本人列表缺' + (wantCancelled ? '已取消' : '待审批') + '申请；不创建或改写记录。');
                const no = String(candidate.applyNo);
                if (!/^[A-Za-z0-9_-]{1,100}$/.test(no)) blocked('本人申请编号格式不完整。');
                const detail = await fresh('dept/book/apply/progress/' + no, () => load('/apply-detail/' + encodeURIComponent(no)));
                if (detail.data?.applyNo !== no || Number(detail.data.examineStatus) !== (wantCancelled ? 3 : 0)) blocked('本人申请状态已改变，未在错误状态下判定。');
                const root = page.locator('.pc-page-apply-detail');
                await root.waitFor({ state: 'visible', timeout: 6000 });
                await root.locator('.audit-status').filter({ visible: true }).waitFor({ state: 'visible', timeout: 6000 });
                if (wantCancelled) {
                    if (await root.getByText(/目前仓库样书库存不足|再次尝试锁单|联系运营核实库存数量/).filter({ visible: true }).count()) fail('已取消申请仍展示库存不足提示或重试入口。');
                    r.detail = '本轮本人已取消详情响应与页面一致，库存不足提示和再次锁单入口均未展示。';
                } else {
                    const revoke = root.getByText('撤销用书申请', { exact: true }).filter({ visible: true });
                    await revoke.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                    if (await revoke.count() !== 1) fail('待审批详情未展示唯一撤销用书申请入口。');
                    if (kind !== 'pending-button') {
                        const before = await root.innerText();
                        await revoke.click();
                        const dialog = page.locator('[role="dialog"],.el-message-box,.van-dialog').filter({ visible: true });
                        await dialog.first().waitFor({ state: 'visible', timeout: 5000 });
                        if (await dialog.count() !== 1) blocked('二次确认弹窗未唯一定位。');
                        if (!(await dialog.innerText()).includes('您是否确认撤销该用书申请')) fail('撤销二次确认文案不符合预期。');
                        const dismiss = dialog.getByText('暂不取消', { exact: true }), confirm = dialog.getByText('确定取消', { exact: true });
                        if (await dismiss.count() !== 1 || await confirm.count() !== 1) fail('二次确认按钮不符合预期。');
                        await dismiss.click(); // Never click the confirm control.
                        await dialog.waitFor({ state: 'hidden', timeout: 5000 });
                        if (kind === 'pending-modal-dismiss' && ((await root.innerText()) !== before || await revoke.count() !== 1)) fail('暂不取消后详情状态或按钮发生改变。');
                        const after = await page.evaluate(async no => {
                            let token = localStorage.getItem('sample-apply-token'); try { token = JSON.parse(token ?? 'null'); } catch { }
                            if (typeof token !== 'string') return undefined;
                            return fetch('https://testapi.yibentushu.com/supply-api/dept/book/apply/progress/' + encodeURIComponent(no), { headers: { Authorization: 'Bearer ' + token } }).then(reply => reply.json());
                        }, no);
                        if (after?.code !== 200 || Number(after.data?.examineStatus) !== 0) fail('关闭弹窗后申请状态未保持待审批。');
                    }
                    r.detail = kind === 'pending-button' ? '同一本人待审批申请的最新接口与页面已核对，撤销入口唯一可见；未点击。' : '实际打开撤销确认弹窗，核对原文及两个按钮，仅点击暂不取消关闭；新GET确认仍待审批，没有发送取消请求。';
                }
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        r.status = message.startsWith('断言失败：') ? 'failed' : 'blocked';
        r.detail = message.startsWith('断言失败：') || message.startsWith('Blocked: ') ? message.replace(/^Blocked: /, '') : 'V1.1只读专项检查未完成：' + (/timeout/i.test(message) ? '页面或控件未在限定时间内就绪。' : '缺少完整的页面、接口或数据库证据。');
    } finally {
        // Close only a known cancellation dialog via its negative action.
        const dismiss = page.locator('[role="dialog"],.el-message-box,.van-dialog').filter({ visible: true }).getByText('暂不取消', { exact: true });
        if (await dismiss.count().catch(() => 0) === 1) await dismiss.click().catch(() => { });
        try {
            mask = await page.addStyleTag({ content: 'input,textarea,.apply-content-item .header .or,.apply-content-item .content .name,.pc-page-apply-detail .value,.pc-page-apply-detail .info-step .hint1,.pc-page-apply-detail .info-step .hint2{color:transparent!important;text-shadow:none!important}' });
            r.evidence = await save(await captureDifyPng(page));
            r.evidenceNote = '本条专项脚本的本轮现场，申请编号和个人字段脱敏；未提交或确认取消。';
        } catch { if (r.status === 'passed') r.status = 'blocked'; r.detail += ' 本轮现场截图未保存成功。'; }
        await mask?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        if (client) {
            await client.send('Network.setUserAgentOverride', { userAgent }).catch(() => { });
            await client.detach().catch(() => { });
        }
        if (viewport) await page.setViewportSize(viewport).catch(() => { });
    }
}
