export function WorkflowRail({ stages }: {
    stages: Array<{
        label: string;
        state: "done" | "current" | "waiting" | "warning";
    }>;
}) {
    const stateLabel = (state: string) => state === "done" ? "完成" : state === "current" ? "进行中" : state === "warning" ? "需处理" : "等待";
    return <section className="workflow-rail" aria-label="测试流程进度"><div className="workflow-rail-head"><h2>测试流程</h2><span>手动启动</span></div><ol>{stages.map((stage, index) => <li className={`workflow-stage ${stage.state}`} key={stage.label} aria-current={stage.state === "current" ? "step" : undefined}><span className="workflow-marker">{String(index + 1)}</span><span className="workflow-stage-label">{stage.label}</span><small>{stateLabel(stage.state)}</small></li>)}</ol></section>;
}
