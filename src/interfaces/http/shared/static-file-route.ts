import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
/** Serve a built workbench asset or SPA route from its configured output root. */
export async function handleStaticFile(pathname: string, res: ServerResponse, distributionDirectory: string): Promise<boolean> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    }
    catch {
        return false;
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const root = path.resolve(distributionDirectory);
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
        return false;
    let file = resolved;
    try {
        if (!(await stat(file)).isFile())
            return false;
    }
    catch {
        if (!path.extname(relative))
            file = path.join(root, "index.html");
        else
            return false;
    }
    try {
        const content = await readFile(file);
        const ext = path.extname(file).toLowerCase();
        const type: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };
        res.writeHead(200, { "content-type": type[ext] ?? "application/octet-stream", "content-length": content.byteLength, "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
        res.end(content);
        return true;
    }
    catch {
        return false;
    }
}
