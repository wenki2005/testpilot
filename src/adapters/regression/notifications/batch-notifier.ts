import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BatchView } from '../../../domain/regression/module-catalog-contract.js';
import type { DifyNotification } from '../../../domain/regression/notification-contract.js';
import { cloudSafe } from '../../integrations/dify/workflow-client.js';
type Payload = {
    msgtype: 'markdown';
    markdown: {
        content: string;
    };
} | {
    msgtype: 'image';
    image: {
        base64: string;
        md5: string;
    };
};
type Transport = (url: string, payload: Payload) => Promise<'sent' | 'failed' | 'uncertain'>;
const readRepoWebhook = (root?: string) => { const candidates = [root ? path.join(root, 'wecom-webhook.txt') : '', path.join(process.cwd(), '.secrets', 'wecom-webhook.txt')].filter(Boolean); for (const file of candidates) { try { const value = readFileSync(file, 'utf8').trim(); if (value) return value; } catch { /* try next */ } } return undefined; };
const timestamp = () => new Date().toISOString();
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function difyNotificationWebhook(value: string | undefined): string | undefined {
    if (!value)
        return undefined;
    try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || u.hostname !== 'qyapi.weixin.qq.com' || u.port || u.username || u.password || u.hash || u.pathname !== '/cgi-bin/webhook/send' || [...u.searchParams.keys()].some(k => k !== 'key') || u.searchParams.getAll('key').length !== 1 || !/^[-A-Za-z0-9_]{10,160}$/.test(u.searchParams.get('key') ?? ''))
            return undefined;
        return u.href;
    }
    catch {
        return undefined;
    }
}
/** No redirects, URL logging, response text or implicit network retries. */
async function send(url: string, payload: Payload): Promise<'sent' | 'failed' | 'uncertain'> {
    try {
        const r = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
        if (!r.ok)
            return r.status >= 500 ? 'uncertain' : 'failed';
        const result = await r.json() as {
            errcode?: unknown;
        };
        return result.errcode === 0 ? 'sent' : typeof result.errcode === 'number' ? 'failed' : 'uncertain';
    }
    catch {
        return 'uncertain';
    }
}
/** Dify-only notification queue. Existing tests and other regression entries never use it. */
export class DifyBatchNotifier {
    private queue = Promise.resolve();
    private lastSent = 0;
    constructor(private root: string, private webhook = () => (process.env.TESTPILOT_DIFY_WECOM_WEBHOOK || '').trim() || readRepoWebhook(root), private transport: Transport = send, private intervalMs = 3100) { }
    configured() { return !!difyNotificationWebhook(this.webhook()); }
    deliver(batch: BatchView, previous: DifyNotification | undefined, save: (record: DifyNotification) => void): Promise<DifyNotification> {
        const result = this.queue.then(() => this.deliverNow(batch, previous, save));
        this.queue = result.then(() => { }, () => { });
        return result;
    }
    private async image(batch: BatchView, itemId: string): Promise<Payload | undefined> {
        const candidates = batch.jobs.flatMap(j => j.results.filter(r => r.status === 'failed' || r.status === 'error').map(r => ({ job: j, row: r, id: `image:${j.id}:${r.caseId}` })));
        const found = candidates.find(v => v.id === itemId);
        if (!found?.row.evidence || !found.job.documentRunId)
            return undefined;
        if (!/^[0-9a-f-]{36}$/i.test(found.job.documentRunId) || !/^[-A-Za-z0-9_.]+\.png$/i.test(found.row.evidence))
            return undefined;
        try {
            const dir = path.resolve(this.root, 'document-tests', 'runs', found.job.documentRunId, 'screenshots');
            const base = await realpath(this.root);
            const allowed = await realpath(dir);
            const relative = path.relative(base, allowed);
            if (relative.startsWith('..') || path.isAbsolute(relative))
                return undefined;
            const file = await realpath(path.join(dir, found.row.evidence));
            if (path.dirname(file) !== allowed || (await stat(file)).size > 2 * 1024 * 1024)
                return undefined;
            const bytes = await readFile(file);
            if (bytes.length > 2 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                return undefined;
            return { msgtype: 'image', image: { base64: bytes.toString('base64'), md5: createHash('md5').update(bytes).digest('hex') } };
        }
        catch {
            return undefined;
        }
    }
    private async deliverNow(batch: BatchView, previous: DifyNotification | undefined, save: (record: DifyNotification) => void) {
        const record = previous ? structuredClone(previous) : { status: 'disabled' as const, updatedAt: timestamp(), items: [] } as DifyNotification;
        const commit = () => { record.updatedAt = timestamp(); save(structuredClone(record)); };
        const url = difyNotificationWebhook(this.webhook());
        if (!url) {
            if (!record.items.length) {
                record.status = 'disabled';
                commit();
            }
            return record;
        }
        if (!record.items.length) {
            record.items.push({ id: 'summary', type: 'summary', status: 'pending', attempts: 0 });
            if (batch.notifyScreenshots)
                for (const j of batch.jobs)
                    for (const r of j.results.filter(r => !r.outOfScope && (r.status === 'failed' || r.status === 'error')).slice(0, 3)) {
                        if (record.items.filter(i => i.type === 'image').length >= 3)
                            break;
                        record.items.push({ id: `image:${j.id}:${r.caseId}`, type: 'image', status: r.evidence ? 'pending' : 'skipped', attempts: 0, ...(!r.evidence ? { detail: '本轮没有该项截图；未用其他轮截图替代。' } : {}) });
                    }
        }
        record.status = 'sending';
        commit();
        for (const item of record.items) {
            // 'sending' persisted by a crashed process is uncertain, never replay silently.
            if (item.status === 'sending') {
                item.status = 'uncertain';
                item.detail = '上次发送已启动但未确认，请先核对测试群；不自动重发。';
                commit();
            }
            if (!['pending', 'failed'].includes(item.status))
                continue;
            const failed = batch.jobs.flatMap(j => j.results.filter(r => !r.outOfScope && (r.status === 'failed' || r.status === 'error'))).slice(0, 8);
            const scopeName = ({ core: '核心链路', custom: '自选用例', all: '全部用例', starter: '起步集合' } as Record<string, string>)[String(batch.scope ?? '')] ?? '回归';
            const content = String(cloudSafe([
                '## TestPilot 回归完成',
                `系统：${batch.systemName.slice(0, 100)}`,
                `范围：${scopeName}`,
                `结果：通过 ${batch.counts.passed} · 失败 ${batch.counts.failed} · 阻塞 ${batch.counts.blocked} · 未执行 ${batch.counts.not_executed}`,
                failed.length ? `失败用例：\n${failed.map(r => `- ${r.caseId}｜${String(r.detail ?? '').slice(0, 40)}`).join('\n')}` : '本轮无失败',
                '详情：http://127.0.0.1:4325/dify/?page=run-reports'
            ].join('\n')));
            const payload: Payload | undefined = item.type === 'summary' ? { msgtype: 'markdown', markdown: { content } } : await this.image(batch, item.id);
            if (!payload) {
                item.status = 'skipped';
                item.detail = '本轮截图缺失、格式不支持、超出大小或路径无效；未发送图片。';
                commit();
                continue;
            }
            const hash = digest(payload);
            if (item.payloadDigest && item.payloadDigest !== hash) {
                item.status = 'uncertain';
                item.detail = '本轮通知内容已变化，未覆盖旧发送记录；请新建回归。';
                commit();
                continue;
            }
            item.payloadDigest = hash;
            item.status = 'sending';
            item.attempts++;
            delete item.detail;
            commit();
            const wait = Math.max(0, this.lastSent + this.intervalMs - Date.now());
            if (wait)
                await new Promise(r => setTimeout(r, wait));
            let status: 'sent' | 'failed' | 'uncertain';
            try {
                status = await this.transport(url, payload);
            }
            catch {
                status = 'uncertain';
            }
            this.lastSent = Date.now();
            item.status = status;
            if (status === 'failed')
                item.detail = '接收端明确拒绝；可以重试通知，不会重跑网页。';
            if (status === 'uncertain')
                item.detail = '未确认接收结果，请先核对测试群；不自动重复发送。';
            commit();
        }
        record.status = record.items.every(i => i.status === 'sent') ? 'sent' : record.items.some(i => i.status === 'uncertain') ? 'uncertain' : record.items.some(i => i.status === 'sent') ? 'partial' : 'failed';
        commit();
        return record;
    }
}
