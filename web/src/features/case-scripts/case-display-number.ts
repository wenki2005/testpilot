type CaseLike = { id: string };

/**
 * Human-facing number for the editor. The stored IDs remain unchanged for
 * MCP, history and dependencies; v2 hash IDs are shown as a readable 2xx
 * sequence so users can distinguish them from the v1 XMind numbers.
 */
export function caseDisplayNumber(id: string, cases: readonly CaseLike[] = []): string {
    const old = /^xmind-(\d+)$/.exec(id);
    if (old)
        return old[1]!.padStart(3, '0');
    const ordered = cases.filter(item => item.id.startsWith('case-')).slice().sort((a, b) => a.id.localeCompare(b.id));
    const index = ordered.findIndex(item => item.id === id);
    return index >= 0 ? String(201 + index).padStart(3, '0') : '2xx';
}
