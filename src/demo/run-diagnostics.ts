import type { DemoRequest, DemoRun, RunContext } from "./contracts.js";

export function demoRunTimeoutMs(request: DemoRequest): number {
  return request.mode !== "deterministic" && request.provider === "model" ? 90_000 : 60_000;
}

export function updateDemoProgress(context: RunContext, phase: NonNullable<DemoRun["diagnostics"]>["phase"], values: Partial<Pick<NonNullable<DemoRun["diagnostics"]>, "modelRequests" | "modelResponses" | "toolCalls" | "currentTool">> = {}): void {
  context.run.diagnostics = {
    modelRequests: 0, modelResponses: 0, toolCalls: 0,
    ...context.run.diagnostics, ...values, phase, updatedAt: new Date().toISOString(),
  };
}

export function markDemoTimedOut(context: RunContext): void {
  const { run } = context;
  const progress = run.diagnostics;
  const stage = progress?.phase === "model-request"
    ? `正在等待第 ${progress.modelRequests} 次模型调用的有效输出；请核对模型响应和工具调用协议。`
    : progress?.phase === "model-response"
      ? "已收到模型输出，尚未完成后续工具执行；请检查工具调用或计划是否有效。"
      : progress?.phase === "http-request"
        ? "样例 HTTP 请求已开始，尚未完整收集响应；请检查样例服务响应。"
        : progress?.phase === "http-response"
          ? "已收集样例 HTTP 响应，后续模型或断言阶段尚未完成。"
          : progress?.phase === "tool"
            ? `正在执行工具 ${progress.currentTool ?? "未知"}。`
            : "尚未记录可定位的执行阶段，无法仅凭超时确定原因。";
  run.status = "blocked";
  run.summary = `运行达到时间上限；${stage}已执行 ${run.actionCount} 次样例 HTTP 动作、记录 ${run.assertions.length} 条断言；未执行部分未判为通过。`;
  run.error = "运行达到时间上限，已停止；具体阶段见摘要和执行事件。";
  if (!run.events.some(item => item.title === "运行超时诊断")) context.emit("error", "运行超时诊断", run.summary);
}
