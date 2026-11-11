/** 结果实际结果统一口径：结论 + 一句事实，控制在 46 字内。 */
const MAX = 40;
export function briefDetail(status: string, raw: string): string {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return status === 'passed' ? '通过' : '';
    if (status === 'passed') return '通过：断言全部成立';
    let body = text;
    body = body.replace(/^断言失败[:：]\s*/, '');
    body = body.replace(/^Blocked[:：]\s*/, '');
    body = body.replace(/^故障[:：]\s*/, '');
    body = body.replace(/^没有完全匹配的可见文本[:：]\s*/, '未见文案：');
    body = body.replace(/^期望可见文本未出现在页面或嵌入 frame[:：]\s*/, '页面未见：');
    body = body.replace(/^观察窗口内出现 (\d+) 个 fetch\/XHR 请求.*$/, '发出了 $1 个请求（应拦截）');
    body = body.replace(/^字段「(.+?)」尚无可见无效状态.*$/, '字段「$1」无无效状态');
    body = body.replace(/本轮数据库排查[:：].*$/, '');
    body = body.replace(/执行路径[:：].*$/, '');
    body = (body.split(/[。；\n]/)[0] ?? '').trim();
    const prefix = status === 'failed' ? '失败：' : status === 'blocked' ? '阻塞：' : '';
    const room = MAX - prefix.length;
    if (body.length > room) body = body.slice(0, room - 1) + '…';
    return prefix + (body || (status === 'failed' ? '断言不成立' : '条件不足'));
}
