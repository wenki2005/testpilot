import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { strToU8, zipSync } from "fflate";

const apiBase = new URL(process.env.TESTPILOT_BASE_URL ?? "http://127.0.0.1:4317");
if (apiBase.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(apiBase.hostname)) {
  throw new Error("TESTPILOT_BASE_URL must be a loopback HTTP URL, for example http://127.0.0.1:4330");
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, apiBase), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { message = (await response.json() as { error?: string }).error ?? message; } catch { /* retain HTTP status */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function requestText(pathname: string): Promise<string> {
  const response = await fetch(new URL(pathname, apiBase), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function requestBase64(pathname: string): Promise<string> {
  const response = await fetch(new URL(pathname, apiBase), { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

type ToolOutput = CallToolResult;

function guarded<TArgs>(handler: (args: TArgs) => Promise<ToolOutput>) {
  return async (args: TArgs): Promise<ToolOutput> => {
    try { return await handler(args); }
    catch (error) { return { content: [{ type: "text" as const, text: `TestPilot error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }; }
  };
}

function isCredentialFreeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

const browserStep = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fillByLabel"), label: z.string().min(1).max(160), value: z.string().max(500) }).strict(),
  z.object({ action: z.literal("fillByPlaceholder"), placeholder: z.string().min(1).max(160), value: z.string().max(500) }).strict(),
  z.object({ action: z.literal("blurByPlaceholder"), placeholder: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("selectByLabel"), label: z.string().min(1).max(160), value: z.string().max(500) }).strict(),
  z.object({ action: z.literal("selectByPlaceholder"), placeholder: z.string().min(1).max(160), value: z.string().min(1).max(500) }).strict(),
  z.object({ action: z.literal("clickByRole"), role: z.enum(["button", "radio", "checkbox", "tab", "link"]), name: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("assertText"), text: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("assertVisible"), text: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("assertValue"), label: z.string().min(1).max(160), value: z.string().max(500) }).strict(),
  z.object({ action: z.literal("assertDisabled"), label: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal("startFetchOrXhrCapture") }).strict(),
  z.object({ action: z.literal("assertNoFetchOrXhr"), quietMs: z.number().int().min(250).max(5000).optional() }).strict(),
]);

const testCase = z.object({
  title: z.string().min(1).max(160), source: z.string().max(500), entryPath: z.string().max(500).optional(), requirementRefs: z.array(z.string().max(500)).max(10).optional(),
  category: z.enum(["functional", "input-validation", "boundary", "authentication", "authorization", "state-transition", "navigation", "accessibility", "visual", "security", "performance", "compatibility", "resilience", "other"]).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(), coverageAreas: z.array(z.enum(["functional", "input-validation", "boundary", "authentication", "authorization", "state-transition", "navigation", "accessibility", "visual", "security", "performance", "compatibility", "resilience", "other"])).min(1).max(14).optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(), selectedForRegression: z.boolean().optional(),
  preconditions: z.array(z.string().max(500)).max(10).optional(), preconditionsConfirmed: z.boolean().optional(),
  testData: z.array(z.string().max(500)).max(10).optional(), sideEffectRisk: z.enum(["none", "reversible", "irreversible", "unknown"]).optional(), cleanup: z.string().max(1000).optional(),
  kind: z.enum(["text", "visible", "field"]), expected: z.string().max(300), steps: z.array(browserStep).max(30),
}).strict();

const webRunScopePlan = z.object({
  mode: z.enum(["single", "feature", "impact", "full", "custom"]),
  targetCaseIds: z.array(z.string().min(1).max(80)).max(200).refine(ids => new Set(ids).size === ids.length, "targetCaseIds 必须唯一"),
  impactCaseIds: z.array(z.string().min(1).max(80)).max(200).refine(ids => new Set(ids).size === ids.length, "impactCaseIds 必须唯一"),
  impactReasons: z.record(z.string().min(1).max(80), z.array(z.string().min(1).max(300)).min(1).max(10)).optional(),
}).strict().superRefine((scope, context) => {
  if (!scope.targetCaseIds.length && (scope.mode !== "impact" || !scope.impactCaseIds.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "至少需要一个直接目标；纯关联影响检查必须使用 impact 范围并包含关联用例。", path: ["targetCaseIds"] });
  }
  if (scope.mode === "single" && (scope.targetCaseIds.length !== 1 || scope.impactCaseIds.length > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "单项测试只能包含一个直接目标，不包含关联用例。", path: ["mode"] });
  }
  if (scope.mode === "impact" && !scope.impactCaseIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "影响检查范围至少要包含一条关联影响用例。", path: ["impactCaseIds"] });
  }
  if (scope.mode === "full" && scope.impactCaseIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "完整回归范围不能把用例标为关联影响项。", path: ["impactCaseIds"] });
  }
  const targetIds = new Set(scope.targetCaseIds);
  if (scope.impactCaseIds.some(id => targetIds.has(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "直接目标和关联影响用例不能重复。", path: ["impactCaseIds"] });
  }
  if (scope.impactReasons && Object.keys(scope.impactReasons).some(id => !scope.impactCaseIds.includes(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "影响依据只能对应本轮关联影响用例。", path: ["impactReasons"] });
  }
});

function createServer() {
  const server = new McpServer({ name: "testpilot-qa", version: "1.0.0" }, { maxToolInputElements: 20_000 });

  server.registerTool("testpilot_status", {
    title: "TestPilot 状态",
    description: "读取 TestPilot 连接、模型和当前测试项目概况。只读。",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async () => {
    const [config, projects, profiles] = await Promise.all([
      request<Record<string, unknown>>("/api/config"),
      request<Array<{ id: string; name: string; cases: unknown[]; reviewStatus?: string }>>("/api/document-projects"),
      request<Array<{ id: string; name: string; suiteName: string }>>("/api/project-profiles"),
    ]);
    return textResult({ baseUrl: apiBase.origin, modelAvailable: config.modelAvailable, modelLabel: config.modelLabel, documentProjects: projects.map(({ id, name, cases, reviewStatus }) => ({ id, name, caseCount: cases.length, reviewStatus })), localProjects: profiles });
  }));

  server.registerTool("testpilot_prepare_web_test", {
    title: "准备网站测试",
    description: "根据目标网址、需求文字及可选 PDF/XMind/Markdown/TXT 内容创建待审核用例项目。不会启动应用提交等业务操作。",
    inputSchema: z.object({
      targetUrl: z.string().url().max(2048),
      requirement: z.string().max(8_000).optional(),
      documentName: z.string().min(1).max(200).optional(),
      documentBase64: z.string().max(12_600_000).optional().describe("可选文档文件的 base64 内容，最大 9 MB 原始文件"),
      projectName: z.string().max(120).optional(),
      requireConfirmation: z.boolean().optional().describe("是否在执行前暂停等待用户审核；默认 true"),
    }).strict().superRefine((value, context) => {
      if ((value.documentName === undefined) !== (value.documentBase64 === undefined)) context.addIssue({ code: "custom", message: "documentName 与 documentBase64 必须同时提供" });
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ targetUrl, requirement, documentName, documentBase64, projectName, requireConfirmation }) => {
    const sourceText = requirement?.trim() || "请从目标网址可访问的页面开始探索，识别关键功能和可验证的状态；把不明确的预期标为待补充。";
    const generatedName = documentName ?? "测试任务.md";
    const generatedBytes = Buffer.from(`# 测试任务\n\n${sourceText}`, "utf8").toString("base64");
    const started = await request<{ preparationId: string; status: string }>("/api/document-projects/import", {
      method: "POST",
      body: JSON.stringify({ fileName: documentName ?? generatedName, bytesBase64: documentBase64 ?? generatedBytes, targetUrl, name: projectName, contextText: requirement?.trim() ?? "", requireConfirmation: requireConfirmation !== false }),
    });
    type PreparationStatus = { status: "running" | "completed" | "needs-review" | "failed"; stage: string; projectId?: string; workflowId?: string; error?: string; events: Array<{ stage: string; status: string; message: string }> };
    let task: PreparationStatus | undefined;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      task = await request<PreparationStatus>(`/api/document-preparation/${started.preparationId}`);
      if (task.status !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!task) return textResult({ preparationId: started.preparationId, status: "running", message: "资料准备仍在运行；稍后用 testpilot_get_document_preparation 查询同一任务，不要重复提交。" });
    if (task.status === "running") return textResult({ preparationId: started.preparationId, workflowId: task.workflowId, status: "running", stage: task.stage, message: "资料准备仍在运行；稍后用 testpilot_get_document_preparation 查询同一任务，不要重复提交。" });
    if (task.status === "failed") throw new Error(task.error ?? "网站测试准备失败。");
    if (!task.projectId) throw new Error("资料准备结束但没有关联测试项目。");
    const projects = await request<Array<{ id: string; name: string; cases: unknown[]; reviewStatus?: string; generationWarning?: string }>>("/api/document-projects");
    const project = projects.find(item => item.id === task!.projectId);
    if (!project) throw new Error(`准备任务指向不存在的项目 ${task.projectId}。`);
    return textResult({ preparationId: started.preparationId, workflowId: task.workflowId, projectId: project.id, name: project.name, caseCount: project.cases.length, reviewStatus: project.reviewStatus ?? "draft", generationWarning: project.generationWarning, stage: task.stage, events: task.events, next: project.reviewStatus === "approved" ? "服务端安全门已通过，工作流会自动继续执行；按 workflowId 查询阶段，按 projectId 查看结果。" : "用例已进入同一 workflow 的审核暂停；读取、检查并编辑后调用 testpilot_approve_web_test_cases。" });
  }));

  server.registerTool("testpilot_generate_web_case_drafts", {
    title: "独立生成网站测试用例",
    description: "按需求、目标网页文字和明确标注用途的资料生成结构化测试用例草稿。held-out-benchmark 留出基准不会传给生成模型，只在生成后用于比较。输出 generationArtifact 可原样交给 testpilot_handoff_generated_web_cases。",
    inputSchema: z.object({
      requirementsText: z.string().max(40_000).optional(),
      websiteUrl: z.string().url().max(2_000).refine(isCredentialFreeHttpUrl, "网站地址必须是有效的 HTTP 或 HTTPS 网址，且不能包含用户名或密码。目标页面可以由服务端按需读取。").optional(),
      websiteText: z.string().max(12_000).optional(),
      files: z.array(z.object({
        fileName: z.string().min(1).max(200),
        bytesBase64: z.string().min(1).max(12_600_000).describe("PDF/XMind/Markdown/TXT 文件的 base64 内容，最大 9 MB 原始文件"),
        role: z.enum(["auto", "requirements", "coverage-reference", "held-out-benchmark"]).optional(),
      }).strict()).max(5).optional(),
      maxCases: z.number().int().min(1).max(80).optional(),
      searchExamples: z.boolean().optional(),
    }).strict().superRefine((value, context) => {
      if (!value.requirementsText?.trim() && !value.websiteUrl && !value.websiteText?.trim() && !value.files?.length) {
        context.addIssue({ code: "custom", message: "至少提供需求文字、目标网址、页面文字或一份资料文件。" });
      }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, guarded(async input => {
    const generated = await request<Record<string, unknown>>("/api/case-generator/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    if (!generated.generationArtifact || typeof generated.generationArtifact !== "object") {
      throw new Error("生成服务没有返回可移交的 generationArtifact；请读取生成错误后重试。")
    }
    return textResult({ ...generated, next: "请先检查生成用例与质量/基准比较；确认后将 generationArtifact 原样传给 testpilot_handoff_generated_web_cases。" });
  }));

  server.registerTool("testpilot_handoff_generated_web_cases", {
    title: "将生成用例移交测试工作流",
    description: "把经检查的完整 generationArtifact 移交至持久网站测试工作流，并关联 case-generator 产物摘要。该操作创建待审核执行草稿，不会直接运行浏览器或业务写操作。",
    inputSchema: z.object({
      targetUrl: z.string().url().max(2_048).refine(isCredentialFreeHttpUrl, "执行目标必须是有效的 HTTP 或 HTTPS 网址，且不能包含用户名或密码。"),
      generationArtifact: z.record(z.string(), z.unknown()),
      projectName: z.string().max(120).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, guarded(async ({ targetUrl, generationArtifact, projectName }) => {
    const result = await request<{ projectId: string; workflowId: string; projectName: string; caseCount: number; selectedForReview: number; reviewStatus: string }>("/api/case-generator/execute-draft", {
      method: "POST", body: JSON.stringify({ generation: generationArtifact, targetUrl, ...(projectName ? { name: projectName } : {}) }),
    });
    return textResult({ ...result, next: "生成产物已关联到 workflow。读取 testpilot_get_document_workflow 与 testpilot_get_web_test；按审核策略补齐用例审查/步骤，审批后再显式运行。" });
  }));

  server.registerTool("testpilot_get_document_preparation", {
    title: "读取文档准备进度",
    description: "按 preparationId 读取项目解析、公开参考、生成、审查、步骤作者和等待状态。只读。",
    inputSchema: z.object({ preparationId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ preparationId }) => textResult(await request(`/api/document-preparation/${preparationId}`))));

  server.registerTool("testpilot_get_document_workflow", {
    title: "读取测试工作流",
    description: "读取同一 HTTP/UI/MCP 服务持久化的固定 specialist workflow、当前阶段、尝试次数、等待原因、人工确认和产物引用。只读。",
    inputSchema: z.object({ workflowId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ workflowId }) => textResult(await request(`/api/document-workflows/${workflowId}`))));

  server.registerTool("testpilot_get_web_test", {
    title: "读取网站测试用例",
    description: "读取一个文档驱动网站测试项目及当前用例、来源、步骤和审核状态。",
    inputSchema: z.object({ projectId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ projectId }) => {
    const projects = await request<Array<Record<string, unknown>>>("/api/document-projects");
    const project = projects.find(item => item.id === projectId);
    if (!project) throw new Error(`测试项目不存在：${projectId}`);
    return textResult(project);
  }));

  server.registerTool("testpilot_update_web_test_cases", {
    title: "更新网站测试用例",
    description: "保存经检查修订的测试用例。保存后项目回到 draft，必须重新审核，原审核不会沿用。",
    inputSchema: z.object({ projectId: z.string().uuid(), cases: z.array(testCase).min(1).max(200) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ projectId, cases }) => textResult(await request(`/api/document-projects/${projectId}/update`, { method: "POST", body: JSON.stringify({ cases }) }))));

  server.registerTool("testpilot_generate_web_test_steps", {
    title: "为网站用例生成步骤草稿",
    description: "仅为明确指定的用例生成浏览器步骤草稿。生成会修改项目并将需要确认的项目退回 draft；不会审核或启动测试。生成后读取用例、检查步骤，再按现有审核策略批准。",
    inputSchema: z.object({ projectId: z.string().uuid(), caseIds: z.array(z.string().min(1).max(80)).min(1).max(200) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ projectId, caseIds }) => {
    const uniqueCaseIds = [...new Set(caseIds)];
    const result = await request<{ projectId: string; requested: number; generatedCaseIds: string[]; blockedCaseIds: string[]; blockedReasons: Array<{ caseId: string; reason: string }>; warning?: string }>(`/api/document-projects/${projectId}/generate-steps`, {
      method: "POST", body: JSON.stringify({ caseIds: uniqueCaseIds }),
    });
    return textResult({ ...result, reviewRequired: true, next: "步骤草稿已保存为项目修订；请读取并检查对应步骤及副作用，再由用户明确审核通过后运行。blockedCaseIds 表示没有生成可执行验收断言，不会伪装为已完成。" });
  }));

  server.registerTool("testpilot_set_web_test_selection", {
    title: "设置网站回归用例范围",
    description: "按 case ID 更新回归选择，同时保留项目当前全部用例及其余字段。选择变更沿用服务端现有审核策略：通常退回 draft；只有用户已启用自动确认且存在安全就绪用例时才沿用服务端自动批准规则。不会自动启动测试。至少保留一条选中用例。",
    inputSchema: z.object({ projectId: z.string().uuid(), caseIds: z.array(z.string().min(1).max(80)).min(1).max(200), selected: z.boolean() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ projectId, caseIds, selected }) => {
    const uniqueCaseIds = [...new Set(caseIds)];
    const result = await request<{ project: Record<string, any>; selectedCaseIds: string[]; excludedCaseIds: string[]; changed: boolean }>(`/api/document-projects/${projectId}/selection`, { method: "POST", body: JSON.stringify({ caseIds: uniqueCaseIds, selected }) });
    const { project } = result;
    return textResult({ projectId, changed: result.changed, selectedCaseIds: result.selectedCaseIds, excludedCaseIds: result.excludedCaseIds, reviewStatus: project.reviewStatus ?? "draft", confirmationRequired: project.confirmationRequired !== false, next: !result.changed ? "回归范围未变化；审核状态未改变，也未启动测试。" : project.reviewStatus === "approved" ? "服务端依据用户已启用的自动确认策略保留批准状态；核对返回的选中范围后，再显式调用测试运行工具。" : "范围变更已保存并使审核状态回到 draft；读取并审核更新后的范围，再由用户批准后运行。此操作没有启动测试。" });
  }));

  server.registerTool("testpilot_approve_web_test_cases", {
    title: "审核通过网站测试用例",
    description: "由用户确认用例与需求相符后调用。只有审核通过的项目才能运行常规回归或 AI 辅助对照。",
    inputSchema: z.object({ projectId: z.string().uuid(), notes: z.string().max(2000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ projectId, notes }) => textResult(await request(`/api/document-projects/${projectId}/review`, { method: "POST", body: JSON.stringify({ decision: "approve", notes }) }))));

  server.registerTool("testpilot_run_web_dual_validation", {
    title: "运行网站回归测试",
    description: "启动已审核项目中明确列出的用例。默认 runMode=regression，只运行确定性步骤且不调用模型；runMode=compare 才额外运行 Computer Use 对照。必须提供本轮唯一 selectedCaseIds，不会自动扩大到全项目。可提供 scopePlan 分开记录直接目标、关联影响用例和影响依据；此时 selectedCaseIds 必须刚好等于 targetCaseIds 与 impactCaseIds 的并集。启动后立即返回 runId；用 testpilot_get_web_run_progress 轮询，结束后读取详情和导出。",
    inputSchema: z.object({ projectId: z.string().uuid(), selectedCaseIds: z.array(z.string().min(1).max(80)).min(1).max(200).refine(ids => new Set(ids).size === ids.length, "selectedCaseIds 必须唯一"), runMode: z.enum(["regression", "compare"]).default("regression"), scopePlan: webRunScopePlan.optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, guarded(async ({ projectId, selectedCaseIds, runMode, scopePlan }) => {
    const started = await request<{ runId: string; projectId: string; status: string; stage: string; progress: unknown }>(`/api/document-projects/${projectId}/start`, { method: "POST", body: JSON.stringify({ selectedCaseIds, runMode, ...(scopePlan ? { scopePlan } : {}) }) });
    return textResult({ ...started, runMode, selectedCaseIds, ...(scopePlan ? { scopePlan } : {}), next: "运行已经在后台启动。请按 runId 调用 testpilot_get_web_run_progress 轮询；完成后再调用 testpilot_get_web_run 读取结果并导出报告。不要重复启动同一轮。" });
  }));

  server.registerTool("testpilot_retest_web_cases", {
    title: "重测网站运行中的指定用例",
    description: "基于父运行的原始选中范围和相同执行模式，针对无副作用用例启动定向重测。项目用例版本变化、API 写请求授权或风险未确认时服务端拒绝重放。返回 runId 后轮询进度；报告保留父运行、版本摘要、选择和重测说明。",
    inputSchema: z.object({ projectId: z.string().uuid(), parentRunId: z.string().uuid(), caseIds: z.array(z.string().min(1).max(80)).min(1).max(200).refine(ids => new Set(ids).size === ids.length, "caseIds 必须唯一"), notes: z.string().max(2000).optional(), runMode: z.enum(["regression", "compare"]).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, guarded(async ({ projectId, parentRunId, caseIds, notes, runMode }) => {
    const started = await request<{ runId: string; projectId: string; status: string; stage: string; progress: unknown }>(`/api/document-projects/${projectId}/retest`, { method: "POST", body: JSON.stringify({ parentRunId, caseIds, ...(notes ? { notes } : {}), ...(runMode ? { runMode } : {}) }) });
    return textResult({ ...started, parentRunId, retestSelection: caseIds, next: "定向重测已在后台启动。请按 runId 调用 testpilot_get_web_run_progress 轮询；完成后读取结果并导出报告。不要重复启动同一轮。" });
  }));

  server.registerTool("testpilot_get_web_run_progress", {
    title: "轮询网站测试运行进度",
    description: "按 runId 读取持久化的文档测试阶段、当前用例及通道结果。running 时继续轮询；completed 时结果内含完整 run；进程重启后仍可按运行 ID 读取 journal 或完成记录。只读。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => textResult(await request(`/api/document-runs/${runId}/progress`))));
  server.registerTool("testpilot_get_web_run", {
    title: "读取网站测试运行结果",
    description: "读取一次网页测试运行的状态、证据摘要及逐用例结果。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => textResult(await request(`/api/document-runs/${runId}`))));

  server.registerTool("testpilot_export_web_run", {
    title: "导出网站测试报告与脚本包",
    description: "导出本轮 Markdown 报告和 ZIP 脚本包。若双通道尚未对齐，产物会明确标注为部分结果或待复核，不能视为测试通过。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => {
    const run = await request<{ finalReady: boolean; reportReady?: boolean; packageReady?: boolean; report: string }>(`/api/document-runs/${runId}`);
    if ((!run.reportReady && !run.report) || (!run.packageReady && !run.finalReady)) throw new Error("本轮报告或脚本包尚未生成。");
    const report = await requestText(`/api/document-runs/${runId}/report`);
    const archive = await requestBase64(`/api/document-runs/${runId}/package`);
    return {
      content: [
        { type: "text" as const, text: `${run.finalReady ? "双通道逐用例对齐报告" : "部分运行报告：双通道尚未完全对齐，blocked 项不能视为通过或产品失败"}\n\n${report}` },
        { type: "resource" as const, resource: { uri: `testpilot://runs/${runId}/package.zip`, mimeType: "application/zip", blob: archive } },
      ],
    };
  }));

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

  server.registerTool("testpilot_prepare_sqlite_migration_test", {
    title: "准备 SQLite 迁移测试",
    description: "创建 SQLite migration 测试草稿。提交 suite JSON 和其引用的 SQL 相对路径文件；只校验并保存，不执行。",
    inputSchema: z.object({ suiteJson: z.string().min(2).max(5_000_000), files: z.record(z.string().max(240), z.string().max(512_000)) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteJson, files }) => {
    let suite: unknown; try { suite = JSON.parse(suiteJson); } catch { throw new Error("suiteJson is not valid JSON."); }
    const candidate = await request<{ id: string; status: string; digest: string; suite: { name: string; scenarios: unknown[] } }>("/api/sqlite-migration-suites", { method: "POST", body: JSON.stringify({ suite, files }) });
    return textResult({ suiteId: candidate.id, status: candidate.status, name: candidate.suite.name, scenarios: candidate.suite.scenarios.length, digest: candidate.digest, next: "Inspect the suite, SQL sources and expected failure behavior, then explicitly approve before running." });
  }));

  server.registerTool("testpilot_get_sqlite_migration_test", {
    title: "读取 SQLite 迁移测试",
    description: "读取已保存迁移套件、SQL 源码、摘要和审核状态。",
    inputSchema: z.object({ suiteId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ suiteId }) => textResult(await request(`/api/sqlite-migration-suites/${suiteId}`))));

  server.registerTool("testpilot_update_sqlite_migration_test", {
    title: "修订 SQLite 迁移测试",
    description: "修订 draft 迁移套件和 SQL 源码。保存后版本递增并重算 digest；已审核版本不可修改。",
    inputSchema: z.object({ suiteId: z.string().uuid(), suiteJson: z.string().min(2).max(5_000_000), files: z.record(z.string().max(240), z.string().max(512_000)) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteId, suiteJson, files }) => {
    let suite: unknown; try { suite = JSON.parse(suiteJson); } catch { throw new Error("suiteJson is not valid JSON."); }
    return textResult(await request(`/api/sqlite-migration-suites/${suiteId}/update`, { method: "POST", body: JSON.stringify({ suite, files }) }));
  }));

  server.registerTool("testpilot_review_sqlite_migration_test", {
    title: "审核 SQLite 迁移测试",
    description: "记录用户明确作出的批准或拒绝。只有批准且 digest 未变化的套件才能运行。",
    inputSchema: z.object({ suiteId: z.string().uuid(), decision: z.enum(["approve", "reject"]), notes: z.string().max(2000) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteId, decision, notes }) => textResult(await request(`/api/sqlite-migration-suites/${suiteId}/review`, { method: "POST", body: JSON.stringify({ decision, notes }) }))));

  server.registerTool("testpilot_run_approved_sqlite_migration_test", {
    title: "运行已批准的 SQLite 迁移测试",
    description: "只在独立内存 SQLite 子进程中运行已批准套件；不连接外部或生产数据库。超时返回 blocked。",
    inputSchema: z.object({ suiteId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, guarded(async ({ suiteId }) => {
    const run = await request<{ runId: string; status: string; results: Array<{ status: string }> ; limitations: string[] }>(`/api/sqlite-migration-suites/${suiteId}/run`, { method: "POST", body: "{}" });
    return textResult({ runId: run.runId, status: run.status, counts: Object.fromEntries(["passed", "failed", "blocked", "error"].map(status => [status, run.results.filter(item => item.status === status).length])), limitations: run.limitations, next: "Read the run evidence and export the report and reusable ZIP." });
  }));

  server.registerTool("testpilot_export_sqlite_migration_run", {
    title: "导出 SQLite 迁移测试报告与脚本包",
    description: "导出 Markdown 报告和包含原始 suite、SQL 源码及结构化证据的 ZIP。",
    inputSchema: z.object({ runId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, guarded(async ({ runId }) => {
    const run = await request(`/api/sqlite-migration-runs/${runId}`);
    const report = await requestText(`/api/sqlite-migration-runs/${runId}/report`);
    const archive = await requestBase64(`/api/sqlite-migration-runs/${runId}/package`);
    return { content: [
      { type: "text" as const, text: `SQLite migration run evidence\n\n${JSON.stringify(run, null, 2)}\n\n${report}` },
      { type: "resource" as const, resource: { uri: `testpilot://sqlite-migration-runs/${runId}/package.zip`, mimeType: "application/zip", blob: archive } },
    ] };
  }));

  server.registerTool("testpilot_list_local_projects", {
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

  return server;
}

void serveStdio(createServer);
