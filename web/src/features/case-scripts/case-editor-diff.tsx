import { useMemo } from 'react';
import type { CaseDependency, EditableCase } from '../../../../src/domain/cases/case-script-contract';
export type CaseEditorFields = {
    title: string;
    expected: string;
    manual: string;
    prerequisites: CaseDependency[];
    script: string;
};
export type CaseDiffTab = 'case' | 'script';
type Line = {
    text: string;
    number: number;
};
type Row = {
    before?: Line;
    after?: Line;
    changed: boolean;
};
/** Align actual editor text. Bound the LCS allocation for large pasted scripts. */
function lineRows(before: string, after: string): Row[] {
    const a = before.split('\n'), b = after.split('\n');
    let prefix = 0, suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
        prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix])
        suffix++;
    const result: Row[] = Array.from({ length: prefix }, (_, i) => ({ before: { text: a[i], number: i + 1 }, after: { text: b[i], number: i + 1 }, changed: false }));
    const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
    let removed: Line[] = [], added: Line[] = [];
    const flush = () => {
        for (let i = 0; i < Math.max(removed.length, added.length); i++)
            result.push({ before: removed[i], after: added[i], changed: true });
        removed = [];
        added = [];
    };
    if (n * m <= 250000) {
        const stride = m + 1, table = new Uint32Array((n + 1) * stride);
        for (let i = n - 1; i >= 0; i--)
            for (let j = m - 1; j >= 0; j--)
                table[i * stride + j] = a[prefix + i] === b[prefix + j] ? 1 + table[(i + 1) * stride + j + 1] : Math.max(table[(i + 1) * stride + j], table[i * stride + j + 1]);
        let i = 0, j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && a[prefix + i] === b[prefix + j]) {
                flush();
                result.push({ before: { text: a[prefix + i], number: prefix + i + 1 }, after: { text: b[prefix + j], number: prefix + j + 1 }, changed: false });
                i++;
                j++;
            }
            else if (i < n && (j === m || table[(i + 1) * stride + j] >= table[i * stride + j + 1])) {
                removed.push({ text: a[prefix + i], number: prefix + i + 1 });
                i++;
            }
            else {
                added.push({ text: b[prefix + j], number: prefix + j + 1 });
                j++;
            }
        }
    }
    else {
        removed = a.slice(prefix, a.length - suffix).map((text, i) => ({ text, number: prefix + i + 1 }));
        added = b.slice(prefix, b.length - suffix).map((text, i) => ({ text, number: prefix + i + 1 }));
    }
    flush();
    for (let i = 0; i < suffix; i++)
        result.push({ before: { text: a[a.length - suffix + i], number: a.length - suffix + i + 1 }, after: { text: b[b.length - suffix + i], number: b.length - suffix + i + 1 }, changed: false });
    return result;
}
type Props = {
    before: CaseEditorFields;
    after: CaseEditorFields;
    current: EditableCase;
    cases: EditableCase[];
    tab: CaseDiffTab;
    onTab: (tab: CaseDiffTab) => void;
    origin: string;
};
const refKey = (d: CaseDependency) => d.moduleId + ':' + d.caseId;
const statuses: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', error: '错误', not_executed: '未执行', outside: '范围外' };
export default function CaseEditorDiff({ before, after, current, cases, tab, onTab, origin }: Props) {
    const rows = useMemo(() => lineRows(before.script, after.script), [before.script, after.script]);
    const changed = (field: keyof CaseEditorFields) => JSON.stringify(before[field]) !== JSON.stringify(after[field]);
    const fieldCount = (['title', 'prerequisites', 'manual', 'expected'] as const).filter(changed).length;
    const byKey = useMemo(() => new Map(cases.map(c => [c.moduleId + ':' + c.id, c])), [cases]);
    const fields = [{ key: 'title', label: '名称' }, { key: 'prerequisites', label: '前置用例' }, { key: 'manual', label: '步骤' }, { key: 'expected', label: '预期' }] as const;
    const dependencies = (refs: CaseDependency[]) => !refs.length ? <span className="ce-diff-empty">无前置用例</span> : <table className="prerequisite-table"><thead><tr><th>编号</th><th>内容</th><th>状态</th></tr></thead><tbody>{refs.map(d => { const c = byKey.get(refKey(d)), status = c?.status ?? 'not_executed', style = status === 'error' ? 'failed' : status === 'not_executed' ? 'not-executed' : status; return <tr key={refKey(d)}><td>{d.caseId}</td><td>{c?.title ?? '用例已归档或移除'}</td><td><span className={'ce-result-status sm-badge sm-' + style}>{statuses[status] ?? '未执行'}</span></td></tr>; })}</tbody></table>;
    return <section className="ce-review-pane" aria-label="修改对比">
  <header className="ce-review-heading"><h2>{current.id} · {current.title}</h2><span>{fieldCount || changed('script') ? origin : '暂无修改'}</span></header>
  <div className="ce-review-tabs" role="tablist" aria-label="对比内容">{(['case', 'script'] as const).map(t => <button key={t} id={'ce-diff-tab-' + t} type="button" role="tab" aria-selected={tab === t} aria-controls={'ce-diff-panel-' + t} className={tab === t ? 'selected' : ''} onClick={() => onTab(t)} onKeyDown={e => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    e.preventDefault();
                    const next = e.key === 'Home' ? 'case' : e.key === 'End' ? 'script' : t === 'case' ? 'script' : 'case';
                    onTab(next);
                    document.getElementById('ce-diff-tab-' + next)?.focus();
                }
            }}>{t === 'case' ? '用例' : '脚本'}{(t === 'case' ? fieldCount : changed('script')) ? <span>{t === 'case' ? fieldCount : 1}</span> : null}</button>)}</div>
  <div key={tab} role="tabpanel" id={'ce-diff-panel-' + tab} aria-labelledby={'ce-diff-tab-' + tab} tabIndex={0} className={'ce-diff-scroll ce-diff-' + tab}>
   <div className="ce-diff-pair ce-diff-headers"><header><strong>修改前</strong><span>v{current.version}</span></header><header><strong>修改后</strong></header></div>
   {tab === 'script' ? <div className="ce-diff-code">{rows.map((row, i) => <div className="ce-diff-pair ce-diff-code-row" key={i}>{(['before', 'after'] as const).map(side => { const line = row[side]; return <div key={side} className={'ce-diff-code-cell' + (!line ? ' ce-diff-gap' : row.changed ? (side === 'before' ? ' ce-diff-removed' : ' ce-diff-added') : '')} aria-label={row.changed && line ? (side === 'before' ? '删除' : '新增') + '第 ' + line.number + ' 行' : undefined}><span className="ce-diff-line-number" aria-hidden="true">{line?.number}</span><span className="ce-diff-sign" aria-hidden="true">{row.changed && line ? (side === 'before' ? '−' : '+') : ''}</span><code>{line?.text || ' '}</code></div>; })}</div>)}</div> : <div className="ce-diff-fields">{fields.map(field => <div className="ce-diff-pair ce-diff-field-row" key={field.key}>{([before, after]).map((value, i) => <section key={i} className="ce-diff-field"><h3 title={field.key === 'prerequisites' ? '前置用例需通过后才能执行' : undefined}>{field.label}</h3><div className={'ce-diff-field-value' + (changed(field.key) ? i ? ' ce-diff-added' : ' ce-diff-removed' : '')}>{field.key === 'prerequisites' ? dependencies(value.prerequisites) : value[field.key] || <span className="ce-diff-empty">{field.key === 'manual' ? '暂无步骤' : '未填写'}</span>}</div></section>)}</div>)}</div>}
  </div>
 </section>;
}
