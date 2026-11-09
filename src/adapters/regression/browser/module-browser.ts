import path from 'node:path';
import { loadDifyCustomerFixtures } from '../config/test-fixtures.js';
import { loadDifyBookFixtures, observeDifyBookResponses, verifyDifyBookResult, difyBookKind } from '../scenarios/books/book-search.js';
import { verifyDifyDeviceResult, waitForDifyDeviceBaseline } from '../scenarios/clients/device-layout.js';
import { verifyDifyListResult } from '../scenarios/records/application-list.js';
import { verifyEmployeeApplicationReadOnly } from '../scenarios/records/employee-application-readonly.js';
import { verifyDifyRecordResult, difyRecordKind } from '../scenarios/records/application-detail.js';
import { verifyConnectedEvidence } from '../scenarios/connected-systems.js';
import { connectedEvidenceKind } from '../evidence/connected-evidence-contract.js';
import { readDepartmentCreationReceipts, readDepartmentCreationBaselines } from '../scenarios/application/submission-receipts.js';
import { verifyInvalidBook, prepareInvalidBook } from '../scenarios/books/invalid-books.js';
import { verifyExcludedCustomer } from '../scenarios/application/excluded-customers.js';
import { prepareClientValidation, verifyClientValidation } from '../scenarios/application/client-validation.js';
import { verifyApplicantIdentity, isApplicantIdentity } from '../scenarios/identity/applicant-identity.js';
import { fieldValidityKind, prepareFieldValidityBaseline, verifyFieldValidityResult } from '../scenarios/application/field-validation.js';
import { maskDifyProfileEvidence, captureDifyPng } from '../evidence/module-evidence.js';
import { executeAuthorizedDepartmentWrites } from '../scenarios/application/submit-application.js';
import { waitForDepartmentFormBaseline } from '../scenarios/application/form-baseline.js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { collectDepartmentDatabaseEvidence } from '../../database/regression-readback.js';
import { acquireDocumentPageLease, executeDocumentRun, cancelDocumentRun, getDocumentRun, saveDocumentProject, draftGroundedReadOnlyBrowserSteps } from '../../documents/execution/workflow-facade.js';
import { launchPersistentTestPage, navigatePersistentPage, getExistingPersistentTestPage } from '../../browser/browser-runtime.js';
import { allowBrowserRequest, bringBrowserToFront, waitForUserLogin, isLoginPage, isAuthenticationRoute, clearLoginHandoff, requestLoginContinue } from '../../browser/login-handoff.js';
import { generateDocumentCaseSteps } from '../../../server/runtime.js';
import { callDifyWorkflow } from '../../integrations/dify/workflow-client.js';
import type { WebModuleDependencies } from '../execution/module-execution-service.js';
import { observeDifyReadOnlyResponses, verifyDepartmentReadOnlyResult, departmentReadOnlyKind, needsDifyReadback } from '../scenarios/scenario-planner.js';
/** The result callback already verified the loaded business page. Inspect its
 * current frames once; do not wait for a login handoff while holding the run. */
