import type { DemoRun } from "../domain/testing/local-test-contracts.js";
/** Render a persisted demo run from its immutable recorded facts. */
export function renderDemoRunReport(run: DemoRun): string {
    const lines = [
        `# TestPilot 运行报告`, "", `- 运行 ID：${run.id}`, `- 模式：${run.mode}`, `- 执行器：${run.provider}`, `- 目标：${run.fixedTarget ? "预置修复" : "预置缺陷"}`,
        `- 状态：${run.status}`, `- 开始时间：${run.startedAt}`, `- 耗时：${run.durationMs} ms`, `- 动作数：${run.actionCount}/${run.maxActions}`, `- 框架：${run.framework ?? "Pi Agent Core"}`, `- 决策来源：${run.modelLabel ?? run.provider}`, "", "## 输入需求", "", run.input?.requirements ?? "历史记录未保存输入需求。", "", `## 摘要`, "", run.summary, "", "## 测试计划", "",
        ...(run.plan.length ? run.plan.map(item => `- ${item}`) : ["- 尚无计划记录"]), "", "## 断言", "",
    ];
    if (!run.assertions.length)
        lines.push("没有已完成断言。", "");
    for (const assertion of run.assertions) {
        lines.push(`### ${assertion.status === "passed" ? "通过" : assertion.status === "failed" ? "失败" : "未定论"} · ${assertion.title}`, "", `- ID：${assertion.id}`, `- 来源：${assertion.source}`, `- 预期：\`${JSON.stringify(assertion.expected)}\``, `- 实际：\`${JSON.stringify(assertion.actual)}\``, `- 证据 ID：${assertion.evidenceId}`, `- 重现：\`${assertion.reproduction.method} ${assertion.reproduction.path}\``, `- 重现请求：\`${JSON.stringify({ body: assertion.reproduction.body, headers: assertion.reproduction.headers })}\``, "");
    }
    lines.push("## HTTP 证据", "");
    if (!run.evidence.length)
        lines.push("没有捕获 HTTP 证据。", "");
    for (const evidence of run.evidence)
        lines.push(`### ${evidence.method} ${evidence.path}`, "", `- 证据 ID：${evidence.id}`, `- 状态：${evidence.status}`, `- 耗时：${evidence.durationMs} ms`, `- 时间：${evidence.capturedAt}`, `- 请求体：\`${JSON.stringify(evidence.requestBody ?? null)}\``, `- 请求头：\`${JSON.stringify(evidence.requestHeaders ?? {})}\``, `- 响应体：\`${JSON.stringify(evidence.body)}\``, "");
    lines.push("## 事件", "");
    if (!run.events.length)
        lines.push("没有事件记录。", "");
    for (const event of run.events)
        lines.push(`- ${event.at} **${event.kind} · ${event.title}** — ${event.detail}`);
    lines.push("", "## 覆盖与未覆盖", "", `已访问：${run.coverage.visited.join(", ") || "无"}`, `可用路由：${run.coverage.available.join(", ") || "无"}`, `未覆盖：${run.coverage.untested.join(", ") || "无"}`, "", "## 限制", "", ...(run.limitations.length ? run.limitations.map(item => `- ${item}`) : ["- 无"]), "");
    if (run.error)
        lines.push("## 错误", "", run.error, "");
    return lines.join("\n");
}
