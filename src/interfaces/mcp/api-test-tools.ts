import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

type ToolOutput = CallToolResult;
type Dependencies = {
  request: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  requestText: (pathname: string) => Promise<string>;
  requestBase64: (pathname: string) => Promise<string>;
  textResult: (value: unknown) => ToolOutput;
  guarded: <TArgs>(handler: (args: TArgs) => Promise<ToolOutput>) => (args: TArgs) => Promise<ToolOutput>;
};

export function registerApiTestTools(server: McpServer, { request, requestText, requestBase64, textResult, guarded }: Dependencies): void {
  server.registerTool("testpilot_prepare_api_test", {
    title: "准备 API 测试用例",
    description: "提交 API suite JSON 草稿。服务端执行严格 DSL 校验并计算 SHA-256；创建草稿不会运行请求，也不会自动审核。",
    inputSchema: z.object({ suiteJson: z.string().min(2).max(60_000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteJson }) => {
    let suite: unknown; try { suite = JSON.parse(suiteJson); } catch { throw new Error("suiteJson 不是合法 JSON。"); }
    const candidate = await request<{ id: string; status: string; digest: string; suite: { name: string; cases: unknown[] } }>("/api/api-suites", { method: "POST", body: JSON.stringify(suite) });
    return textResult({ suiteId: candidate.id, status: candidate.status, name: candidate.suite.name, caseCount: candidate.suite.cases.length, digest: candidate.digest, next: "读取并检查用例、目标环境、副作用和清理步骤。只有用户明确批准后，才调用 testpilot_review_api_test(decision=approve)。" });
  }));

  server.registerTool("testpilot_get_api_test", {
    title: "读取 API 测试套件",
    description: "读取 API suite 的完整用例、fixture 和审批状态。",
    inputSchema: z.object({ suiteId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ suiteId }) => textResult(await request(`/api/api-suites/${suiteId}`))));

  server.registerTool("testpilot_update_api_test", {
    title: "修订 API 测试套件",
    description: "修订 draft API suite。服务端重新校验并递增版本、更新 SHA-256；审核结论会重置/不能被覆盖，approved 或 rejected 候选不可修改。",
    inputSchema: z.object({ suiteId: z.string().uuid(), suiteJson: z.string().min(2).max(60_000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteId, suiteJson }) => {
    let suite: unknown; try { suite = JSON.parse(suiteJson); } catch { throw new Error("suiteJson 不是合法 JSON。"); }
    const candidate = await request<{ id: string; status: string; revision: number; digest: string }>(`/api/api-suites/${suiteId}/update`, { method: "POST", body: JSON.stringify({ suite }) });
    return textResult({ suiteId: candidate.id, status: candidate.status, revision: candidate.revision, digest: candidate.digest, next: "重新检查修订内容并由用户批准新的 digest 后才能运行。" });
  }));

  server.registerTool("testpilot_review_api_test", {
    title: "审核 API 测试套件",
    description: "记录用户明确作出的批准或拒绝。被批准的套件内容由 digest 锁定；修改需新建候选并重新审核。",
    inputSchema: z.object({ suiteId: z.string().uuid(), decision: z.enum(["approve", "reject"]), notes: z.string().max(2000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteId, decision, notes }) => textResult(await request(`/api/api-suites/${suiteId}/review`, { method: "POST", body: JSON.stringify({ decision, notes }) }))));

  server.registerTool("testpilot_run_approved_api_test", {
    title: "运行已批准的 API 测试",
    description: "仅运行服务端已批准且 digest 未变化的 API suite。默认只允许本机只读请求；外网、POST/PUT/PATCH/DELETE 和并发必须分别显式开启，并确保使用隔离测试环境。",
    inputSchema: z.object({ suiteId: z.string().uuid(), baseUrl: z.string().url().max(2000).optional(), allowNetwork: z.boolean().optional(), allowMutations: z.boolean().optional(), allowConcurrency: z.boolean().optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, guarded(async ({ suiteId, ...options }) => {
    const run = await request<{ runId: string; status: string; results: Array<{ status: string }> ; scope: string[]; limitations: string[] }>(`/api/api-suites/${suiteId}/run`, { method: "POST", body: JSON.stringify(options) });
    const counts = Object.fromEntries(["passed", "failed", "blocked", "error"].map(status => [status, run.results.filter(item => item.status === status).length]));
    return textResult({ runId: run.runId, status: run.status, counts, scope: run.scope, limitations: run.limitations, next: "调用 testpilot_get_api_run 查看逐条证据，再调用 testpilot_export_api_run 获取报告和可复用 ZIP。" });
  }));

  server.registerTool("testpilot_get_api_run", {
    title: "读取 API 测试运行结果",
    description: "读取 API 运行记录、逐用例结果和安全限制。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => textResult(await request(`/api/api-runs/${runId}`))));

  server.registerTool("testpilot_diagnose_api_finding", {
    title: "诊断 API 测试问题",
    description: "根据某个 API finding 关联的持久化运行证据给出确定性分类和建议。只读，不调用模型、不修改用例，也不会自动重测。若建议定向重测，需回到工作台确认并点击重测按钮。",
    inputSchema: z.object({ suiteId: z.string().uuid(), findingId: z.string().regex(/^[0-9a-f]{24}$/i) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ suiteId, findingId }) => textResult(await request(`/api/api-suites/${suiteId}/findings/${findingId}/diagnosis`))));

  server.registerTool("testpilot_export_api_run", {
    title: "导出 API 测试报告和脚本包",
    description: "返回 Markdown 运行报告，以及包含 suite.json、README、run.json 的 ZIP。包内脚本可离线于 AI 模型通过 CLI 重跑。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => {
    const report = await requestText(`/api/api-runs/${runId}/report`);
    const archive = await requestBase64(`/api/api-runs/${runId}/package`);
    return { content: [
      { type: "text" as const, text: `API 测试运行报告\n\n${report}` },
      { type: "resource" as const, resource: { uri: `testpilot://api-runs/${runId}/package.zip`, mimeType: "application/zip", blob: archive } },
    ] };
  }));

}