async function evidenceLoginPage(page: import('playwright').Page) {
    const checks = await Promise.all(page.frames().map(async (frame) => isAuthenticationRoute(frame.url()) || await frame.evaluate(() => !!document.querySelector('input[type="password"],input[autocomplete="current-password"],input[autocomplete="one-time-code"]') || /企业微信(?:扫码|登录)|微信扫码登录|扫码登录|扫描二维码登录|二维码已过期|用户登录|统一身份认证|请先登录|登录后继续|please\s+sign\s*in|sign\s*in\s+to\s+continue|please\s+log\s*in/i.test(document.body?.innerText ?? '')).catch(() => true)));
    return checks.some(Boolean);
}
/** Dify-only fallback at the result callback, before the next case resets the page. */
export async function captureMissingDifyFailureEvidence(dataRoot: string, project: {
    id: string;
    targetUrl: string;
    browserProfileIsolation?: boolean;
}, runId: string, result: {
    id: string;
    status: string;
    detail: string;
    evidence?: string;
}, required = false, knownPage?: import('playwright').Page) {
    if ((!['failed', 'blocked'].includes(result.status) && !(required && result.status === 'passed')) || result.evidence)
        return;
    let client: import('playwright').CDPSession | undefined, stage = '连接窗口';
    const deadline = Date.now() + 12000;
    const bounded = async <T>(operation: Promise<T>, ms = 5000): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('evidence-timeout')), Math.max(1, Math.min(ms, deadline - Date.now()))); })]);
        }
        finally {
            clearTimeout(timer);
        }
    };
    try {
        const page = knownPage ?? (await bounded(getExistingPersistentTestPage(path.join(dataRoot, 'document-tests', 'browser-profiles', project.browserProfileIsolation ? `isolated-${project.id}` : project.id), { isolated: project.browserProfileIsolation === true })))?.page;
        if (!page || page.isClosed())
            throw Error('window-missing');
        stage = '检查目标地址';
        if (new URL(page.url()).origin !== new URL(project.targetUrl).origin)
            throw Error('not-business-page');
        stage = '检查登录状态';
        if (await bounded(knownPage ? evidenceLoginPage(page) : isLoginPage(page)))
            throw Error('not-business-page');
        stage = '显示窗口';
        await bounded(page.bringToFront());
        stage = '连接截图通道';
        client = await bounded(page.context().newCDPSession(page));
        stage = '截图';
        const shot = await bounded(captureDifyPng(page, client), 8000);
        stage = '保存图片';
        const name = createHash('sha256').update(result.id).digest('hex') + '.png';
        const directory = path.join(dataRoot, 'document-tests', 'runs', runId, 'screenshots');
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, name), shot);
        result.evidence = name;
    }
    catch {
        if (required && result.status === 'passed') {
            result.status = 'blocked';
            result.detail += '；补充操作后的本轮截图未采集成功（' + stage + '），未算完整通过。';
        }
        else
            result.detail += '；本轮现场截图未采集成功（' + stage + '），断言结果保留。';
    }
    finally {
        if (client)
            await bounded(client.detach(), 1000).catch(() => { });
    }
}
/** A prerequisite screenshot is bound to its Dify job, without inventing a
 * document run or pretending that a blocked business assertion was executed. */
