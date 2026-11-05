import { readFile } from 'node:fs/promises';
import path from 'node:path';
export type DifyCustomerFixture = {
    code: string;
    category: '1004.00' | '1004.06';
};
/** Local baseline contains codes/classification only, never credentials or customer names. */
export function validateDifyCustomerFixtures(value: unknown, now = Date.now()): DifyCustomerFixture[] {
    const v = value as {
        schema?: number;
        source?: string;
        capturedAt?: string;
        customers?: DifyCustomerFixture[];
    };
    const time = Date.parse(v?.capturedAt ?? '');
    if (v?.schema !== 1 || v.source !== 'supply.biz_agent_info' || !Number.isFinite(time) || time > now + 60000 || now - time > 7 * 86400000 || !Array.isArray(v.customers) || v.customers.length > 10)
        return [];
    if (v.customers.some(c => !c || !/^(?:\d{4}CL\d{12}|\d{2}-\d{5})$/.test(c.code) || !['1004.00', '1004.06'].includes(c.category)) || new Set(v.customers.map(c => c.code)).size !== v.customers.length)
        return [];
    return v.customers.map(c => ({ code: c.code, category: c.category }));
}
export async function loadDifyCustomerFixtures(dataRoot: string) {
    try {
        return validateDifyCustomerFixtures(JSON.parse(await readFile(path.join(dataRoot, 'dify-web-modules', 'readonly-fixtures.json'), 'utf8')));
    }
    catch {
        return [];
    }
}
