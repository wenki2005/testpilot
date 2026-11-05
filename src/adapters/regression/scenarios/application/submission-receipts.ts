import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export async function readDepartmentCreationReceipts(root: string, profileId: string) {
    const result = new Set<string>(), folder = path.join(root, 'dify-web-modules', 'authorized-writes');
    let files: string[];
    try {
        files = await readdir(folder);
    }
    catch {
        files = [];
    }
    const journals = files.filter(f => /^[a-f0-9-]{36}\.json$/i.test(f));
    if (journals.length > 200)
        throw Error('Blocked: 创建记录超出本轮核验上限，未静默截断。');
    for (const file of journals) {
        const log = JSON.parse(await readFile(path.join(folder, file), 'utf8')) as {
            schema?: number;
            profileId?: string;
            jobId?: string;
            attempts?: Array<{
                phase?: string;
                applyNo?: string;
            }>;
        };
        if (log.schema !== 1 || log.profileId !== profileId || file !== log.jobId + '.json')
            continue;
        for (const attempt of log.attempts ?? [])
            if (attempt.phase === 'passed' && /^\d{12}$/.test(attempt.applyNo ?? ''))
                result.add(attempt.applyNo!);
    }
    // Authorized API tasks also create real applications outside Dify job runs.
    // Keep their own receipt type rather than fabricating a Dify job journal.
    const external = path.join(root, 'dify-web-modules', 'business-creation-receipts');
    let receipts: string[];
    try {
        receipts = await readdir(external);
    }
    catch {
        return result;
    }
    const manifests = receipts.filter(f => /^[a-f0-9-]{36}\.json$/i.test(f));
    if (manifests.length > 100)
        throw Error('Blocked: 独立业务创建收据超过核验范围。');
    for (const file of manifests) {
        const receipt = JSON.parse(await readFile(path.join(external, file), 'utf8'));
        if (receipt.schema !== 2 || receipt.origin !== 'authorized-business-api' || receipt.profileId !== profileId || file !== receipt.taskId + '.json' || receipt.targetUrl !== 'https://cdn.yibentushu.com/test-sample-apply/index.html#/home')
            continue;
        if (receipt.source?.file !== receipt.taskId + '.source.json' || !/^\w{64}$/.test(receipt.source?.sha256 ?? ''))
            continue;
        const source = await readFile(path.join(external, receipt.source.file));
        if (createHash('sha256').update(source).digest('hex') !== receipt.source.sha256)
            throw Error('Blocked: 独立业务创建收据来源摘要不一致。');
        const journal = JSON.parse(source.toString('utf8'));
        if (journal.schema !== 1 || journal.taskId !== receipt.taskId || !Array.isArray(journal.samples))
            continue;
        if (!Array.isArray(receipt.applications) || receipt.applications.length > 20)
            continue;
        for (const a of receipt.applications) {
            const s = journal.samples.find((s: any) => s.applyNo === a.applyNo);
            if (!/^\d{12}$/.test(a.applyNo ?? '') || a.verified !== true || !s || s.phase !== 'verified' || !String(s.recipient ?? '').startsWith('TP') || !String(s.recipient).endsWith('勿发货'))
                continue;
            if (s.response?.http !== 200 || s.response?.code !== 200 || s.response?.applyNo !== a.applyNo || !s.reservedAt || !s.verifiedAt || s.databaseChecks?.oneMaster !== true || !(s.databaseChecks?.templatePresent === true || s.databaseChecks?.approvalReferences === true))
                continue;
            const checks = a.readback;
            if (!checks || !['singleApplication', 'sameOwner', 'markedRecipient', 'goodsMatch', 'amountMatch', 'weightMatch', 'templateMatch'].every(k => checks[k] === true))
                continue;
            result.add(a.applyNo);
        }
    }
    return result;
}
export type DepartmentCreationBaseline = {
    applyNo: string;
    verifiedAt: string;
    approvalStatus: 0;
    lockStatus: 0;
    orderPresent: false;
    quantity?: number;
    usage?: number;
};
/** Read the historical pending/no-order observation from an intact submission
 * receipt, rather than reconstructing the past from the current DB state. */
export async function readDepartmentCreationBaselines(root: string, profileId: string): Promise<DepartmentCreationBaseline[]> {
    const trusted = await readDepartmentCreationReceipts(root, profileId), folder = path.join(root, 'dify-web-modules', 'business-creation-receipts'), out: DepartmentCreationBaseline[] = [];
    let files: string[];
    try {
        files = await readdir(folder);
    }
    catch {
        return out;
    }
    for (const file of files.filter(f => /^[a-f0-9-]{36}\.json$/i.test(f))) {
        const receipt = JSON.parse(await readFile(path.join(folder, file), 'utf8'));
        if (receipt.schema !== 2 || receipt.origin !== 'authorized-business-api' || receipt.profileId !== profileId || file !== receipt.taskId + '.json' || receipt.targetUrl !== 'https://cdn.yibentushu.com/test-sample-apply/index.html#/home' || receipt.source?.file !== receipt.taskId + '.source.json')
            continue;
        const raw = await readFile(path.join(folder, receipt.source.file));
        if (createHash('sha256').update(raw).digest('hex') !== receipt.source.sha256)
            throw Error('Blocked: 独立业务创建收据来源摘要不一致。');
        const journal = JSON.parse(raw.toString('utf8'));
        if (journal.schema !== 1 || journal.taskId !== receipt.taskId || !Array.isArray(journal.samples) || !Array.isArray(receipt.applications))
            continue;
        for (const s of journal.samples) {
            if (!trusted.has(s.applyNo) || !receipt.applications.some((a: any) => a.applyNo === s.applyNo && a.verified === true) || s.phase !== 'verified' || s.approvalStatus !== 0 || s.lockStatus !== 0 || s.orderNo !== null || !Number.isFinite(Date.parse(s.verifiedAt)))
                continue;
            out.push({ applyNo: s.applyNo, verifiedAt: s.verifiedAt, approvalStatus: 0, lockStatus: 0, orderPresent: false, ...(Number.isInteger(s.quantity) ? { quantity: s.quantity } : {}), ...(Number.isInteger(s.usage) ? { usage: s.usage } : {}) });
        }
    }
    return [...new Map(out.map(v => [v.applyNo, v])).values()];
}
