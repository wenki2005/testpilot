import type { IncomingMessage, ServerResponse } from "node:http";
import { bodyJson, fail, json } from "../shared/http-utils.js";
export interface MysqlRouteDependencies {
    connect(input: {
        user: unknown;
        password: unknown;
        tlsMode?: unknown;
    }): Promise<unknown>;
    disconnect(): Promise<void>;
    listColumns(table: string): Promise<unknown>;
    listTables(): Promise<unknown>;
    config(): unknown;
    status(): unknown;
    readRows(table: string, offset: number, limit: number): Promise<unknown>;
}
/** Owns the read-only database explorer routes; returns false for unrelated paths. */
export async function handleMysqlRoutes(req: IncomingMessage, res: ServerResponse, url: URL, deps: MysqlRouteDependencies): Promise<boolean> {
    if (req.method === "GET" && url.pathname === "/api/mysql/status") {
        json(res, 200, deps.status());
        return true;
    }
    if (req.method === "POST" && url.pathname === "/api/mysql/connect") {
        let data: any;
        try {
            data = await bodyJson(req);
        }
        catch (error) {
            fail(res, 400, String((error as Error).message));
            return true;
        }
        if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !["user", "password", "tlsMode"].includes(key))) {
            fail(res, 400, "连接请求只接受用户名、密码和 TLS 模式。");
            return true;
        }
        if (data.tlsMode !== undefined && !["verify-certificate", "encrypted-unverified"].includes(data.tlsMode)) {
            fail(res, 400, "MySQL TLS 模式无效。");
            return true;
        }
        try {
            json(res, 200, await deps.connect({ user: data.user, password: data.password, ...(data.tlsMode !== undefined ? { tlsMode: data.tlsMode } : {}) }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "无法连接测试库。";
            fail(res, 422, message.includes("只读") || message.includes("TLS") || message.includes("格式") || message.includes("无效") ? message : "无法连接测试库，请检查用户名、密码和网络；密码未保存。");
        }
        return true;
    }
    if (req.method === "POST" && url.pathname === "/api/mysql/disconnect") {
        try {
            await deps.disconnect();
            json(res, 200, { connected: false, ...(deps.config() as object) });
        }
        catch {
            fail(res, 500, "断开 MySQL 连接失败。");
        }
        return true;
    }
    if (req.method === "GET" && url.pathname === "/api/mysql/tables") {
        try {
            json(res, 200, await deps.listTables());
        }
        catch (error) {
            fail(res, 409, error instanceof Error && error.message.includes("尚未连接") ? error.message : "读取数据表清单失败；请确认数据库连接仍有效。");
        }
        return true;
    }
    const columnsRoute = url.pathname.match(/^\/api\/mysql\/tables\/([^/]+)\/columns$/u);
    if (req.method === "GET" && columnsRoute) {
        try {
            json(res, 200, await deps.listColumns(decodeURIComponent(columnsRoute[1]!)));
        }
        catch (error) {
            fail(res, 422, error instanceof Error && (error.message.includes("尚未连接") || error.message.includes("找不到") || error.message.includes("无效")) ? error.message : "读取数据表结构失败。");
        }
        return true;
    }
    const rowsRoute = url.pathname.match(/^\/api\/mysql\/tables\/([^/]+)\/rows$/u);
    if (req.method === "GET" && rowsRoute) {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "25");
        try {
            json(res, 200, await deps.readRows(decodeURIComponent(rowsRoute[1]!), offset, limit));
        }
        catch (error) {
            fail(res, 422, error instanceof Error && (error.message.includes("尚未连接") || error.message.includes("必须在") || error.message.includes("找不到") || error.message.includes("无效")) ? error.message : "读取当前数据页失败；请确认连接有效且查询可在短时间内完成。");
        }
        return true;
    }
    return false;
}
