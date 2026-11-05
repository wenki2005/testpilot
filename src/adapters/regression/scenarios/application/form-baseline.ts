import type { Page } from 'playwright';
/** The known app mounts asynchronously after DOMContentLoaded. Wait for
 * controls, without treating the wait itself as any business assertion. */
export async function waitForDepartmentFormBaseline(page: Page, targetUrl: string, timeout = 15000) {
    let u: URL, current: URL;
    try {
        u = new URL(targetUrl);
        current = new URL(page.url());
    }
    catch {
        return;
    }
    if (u.origin !== 'https://cdn.yibentushu.com' || u.pathname !== '/test-sample-apply/index.html' || current.origin !== u.origin || current.pathname !== u.pathname || current.hash.split('?')[0] !== '#/home')
        return;
    try {
        await page.waitForFunction(() => {
            const root = document.querySelector('.pc-page-home'), visible = (e: Element) => !!e.getClientRects().length;
            return !!root && visible(root) && [...root.querySelectorAll('input')].filter(e => e.placeholder === '请输入收件人姓名' && visible(e)).length === 1 && [...root.querySelectorAll('input')].filter(e => e.placeholder === '请输入手机号码' && visible(e)).length === 1;
        }, undefined, { timeout });
    }
    catch {
        throw Error('Blocked: 部门申样申请表单未在限定时间内完成渲染，未把加载中的页面当业务断言失败。');
    }
}
