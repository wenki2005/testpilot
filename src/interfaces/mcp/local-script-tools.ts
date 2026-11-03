import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { strToU8, zipSync } from "fflate";

type ToolOutput = CallToolResult;
type Dependencies = {
  request: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  requestText: (pathname: string) => Promise<string>;
  requestBase64: (pathname: string) => Promise<string>;
  textResult: (value: unknown) => ToolOutput;
  guarded: <TArgs>(handler: (args: TArgs) => Promise<ToolOutput>) => (args: TArgs) => Promise<ToolOutput>;
};

export function registerLocalScriptTools(server: McpServer, { request, requestText, textResult, guarded }: Dependencies): void {  server.registerTool("testpilot_list_local_projects", {
    title: "列出已登记的本地项目",
    description: "只读列出可生成和执行可复用测试脚本的本地项目配置。",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async () => textResult(await request("/api/project-profiles"))));

  server.registerTool("testpilot_create_local_script_candidate", {
    title: "为本地项目生成脚本候选",
    description: "根据需求和可选文档生成可审核的自动化测试脚本候选，不会自动批准或运行。",
    inputSchema: z.object({
      profileId: z.string().min(1), requirement: z.string().max(2000).optional(),
      documentName: z.string().min(1).max(200).optional(), documentBase64: z.string().max(12_600_000).optional(),
    }).strict().superRefine((value, context) => {
      if ((value.documentName === undefined) !== (value.documentBase64 === undefined)) context.addIssue({ code: "custom", message: "documentName 与 documentBase64 必须同时提供" });
      if (!value.requirement?.trim() && !value.documentBase64) context.addIssue({ code: "custom", message: "请提供测试需求或一份需求资料" });
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ profileId, requirement, documentName, documentBase64 }) => {
    const script = await request<{ id: string; version: number; status: string; requirement?: string; generationSummary?: string; cases: unknown[] }>("/api/project-scripts/ai-candidates", {
      method: "POST", body: JSON.stringify({ profileId, requirement: requirement?.trim() || "请依据附件需求整理关键测试场景。", ...(documentName ? { fileName: documentName } : {}), ...(documentBase64 ? { bytesBase64: documentBase64 } : {}) }),
    });
    return textResult({ scriptId: script.id, version: script.version, status: script.status, caseCount: script.cases.length, requirement: script.requirement, generationSummary: script.generationSummary, next: "检查候选命令、测试步骤和文件后再决定批准；批准前不能运行。" });
  }));

  server.registerTool("testpilot_review_local_script", {
    title: "审核本地项目脚本",
    description: "批准或拒绝一份本地项目脚本候选。只有批准版本可运行。",
    inputSchema: z.object({ scriptId: z.string().uuid(), decision: z.enum(["approve", "reject"]), notes: z.string().max(2000).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ scriptId, decision, notes }) => textResult(await request(`/api/project-scripts/${scriptId}/review`, { method: "POST", body: JSON.stringify({ decision, notes: notes ?? "" }) }))));

  server.registerTool("testpilot_run_approved_local_script", {
    title: "运行已批准的本地项目脚本",
    description: "无 AI 地执行已批准脚本；候选或拒绝的版本会被服务端拒绝。",
    inputSchema: z.object({ scriptId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ scriptId }) => textResult(await request(`/api/project-scripts/${scriptId}/run`, { method: "POST" }))));

  server.registerTool("testpilot_get_local_run", {
    title: "读取本地项目运行状态",
    description: "查询本地项目脚本运行状态、摘要和证据文件列表。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => textResult(await request(`/api/project-runs/${runId}`))));

  server.registerTool("testpilot_export_local_run", {
    title: "导出本地项目报告与脚本包",
    description: "为已结束的批准脚本运行导出报告和包含可复用脚本文件的 ZIP。未完成运行或不含批准脚本的运行不能导出。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => {
    const run = await request<{ status: string; scriptId?: string; scriptVersion?: number; profileName: string; summary: string }>(`/api/project-runs/${runId}`);
    if (["queued", "running"].includes(run.status)) throw new Error("运行尚未结束，请稍后调用 testpilot_get_local_run 查询状态。");
    if (!run.scriptId) throw new Error("该运行没有关联已批准的可复用脚本版本。");
    const scripts = await request<Array<{ id: string; status: string; version: number; profileName: string; suiteName: string; requirement?: string; cases: unknown[]; files: Array<{ path: string; content: string }> }>>("/api/project-scripts");
    const script = scripts.find(item => item.id === run.scriptId && item.status === "approved");
    if (!script) throw new Error("该运行关联的批准脚本版本当前不可用，未生成脚本包。");
    const report = await requestText(`/api/project-runs/${runId}/report?format=md`);
    const entries: Record<string, Uint8Array> = {
      "README.md": strToU8(`# ${script.profileName} · TestPilot 回归包\n\n脚本版本：v${script.version}\n运行状态：${run.status}\n运行摘要：${run.summary}\n需求：${script.requirement ?? "未记录"}\n\n此包保存已批准的脚本快照与本次报告。使用前请先阅读源文件，按照项目 profile 的受限 runner 约定执行。`),
      "report.md": strToU8(report),
      "script-metadata.json": strToU8(JSON.stringify({ scriptId: script.id, version: script.version, status: script.status, profileName: script.profileName, suiteName: script.suiteName, requirement: script.requirement, cases: script.cases }, null, 2)),
    };
    for (const file of script.files) {
      const normalized = file.path.replaceAll("\\", "/");
      if (normalized.startsWith("/") || normalized.split("/").some(part => !part || part === "." || part === "..")) throw new Error(`脚本文件路径不安全，已停止打包：${file.path}`);
      entries[`script/${normalized}`] = strToU8(file.content);
    }
    const archive = Buffer.from(zipSync(entries)).toString("base64");
    return {
      content: [
        { type: "text" as const, text: `本地项目运行报告与批准脚本快照已打包。\n\n${report}` },
        { type: "resource" as const, resource: { uri: `testpilot://project-runs/${runId}/package.zip`, mimeType: "application/zip", blob: archive } },
      ],
    };
  }));
}

