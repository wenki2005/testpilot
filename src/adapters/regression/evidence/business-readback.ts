import type { Page, Response } from 'playwright';
export type DepartmentBusinessFact = {
    kind: 'book' | 'customer';
    observedAt: string;
    requestKey: string;
    availableFields: string[];
    fields: Record<string, string | number>;
};
/** Passive evidence from the supplied department application's two read APIs.
 * Never sends a request or retains request headers, cookies or whole responses. */
export function observeDepartmentBusinessEvidence(page: Page, targetUrl: string) {
    const target = new URL(targetUrl), facts: DepartmentBusinessFact[] = [], pending = new Set<Promise<void>>();
    const enabled = target.hostname === 'cdn.yibentushu.com' && target.pathname.startsWith('/test-sample-apply/');
    const handle = async (response: Response) => {
        if (!enabled || facts.length >= 30 || response.request().method() !== 'GET' || !response.ok())
            return;
        const url = new URL(response.url());
        if (url.origin !== 'https://testapi.yibentushu.com')
            return;
        const kind = url.pathname === '/supply-api/dept/book/apply/bookCheck' ? 'book' : url.pathname === '/supply-api/dept/book/apply/clientSearch' ? 'customer' : undefined;
        if (!kind)
            return;
        const requestKey = url.searchParams.get(kind === 'book' ? 'productId' : 'keyword') ?? '';
        if (kind === 'book' ? !/^202260004[67]$/u.test(requestKey) : requestKey !== '北京')
            return;
        const body = await response.json().catch(() => undefined);
        if (body?.code !== 200)
            return;
        const candidates = Array.isArray(body.data) ? body.data : [body.data];
        for (const item of candidates.slice(0, 30)) {
            if (!item || typeof item !== 'object' || Array.isArray(item))
                continue;
            if (kind === 'customer' && (typeof item.agentName !== 'string' || !item.agentName.startsWith('海御天成（北京）文化发展有限公司')))
                continue;
            const allowed = kind === 'book' ? /^(?:productId|bookName|pubname|pubName|hprice|price|weight)$/u : /^(?:agentId|agentName|agentType|agentClass|agentClassId|classId|classCode|className|category|categoryCode|categoryName|agentCategory|agentCategoryId|agentCategoryCode)$/u;
            const fields = Object.fromEntries(Object.entries(item).filter(([key, value]) => allowed.test(key) && (typeof value === 'number' || typeof value === 'string' && value.length <= 200))) as Record<string, string | number>;
            facts.push({ kind, observedAt: new Date().toISOString(), requestKey, availableFields: Object.keys(item).filter(key => /^[A-Za-z_]{1,40}$/u.test(key)).slice(0, 40), fields });
        }
    };
    const listener = (response: Response) => { const work = handle(response).catch(() => undefined); pending.add(work); void work.finally(() => pending.delete(work)); };
    page.on('response', listener);
    return { async finish() { page.off('response', listener); await Promise.allSettled([...pending]); return facts; } };
}
