import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY = 64 * 1024;

export function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store", ...headers });
  res.end(data);
}

export function fail(res: ServerResponse, status: number, message: string): void { json(res, status, { error: message }); }

export async function bodyJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("request body too large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("request body must be valid JSON"); }
}

export async function documentBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > 64 * 1024 * 1024) throw new Error("资料请求超过 64 MB。最多附加 5 个文件，每个不超过 9 MB。"); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("request body must be valid JSON"); }
}

export async function migrationBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > 7 * 1024 * 1024) throw new Error("SQLite migration suite request exceeds 7 MB."); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("request body must be valid JSON"); }
}
