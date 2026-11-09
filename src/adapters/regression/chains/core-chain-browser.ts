import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Page, Route } from 'playwright';
import type { CoreRun, CoreChainResult, CoreStepResult } from '../../../domain/regression/core-chain-definitions.js';
import type { WebModuleDependencies, WebModuleJob } from '../execution/module-execution-service.js';
import type { DocumentProject } from '../../documents/execution/workflow-facade.js';
import { acquireDocumentPageLease } from '../../documents/execution/workflow-facade.js';
import { getExistingPersistentTestPage } from '../../browser/browser-runtime.js';
import { readDepartmentCreationBaselines, type DepartmentCreationBaseline } from '../scenarios/application/submission-receipts.js';
import { readDepartmentApplicationSnapshot, readDepartmentGoods } from '../../database/mysql-browser.js';
import { compareDepartmentGoods } from '../../database/regression-readback.js';
import { assertApprovalProgress } from '../evidence/integration-assertions.js';
import { inspectOrder85Presentation } from '../scenarios/orders/order-detail-presentation.js';
import { captureDifyPng } from '../evidence/module-evidence.js';
type Row = Record<string, any>;
type Fixture = {
    baseline: DepartmentCreationBaseline;
    stored: Row;
    goods: Row[];
};
export type CorePatch = Partial<Pick<CoreStepResult, 'status' | 'detail' | 'startedAt' | 'finishedAt' | 'evidence' | 'evidenceKind' | 'references'>>;
export type CoreChainExecutor = (run: CoreRun, chain: CoreChainResult, emit: (stepId: string, patch: CorePatch) => void, signal: AbortSignal, onLogin: (waiting: boolean) => void) => Promise<void>;
export function departmentCoreChainBrowser(root: string, deps: WebModuleDependencies, saveEvidence: (runId: string, bytes: Buffer) => Promise<string>): CoreChainExecutor {
    return async (run, chain, emit, signal, onLogin) => {
        if (run.targetUrl !== 'https://cdn.yibentushu.com/test-sample-apply/index.html#/home')
            throw Error('核心链路只适用于已绑定的部门申样测试环境。');
        const project = { id: run.profileId, name: run.systemName, fileName: 'core-business-chains', format: 'text', browserProfileIsolation: true, targetUrl: run.targetUrl, sourceText: '', cases: [], createdAt: run.createdAt, updatedAt: run.updatedAt } as DocumentProject;
        let browserRoot = root, idleUrl: string | undefined;
        try {
            const config = JSON.parse(await readFile(path.join(root, 'private', 'core-browser-session.json'), 'utf8'));
            if (config.schema !== 1 || config.profileId !== run.profileId || !path.isAbsolute(config.dataRoot) || config.idleUrl !== 'http://127.0.0.1:4321/api/system-module-regression')
                throw Error('核心链路既有会话配置无效。');
            browserRoot = config.dataRoot;
            idleUrl = config.idleUrl;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        const ensureIdle = async () => {
            if (!idleUrl)
                return;
            const response = await fetch(idleUrl, { signal: AbortSignal.timeout(8000) });
            if (!response.ok)
                throw Error('既有Dify窗口归属服务不可核对。');
            const state = await response.json(), system = state.systems?.find((s: Row) => s.id === run.systemId);
            if (!system || system.profileId !== run.profileId || system.targetUrl !== run.targetUrl || system.environment !== run.environment || state.batches?.some((b: Row) => b.systemId === run.systemId && ['queued', 'running'].includes(b.phase)) || ['connecting', 'awaiting-login'].includes(state.accounts?.[run.systemId]?.state))
                throw Error('既有Dify窗口身份不匹配或正在使用，未借用。');
        };
        await ensureIdle();
        if (browserRoot === root)
            await deps.inspect(project, { id: run.id } as WebModuleJob, signal, onLogin);
        signal.throwIfAborted();
        const release = acquireDocumentPageLease(run.profileId);
        if (!release)
            throw Error('测试窗口被占用，请结束已有运行后重试。');
        let page: Page | undefined, policy: ((route: Route) => Promise<void>) | undefined;
        let original = '';
        try {
            const session = await getExistingPersistentTestPage(path.join(browserRoot, 'document-tests', 'browser-profiles', 'isolated-' + run.profileId), { isolated: true });
            if (!session)
                throw Error('当前账号测试窗口不可用。');
            page = session.page;
            original = page.url();
            if (new URL(original).origin !== 'https://cdn.yibentushu.com')
                throw Error('既有测试窗口未停留在部门申样环境。');
            const device = await page.evaluate(() => ({ ua: navigator.userAgent, width: innerWidth, height: innerHeight }));
            if (/ Mobile/.test(device.ua))
                throw Error('既有测试窗口为移动布局，请恢复桌面布局后重试；未擅自改变其他运行的设备。');
            policy = async (route) => { const q = route.request(), u = new URL(q.url()); await (q.method() === 'GET' || q.method() === 'HEAD' || q.method() === 'OPTIONS' ? route.continue() : u.origin === 'https://testapi.yibentushu.com' ? route.abort('blockedbyclient') : route.continue()).catch(() => { }); };
            await page.route('**/*', policy);
            const current = page;
            const get = async (p: string): Promise<Row> => {
                signal.throwIfAborted();
                if (!/^(getInfo|dept\/book\/(apply\/(progress|detail)\/[A-Za-z0-9_-]+|manage\/orderList\?pageNum=1&pageSize=100)|h5\/dept\/book\/order\/(myList\?pageNum=1&pageSize=100|detail\/[A-Za-z0-9_-]+))$/.test(p))
                    throw Error('核心链路拒绝未审核的接口。');
                return current.evaluate(async (p) => {
                    if (location.origin !== 'https://cdn.yibentushu.com')
                        throw Error('Wrong business origin');
                    let token = localStorage.getItem('sample-apply-token');
                    try {
                        token = JSON.parse(token ?? 'null');
                    }
                    catch { }
                    if (typeof token !== 'string')
                        throw Error('Missing identity');
                    const r = await fetch('https://testapi.yibentushu.com/supply-api/' + p, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(12000) }), b = await r.json();
                    if (r.status !== 200 || b.code !== 200)
                        throw Error('只读接口未成功，未当业务结果');
                    return b;
                }, p);
            };
            const uid = String((await get('getInfo')).user?.userId ?? '');
            if (!/^\d+$/.test(uid))
                throw Error('当前账号身份不可用。');
            const baselines = await readDepartmentCreationBaselines(root, run.profileId), fixtures: Fixture[] = [];
            for (const baseline of baselines) {
                const stored = await readDepartmentApplicationSnapshot(baseline.applyNo, uid);
                if (!stored)
                    continue;
                const goods = await readDepartmentGoods(baseline.applyNo);
                if (!goods.length)
                    throw Error('本人申请商品缺失。');
                fixtures.push({ baseline, stored, goods });
            }
            const approved = fixtures.filter(f => Number(f.stored.examine_status) === 1 && Number(f.stored.lock_status) === 1 && f.stored.order_id), rejected = fixtures.filter(f => Number(f.stored.examine_status) === 2);
            const choose = (usage: number) => approved.filter(f => Number(f.stored.book_usage) === usage).sort((a, b) => a.baseline.applyNo.localeCompare(b.baseline.applyNo))[0];
            const first = choose(1), second = choose(2), stockCandidates = fixtures.filter(f => Number(f.stored.examine_status) === 1 && f.goods.some(g => ['1012600290', '3012600103', '2012600995'].includes(String(g.product_id)))), stock = run.stockApplicationNos ? run.stockApplicationNos.map(no => {
                const f = stockCandidates.find(f => f.baseline.applyNo === no);
                if (!f)
                    throw Error('指定库存申请没有本人可信提交凭证、审批通过状态或指定商品，未替换为旧样本。');
                return f;
            }) : stockCandidates;
            const selected = chain.id === 'submit-order' ? [first, second].filter((f): f is Fixture => !!f) : chain.id === 'reject-reapply' ? rejected.slice(0, 1) : chain.id === 'stock-retry' ? stock : [first, second].filter((f): f is Fixture => !!f);
            if (!selected.length || chain.id === 'submit-order' && selected.length !== 2)
                throw Error('未找到对应链路的本人可信提交凭证及现有状态，未新建申请补样本。');
            chain.references = selected.map(f => f.baseline.applyNo);
            const load = async (route: string, api: string) => {
                signal.throwIfAborted();
                const url = new URL(run.targetUrl);
                url.hash = route;
                await current.goto('about:blank');
                const pending = current.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/supply-api/' + api, { timeout: 12000 }).then(async (r) => ({ http: r.status(), body: await r.json() }));
                try {
                    await current.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    const r = await pending;
                    if (r.http !== 200 || r.body.code !== 200)
                        throw Error('页面本轮只读响应未成功。');
                    return r.body.data;
                }
                finally {
                    void pending.catch(() => { });
                }
            };
            const progress = async (f: Fixture) => { const d = await load('/apply-detail/' + f.baseline.applyNo, 'dept/book/apply/progress/' + f.baseline.applyNo); assertApprovalProgress(f.stored, d); await current.locator('.pc-page-apply-detail .audit-status .title').waitFor({ state: 'visible', timeout: 7000 }); return d; };
            const form = async (f: Fixture) => {
                const d = await load('/apply-form-detail/' + f.baseline.applyNo, 'dept/book/apply/detail/' + f.baseline.applyNo), c = compareDepartmentGoods(d?.goodsList, f.goods);
                if (d?.applyNo !== f.baseline.applyNo || c.status !== 'passed')
                    throw Error('断言失败：同一申请商品/编号未对应数据库。');
                const main = current.locator('.pc-page-apply-form-detail');
                await main.waitFor({ state: 'visible', timeout: 7000 });
                for (const [label, key] of [['收件人：', 'receiver_name'], ['手机号码：', 'receiver_phone'], ['详细地址：', 'detail_address']] as const) {
                    const field = main.locator('.word-pc-from-item-preview').filter({ has: current.locator('.label').filter({ hasText: new RegExp('^' + label + '$') }) });
                    if (await field.count() !== 1 || (await field.locator('.value').textContent()) !== String(f.stored[key]))
                        throw Error('断言失败：申请收件字段与数据库不一致。');
                }
                const remark = main.locator('.detailed-info li').filter({ has: current.locator('.label').filter({ hasText: '备注：' }) });
                if (await remark.count() !== 1 || (await remark.locator('.value').textContent()) !== String(f.stored.remark ?? ''))
                    throw Error('断言失败：申请备注与数据库不一致。');
                return d;
            };
            const order = async (f: Fixture) => {
                const id = String(f.stored.order_id ?? '');
                if (!id)
                    throw Error('当前申请尚无订单。');
                const d = await load('/logistics-detail/' + id, 'h5/dept/book/order/detail/' + id);
                if (d?.applyNo !== f.baseline.applyNo || d?.orderId !== id)
                    throw Error('断言失败：订单没有对应同一申请。');
                const main = current.locator('.pc-page-logistics-detail');
                await main.waitFor({ state: 'visible', timeout: 7000 });
                await current.waitForFunction(id => document.querySelector('.pc-page-logistics-detail')?.textContent?.includes(id), id, { timeout: 7000 });
                for (const [label, value] of Object.entries({ '订单编号：': id, '下单时间：': d.createTime, '收货人：': f.stored.receiver_name, '手机号码：': f.stored.receiver_phone, '收货地址：': [f.stored.province, f.stored.city, f.stored.county, f.stored.detail_address].join(' ') })) {
                    const field = main.locator('.word-pc-from-item-preview').filter({ has: current.locator('.label').filter({ hasText: new RegExp('^' + label + '$') }) });
                    if (await field.count() !== 1 || (await field.locator('.value').textContent()) !== String(value))
                        throw Error('断言失败：订单基础字段与同一申请不一致。');
                }
                const shown = await inspectOrder85Presentation(current, d, f.goods);
                return { data: d, shown };
            };
            const capture = async () => {
                let style: import('playwright').ElementHandle | undefined;
                try {
                    style = await current.addStyleTag({ content: '.word-pc-from-item-preview .value,.detailed-info .value,.audit-info,.apply-no,.order-info,.receiver-info,.header .or,.user-info,.logistics-content-item .content li:nth-child(2){color:transparent!important;text-shadow:none!important}' });
                    await current.bringToFront();
                    const client = await current.context().newCDPSession(current);
                    try {
                        return await saveEvidence(run.id, await captureDifyPng(current, client));
                    }
                    finally {
                        await client.detach();
                    }
                }
                finally {
                    await style?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
                }
            };
            const check = async (id: string): Promise<CorePatch> => {
                if (id === 'submitted') {
                    for (const f of selected) {
                        await form(f);
                        if (f.baseline.approvalStatus !== 0 || f.baseline.lockStatus !== 0 || f.baseline.orderPresent !== false)
                            throw Error('原提交待审凭证不完整。');
                    }
                    return { status: 'passed', evidenceKind: 'historical-submission', detail: '已复用来源摘要校验通过的真实提交凭证，并重新核对同一本人申请及商品落库。原提交时待审批/未锁单/无订单；本轮没有重新发送提交。' };
                }
                if (id === 'application-detail') {
                    for (const f of selected)
                        await form(f);
                    return { status: 'passed', detail: '营销/产品同一申请的收件字段、原始备注及商品数量/单价逐项与数据库核对一致。' };
                }
                if (id === 'approved') {
                    for (const f of selected) {
                        await progress(f);
                        if (Number(f.stored.examine_status) !== 1)
                            throw Error('断言失败：链路申请尚未审批通过。');
                    }
                    return { status: 'passed', detail: '同一申请审批通过，数据库、实时progress及页面时间轴一致；本轮复核已完成的人工审批，没有再次审批。' };
                }
                if (id === 'order-created') {
                    const managed = await get('dept/book/manage/orderList?pageNum=1&pageSize=100');
                    if (!Array.isArray(managed.rows) || managed.rows.length !== Number(managed.total))
                        throw Error('管理订单基线未完整读取。');
                    for (const f of selected) {
                        const p = await progress(f);
                        if (Number(f.stored.lock_status) !== 1 || !f.stored.order_id)
                            throw Error('断言失败：同一申请未锁单或未生成订单。');
                        if (managed.rows.filter((r: Row) => r.applyNo === f.baseline.applyNo && r.orderId === f.stored.order_id).length !== 1)
                            throw Error('断言失败：申请未唯一关联管理订单。');
                        await order(f);
                        if (!p.timeline?.length)
                            throw Error('审批时间轴缺失。');
                    }
                    return { status: 'passed', detail: '营销/产品两分支均按同一申请关联审批通过、锁单成功及唯一管理订单；实际订单详情与本人申请、商品及独立求和总价一致。' };
                }
                if (id === 'outbound') {
                    for (const f of selected)
                        await order(f);
                    return { status: 'blocked', detail: '已有真实订单；当前明细未提供最终发送备注、旺店通店铺与易诚通出库分类的同单读回。原始备注存在，不能把它当最终发送备注或判定拼接错误。' };
                }
                if (id === 'rejected') {
                    const f = selected[0]!;
                    await progress(f);
                    if (Number(f.stored.examine_status) !== 2 || !f.stored.reject_reason)
                        throw Error('断言失败：驳回状态或理由缺失。');
                    if (!(await current.locator('.pc-page-apply-detail').innerText()).includes(String(f.stored.reject_reason)))
                        throw Error('断言失败：页面未展示真实驳回理由。');
                    return { status: 'passed', detail: '同一申请已驳回，真实长理由在数据库、进度接口及页面完整一致，未要求它等于示例短语。' };
                }
                if (id === 'no-order') {
                    const f = selected[0]!;
                    await progress(f);
                    const managed = await get('dept/book/manage/orderList?pageNum=1&pageSize=100');
                    if (!Array.isArray(managed.rows) || managed.rows.length !== Number(managed.total))
                        throw Error('管理订单列表不完整。');
                    if (Number(f.stored.lock_status) !== 0 || f.stored.order_id || managed.rows.some((r: Row) => r.applyNo === f.baseline.applyNo))
                        throw Error('断言失败：被驳回申请仍锁单或生成订单。');
                    return { status: 'passed', detail: '驳回申请锁单状态0、无订单引用，完整管理订单中也不存在该申请。' };
                }
                if (id === 'reapply-entry') {
                    await progress(selected[0]!);
                    const actions = current.locator('.pc-page-apply-detail').locator('button,a,[role="button"],.button,[class*="btn"]').filter({ hasText: /重新申请|联系审批人/ }).filter({ visible: true });
                    return await actions.count() ? { status: 'passed', detail: '已找到可见的重新申请或联系审批人入口；本步不自动提交新申请。' } : { status: 'failed', detail: '被测系统驳回详情没有可见的“重新申请”或“联系审批人”入口，原预期要求的操作缺失。' };
                }
                if (id === 'new-application')
                    return { status: 'blocked', detail: '原驳回申请没有重新申请入口，本轮未由该流程产生新编号；不新造独立申请冒充驳回后的重新申请。' };
                if (id === 'warehouse') {
                    for (const f of selected)
                        await progress(f);
                    return { status: 'blocked', detail: '本轮绑定申请' + selected.map(f => f.baseline.applyNo).join('、') + '；现有接口没有同笔分仓库存查询次序与实际锁定仓库，不能由图书资料或订单前缀认定长沙/天津。' };
                }
                if (id === 'shortage') {
                    for (const f of selected)
                        await progress(f);
                    const failed = selected.filter(f => Number(f.stored.lock_status) !== 1);
                    if (!failed.length) {
                        for (const f of selected)
                            await order(f);
                    }
                    return { status: 'blocked', detail: failed.length ? '尚未取得符合两仓不足前提的完整独立分仓库存与失败提示证据。' : '本轮绑定申请' + selected.map(f => f.baseline.applyNo + '（订单' + f.stored.order_id + '）').join('、') + '均锁单成功；页面、实时接口和数据库一致，未触发真实缺货失败，不能将缺货分支记通过。' };
                }
                if (id === 'retry')
                    return { status: 'blocked', detail: selected.every(f => Number(f.stored.lock_status) === 1) ? '本轮绑定申请已锁单成功并生成订单，缺真实失败后可重试的状态；未对成功订单重复锁单。' : '已绑定未成功锁单申请；本执行器尚未实际发送重试，重试行为未验证，不能记通过。' };
                if (id === 'search') {
                    const list = await get('h5/dept/book/order/myList?pageNum=1&pageSize=100');
                    if (!Array.isArray(list.rows) || list.rows.length !== Number(list.total))
                        throw Error('本人订单基线未完整读取。');
                    const f = selected[0]!, key = String(f.stored.order_id), url = new URL(run.targetUrl);
                    url.hash = '/logistics';
                    await current.goto('about:blank');
                    await current.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    const input = current.getByPlaceholder('搜索订单号/书籍', { exact: true });
                    await input.waitFor({ state: 'visible', timeout: 7000 });
                    const keyword = key.slice(0, -2), response = current.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/supply-api/h5/dept/book/order/myList' && new URL(r.url()).searchParams.get('keyword') === keyword, { timeout: 12000 });
                    try {
                        await input.fill(keyword);
                        await input.press('Enter');
                        const r = await response, b = await r.json();
                        if (r.status() !== 200 || b.code !== 200 || !b.rows?.some((v: Row) => v.orderId === key))
                            throw Error('断言失败：真实订单号关键词搜索未命中原本人订单。');
                        await current.waitForFunction(id => document.querySelector('.pc-page-logistics')?.textContent?.includes(id), key, { timeout: 7000 });
                    }
                    finally {
                        void response.catch(() => { });
                    }
                    return { status: 'passed', detail: '实际输入本人订单号部分关键词并查询，新响应包含同一订单且页面可见；未把空态当模糊命中通过。' };
                }
                if (id === 'detail' || id === 'status') {
                    for (const f of selected)
                        await order(f);
                    return { status: 'passed', detail: id === 'detail' ? '两分支实际打开同一订单，基础字段、逐行商品、小计/总本数/总价与独立数据库核对一致。' : '两分支当前已下单时间轴的节点、时间和说明与同一订单接口一致；本步不宣称已发货或已签收。' };
                }
                if (id === 'tracking') {
                    let count = 0;
                    for (const f of selected) {
                        const { data, shown } = await order(f);
                        if (data.logisticsNo && shown.traceRows)
                            count++;
                    }
                    return count === selected.length ? { status: 'passed', detail: '各同单已有真实快递单号与轨迹，实际页面与接口逐节点一致，轨迹时间倒序。' } : { status: 'blocked', detail: '现有本人订单快递单号为空或轨迹为空，不能验证真实发货/签收及最新轨迹置顶。其他账号历史物流详情有权限拒绝，未绕过权限。' };
                }
                if (id === 'refresh')
                    return { status: 'blocked', detail: '页面只读GET不含上游来源和最近拉取执行时间；现有通用任务日志不能关联本订单并证明每10分钟执行，未把浏览器刷新冒充后台物流任务。' };
                if (['h5-application', 'pc-application', 'application-records', 'order-detail', 'scheduled-retry', 'wecom-notifications', 'service-defenses', 'audit', 'admin-tracking'].includes(id))
                    return { status: 'blocked', detail: '该新版链路步骤已挂入目录，但对应的专用只读执行器尚未接入；本轮未提交申请、审批、下单、取消或通知，也未用旧步骤冒充新版结果。' };
                throw Error('未知核心步骤。');
            };
            for (const step of chain.steps) {
                signal.throwIfAborted();
                await ensureIdle();
                emit(step.id, { startedAt: new Date().toISOString(), detail: '正在核验同一链路记录…', references: chain.references });
                let patch: CorePatch;
                try {
                    patch = await check(step.id);
                }
                catch (e) {
                    if (signal.aborted)
                        throw e;
                    const message = e instanceof Error ? e.message : '';
                    patch = { status: message.startsWith('断言失败：') ? 'failed' : 'blocked', detail: message.startsWith('断言失败：') ? message : '当前步骤未取得完整的同单页面/接口/数据库证据；未判通过，请核对登录、数据状态或读取失败。' };
                }
                try {
                    patch.evidence = await capture();
                }
                catch {
                    patch.detail += '；本步骤现场截图采集未完成。';
                    if (patch.status === 'passed')
                        patch.status = 'blocked';
                }
                patch.evidenceKind ??= 'current-readback';
                emit(step.id, { ...patch, finishedAt: new Date().toISOString(), references: chain.references });
            }
        }
        finally {
            if (page && policy)
                await page.unroute('**/*', policy).catch(() => { });
            if (page && original && !signal.aborted)
                await page.goto(original, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            release();
        }
    };
}
