import type { RegressionBatch } from './module-catalog-contract.js';
/** Portable names for Windows/macOS/Linux. Never use user-supplied path or
 * shell punctuation; the original business name remains in the manifest. */
export function difyScriptName(value: string, limit = 32): string {
    const clean = value.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M}._-]+/gu, '_').replace(/_+/g, '_').replace(/^[. _-]+|[. _-]+$/g, '');
    const name = Array.from(clean || '未命名').slice(0, limit).join('').replace(/[. ]+$/g, '');
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' + name : name;
}
export function difyScriptArchiveName(batch: Pick<RegressionBatch, 'id' | 'systemName' | 'createdAt'>): string {
    const time = new Date(batch.createdAt);
    const parts = Number.isNaN(time.getTime()) ? undefined : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(time);
    const part = (type: string) => parts?.find(item => item.type === type)?.value ?? '';
    const stamp = parts ? `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}${part('second')}` : '时间未记录';
    return `Dify_${difyScriptName(batch.systemName, 24)}_固定脚本_${stamp}_${difyScriptName(batch.id, 8)}.zip`;
}