export async function captureDifyBlockedEvidence(dataRoot: string, project: import('../../documents/execution/workflow-facade.js').DocumentProject, jobId: string, item: import('../../documents/execution/workflow-facade.js').BrowserCheck, signal: AbortSignal) {
    const target = new URL(project.targetUrl);
    // Every blocked case needs its current prerequisite scene, even when this
    // employee page cannot prove a backend/configuration/notification assertion.
    // Label that limit explicitly; never reuse a historical shot as current proof.
    const release = acquireDocumentPageLease(project.id);
    if (!release)
        return;
    let client: import('playwright').CDPSession | undefined, style: import('playwright').ElementHandle | undefined, sceneMask: import('playwright').ElementHandle | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const session = await getExistingPersistentTestPage(path.join(dataRoot, 'document-tests', 'browser-profiles', project.browserProfileIsolation ? `isolated-${project.id}` : project.id), { isolated: project.browserProfileIsolation === true }).catch(() => undefined);
    if (!session) {
        release();
        return;
    }
    const page = session.page, original = page.url();
    const policy = async (route: import('playwright').Route) => { const r = route.request(); await (allowBrowserRequest(r.method(), r.url(), project.id, { targetOrigin: target.origin, resourceType: r.resourceType(), authenticationPage: isAuthenticationRoute(page.url()), isNavigationRequest: r.isNavigationRequest(), isMainFrameNavigation: r.isNavigationRequest() && r.frame() === page.mainFrame() }) ? route.continue() : route.abort('blockedbyclient')).catch(() => { }); };
    try {
        signal.throwIfAborted();
        if (new URL(original).origin !== target.origin || await isLoginPage(page))
            return;
        await page.route('**/*', policy);
        const department = target.origin === 'https://cdn.yibentushu.com' && target.pathname.startsWith('/test-sample-apply/');
        const backend = /本期PC后台/.test(item.expected) || item.source.includes('管理端后台');
        const courierRule = /快递公司由旺店通店铺默认快递决定/u.test(item.expected);
        const route = !backend && /员工端-(?:历史申请记录|用书审批详情|申请表单明细)/.test(item.source) ? '/apply' : !backend && /员工端-订单/.test(item.source) ? '/logistics' : '/home';
        if (department) {
            const url = new URL(project.targetUrl);
            url.hash = route;
            if (page.url() !== url.href)
                await navigatePersistentPage(page, url.href, 15000);
            await page.locator(route === '/apply' ? '.pc-page-apply' : route === '/logistics' ? '.pc-page-logistics' : '.pc-page-home').waitFor({ state: 'visible', timeout: 10000 });
        }
        if (await isLoginPage(page))
            return;
        signal.throwIfAborted();
        await page.bringToFront();
        style = await maskDifyProfileEvidence(page, true);
        sceneMask = await page.addStyleTag({ content: '.pc-page-home input,.pc-page-home textarea,.pc-page-home .person-info,.pc-page-home .user-info,.pc-page-apply .apply-content-item,.pc-page-apply .apply-content-item *,.page-apply-item,.page-apply-item *,.pc-page-apply-form-detail .value,.pc-page-apply-form-detail td,.pc-page-apply-detail .value,.pc-page-apply-detail .info-step .hint1,.pc-page-apply-detail .info-step .hint2,.pc-page-logistics .logistics-content-item,.pc-page-logistics .logistics-content-item *,.page-logistics-item,.page-logistics-item *{color:transparent!important;text-shadow:none!important}' });
        client = await page.context().newCDPSession(page);
        const shot = await captureDifyPng(page, client);
        const evidence = createHash('sha256').update(item.id).digest('hex') + '.png', directory = path.join(dataRoot, 'dify-web-modules', 'evidence', jobId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, evidence), shot);
        return { evidence, evidenceNote: courierRule ? '本轮前置阻塞现场：H5 只显示“仅支持快递”，没有旺店通默认快递的接口/配置读回；未执行该业务断言，不将截图视为通过。' : backend ? '本轮前置阻塞现场：当前连接员工申样页面，没有管理后台入口和角色；未执行后台业务断言。' : '本轮前置阻塞现场：展示同账号对应入口/列表的实际状态；业务断言尚未执行，不将截图视为用例通过。' };
    }
    finally {
        if (timer)
            clearTimeout(timer);
        await sceneMask?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        await style?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
        await client?.detach().catch(() => { });
        if (page.url() !== original) {
            await navigatePersistentPage(page, original, 15000).catch(() => { });
        }
        await page.unroute('**/*', policy).catch(() => { });
        release();
    }
}
/** The source asks for both disabled behavior and a gray appearance. */
export async function verifyDifyRequiredButtonAppearance(page: import('playwright').Page, result: {
    status: string;
    detail: string;
    evidence?: string;
}, expected: string) {
    if (result.status !== 'passed' || expected !== '必填未完成时提交按钮置灰不可点击')
        return;
    try {
        const button = page.getByText('提交申请', { exact: true });
        if (await button.count() !== 1)
            throw Error('提交控件不唯一');
        await button.scrollIntoViewIfNeeded({ timeout: 3000 });
        const visual = await button.evaluate(el => { const node = el.closest('button,[role="button"],[class*="button"],[class*="btn"]') ?? el; const style = getComputedStyle(node); const rgb = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? []; const opaque = rgb.length === 3 || rgb.length === 4 && rgb[3] === 1; const gray = opaque && rgb.length >= 3 && Math.max(...rgb.slice(0, 3)) - Math.min(...rgb.slice(0, 3)) <= 12 && Math.min(...rgb.slice(0, 3)) >= 80 && Math.max(...rgb.slice(0, 3)) <= 245; return { gray, color: style.backgroundColor }; });
        if (!visual.gray)
            throw Error('提交控件背景未呈灰色');
        result.detail += '；Dify 本轮样式核验：提交控件背景为灰色 ' + visual.color + '。';
    }
    catch {
        result.status = 'failed';
        result.detail = '断言失败：提交控件禁用子检查已通过，但本轮没有验证到唯一提交控件的灰色背景。';
        delete result.evidence;
    }
}
export function webModuleDependencies(dataRoot: string): WebModuleDependencies {
    return {
        cloud: callDifyWorkflow,
        authorizedWrites: (project, jobId, checks, signal, progress) => executeAuthorizedDepartmentWrites(dataRoot, project, jobId, checks, signal, progress),
        database: (project, signal) => collectDepartmentDatabaseEvidence(dataRoot, project, signal),
        captureBlockedEvidence: (project, jobId, item, signal) => captureDifyBlockedEvidence(dataRoot, project, jobId, item, signal),
        saveProject: saveDocumentProject,
        recover: getDocumentRun,
        async savedSessionStatus(project) {
            const profilePath = path.join(dataRoot, 'document-tests', 'browser-profiles', `isolated-${project.id}`);
            const existing = await getExistingPersistentTestPage(profilePath, { isolated: true });
            if (!existing) return 'unavailable';
            const session = await launchPersistentTestPage(profilePath, { isolated: true, targetUrl: project.targetUrl });
            if (new URL(session.page.url()).origin !== new URL(project.targetUrl).origin) return 'unavailable';
            if (await isLoginPage(session.page)) return 'expired';
            // Do not expose the token or personal fields to HTTP responses/logs.
            // The live server, rather than the mere presence of storage, decides
            // whether the remembered login is still valid.
            if (new URL(project.targetUrl).origin !== 'https://cdn.yibentushu.com') return 'unavailable';
            return session.page.evaluate(async () => {
                let token = localStorage.getItem('sample-apply-token');
                try { token = JSON.parse(token ?? 'null'); } catch { /* raw string */ }
                if (typeof token !== 'string' || !token) return 'expired' as const;
                try {
                    const r = await fetch('https://testapi.yibentushu.com/supply-api/getInfo', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
                    const data = await r.json();
                    return r.ok && data.code === 200 && data.user?.userId ? 'connected' as const : r.status === 401 || data.code === 401 ? 'expired' as const : 'unavailable' as const;
                } catch { return 'unavailable' as const; }
            });
        },
        async inspect(project, job, signal, onLogin) {
            const release = acquireDocumentPageLease(project.id);
            if (!release)
                throw new Error('这个模块的测试窗口正在被其他操作占用。');
            const profilePath = path.join(dataRoot, 'document-tests', 'browser-profiles', project.browserProfileIsolation ? `isolated-${project.id}` : project.id), profileOptions = { isolated: project.browserProfileIsolation === true, targetUrl: project.targetUrl };
            const session = await launchPersistentTestPage(profilePath, profileOptions).catch(error => { release(); throw error; });
            const policy = async (route: import('playwright').Route) => { const request = route.request(); const allowed = allowBrowserRequest(request.method(), request.url(), project.id, { targetOrigin: new URL(project.targetUrl).origin, resourceType: request.resourceType(), isNavigationRequest: request.isNavigationRequest(), isMainFrameNavigation: request.isNavigationRequest() && request.frame() === session.page.mainFrame(), authenticationPage: isAuthenticationRoute(session.page.url()) }); await (allowed ? route.continue() : route.abort('blockedbyclient')).catch(() => { }); };
            const abort = () => clearLoginHandoff(project.id);
            signal.addEventListener('abort', abort, { once: true });
            try {
                await session.page.route('**/*', policy);
                signal.throwIfAborted();
                // Opening/connecting must retain the authenticated document.
                // Per-case form reset belongs to the execution baseline, not
                // login: navigating through about:blank can strand the window
                // if the next navigation fails and loses in-memory app state.
                const navigationResult = await navigatePersistentPage(session.page, project.targetUrl);
                // A failed SPA bootstrap can leave the correct URL with an
                // empty shell. Retry that document once, not via a blank tab.
                if (navigationResult === 'reused' && !await session.page.locator('body').evaluate(el => !!el.textContent?.trim() || !!el.querySelector('iframe,input,button'))) {
                    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                }
                // Connecting can finish without waiting for a login page. Make
                // the managed Edge window visible in that path too; otherwise
                // the account is connected in the background and the user sees
                // no page after clicking “连接我的账号”.
                await bringBrowserToFront(session.browser, session.page);
                if (await isLoginPage(session.page))
                    await waitForUserLogin(project.id, job.id, project.targetUrl, session.browser, session.page, async (waiting) => onLogin(waiting));
                await waitForDepartmentFormBaseline(session.page, project.targetUrl);
                signal.throwIfAborted();
                if (new URL(session.page.url()).origin !== new URL(project.targetUrl).origin)
                    throw new Error('测试窗口没有进入目标网站，请完成登录后重试。');
                const customerFixtures = await loadDifyCustomerFixtures(dataRoot);
                const books = await loadDifyBookFixtures(dataRoot);
                const bookFixtureBaseline = books.length ? { schema: 1, source: 'supply.biz_book_info', weightUnit: 'g', capturedAt: new Date().toISOString(), books } : undefined;
                const bookCodeAliasConfirmed = project.cases.some(c => c.source.includes('输入物流编码（自编码/erp编码）'));
                const navigation: string[] = [];
                for (const name of ['历史申请记录', '订单物流'])
                    if (await session.page.getByText(name, { exact: true }).filter({ visible: true }).count() === 1)
                        navigation.push(name);
                const customerMatches: number[] = [];
                const combos = session.page.getByRole('combobox');
                for (let index = 0; index < await combos.count(); index++)
                    if (await combos.nth(index).evaluate(el => (el.closest('.home-form-item')?.querySelector('label')?.textContent ?? '').includes('费用划归客户')))
                        customerMatches.push(index);
                const customerSearchIndex = customerMatches.length === 1 ? customerMatches[0] : undefined;
                const regionSearchIndexes: number[] = [];
                for (let index = 0; index < await combos.count(); index++)
                    if (await combos.nth(index).evaluate(el => (el.closest('.home-form-item')?.querySelector('label')?.textContent ?? '').includes('所在地区')))
                        regionSearchIndexes.push(index);
                let bookCodeLabel: string | undefined;
                for (const name of ['自编码', '物流编码'])
                    if (await session.page.getByRole('columnheader', { name, exact: true }).count() === 1)
                        bookCodeLabel = name;
                const observed = await session.page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll('h1,h2,h3')].map(e => e.textContent?.trim()).filter(Boolean).slice(0, 30), controls: [...document.querySelectorAll('input,select,textarea,button,[role="button"],[class*="button"],[class*="btn"],a')].filter(e => e.getClientRects().length).slice(0, 120).map(e => { const el = e as HTMLInputElement; return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? (el.tagName === 'BUTTON' || el.matches('[class*="button"],[class*="btn"]') ? 'button' : el.tagName === 'A' ? 'link' : undefined), name: el.getAttribute('aria-label') ?? (el.labels?.[0]?.textContent ?? (el.tagName === 'BUTTON' || el.matches('[class*="button"],[class*="btn"]') ? el.textContent : ''))?.trim(), placeholder: el.getAttribute('placeholder') ?? undefined }; }), links: [...document.querySelectorAll('a')].map(e => e.textContent?.trim()).filter(Boolean).slice(0, 30) }));
                return JSON.stringify({ ...observed, navigation, customerSearchIndex, regionSearchIndexes, bookCodeLabel, bookCodeAliasConfirmed, customerFixtures, bookFixtureBaseline });
            }
            finally {
                signal.removeEventListener('abort', abort);
                await session.page.unroute('**/*', policy).catch(() => { });
                release();
            }
        },
        async author(project, item, evidence, proposal) {
            const grounded = draftGroundedReadOnlyBrowserSteps(item);
            if (grounded?.length)
                return grounded;
            return generateDocumentCaseSteps(project.targetUrl, { ...item, caseGenerationActions: proposal }, evidence);
        },
        async execute(project, runId, selected, onStage, onResult) {
            const session = await getExistingPersistentTestPage(path.join(dataRoot, 'document-tests', 'browser-profiles', project.browserProfileIsolation ? `isolated-${project.id}` : project.id), { isolated: project.browserProfileIsolation === true });
            const observer = session ? observeDifyReadOnlyResponses(session.page, project.targetUrl) : undefined;
            const bookObserver = session ? observeDifyBookResponses(session.page, project.targetUrl) : undefined;
            const saveEvidenceFor = async (id: string, png: Buffer) => { const name = createHash('sha256').update(id).digest('hex') + '.png'; const directory = path.join(dataRoot, 'document-tests', 'runs', runId, 'screenshots'); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, name), png); return name; };
            // Own evidence capture after all adapter assertions. The shared pre-hook
            // page.screenshot can stall a Windows compositor and block later checks.
            try {
                return await executeDocumentRun(project, { runId, runMode: 'regression', selectedCaseIds: selected, scopePlan: { mode: selected.length === 1 ? 'single' : 'custom', targetCaseIds: selected, impactCaseIds: [] }, captureEvidence: false, onStage: async (stage) => onStage?.(stage), onCasePrepared: async (source, page) => { await waitForDepartmentFormBaseline(page, project.targetUrl); await waitForDifyDeviceBaseline(page, source, project.targetUrl); await prepareFieldValidityBaseline(page, source, project.targetUrl, dataRoot); await prepareInvalidBook(page, source); await prepareClientValidation(page, source, project.targetUrl, dataRoot, png => saveEvidenceFor(source.id, png)); }, onCaseResult: async (result) => {
                        const saveEvidence = (png: Buffer) => saveEvidenceFor(result.id, png);
                        const source = project.cases.find(c => c.id === result.id);
                        const reads = await observer?.take(source ? departmentReadOnlyKind(source) : undefined, source?.steps.filter(s => s.action === 'fillByRoleIndex').at(-1)?.value) ?? [];
                        const bookReads = await bookObserver?.take(source) ?? [];
                        if (source && session)
                            await verifyDifyBookResult(session.page, source, result, bookReads).catch(() => {
                                if (result.status === 'passed') {
                                    result.status = 'blocked';
                                    result.detail = '图书完整断言尚未完成，未将子步骤通过当作业务通过。';
                                }
                            });
                        if (source && session)
                            await verifyDepartmentReadOnlyResult(session.page, source, result, reads).catch(() => {
                                if (result.status === 'passed') {
                                    result.status = 'blocked';
                                    result.detail = '本条只读补充证据采集未完成；保留未验证状态。';
                                }
                            });
                        if (source && session)
                            await verifyFieldValidityResult(session.page, source, result);
                        if (source && session)
                            await verifyInvalidBook(session.page, source, result);
                        if (source && session)
                            await verifyExcludedCustomer(session.page, source, result);
                        if (source && session)
                            verifyClientValidation(session.page, source, result);
                        if (source && session)
                            await verifyApplicantIdentity(session.page, source, result, project.targetUrl, saveEvidence);
                        if (source && session)
                            await verifyDifyDeviceResult(session.page, source, result, project.targetUrl, saveEvidence);
                        if (source && session)
                            await verifyDifyListResult(session.page, source, result, project.targetUrl, saveEvidence);
                        if (source && session)
                            await verifyEmployeeApplicationReadOnly(session.page, source, result, project.targetUrl, saveEvidence);
                        if (source && session)
                            await verifyDifyRecordResult(session.page, source, result, project.targetUrl, saveEvidence);
                        if (source && session)
                            await verifyConnectedEvidence(session.page, source, result, project.targetUrl, saveEvidence, undefined, () => readDepartmentCreationReceipts(dataRoot, project.id), () => readDepartmentCreationBaselines(dataRoot, project.id));
                        if (source && (needsDifyReadback(source) || fieldValidityKind(source)) && !session && result.status === 'passed') {
                            result.status = 'blocked';
                            result.detail = '缺少本轮页面与查询补充核验，不能只按子步骤判断通过。';
                        }
                        if (result.status === 'passed' && source?.expected === '必填未完成时提交按钮置灰不可点击') {
                            if (session)
                                await verifyDifyRequiredButtonAppearance(session.page, result, source.expected);
                            else {
                                result.status = 'blocked';
                                result.detail = '必填与禁用子检查完成，但缺少当前页面的置灰样式证据。';
                                delete result.evidence;
                            }
                        }
                        if (!source || !difyRecordKind(source) && !isApplicantIdentity(source) && !connectedEvidenceKind(source))
                            await captureMissingDifyFailureEvidence(dataRoot, project, runId, result, true, session?.page);
                        onResult?.(result);
                    } });
            }
            finally {
                observer?.close();
                bookObserver?.close();
            }
        },
        async cancel(projectId, runId) {
            clearLoginHandoff(projectId);
            if (runId)
                await cancelDocumentRun(runId);
        },
        async continueLogin(projectId) { await requestLoginContinue(projectId); },
    };
}
