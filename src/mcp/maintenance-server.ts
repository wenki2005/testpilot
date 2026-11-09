import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { registerCaseMaintenanceTools } from '../interfaces/mcp/case-maintenance-tools.js';
const base = new URL(process.env.TESTPILOT_BASE_URL ?? 'http://127.0.0.1:4325/dify/');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw Error('TESTPILOT_BASE_URL必须是无凭据的本机HTTP地址。');
const systemId = z.uuid().parse(process.env.TESTPILOT_SYSTEM_ID);
const prefix = base.pathname.replace(/\/$/, '');
const request = async <T>(route: string, body?: unknown): Promise<T> => {
    const response = await fetch(new URL(prefix + route, base.origin), { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const value = await response.json() as { error?: string };
    if (!response.ok) throw Error(value.error ?? 'TestPilot HTTP ' + response.status);
    return value as T;
};
void serveStdio(() => { const server = new McpServer({ name: 'testpilot-case-maintenance', version: '1.0.0' }, { maxToolInputElements: 100000 }); registerCaseMaintenanceTools(server, request, systemId); return server; });
