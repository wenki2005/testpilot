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
export function registerSqliteMigrationTools(server: McpServer, { request, requestText, requestBase64, textResult, guarded }: Dependencies): void {
    server.registerTool("testpilot_prepare_sqlite_migration_test", {
        title: "准备 SQLite 迁移测试",
        description: "创建 SQLite migration 测试草稿。提交 suite JSON 和其引用的 SQL 相对路径文件；只校验并保存，不执行。",
        inputSchema: z.object({ suiteJson: z.string().min(2).max(5000000), files: z.record(z.string().max(240), z.string().max(512000)) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, guarded(async ({ suiteJson, files }) => {
        let suite: unknown;
        try {
            suite = JSON.parse(suiteJson);
        }
        catch {
            throw new Error("suiteJson is not valid JSON.");
        }
        const candidate = await request<{
            id: string;
            status: string;
            digest: string;
            suite: {
                name: string;
                scenarios: unknown[];
            };
        }>("/api/sqlite-migration-suites", { method: "POST", body: JSON.stringify({ suite, files }) });
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
        inputSchema: z.object({ suiteId: z.string().uuid(), suiteJson: z.string().min(2).max(5000000), files: z.record(z.string().max(240), z.string().max(512000)) }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, guarded(async ({ suiteId, suiteJson, files }) => {
        let suite: unknown;
        try {
            suite = JSON.parse(suiteJson);
        }
        catch {
            throw new Error("suiteJson is not valid JSON.");
        }
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
        const run = await request<{
            runId: string;
            status: string;
            results: Array<{
                status: string;
            }>;
            limitations: string[];
        }>(`/api/sqlite-migration-suites/${suiteId}/run`, { method: "POST", body: "{}" });
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
}
