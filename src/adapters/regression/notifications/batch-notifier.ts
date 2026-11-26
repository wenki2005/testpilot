import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { buildXlsx } from '../../reports/simple-xlsx.js';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { BatchView } from '../../../domain/regression/module-catalog-contract.js';
import type { DifyNotification } from '../../../domain/regression/notification-contract.js';
import { cloudSafe } from '../../integrations/dify/workflow-client.js';
type Payload = {
    msgtype: 'file';
    file: {
        media_id: string;
    };
} | {
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

const lanAddress = () => {
    try {
        for (const list of Object.values(networkInterfaces()))
            for (const item of list ?? [])
                if (item.family === 'IPv4' && !item.internal)
                    return item.address;
    }
    catch { /* ignore */ }
    return '127.0.0.1';
};
const publicBaseUrl = () => (process.env.TESTPILOT_PUBLIC_BASE_URL || `http://${lanAddress()}:4325`).replace(/\/+$/, '');
const shortReason = (value: unknown) => {
    let text = String(value ?? '');
    text = text.replace(/^断言失败[:：]\s*/, '').replace(/^失败[:：]\s*/, '').replace(/^阻塞[:：]\s*/, '');
    text = text.replace(/[；;]\s*(当前页|页面)=[^；;]*/g, '').replace(/[；;]\s*页内其他 iframe=[^；;]*/g, '').replace(/[；;]\s*frames=[^；;]*/g, '');
    return text.trim().slice(0, 40);
};
const readRepoWebhook = (root?: string) => { const candidates = [root ? path.join(root, 'wecom-webhook.txt') : '', path.join(process.cwd(), '.secrets', 'wecom-webhook.txt')].filter(Boolean); for (const file of candidates) { try { const value = readFileSync(file, 'utf8').trim(); if (value) return value; } catch { /* try next */ } } return undefined; };
/** Built-in fallback so a fresh checkout still notifies; local file or env var overrides it. */
const BUILTIN_WECOM_WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=dd56fe34-47b5-43f1-aac9-316f63fc44a1';
const resolveWebhook = (root?: string) => (process.env.TESTPILOT_DIFY_WECOM_WEBHOOK || '').trim() || readRepoWebhook(root) || BUILTIN_WECOM_WEBHOOK;
const displayCaseId = (id: string) => {
    const staged = /^xmind-(\d+)-(\d+)$/i.exec(id);
    if (staged) return `${Number(staged[1]!)}-${staged[2]!.padStart(3, '0')}`;
    const legacy = /^xmind-(\d+)$/i.exec(id);
    if (legacy) return legacy[1]!.padStart(3, '0');
    return String(id);
};
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
    constructor(private root: string, private webhook = () => resolveWebhook(root), private transport: Transport = send, private intervalMs = 3100) { }
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
    /** Text-only Excel attachment; screenshots stay on this machine. */
    private reportFile(batch: BatchView) {
        const label = { passed: '通过', failed: '失败', blocked: '阻塞', not_executed: '未执行', error: '异常', outside: '范围外' } as Record<string, string>;
        const rows: Array<Array<string | number>> = [
            ['TestPilot 回归报告'],
            ['系统', batch.systemName],
            ['账号', batch.accountName ?? '未记录'],
            ['开始', new Date(batch.createdAt).toLocaleString('zh-CN', { hour12: false })],
            ['结束', new Date(batch.updatedAt).toLocaleString('zh-CN', { hour12: false })],
            ['结果', `通过 ${batch.counts.passed} / 失败 ${batch.counts.failed} / 阻塞 ${batch.counts.blocked} / 未执行 ${batch.counts.not_executed}`],
            [],
            ['模块', '用例编号', '标题', '结果', '实际结果', '截图'],
        ];
        for (const job of batch.jobs)
            for (const result of job.results ?? [])
                rows.push([job.moduleName, displayCaseId(result.caseId), result.title, label[result.status] ?? result.status, String(result.detail ?? '').slice(0, 300), result.evidence ? '有' : '无']);
        const stamp = new Date(batch.createdAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const safe = batch.systemName.replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
        const name = `TestPilot_${safe}_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}.xlsx`;
        return { name, bytes: buildXlsx('用例明细', rows, [22, 18, 48, 10, 70, 8]) };
    }
    private async uploadReport(url: string, bytes: Uint8Array, name: string): Promise<string | undefined> {
        try {
            const key = new URL(url).searchParams.get('key');
            if (!key)
                return undefined;
            const form = new FormData();
            form.append('media', new Blob([bytes as unknown as BlobPart]), name);
            const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=${encodeURIComponent(key)}&type=file`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
            if (!response.ok)
                return undefined;
            const result = await response.json() as { media_id?: unknown };
            return typeof result.media_id === 'string' ? result.media_id : undefined;
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
        const failedRows = batch.jobs.flatMap(j => j.results.filter(r => !r.outOfScope && (r.status === 'failed' || r.status === 'error')).map(r => ({ job: j, row: r })));
        const blockedRows = batch.jobs.flatMap(j => j.results.filter(r => !r.outOfScope && r.status === 'blocked').map(r => ({ job: j, row: r })));
        const approvalNotice = (() => {
            for (const job of batch.jobs) for (const result of job.results ?? []) {
                const matched = /读取：(\{[^}]*\})/.exec(String(result.detail ?? ''));
                if (!matched) continue;
                try {
                    const captured = JSON.parse(matched[1] ?? '{}');
                    const applicationNo = captured.applicationNo;
                    const approver = captured.approver;
                    if (applicationNo) return { applicationNo, approver };
                } catch { }
            }
            return undefined;
        })();
        if (!record.items.length) {
            record.items.push({ id: 'summary', type: 'summary', status: 'pending', attempts: 0 });
            // 只发一条汇总消息；失败清单与截图在报告页查看。
        }
        record.status = 'sending';
        commit();
        let sentCount = 0;
        for (const item of record.items) {
            // 'sending' persisted by a crashed process is uncertain, never replay silently.
            if (item.status === 'sending') {
                item.status = 'uncertain';
                item.detail = '上次发送已启动但未确认，请先核对测试群；不自动重发。';
                commit();
            }
            if (!['pending', 'failed'].includes(item.status))
                continue;
            const scopeName = ({ core: '核心链路', custom: '自选用例', all: '全部用例', starter: '起步集合' } as Record<string, string>)[String(batch.scope ?? '')] ?? '回归';
            const started = Date.parse(batch.createdAt);
            const ended = Date.parse(batch.updatedAt);
            const seconds = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
            const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
            const file = this.reportFile(batch);
            const content = String(cloudSafe([
                '## 自动化测试',
                `系统：${batch.systemName.slice(0, 100)}`,
                `账号：${batch.accountName ?? '未记录'}`,
                `结果：通过 ${batch.counts.passed} · 失败 ${batch.counts.failed} · 阻塞 ${batch.counts.blocked} · 未执行 ${batch.counts.not_executed}`,
                `耗时：${duration}`,
                `失败用例：${failedRows.length ? failedRows.slice(0, 10).map(item => displayCaseId(item.row.caseId)).join('、') : '无'}`,
                `阻塞用例：${blockedRows.length ? blockedRows.slice(0, 10).map(item => displayCaseId(item.row.caseId)).join('、') : '无'}`,
                `报告：${file.name}（见附件）`,
                '截图：本机报告目录查看，群里不发图',
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
                if (status === 'sent' && item.type === 'summary' && !record.items.some(i => i.id === 'attachment')) {
                    const mediaId = await this.uploadReport(url, file.bytes, file.name);
                    const sentFile = mediaId ? await this.transport(url, { msgtype: 'file', file: { media_id: mediaId } }) : 'failed';
                    record.items.push({ id: 'attachment', type: 'file', status: sentFile, attempts: 1 });
                    commit();
                }
            }
            catch {
                status = 'uncertain';
            }
            this.lastSent = Date.now();
            sentCount++;
            item.status = status;
            if (sentCount > 0 && sentCount % 15 === 0)
                await new Promise(r => setTimeout(r, 60000));
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

/** 提交成功后立即发送一条审批提醒（不等整批结束）。 */
export async function sendApprovalNotice(root: string, content: string): Promise<boolean> {
    const url = difyNotificationWebhook(resolveWebhook(root));
    if (!url)
        return false;
    try {
        return await send(url, { msgtype: 'markdown', markdown: { content } }) === 'sent';
    }
    catch {
        return false;
    }
}
