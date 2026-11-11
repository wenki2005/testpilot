type CaseLike = { id: string };

/**
 * Human-facing number for the editor.
 *
 * 现在的编号是“批次-序号”三段式：xmind-<批次>-<序号>，例如 xmind-2-014。
 * 界面显示成 "2-014"，一眼能看出属于第几批，也不会和别的批次撞号。
 *
 * 旧的两段式仍保留兼容：xmind-42 → "042"；历史遗留的 case-… 走 2xx 兜底。
 */
export function caseDisplayNumber(id: string, cases: readonly CaseLike[] = []): string {
    const staged = /^xmind-(\d+)-(\d+)$/.exec(id);
    if (staged)
        return `${Number(staged[1])}-${staged[2]!.padStart(3, '0')}`;
    const legacy = /^xmind-(\d+)$/.exec(id);
    if (legacy)
        return legacy[1]!.padStart(3, '0');
    const ordered = cases.filter(item => item.id.startsWith('case-')).slice().sort((a, b) => a.id.localeCompare(b.id));
    const index = ordered.findIndex(item => item.id === id);
    return index >= 0 ? String(201 + index).padStart(3, '0') : '—';
}
