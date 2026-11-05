import type { IncomingMessage } from "node:http";

export type LocalRequestPolicyResult = { url: URL } | { status: 400 | 403; message: string };

function isLoopbackHost(value: string): boolean {
  return value === "127.0.0.1" || value === "localhost" || value === "[::1]";
}

/** Applies the local workbench host/origin boundary before any API route runs. */
export function evaluateLocalRequestPolicy(req: Pick<IncomingMessage, "headers" | "url">, base: string): LocalRequestPolicyResult {
  const hostHeader = req.headers.host ?? "";
  let parsedHost: string;
  try { parsedHost = new URL(`http://${hostHeader}`).hostname; }
  catch { return { status: 400, message: "invalid host" }; }
  if (!isLoopbackHost(parsedHost)) return { status: 403, message: "loopback requests only" };

  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "http:" || parsedOrigin.host !== hostHeader || !isLoopbackHost(parsedOrigin.hostname)) {
        return { status: 403, message: "same-origin requests only" };
      }
    } catch { return { status: 403, message: "same-origin requests only" }; }
  }
  return { url: new URL(req.url ?? "/", base) };
}
