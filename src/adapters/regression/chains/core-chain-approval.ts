import path from 'node:path';
import type { Page } from 'playwright';
import { acquireDocumentPageLease } from '../../documents/execution/workflow-facade.js';
import { getExistingPersistentTestPage } from '../../browser/browser-runtime.js';
/**
 * 提交成功后的只读审批等待：每 30 秒检查同一申请编号的审批进度，最多 10 次。
 * 检查方式是在既有登录页面里发一个只读 GET（审批进度接口）：不导航、不点击、
 * 不拦截写请求，也不重放提交用例——等待期间用户仍可以在同一个测试窗口里正常
 * 操作（例如撤回这条申请），自动化不会把人的操作挡掉。
 */
export type ApprovalState = 'approved' | 'cancelled' | 'rejected' | 'pending' | 'unknown' | 'timeout';
export type ApprovalObservation = {
    state: ApprovalState;
    detail: string;
    at: string;
};
export const approvalPollMs = 30000;
export const approvalPollAttempts = 10;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted)
        return reject(new Error('cancelled by user'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(new Error('cancelled by user')); }
    signal.addEventListener('abort', onAbort, { once: true });
});
/** 进度接口的 examineStatus：0 待审批 / 1 已通过 / 2 已驳回 / 3 已取消。 */
export function classifyExamineStatus(status: unknown, description: string): ApprovalObservation {
    const at = new Date().toISOString(), text = description.trim().replace(/\s+/g, ' ');
    if (Number(status) === 3)
        return { state: 'cancelled', detail: text || '已取消', at };
    if (Number(status) === 2)
        return { state: 'rejected', detail: text || '已驳回', at };
    if (Number(status) === 1)
        return { state: 'approved', detail: text || '已通过', at };
    if (Number(status) === 0)
        return { state: 'pending', detail: text || '待审批', at };
    return { state: 'unknown', detail: text || '进度接口未返回可识别状态', at };
}
type Progress = {
    http: number;
    body: {
        code?: number;
        data?: Record<string, unknown>;
    };
} | null;
const readProgress = (page: Page, applyNo: string) => page.evaluate(async (no: string): Promise<Progress> => {
    if (location.origin !== 'https://cdn.yibentushu.com')
        return null;
    let token: unknown = localStorage.getItem('sample-apply-token');
    try {
        token = JSON.parse(String(token ?? 'null'));
    }
    catch { /* 原始字符串 */ }
    if (typeof token !== 'string' || !token)
        return null;
    const response = await fetch('https://testapi.yibentushu.com/supply-api/dept/book/apply/progress/' + encodeURIComponent(no), { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(12000) });
    return { http: response.status, body: await response.json() };
}, applyNo).catch(() => null);
async function observeByProgress(page: Page, applyNo: string): Promise<ApprovalObservation | undefined> {
    const progress = await readProgress(page, applyNo);
    if (!progress || progress.http !== 200 || progress.body?.code !== 200 || !progress.body.data)
        return undefined;
    const data = progress.body.data as { examineStatus?: unknown; applyNo?: unknown; timeline?: Array<{ node?: unknown; desc?: unknown }> };
    if (String(data.applyNo ?? '') !== applyNo)
        return undefined;
    const nodes = Array.isArray(data.timeline) ? data.timeline : [];
    const last = nodes.at(-1);
    const description = [last?.node, last?.desc].filter(item => typeof item === 'string' && item).join(' ') || '申请编号 ' + applyNo;
    return classifyExamineStatus(data.examineStatus, description);
}
async function acquireLease(profileId: string, signal: AbortSignal) {
    const deadline = Date.now() + 60000;
    for (;;) {
        const release = acquireDocumentPageLease(profileId);
        if (release)
            return release;
        if (Date.now() > deadline || signal.aborted)
            return undefined;
        await sleep(2000, signal);
    }
}
export async function waitForApproval(input: {
    applicationNo: string;
    profileId: string;
    dataRoot: string;
    targetUrl: string;
    signal: AbortSignal;
    onProgress: (message: string) => void;
    pollMs?: number;
    attempts?: number;
}): Promise<ApprovalObservation> {
    const pollMs = input.pollMs ?? approvalPollMs, attempts = input.attempts ?? approvalPollAttempts;
    const release = await acquireLease(input.profileId, input.signal);
    if (!release)
        return { state: 'unknown', detail: '测试窗口被其他操作占用，未取得只读审批状态。', at: new Date().toISOString() };
    try {
        const session = await getExistingPersistentTestPage(path.join(input.dataRoot, 'document-tests', 'browser-profiles', 'isolated-' + input.profileId), { isolated: true });
        if (!session)
            return { state: 'unknown', detail: '当前账号测试窗口不可用，未取得只读审批状态。', at: new Date().toISOString() };
        const page = session.page;
        let last: ApprovalObservation = { state: 'unknown', detail: '尚未检查。', at: new Date().toISOString() };
        for (let attempt = 1; attempt <= attempts; attempt++) {
            await sleep(pollMs, input.signal);
            input.signal.throwIfAborted();
            let observed: ApprovalObservation | undefined;
            try {
                observed = await observeByProgress(page, input.applicationNo);
            }
            catch (error) {
                if (input.signal.aborted)
                    throw error;
                observed = { state: 'unknown', detail: '第 ' + attempt + ' 次只读检查未取得审批状态：' + (error instanceof Error ? error.message : '未知错误'), at: new Date().toISOString() };
            }
            last = observed ?? { state: 'unknown', detail: '第 ' + attempt + ' 次只读检查未取得审批状态。', at: new Date().toISOString() };
            input.onProgress('审批等待：第 ' + attempt + '/' + attempts + ' 次只读检查，' + (last.state === 'pending' ? '仍待审批' : last.state === 'unknown' ? '状态未识别' : last.detail));
            if (last.state === 'approved' || last.state === 'cancelled' || last.state === 'rejected')
                return last;
        }
        return { state: 'timeout', detail: '审批等待超时（5 分钟）：已按每 ' + Math.round(pollMs / 1000) + ' 秒只读检查 ' + attempts + ' 次，最后一次：' + last.detail, at: new Date().toISOString() };
    }
    finally {
        release();
    }
}
