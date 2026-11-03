import { request } from "./client";
import type { Comparison, Run, RunProgress } from "../types";

export async function startAndWaitForRun(
  projectId: string,
  body: Record<string, unknown>,
  onStatus: (message: string) => void,
  action: "start" | "retest" | "checkpoint-retry" = "start",
  onRunId?: (runId: string) => void,
  onProgress?: (progress: RunProgress) => void,
): Promise<Run> {
  const started = await request<{ runId?: string; comparisons?: Comparison[]; finalReady?: boolean }>(`/api/document-projects/${projectId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (Array.isArray(started.comparisons)) return started as Run;
  if (!started.runId) throw new Error("服务未返回 runId，无法继续轮询运行状态。");
  onRunId?.(started.runId);
  let lastStage = "";
  let lastControlStatus = "";
  while (true) {
    const progress = await request<RunProgress>(`/api/document-runs/${encodeURIComponent(started.runId)}/progress`);
    onProgress?.(progress);
    if (progress.status === "completed") {
      if (progress.run) return progress.run;
      return request<Run>(`/api/document-runs/${encodeURIComponent(started.runId)}`);
    }
    if (progress.status === "cancelled") return progress.run ?? request<Run>(`/api/document-runs/${encodeURIComponent(started.runId)}`);
    if (progress.status === "failed") throw new Error(progress.lastError || `运行 ${started.runId} 中断；可从项目恢复状态检查并安全恢复。`);
    if ((progress.status === "paused" || progress.status === "pause-requested") && progress.status !== lastControlStatus) {
      lastControlStatus = progress.status;
      onStatus(progress.status === "paused"
        ? progress.handoff?.status === 'paused-for-analysis' || progress.handoff?.status === 'ready-to-continue'
          ? '前置用例已完成，AI页面观察已记录；等待你确认继续目标用例。浏览器会话仍由本轮占用。'
          : `运行已暂停：${progress.checkpoint?.caseId ?? progress.currentCase?.id ?? '当前用例'} · 下次从步骤 ${((progress.checkpoint?.nextStepIndex ?? 0) + 1)} 继续。浏览器会话仍由本轮占用。`
        : `暂停请求中：${progress.currentCase?.id ?? ''} 的当前动作完成后会停住。`);
    } else if (progress.status === "running") lastControlStatus = "";
    if (progress.stage !== lastStage) {
      lastStage = progress.stage;
      const where = progress.currentCase ? ` · ${progress.currentCase.id} ${progress.currentCase.title}` : "";
      onStatus(progress.stage === "awaiting-login"
        ? `测试窗口正在等待登录；完成登录后在此项目提示中继续，运行 ${started.runId} 会复用当前会话。`
        : `运行中：${progress.stage}${where} · ${progress.progress?.completed ?? 0}/${progress.progress?.total ?? 0}`);
    }
    await new Promise(resolve => window.setTimeout(resolve, 1200));
  }
}
