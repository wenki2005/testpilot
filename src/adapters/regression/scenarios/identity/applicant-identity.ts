import type { Page } from 'playwright';
import { actionablePreconditions, type BrowserCheck } from '../../../documents/execution/workflow-facade.js';
import { captureDifyPng } from '../../evidence/module-evidence.js';
type Result = {
    status: string;
    detail: string;
    evidence?: string;
};
export function isApplicantIdentity(c: Pick<BrowserCheck, 'expected' | 'source'>) { return c.expected === '本人申请：申请人取当前企微登录人姓名与部门' && c.source.includes('申请人类型') && c.source.includes('表单带出对应申请人信息'); }
export function reviewApplicantIdentity(c: BrowserCheck, evidence: string, targetUrl?: string) {
    if (!isApplicantIdentity(c) || actionablePreconditions(c).length)
        return;
    let u: URL, p: {
        controls?: Array<{
            placeholder?: string;
        }>;
    };
    try {
        u = new URL(targetUrl ?? '');
        p = JSON.parse(evidence);
    }
    catch {
        return;
    }
    if (u.origin !== 'https://cdn.yibentushu.com' || !u.pathname.startsWith('/test-sample-apply/') || p.controls?.filter(c => c.placeholder === '请输入收件人姓名').length !== 1)
        return;
    return { kind: 'applicant-identity' as const, steps: [{ action: 'blurByLabel' as const, label: '收件人' }, { action: 'assertExactVisible' as const, text: '收货信息' }], detail: '只读审核：重新加载本人申请表单和本轮认证响应，兼容当前单一表单及历史本人切换入口；核对姓名、部门的身份基线与实际回显。' };
}
export async function verifyApplicantIdentity(page: Page, c: BrowserCheck, r: Result, target: string, save: (png: Buffer) => Promise<string>) {
    if (!isApplicantIdentity(c) || r.status !== 'passed')
        return;
    delete r.evidence;
    let mask: Awaited<ReturnType<Page['addStyleTag']>> | undefined;
    try {
        const u = new URL(target);
        if (u.origin !== 'https://cdn.yibentushu.com' || !u.pathname.startsWith('/test-sample-apply/'))
            throw Error('Blocked: 不是约定的申样系统。');
        u.hash = '/home';
        await page.goto('about:blank');
        const pending = page.waitForResponse(res => {
            try {
                const url = new URL(res.url());
                return res.request().method() === 'GET' && url.origin === 'https://testapi.yibentushu.com' && url.pathname === '/supply-api/getInfo';
            }
            catch {
                return false;
            }
        }, { timeout: 10000 }).then(async (res) => ({ ok: res.status() === 200, body: await res.json() })).catch(() => undefined);
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const identity = await pending;
        if (!identity?.ok || identity.body?.code !== 200 || !identity.body?.user)
            throw Error('Blocked: 本轮认证身份读取未成功。');
        const root = page.locator('.pc-page-home');
        await root.waitFor({ state: 'visible', timeout: 5000 });
        const self = root.locator('.header-nav li').filter({ hasText: /^\s*(?:本人申领|本人申请|本人)\s*$/ });
        const selfCount = await self.count();
        if (selfCount > 1)
            throw Error('Blocked: 本人申请入口未唯一定位。');
        if (selfCount === 1) {
            await self.click();
            if (!await self.evaluate(el => el.classList.contains('active')))
                throw Error('断言失败：点击本人申请后未进入本人选中状态。');
        }
        else {
            const recipient = root.getByPlaceholder('请输入收件人姓名', { exact: true });
            await recipient.first().waitFor({ state: 'visible', timeout: 5000 });
            if (await recipient.count() !== 1)
                throw Error('Blocked: 当前本人申请表单未唯一加载。');
        }
        const user = identity.body.user, name = typeof user.nickName === 'string' ? user.nickName.trim() : '', department = typeof user.deptName === 'string' ? user.deptName.trim() : typeof identity.body.deptName === 'string' ? identity.body.deptName.trim() : typeof user.dept?.deptName === 'string' ? user.dept.deptName.trim() : '';
        const missing = [...(!name ? ['姓名'] : []), ...(!department ? ['部门'] : [])];
        if (missing.length)
            throw Error('Blocked: 本轮认证接口成功且本人申请已选中，但认证响应缺少可对照的' + missing.join('、') + '，无法建立原预期的完整身份基线；需排查当前账号的组织资料/企微同步映射。未将登录成功或字段标题当通过。');
        const shown = await root.innerText();
        if (!shown.includes(name) || !shown.includes(department))
            throw Error('断言失败：本人申请已选中且本轮身份响应含姓名、部门，但申请表单未完整展示对应值。');
        r.status = 'blocked';
        r.detail = '本轮本人申请已选中，姓名和部门与认证响应页面对照一致；仍缺该账号对应企微身份的独立组织基线，无法证明认证响应本身映射正确，保留完整原预期为阻塞。';
    }
    catch (e) {
        const m = e instanceof Error ? e.message : '';
        r.status = m.startsWith('断言失败：') ? 'failed' : 'blocked';
        r.detail = /^(断言失败：|Blocked: )/.test(m) ? m.replace(/^Blocked: /, '') : '本人身份字段的本轮核验未完成，未计为通过。';
    }
    finally {
        try {
            mask = await page.addStyleTag({ content: '.pc-page-home{color:transparent!important}.pc-page-home *{color:transparent!important;text-shadow:none!important}.pc-page-home input{caret-color:transparent!important}' });
            r.evidence = await save(await captureDifyPng(page));
        }
        catch {
            r.detail += '；本轮脱敏页面截图未完成。';
        }
        await mask?.evaluate(el => el.parentNode?.removeChild(el)).catch(() => { });
    }
}
