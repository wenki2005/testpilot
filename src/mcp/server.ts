import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { createTestPilotHttpClient } from "../interfaces/mcp/http-client.js";
import { registerApiTestTools } from "../interfaces/mcp/api-test-tools.js";
import { registerSqliteMigrationTools } from "../interfaces/mcp/sqlite-migration-tools.js";
import { registerLocalScriptTools } from "../interfaces/mcp/local-script-tools.js";
import { registerDocumentTestTools } from "../interfaces/mcp/document-test-tools.js";
const { baseUrl: apiBase, request, requestText, requestBase64 } = createTestPilotHttpClient(process.env.TESTPILOT_BASE_URL ?? "http://127.0.0.1:4317");
function textResult(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
type ToolOutput = CallToolResult;
function guarded<TArgs>(handler: (args: TArgs) => Promise<ToolOutput>) {
    return async (args: TArgs): Promise<ToolOutput> => {
        try {
            return await handler(args);
        }
        catch (error) {
            return { content: [{ type: "text" as const, text: `TestPilot error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
    };
}
function createServer() {
    const server = new McpServer({ name: "testpilot-qa", version: "1.0.0" }, { maxToolInputElements: 20000 });
    server.registerTool("testpilot_status", {
        title: "TestPilot 状态",
        description: "读取 TestPilot 连接、模型和当前测试项目概况。只读。",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, guarded(async () => {
        const [config, projects, profiles] = await Promise.all([
            request<Record<string, unknown>>("/api/config"),
            request<Array<{
                id: string;
                name: string;
                cases: unknown[];
                reviewStatus?: string;
            }>>("/api/document-projects"),
            request<Array<{
                id: string;
                name: string;
                suiteName: string;
            }>>("/api/project-profiles"),
        ]);
        return textResult({ baseUrl: apiBase, modelAvailable: config.modelAvailable, modelLabel: config.modelLabel, documentProjects: projects.map(({ id, name, cases, reviewStatus }) => ({ id, name, caseCount: cases.length, reviewStatus })), localProjects: profiles });
    }));
    registerDocumentTestTools(server, { request, requestText, requestBase64, textResult, guarded });
    registerApiTestTools(server, { request, requestText, requestBase64, textResult, guarded });
    registerSqliteMigrationTools(server, { request, requestText, requestBase64, textResult, guarded });
    registerLocalScriptTools(server, { request, requestText, requestBase64, textResult, guarded });
    return server;
}
void serveStdio(createServer);
