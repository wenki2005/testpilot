type Row = Record<string, any>;
export type AdminFilterKind = 'admin-filter-usage' | 'admin-filter-customer' | 'admin-filter-delivery' | 'admin-filter-identifiers';
/** API sub-check only. The caller must retain the separate management-page requirement. */
export async function auditAdminFilters(kind: AdminFilterKind, rows: Row[], parameters: string[], read: (query: URLSearchParams) => Promise<{ rows?: Row[]; total?: number }>) {
    if (!rows.length || new Set(rows.map(r => String(r.orderId))).size !== rows.length) throw Error('Blocked: 管理订单基线不完整。');
    const fields = kind === 'admin-filter-usage' ? ['bookUsage'] : kind === 'admin-filter-customer' ? ['costClientId'] : kind === 'admin-filter-delivery' ? ['deliveryWay'] : ['logisticsNo', 'spId'];
    let checked = 0; const mismatches: string[] = [];
    for (const field of fields) {
        if (!parameters.includes(field)) throw Error('Blocked: 本轮OpenAPI未确认筛选参数' + field + '。');
        const values = [...new Set(rows.map(r => String(r[field] ?? '')).filter(Boolean))];
        if (!values.length || values.length > 100) throw Error('Blocked: ' + field + '缺完整筛选样本。');
        if (field === 'bookUsage' && !['1', '2'].every(v => values.includes(v))) throw Error('Blocked: 需同时有营销和产品样本。');
        for (const value of values) {
            if (['spId', 'logisticsNo'].includes(field) && values.some(other => other !== value && other.includes(value))) throw Error('Blocked: 当前编号样本的精确/模糊匹配有歧义。');
            const query = new URLSearchParams({ pageNum: '1', pageSize: '100', [field]: value });
            const actual = await read(query), expected = rows.filter(r => String(r[field] ?? '') === value).map(r => String(r.orderId)).sort();
            if (!Array.isArray(actual.rows) || actual.rows.length !== Number(actual.total) || new Set(actual.rows.map(r => String(r.orderId))).size !== actual.rows.length) throw Error('Blocked: 筛选响应未完整分页或唯一。');
            const ids = actual.rows.map(r => String(r.orderId)).sort();
            if (JSON.stringify(ids) !== JSON.stringify(expected)) mismatches.push(field);
            checked++;
        }
    }
    return { queries: checked, fields, mismatches, detail: '已按本轮OpenAPI确认的参数，对稳定完整订单基线完成' + checked + '次筛选与订单集合对照。' };
}
