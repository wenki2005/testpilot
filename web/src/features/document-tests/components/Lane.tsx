import type { Lane as LaneData, RunScopePlan } from "../types";

export function Lane({ title, lane, scopePlan, caseScopeKnown }: { title: string; lane: LaneData; scopePlan?: RunScopePlan; caseScopeKnown?: boolean }) {
  const scopeLabel = (id: string) => scopePlan
    ? scopePlan.targetCaseIds.includes(id) ? "直接目标" : scopePlan.impactCaseIds.includes(id) ? "关联影响" : "范围未分类"
    : caseScopeKnown === false ? "历史范围未标注" : "目标/影响未标注";
  return <article className="doc-lane"><h3>{title} · {lane.status}</h3><p>{lane.summary}</p>{lane.results.map(item => {
    const label = scopeLabel(item.id);
    const tone = label === "直接目标" ? "target" : label === "关联影响" ? "impact" : "unknown";
    return <div className={`doc-result ${item.status}`} key={item.id}><strong>{item.status === "passed" ? "✓" : item.status === "blocked" ? "!" : item.status === "not-applicable" ? "—" : item.status === "cancelled" ? "Ⅱ" : item.status === "not-run" ? "·" : "×"} <span className={`doc-run-scope-badge ${tone}`}>{label}</span> · {item.status === "not-applicable" ? "N/A · " : item.status === "cancelled" ? "已取消 · " : item.status === "not-run" ? "未运行 · " : ""}{item.title} ({item.id})</strong><small>{item.detail}</small></div>;
  })}</article>;
}
