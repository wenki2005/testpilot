import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
/** Maintenance only: no execution, browser, SQL, shell or notification capability. */
export function registerCaseMaintenanceTools(server: McpServer, request: <T>(route: string, body?: unknown) => Promise<T>, systemId: string) {
    const result = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
    const register = (name: string, description: string, schema: z.ZodObject<any>, readOnly: boolean, handler: (args: any) => Promise<unknown>) => server.registerTool(name, {
        description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly },
    }, async args => { try { return result(await handler(args)); } catch (error) { return { ...result({ error: error instanceof Error ? error.message : String(error) }), isError: true }; } });
    const root = '/api/system-module-regression';
    const catalog = () => request<{ cases: Array<Record<string, any>>; modules: unknown[] }>(root + '/case-editor?systemId=' + systemId);
    const find = async (caseId: string, moduleId?: string) => { const rows = (await catalog()).cases.filter(c => c.id === caseId && (!moduleId || c.moduleId === moduleId)); if (rows.length !== 1) throw Error('用例不存在或编号重复，请指定moduleId。'); return rows[0]!; };
    const identity = z.object({ caseId: z.string().min(1).max(80), moduleId: z.uuid().optional() }).strict();
    register('testpilot_cases', '列出当前项目的用例和模块，可按编号或内容搜索。只读。', z.object({ search: z.string().max(500).optional() }).strict(), true, async ({ search }) => { const c = await catalog(); return { systemId, modules: c.modules, cases: c.cases.filter(c => !search || (c.id + ' ' + c.title).includes(search)).map(({ id, moduleId, title, version, versionId, changeSource }) => ({ id, moduleId, title, version, versionId, changeSource })) }; });
    register('testpilot_pending_script_reviews', '列出当前项目所有脚本待核对用例及脚本路径，供AI批量整理前逐条读取。只读，不会修改或执行。', z.object({}).strict(), true, async () => { const c = await catalog(); return { systemId, count: c.cases.filter(item => item.scriptReview?.status === 'pending').length, cases: c.cases.filter(item => item.scriptReview?.status === 'pending').map(({ id, moduleId, title, version, versionId, scriptPath, scriptReview }) => ({ id, moduleId, title, version, versionId, scriptPath, note: scriptReview?.note ?? '' })) }; });
    register('testpilot_case', '读取完整用例、前置、脚本和有效版本。', identity, true, ({ caseId, moduleId }) => find(caseId, moduleId));
    register('testpilot_case_versions', '读取指定用例的历史版本。', identity, true, async ({ caseId, moduleId }) => { const c = await find(caseId, moduleId); return request(root + '/case-editor/' + c.moduleId + '/' + encodeURIComponent(caseId)); });
    register('testpilot_save_case', '将已展示给用户的修改保存为新版本，不执行测试。先读取用例，保留versionId；版本过期会拒绝。', z.object({ moduleId: z.uuid(), change: z.record(z.string(), z.unknown()) }).strict(), false, async ({ moduleId, change }) => { await find(String(change.caseId), moduleId); return request(root + '/maintenance/save', { systemId, moduleId, change }); });
    register('testpilot_resources', '读取完整定义和revision，供新增、移除用例或整份维护。没有运行数据。', z.object({}).strict(), true, () => request(root + '/resources?systemId=' + systemId));
    register('testpilot_preview_resources', '校验完整修改，返回新增、修改、移除和版本冲突基线。先展示对比再应用。', z.object({ resources: z.record(z.string(), z.unknown()) }).strict(), true, ({ resources }) => { if ((resources.project as { id?: string })?.id !== systemId) throw Error('只允许维护配置的项目。'); return request(root + '/resources/preview', resources); });
    register('testpilot_apply_resources', '应用已预览的完整定义，支持新增用例；baseRevision必须来自最新预览。不执行测试。', z.object({ resources: z.record(z.string(), z.unknown()), baseRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), false, ({ resources, baseRevision }) => { if ((resources.project as { id?: string })?.id !== systemId) throw Error('只允许维护配置的项目。'); return request(root + '/maintenance/resources', { resources, baseRevision }); });
}
