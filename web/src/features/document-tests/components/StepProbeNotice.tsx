import type { StepProbeResult } from "../types";

export function StepProbeNotice({ result }: { result: StepProbeResult }) {
  const labels: Record<StepProbeResult["status"], string> = {
    found: "定位通过", "not-found": "没有匹配控件", "not-visible": "匹配控件不可见",
    ambiguous: "匹配不唯一", "not-required": "此步骤无需定位", blocked: "定位未执行",
  };
  const failed = ["not-found", "not-visible", "ambiguous", "blocked"].includes(result.status);
  return <p className={`doc-notice ${failed ? "error" : ""}`}><strong>{labels[result.status]}</strong>{result.matchCount !== undefined ? ` · 匹配 ${result.matchCount} 个，可见 ${result.visibleCount ?? 0} 个${result.elementTypes?.length ? ` · 控件：${result.elementTypes.join("、")}` : ""}` : ""}<br />{result.detail}</p>;
}
