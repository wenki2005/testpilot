/** Explicit loopback HTTP bridge used by MCP tools to call the shared TestPilot server. */
export function createTestPilotHttpClient(baseUrl: string) {
  const apiBase = new URL(baseUrl);
  if (apiBase.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(apiBase.hostname)) {
    throw new Error("TESTPILOT_BASE_URL must be a loopback HTTP URL, for example http://127.0.0.1:4330");
  }
  return {
    baseUrl: apiBase.origin,
    async request<T>(pathname: string, init?: RequestInit): Promise<T> {
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
    },
    async requestText(pathname: string): Promise<string> {
      const response = await fetch(new URL(pathname, apiBase), { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    },
    async requestBase64(pathname: string): Promise<string> {
      const response = await fetch(new URL(pathname, apiBase), { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer()).toString("base64");
    },
  };
}
